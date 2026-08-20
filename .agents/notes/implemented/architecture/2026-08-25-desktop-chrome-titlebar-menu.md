# Agent Note: Desktop chrome — Chinese native menu and the frame titlebar

Status: implemented

English | [中文](2026-08-25-desktop-chrome-titlebar-menu.zh.md)

## Problem

The Tauri desktop shell hosted the Web GUI inside a stock window: the macOS menu bar was Tauri's English default with no file operations, and the window title bar was the opaque native bar. The desktop product needs two surfaces: a top menu in Chinese whose 文件 (File) menu offers 新聊天 and 添加新工作区, and a custom titlebar row carrying the sidebar fold next to the OS-level buttons plus undo/redo arrows.

## Decision

The two surfaces split along the webview boundary.

**Native menu (Rust).** The shell builds a Chinese menu in `setup` (`desktop/src-tauri/src/lib.rs`): 文件 with `new-chat` / `add-workspace` items (Cmd+N, Cmd+Shift+N), plus predefined 编辑 and 窗口 submenus whose items keep OS-localized role behavior. `on_menu_event` forwards the two file actions to the webview as `desktop-menu` events — the shell's only IPC edge (`core:event:default`). The menu never reaches into GUI state; the GUI's own services own the actions.

**Titlebar row (web).** The window config switches to `titleBarStyle: Overlay` + `hiddenTitle`, so the web content extends under the native traffic lights and the GUI draws the bar itself. [ui-layout](../../../../packages/client/ui-layout/README.md) declares the `shell.titlebar` slot above the frame grid and passes the resolved fold state as owner props. The new [ui-titlebar](../../../../packages/client/ui-titlebar/README.md) plugin occupies it: the 文件操作 dropdown (same two actions), the fold button moved out of ui-sidebar (the collapsed rail now rests on a static brand mark), and undo/redo arrows that hop through the current Session's scope into the composer's input machine (`ctx.sessions.scope(current).conversation.input.for(scoped).undo()`) — the same machine Cmd/Ctrl-Z drives. Tauri detection is a one-shot `window.__TAURI_INTERNALS__` check per page: inside the desktop webview the bar's empty middle becomes the `data-tauri-drag-region` region, macOS reserves a 78px traffic-light inset, and `desktop-menu` events route to the same two actions; a plain browser renders the same bar without the desktop chrome.

**Add Workspace reuse.** The titlebar declares its own `shell.titlebar.directoryFlow` hole and drives it with ui-workspace's `DirectoryFlowOwnerProps` conversation, so the composed directory-picker package (native or browse) fills the third hole alongside its two existing ones — one cordis.yml row composes every add route, and the adoption semantics (create workspace, open its blank session, retryable error dialog) stay identical.

## Alternatives considered

- **Keep the native opaque title bar and put the fold in the sidebar** — no GUI change at all, but the fold stays two surfaces away from the window controls and the top row stays dead space in the desktop shell.
- **Fully custom window controls (`decorations: false`)** — puts every button on one row, but replaces the OS traffic lights with redrawn copies, loses native double-click-zoom/hover behavior, and needs minimize/maximize/close IPC on every platform.
- **Drive the menu actions from Rust** — the shell cannot reach session/workspace state without re-implementing the GUI's services, so the actions must land in the webview; events keep the shell a thin forwarder.

## Consequences

- The titlebar row takes ~32px in every composition (desktop and plain browser); an empty `shell.titlebar` hole collapses to zero height.
- The sidebar lost its own fold control; compositions without ui-titlebar have no fold affordance, so the two packages are composed together (web-app bundle).
- Undo/redo arrows stay enabled with an empty history — the input machine does not publish undo/redo stack depth (recorded as a Known Limitation in ui-titlebar's README).
- `titleBarStyle: Overlay` applies on macOS; Windows/Linux windows keep their native title bar with the bar rendering below it.
