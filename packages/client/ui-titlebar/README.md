# @deepseek-ai/dsh-client-ui-titlebar

English | [中文](README.zh.md)

Window-top chrome plugin: the frame-wide titlebar row rendered into [ui-layout](../ui-layout/README.md)'s `shell.titlebar` slot. It owns the file-operations dropdown (New Chat / Add Workspace), the sidebar fold button (moved here from [ui-sidebar](../ui-sidebar/README.md)), the input undo/redo arrows, and — inside the Tauri desktop shell — the window drag region, the macOS traffic-light inset, and the bridge that runs the native 文件 menu's actions.

The row is pure presentation: every Host verb arrives through the injected face (`toggleSidebar` → the layout service; `newChat`/`createWorkspace`/`startSession` → the workspace service). Undo/redo hop through the current Session's scope into the conversation service's per-session input facade (`ctx.sessions.scope(current).conversation.input.for(scoped).undo()`), the same machine the composer's Cmd/Ctrl-Z bindings drive; with no current session, no ui-conversation composition, or an empty history the hops are no-ops.

The Add Workspace action declares its own `shell.titlebar.directoryFlow` hole and drives it with ui-workspace's `DirectoryFlowOwnerProps` conversation — the composed directory-picker package (native or browse) fills this hole alongside its two ui-workspace surfaces, so one cordis.yml row composes every add route. A picked directory is adopted via `createWorkspace` and its blank session opened, mirroring the sidebar's add flow; adoption failures land in a retryable error dialog.

Tauri detection is a one-shot per-page check of `window.__TAURI_INTERNALS__`: inside the desktop webview the bar's empty middle becomes the drag region (`data-tauri-drag-region`), the macOS inset reserves the traffic-light corner, and `desktop-menu` events from the Rust shell (新聊天 / 添加新工作区) route to the same two actions. In a plain browser the dropdown is the only route and no desktop chrome renders.

## Model Experience

None, as the titlebar drives browser UI actions; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Undo/redo buttons stay enabled with an empty history** — the input machine does not publish its undo/redo stack depth, so the arrows cannot reflect availability; clicks no-op instead.
- **The macOS traffic-light inset is a fixed 78px** — a custom titlebar height would need the inset to track the configured bar height.
- **Windows/Linux windows keep their native title bar** — `titleBarStyle: Overlay` applies on macOS; the bar renders below the native title bar elsewhere.
