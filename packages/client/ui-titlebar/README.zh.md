# @deepseek-ai/dsh-client-ui-titlebar

[English](README.md) | 中文

窗口顶部 chrome 插件：渲染到 [ui-layout](../ui-layout/README.md) 的 `shell.titlebar` slot 的整幅标题栏行。它持有侧边栏折叠按钮（从 [ui-sidebar](../ui-sidebar/README.md) 移到这里）、输入撤销/重做箭头，以及在 Tauri 桌面外壳内的窗口拖拽区、macOS 交通灯内边距，以及执行原生"文件"菜单动作的桥接。文件操作（新聊天 / 添加新工作区）在操作系统菜单栏里，不在这一行；该行自身不带文件入口。

该行是纯呈现：所有 Host 动词都通过注入面到达（`toggleSidebar` → 布局服务；`newChat`/`createWorkspace`/`startSession` → 工作区服务）。撤销/重做经由当前 Session 的 scope 跳转到 conversation 服务的每会话输入门面（`ctx.sessions.scope(current).conversation.input.for(scoped).undo()`），与编辑器 Cmd/Ctrl-Z 绑定驱动的是同一台状态机；没有当前会话、没有组合 ui-conversation、或历史为空时，跳转是空操作。

"添加新工作区"菜单动作声明自己的 `shell.titlebar.directoryFlow` 槽，并以 ui-workspace 的 `DirectoryFlowOwnerProps` 会话协议驱动它——被组合的目录选择包（原生或浏览式）会在填充 ui-workspace 的两个槽之外同样填充这个槽，因此一行 cordis.yml 即可组合所有添加路径。选中的目录经 `createWorkspace` 采纳，并打开其空白会话，与侧边栏添加流程一致；采纳失败会进入可重试的错误对话框。

Tauri 检测是每页一次的 `window.__TAURI_INTERNALS__` 检查：在桌面 webview 内，该行的空白中间区域成为拖拽区（`data-tauri-drag-region`，拖动能力由外壳的 `core:window:allow-start-dragging` capability 授予），macOS 内边距为交通灯留出角落，Rust 外壳的 `desktop-menu` 事件（新聊天 / 添加新工作区）路由到运行时动作与添加流程。在普通浏览器里不渲染任何桌面 chrome，菜单动作在该行内没有入口。

## Model Experience

无，标题栏只驱动浏览器 UI 动作；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **撤销/重做按钮在历史为空时仍保持可用** —— 输入状态机不发布其撤销/重做栈深度，箭头无法反映可用性；点击只是空操作。
- **macOS 交通灯内边距固定为 78px** —— 自定义标题栏高度时需要让内边距跟随配置的高度。
- **Windows/Linux 窗口保留其原生标题栏** —— `titleBarStyle: Overlay` 仅在 macOS 生效；该行渲染在原生标题栏下方。
