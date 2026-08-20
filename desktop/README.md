# desktop/

English | [中文](README.zh.md)

A Tauri desktop shell hosting the [DeepSeek Harness Web GUI](../packages/bundle/web-app/README.md). The shell owns the `dsh web` server lifecycle; the harness backend itself is unchanged and still runs as a Node process.

## What it is

- `src-tauri/` — the Rust shell. It starts the server, waits for readiness, loads the GUI URL in the window, and stops the server on exit.
- `ui/` — a placeholder page shown while the server starts; the harness GUI replaces it on readiness.
- `runtime/` — a dependency-only deploy root manifest whose closure becomes the bundled single-file `dsh` executable.
- `src-tauri/resources/` — the build products: the single-file `dsh` executable plus the node-pty `dsh-spawn-helper`, bundled into the app via `bundle.resources`.

The webview stays browser-grade — the GUI talks to the server over HTTP/WebSocket exactly as it does in a browser — with one desktop-chrome edge: the shell builds a Chinese native menu (文件 → 新聊天 / 添加新工作区, 编辑, 窗口) and forwards those two file actions to the webview as `desktop-menu` events (its only IPC, under the `core:event:default` capability). The window runs an overlay titlebar (`titleBarStyle: Overlay`, `hiddenTitle`); the GUI draws the chrome row itself — fold, undo/redo, the 文件操作 dropdown, and the `data-tauri-drag-region` drag area — see [ui-titlebar](../packages/client/ui-titlebar/README.md).

## Server lifecycle

On launch the shell starts `dsh web --port 0` (the OS assigns a free port), parses the readiness line the web profile prints (`dsh web: http://127.0.0.1:<port>`), then navigates the window to that URL. Closing the window quits the app; on every exit path the shell stops the child with SIGTERM, then SIGKILL after a 3-second grace period. Server stdout is forwarded to the shell's terminal with a `[dsh]` prefix.

Server command resolution, in order:

1. `DSH_DESKTOP_SERVER` environment variable — whitespace-split command words.
2. Development builds — the checkout's built CLI: `node apps/cli/lib/bin.js web --port 0`, working directory the repository root.
3. Packaged builds — the bundled `dsh` executable from the app resources, working directory `$HOME`.
4. Packaged builds without a bundled executable — `dsh web --port 0` resolved from `PATH`, working directory `$HOME`.

## Prerequisites

- A Rust toolchain (rustc 1.77 or newer) and the Tauri CLI: `cargo install tauri-cli --locked`.
- Development runs need a built checkout (`pnpm install && pnpm run build`); the dev shell spawns `apps/cli/lib/bin.js`.
- Packaged builds need a built checkout plus network access for the single-file build ([`scripts/build-exe-for-desktop-shell.ts`](../../scripts/build-exe-for-desktop-shell.ts) downloads the Node base and `@yao-pkg/pkg`).

## Run

```sh
cd desktop && cargo tauri dev
```

The window opens on the placeholder page and switches to the GUI once the server is ready. A server that fails to start (or dies later) reports the reason in the window and in the terminal.

## Build

```sh
pnpm run desktop:build
```

The single-file build alone is `pnpm run desktop:exe` (flags: `--targets=node24-macos-arm64,node24-macos-x64`, `--skip-build`, `--dry-run`).

Output: `src-tauri/target/release/bundle/macos/DeepSeek Harness.app` and `src-tauri/target/release/bundle/dmg/DeepSeek Harness_<version>_aarch64.dmg`. Both are unsigned and run locally; the app carries its own server, so no separate `dsh` installation is needed.

## Known Limitations and Deferred Work

- The server runs in its own process group and shutdown signals the whole group; a SIGKILL of the shell (Force Quit) still skips every shutdown path and orphans the server.
- macOS is the verified target; the Windows and Linux webview backends are untested.
- The bundled `dsh` executable is an unsigned nested binary: signing and notarizing the app for Gatekeeper-less distribution must sign it alongside the app bundle.
- API credentials: Finder-launched apps do not inherit shell environment variables; set `DEEPSEEK_API_KEY` through the GUI's credentials plane instead.
- First launch materializes the bundled closure into `$DSH_HOME/profiles/node_modules` (a few hundred MB); a later source-checkout `dsh` run converts it back to symlinks automatically.
