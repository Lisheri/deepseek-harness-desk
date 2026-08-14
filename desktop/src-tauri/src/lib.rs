//! Tauri desktop shell for the DeepSeek Harness Web GUI.
//!
//! The shell owns the `dsh web` server lifecycle: it starts the server as a
//! child process on launch (`--port 0`, so the OS assigns a free port), waits
//! for the readiness line the web profile prints (`dsh web: http://127.0.0.1:<port>`),
//! navigates the webview to that URL, and kills the child when the app exits.
//! The webview is a plain browser surface: no Tauri IPC is exposed to it.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

/// The readiness line prefix the web profile prints once the server is up.
const READY_LINE_PREFIX: &str = "dsh web: http://";
/// How long the shell waits for the readiness line before giving up.
const READY_TIMEOUT: Duration = Duration::from_secs(60);
/// Grace period between SIGTERM and SIGKILL when stopping the server.
const STOP_GRACE: Duration = Duration::from_secs(3);

/// Shared server-process state between the run loop and the monitor thread.
struct ServerState {
    child: Mutex<Option<Child>>,
    /// Set once shutdown begins, so the monitor does not report an exit we requested.
    stopping: AtomicBool,
}

impl ServerState {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            stopping: AtomicBool::new(false),
        }
    }
}

/// The repository root, fixed at compile time from the manifest location.
/// `<repo>/desktop/src-tauri` -> `<repo>`. Development builds only: the
/// packaged shell resolves the bundled executable instead.
#[cfg(dev)]
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("manifest is nested two levels under the repository root")
        .to_path_buf()
}

