# desktop/

English | [中文](README.zh.md)

A Tauri desktop shell hosting the [DeepSeek Harness Web GUI](../packages/bundle/web-app/README.md). The shell owns the `dsh web` server lifecycle; the harness backend itself is unchanged and still runs as a Node process.

## What it is

- `src-tauri/` — the Rust shell. It starts the server, waits for readiness, loads the GUI URL in the window, and stops the server on exit.
- `ui/` — a placeholder page shown while the server starts; the harness GUI replaces it on readiness.

The webview is a plain browser surface: the shell exposes no Tauri IPC, and the GUI talks to the server over HTTP/WebSocket exactly as it does in a browser.

## Server lifecycle

On launch the shell starts `dsh web --port 0` (the OS assigns a free port), parses the readiness line the web profile prints (`dsh web: http://127.0.0.1:<port>`), then navigates the window to that URL. Closing the window quits the app; on every exit path the shell stops the child with SIGTERM, then SIGKILL after a 3-second grace period. Server stdout is forwarded to the shell's terminal with a `[dsh]` prefix.

Server command resolution, in order:

1. `DSH_DESKTOP_SERVER` environment variable — whitespace-split command words.
2. Development builds — the checkout's built CLI: `node apps/cli/lib/bin.js web --port 0`, working directory the repository root.
3. Packaged builds — `dsh web --port 0` resolved from `PATH`, working directory `$HOME`.

## Prerequisites

- A Rust toolchain (rustc 1.77 or newer) and the Tauri CLI: `cargo install tauri-cli --locked`.
- Development runs need a built checkout (`pnpm install && pnpm run build`); the dev shell spawns `apps/cli/lib/bin.js`.
- Packaged builds need `dsh` on `PATH` — the shell does not bundle a Node runtime.

## Run

```sh
cd desktop && cargo tauri dev
# or from the repository root: pnpm run desktop:dev
```

The window opens on the placeholder page and switches to the GUI once the server is ready. A server that fails to start (or dies later) reports the reason in the window and in the terminal.

## Build

```sh
cd desktop && cargo tauri build
# or from the repository root: pnpm run desktop:build
```

Output: `src-tauri/target/release/bundle/macos/DeepSeek Harness.app`. The bundle is unsigned and runs locally.

## Known Limitations and Deferred Work

- Packaged builds require `dsh` on `PATH`: bundling the harness CLI plus a Node runtime into the app bundle is deferred.
- The shell kills the spawned process, not its process group; a `DSH_DESKTOP_SERVER` pipeline may leave children behind. A SIGKILL of the shell (Force Quit) skips every shutdown path and orphans the server.
- macOS is the verified target; the Windows and Linux webview backends are untested.
