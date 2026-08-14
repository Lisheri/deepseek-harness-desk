# Agent Note: Tauri desktop shell over the Web GUI owns the dsh web server lifecycle

Status: implemented

English | [中文](2026-08-14-tauri-desktop-shell.zh.md)

## Problem

The DeepSeek Harness Web GUI runs in a browser, but desktop users want one self-contained app whose window owns the server: no terminal to start `dsh web`, no browser tab to find, and no server left behind when the window closes.

## Decision

Ship `desktop/`, a Tauri v2 shell outside the pnpm workspace. The harness backend is unchanged: the shell spawns `dsh web --port 0` as a child process, parses the readiness line the web profile prints (`dsh web: http://127.0.0.1:<port>`), then navigates its window there. The ephemeral port means concurrent shells and any other server on the default port never collide.

The webview is a plain browser surface: the shell registers no Tauri commands, plugins, or capabilities, so the GUI's HTTP/WebSocket transport and `window.__DSH_BOOT__` injection work exactly as in a browser. The placeholder page under `desktop/ui/` shows while the server starts and reports startup failure or unexpected exit.

The server command resolves in this order: `DSH_DESKTOP_SERVER` (whitespace-split command words), then development builds spawn the checkout's built CLI (`node apps/cli/lib/bin.js web --port 0`, working directory the repository root, fixed at compile time from `CARGO_MANIFEST_DIR`), then packaged builds resolve `dsh` from `PATH`. Every exit path stops the child — window close (which quits the app), Tauri exit events, and a `ctrlc` handler for SIGINT/SIGTERM — with SIGTERM then SIGKILL after a 3-second grace period.

## Alternatives considered

- **Electron shell** — same lifecycle code, but Chromium and Node are bundled per app and the repo already standardizes on webviews elsewhere.
- **Rewrite the backend in Rust inside Tauri** — the harness is the Cordis plugin ecosystem plus its native addons; a Rust re-implementation would discard it rather than host it.
- **Tauri sidecar mechanism** — the official way to bundle an external binary, but the server is a Node CLI; a sidecar requires shipping a Node runtime plus the installed package closure inside the app bundle, which is deferred work, not a first-pass requirement.
- **Embed the frontend `dist/` and serve it from the shell** — breaks `window.__DSH_BOOT__` and the `/plugins` registry the server injects at request time; the shell would re-implement server behavior.

## Consequences

- Closing the window or Ctrl-C stops the server; a SIGKILL of the shell (Force Quit) skips every shutdown path and orphans the server.
- Packaged builds require `dsh` on `PATH` until the app bundles a Node runtime and the harness CLI.
- macOS is the verified target; Windows and Linux webview backends are untested.
- The GUI still sees a browser environment; native dialogs (directory picking, `host.openPath`) keep their existing browser fallbacks.
