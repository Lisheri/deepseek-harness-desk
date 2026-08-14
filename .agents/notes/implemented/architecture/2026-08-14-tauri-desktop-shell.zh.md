# Agent Note: Tauri 桌面壳承载 Web GUI 并接管 dsh web 服务端生命周期

Status: implemented

[English](2026-08-14-tauri-desktop-shell.md) | 中文

## Problem

DeepSeek Harness Web GUI 在浏览器中运行，但桌面用户想要一个自包含的应用：窗口本身负责服务端——无需终端手动启动 `dsh web`、无需找浏览器标签页，窗口关闭后也不残留服务端进程。

## Decision

新增 `desktop/` 目录，一个位于 pnpm workspace 之外的 Tauri v2 壳。harness 后端保持不变：壳以子进程方式启动 `dsh web --port 0`，解析 web profile 打印的就绪行（`dsh web: http://127.0.0.1:<port>`），随后把窗口导航到该 URL。临时端口意味着并发壳实例与默认端口上的其他服务端永不冲突。

webview 是纯浏览器表面：壳不注册任何 Tauri command、plugin 或 capability，因此 GUI 的 HTTP/WebSocket 传输与 `window.__DSH_BOOT__` 注入行为与浏览器中完全一致。`desktop/ui/` 下的占位页在服务端启动期间显示，并报告启动失败或意外退出。

服务端命令按以下顺序解析：`DSH_DESKTOP_SERVER`（按空白拆分的命令词）；开发构建则 spawn 检出仓库中已构建的 CLI（`node apps/cli/lib/bin.js web --port 0`，工作目录为仓库根，编译期由 `CARGO_MANIFEST_DIR` 固定）；打包构建则从 `PATH` 解析 `dsh`。每条退出路径都会停止子进程——窗口关闭（即退出应用）、Tauri 退出事件，以及处理 SIGINT/SIGTERM 的 `ctrlc` handler——先 SIGTERM，3 秒宽限期后 SIGKILL。

## Alternatives considered

- **Electron 壳** — 生命周期代码相同，但每个应用都要捆绑 Chromium 与 Node，而本仓库在别处已经以 webview 为准。
- **在 Tauri 内用 Rust 重写后端** — harness 的本质是 Cordis 插件生态及其 native addon；Rust 重写等于丢弃它而不是承载它。
- **Tauri sidecar 机制** — 捆绑外部二进制的官方方式，但服务端是 Node CLI；sidecar 要求在 app bundle 内同时提供 Node 运行时与安装包闭包，这属于后续工作而非首版要求。
- **内嵌前端 `dist/` 由壳自行托管** — 会破坏服务端在请求时注入的 `window.__DSH_BOOT__` 与 `/plugins` 注册表；壳将不得不复刻服务端行为。

## Consequences

- 关闭窗口或 Ctrl-C 会停止服务端；对壳的 SIGKILL（强制退出）会跳过所有退出路径并遗留服务端进程。
- 在 app 内置 Node 运行时与 harness CLI 之前，打包构建要求 `PATH` 中存在 `dsh`。
- macOS 是已验证目标；Windows 与 Linux 的 webview 后端未经测试。
- GUI 仍然感知到的是浏览器环境；原生对话框（目录选择、`host.openPath`）沿用现有浏览器回退方案。