/// Resolve the bundled single-file dsh executable from the resource directory.
/// The macOS bundler keeps the configured `resources/` directory name in the
/// bundle layout; probe that layout first, then the flat one.
#[cfg(not(dev))]
fn bundled_exe(resources: &PathBuf) -> Option<PathBuf> {
    for candidate in [resources.join("resources").join("dsh"), resources.join("dsh")] {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Resolve the command that launches the dsh web server, plus its working directory.
///
/// Order: `DSH_DESKTOP_SERVER` (whitespace-split command words) overrides
/// everything; dev builds default to the checkout's built CLI
/// (`node apps/cli/lib/bin.js web --port 0`); packaged builds prefer the
/// bundled single-file `dsh` executable from the app resources (built by
/// scripts/build-exe-for-desktop-shell.ts) and fall back to `dsh` on PATH.
/// @param resources - the Tauri resource directory (`Contents/Resources` in the bundle).
fn server_command(resources: Option<PathBuf>) -> Result<(Command, PathBuf), String> {
    if let Ok(custom) = std::env::var("DSH_DESKTOP_SERVER") {
        let mut words = custom.split_whitespace();
        let program = words
            .next()
            .ok_or_else(|| "DSH_DESKTOP_SERVER is set but empty".to_string())?;
        let mut cmd = Command::new(program);
        cmd.args(words);
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
        return Ok((cmd, cwd));
    }
    #[cfg(dev)]
    {
        let _ = &resources; // dev builds ignore the bundled executable
        let cli = repo_root().join("apps/cli/lib/bin.js");
        let mut cmd = Command::new("node");
        cmd.arg(&cli).args(["web", "--port", "0"]);
        return Ok((cmd, repo_root()));
    }
    #[cfg(not(dev))]
    {
        let cwd = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/"));
        if let Some(exe) = resources.as_ref().and_then(bundled_exe) {
            let mut cmd = Command::new(&exe);
            cmd.args(["web", "--port", "0"]);
            return Ok((cmd, cwd));
        }
        let mut cmd = Command::new("dsh");
        cmd.args(["web", "--port", "0"]);
        return Ok((cmd, cwd));
    }
}

/// Extract the canonical URL from a readiness line.
/// Accepts `dsh web: http://127.0.0.1:3080` and the LAN suffix form.
fn parse_ready_url(line: &str) -> Option<String> {
    let authority = line.strip_prefix(READY_LINE_PREFIX)?.split(' ').next()?;
    if !authority.starts_with("127.0.0.1:") || authority.len() == "127.0.0.1:".len() {
        return None;
    }
    Some(format!("http://{authority}"))
}

/// Spawn the server, wait for its readiness line, and return the Web URL.
/// On failure the child is reaped and the reason is returned.
/// @param resources - the Tauri resource directory passed to {@link server_command}.
fn spawn_server(state: &ServerState, resources: Option<PathBuf>) -> Result<String, String> {
    let (mut cmd, cwd) = server_command(resources)?;
    let child = cmd
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    // The server runs in its own process group: the shell stays its sole
    // controller, terminal signals reach it only through the shell's cleanup,
    // and one group signal stops a DSH_DESKTOP_SERVER pipeline as a whole.
    #[cfg(unix)]
    child.process_group(0);
    let mut child = child
        .spawn()
        .map_err(|error| format!("failed to start dsh web: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "dsh web stdout unavailable".to_string())?;

    // Drain stdout forever: forward lines to our stdout and yield them to the
    // readiness wait, so the server never blocks on a full pipe.
    let (lines_tx, lines_rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            println!("[dsh] {line}");
            if lines_tx.send(line).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + READY_TIMEOUT;
    while Instant::now() < deadline {
        match lines_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(line) => {
                if let Some(url) = parse_ready_url(&line) {
                    *state.child.lock().expect("server state lock poisoned") = Some(child);
                    return Ok(url);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(Some(status)) = child.try_wait() {
                    return Err(format!("dsh web exited before becoming ready (status {status})"));
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    terminate(&mut child);
    let _ = child.wait();
    Err(format!(
        "dsh web did not print its readiness line within {}s",
        READY_TIMEOUT.as_secs()
    ))
}

/// Ask the server's process group to shut down with a signal.
/// The child runs in its own process group (see {@link spawn_server}), so one
/// signal reaches a `DSH_DESKTOP_SERVER` pipeline, not just the direct child.
#[cfg(unix)]
fn signal_group(child: &mut Child, signal: &str) {
    let _ = Command::new("kill")
        .args([format!("-{signal}"), format!("-{}", child.id())])
        .status();
}

/// Ask the server to shut down: SIGTERM to the process group (unix), then
/// SIGKILL after a grace period.
#[cfg(unix)]
fn terminate(child: &mut Child) {
    signal_group(child, "TERM");
}

/// Ask the server to shut down (non-unix: straight kill).
#[cfg(not(unix))]
fn terminate(child: &mut Child) {
    let _ = child.kill();
}

/// Stop the managed server, idempotently. Called on every exit path.
fn kill_server(state: &ServerState) {
    if state.stopping.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(mut child) = state.child.lock().expect("server state lock poisoned").take() else {
        return;
    };
    let pid = child.id();
    terminate(&mut child);
    let deadline = Instant::now() + STOP_GRACE;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            _ => {
                #[cfg(unix)]
                signal_group(&mut child, "KILL");
                #[cfg(not(unix))]
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    println!("[dsh-desktop] stopped dsh web (pid {pid})");
}

/// Run the desktop shell.
pub fn run() {
    let state = Arc::new(ServerState::new());
    // SIGINT/SIGTERM can reach this process without a Tauri exit event (Ctrl-C
    // in `cargo tauri dev`); the handler stops the server before dying.
    let signal_state = Arc::clone(&state);
    ctrlc::set_handler(move || {
        kill_server(&signal_state);
        std::process::exit(0);
    })
    .expect("failed to install signal handler");
    let app = tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            let handle = app.handle().clone();
            let resources = app.path().resource_dir().ok();
            thread::spawn(move || {
                let state = handle.state::<Arc<ServerState>>();
                let window = handle
                    .get_webview_window("main")
                    .expect("main window declared in tauri.conf.json");
                match spawn_server(&state, resources) {
                    Ok(url) => {
                        let script = format!(
                            "window.location.replace({});",
                            serde_json::to_string(&url).expect("URL serializes")
                        );
                        if let Err(error) = window.eval(&script) {
                            eprintln!("[dsh-desktop] navigation failed: {error}");
                        }
                        // Monitor the server for unexpected exits while the app lives.
                        loop {
                            thread::sleep(Duration::from_secs(1));
                            if state.stopping.load(Ordering::SeqCst) {
                                return;
                            }
                            let exited = {
                                let mut guard = state.child.lock().expect("server state lock poisoned");
                                match guard.as_mut() {
                                    Some(child) => matches!(child.try_wait(), Ok(Some(_))),
                                    None => true,
                                }
                            };
                            if exited {
                                let message = "dsh web server exited unexpectedly";
                                eprintln!("[dsh-desktop] {message}");
                                let script = format!(
                                    "window.__dshDesktopStatus && window.__dshDesktopStatus({});",
                                    serde_json::to_string(message).expect("message serializes")
                                );
                                let _ = window.eval(&script);
                                return;
                            }
                        }
                    }
                    Err(error) => {
                        eprintln!("[dsh-desktop] {error}");
                        let script = format!(
                            "window.__dshDesktopStatus && window.__dshDesktopStatus({});",
                            serde_json::to_string(&error).expect("error serializes")
                        );
                        let _ = window.eval(&script);
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the tauri application");
    app.run(|app: &tauri::AppHandle, event: tauri::RunEvent| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            kill_server(&app.state::<Arc<ServerState>>());
        }
        // Closing the window quits the app, so the server follows the shell.
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { .. },
            ..
        } => {
            app.exit(0);
        }
        _ => {}
    });
}
