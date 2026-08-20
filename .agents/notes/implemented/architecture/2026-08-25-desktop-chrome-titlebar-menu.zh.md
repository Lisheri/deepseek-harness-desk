# Agent Note: 桌面 chrome——中文原生菜单与窗口标题栏

Status: implemented

[English](2026-08-25-desktop-chrome-titlebar-menu.md) | 中文

## 问题

Tauri 桌面外壳此前在默认窗口中承载 Web GUI：macOS 菜单栏是 Tauri 的英文默认菜单、没有任何文件操作，窗口标题栏是原生不透明栏。桌面产品需要两个表面：一个中文顶层菜单，其"文件"菜单提供新聊天与添加新工作区；以及一个自定义标题栏行，把侧边栏折叠按钮放到与操作系统级按钮同一排，并加上撤销/重做箭头。

## 决策

两个表面沿 webview 边界划分。

**原生菜单（Rust）。** 外壳在 `setup` 中构建全中文菜单（`desktop/src-tauri/src/lib.rs`）："文件"含 `new-chat` / `add-workspace` 两项（Cmd+N、Cmd+Shift+N），另有"编辑"与"窗口"子菜单及 macOS 应用菜单（关于 / 服务 / 隐藏… / 退出），其条目全部是预定义角色并带显式中文文本覆盖（`PredefinedMenuItem::undo(app, Some("撤销"))` 等）——原生 selector 与快捷键保留，且没有任何标签跟随 OS 语言。`on_menu_event` 把两个文件动作以 `desktop-menu` 事件转发给 webview——这是外壳唯一的 IPC 边（`core:event:default`）。菜单从不触及 GUI 状态；动作由 GUI 自己的服务负责执行。文件操作**只**放在这里：标题栏不携带任何文件入口。

**标题栏行（web）。** 窗口配置改为 `titleBarStyle: Overlay` + `hiddenTitle`，网页内容延伸到原生交通灯之下，由 GUI 自己绘制标题栏。[ui-layout](../../../../packages/client/ui-layout/README.md) 在 frame 网格上方声明 `shell.titlebar` slot，并把解析后的折叠状态作为 owner props 传入。新的 [ui-titlebar](../../../../packages/client/ui-titlebar/README.md) 插件占据该 slot：从 ui-sidebar 移出的折叠按钮（收起后的窄轨改为静态品牌标记），以及撤销/重做箭头——它们经当前 Session 的 scope 跳到编辑器的输入状态机（`ctx.sessions.scope(current).conversation.input.for(scoped).undo()`），与 Cmd/Ctrl-Z 驱动的是同一台状态机。Tauri 检测是每页一次的 `window.__TAURI_INTERNALS__` 检查：在桌面 webview 内，标题栏的空白中间区域成为 `data-tauri-drag-region` 拖拽区（拖动能力由外壳的 `core:window:allow-start-dragging` capability 授予——缺了它该属性不生效），macOS 预留 78px 交通灯内边距，`desktop-menu` 事件路由到运行时动作与添加流程；普通浏览器渲染同样的标题栏但没有桌面 chrome。

**添加工作区的复用。** 标题栏声明自己的 `shell.titlebar.directoryFlow` 槽，并以 ui-workspace 的 `DirectoryFlowOwnerProps` 会话协议驱动它，因此被组合的目录选择包（原生或浏览式）在填充既有两个槽之外同样填充第三个槽——一行 cordis.yml 即可组合所有添加路径，采纳语义（创建工作区、打开其空白会话、可重试错误对话框）保持一致。

## 备选方案

- **保留原生不透明标题栏，折叠按钮留在侧边栏** —— 完全不动 GUI，但折叠控件与窗口按钮相隔两个表面，桌面壳的顶部一行仍是死区。
- **完全自绘窗口控制按钮（`decorations: false`）** —— 所有按钮都在同一行，但会用重绘副本替换 OS 交通灯，失去原生双击缩放/悬停行为，且每个平台都需要最小化/最大化/关闭 IPC。
- **菜单动作由 Rust 直接驱动** —— 壳无法在不重实现 GUI 服务的情况下触达会话/工作区状态，因此动作必须落到 webview；事件让壳保持薄转发者。

## 后果

- 每个组合（桌面与普通浏览器）都会占用约 32px 的标题栏行；空的 `shell.titlebar` 槽会塌缩到零高度。
- 侧边栏失去了自己的折叠控件；不组合 ui-titlebar 的组合就没有折叠入口，因此两个包在 web-app bundle 中一起组合。
- 撤销/重做箭头在历史为空时仍保持可用——输入状态机不发布撤销/重做栈深度（已记录在 ui-titlebar README 的 Known Limitations 中）。
- `titleBarStyle: Overlay` 仅在 macOS 生效；Windows/Linux 窗口保留其原生标题栏，标题栏行渲染在其下方。
