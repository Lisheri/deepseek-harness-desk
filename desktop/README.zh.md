# desktop/

[English](README.md) | 中文

承载 [DeepSeek Harness Web GUI](../packages/bundle/web-app/README.md) 的 Tauri 桌面壳。壳负责 `dsh web` 服务端的完整生命周期；harness 后端本身保持不变，仍以 Node 进程运行。

## 组成

- `src-tauri/` — Rust 壳：启动服务端、等待就绪、把 GUI URL 载入窗口、退出时停止服务端。
- `ui/` — 服务端启动期间显示的占位页；就绪后由 harness GUI 接管。

webview 是纯浏览器表面：壳不暴露任何 Tauri IPC，GUI 与后端之间的 HTTP/WebSocket 通信与浏览器中完全一致。

## 服务端生命周期

壳启动时以 `dsh web --port 0` 拉起服务端（端口由 OS 分配），解析 web profile 打印的就绪行（`dsh web: http://127.0.0.1:<port>`），随后把窗口导航到该 URL。关闭窗口即退出应用；任何退出路径下壳都会先向子进程发送 SIGTERM，3 秒宽限期后发送 SIGKILL。服务端 stdout 以 `[dsh]` 前缀转发到壳的终端。

服务端命令解析顺序：

1. 环境变量 `DSH_DESKTOP_SERVER` — 按空白拆分的命令词。
2. 开发构建 — 检出仓库中已构建的 CLI：`node apps/cli/lib/bin.js web --port 0`，工作目录为仓库根。
3. 打包构建 — 从 `PATH` 解析 `dsh web --port 0`，工作目录为 `$HOME`。

## 前置条件

- Rust 工具链（rustc 1.77+）与 Tauri CLI：`cargo install tauri-cli --locked`。
- 开发运行需要已构建的检出仓库（`pnpm install && pnpm run build`）；开发壳 spawn 的是 `apps/cli/lib/bin.js`。
- 打包构建需要 `PATH` 中存在 `dsh` — 壳不内置 Node 运行时。

## 运行

```sh
cd desktop && cargo tauri dev
# 或在仓库根目录执行：pnpm run desktop:dev
```

窗口先显示占位页，服务端就绪后切换到 GUI。服务端启动失败（或运行中崩溃）时，窗口与终端都会显示原因。

## 构建

```sh
cd desktop && cargo tauri build
# 或在仓库根目录执行：pnpm run desktop:build
```

产物：`src-tauri/target/release/bundle/macos/DeepSeek Harness.app`。bundle 未签名，可在本机直接运行。

## 已知限制与后续工作

- 打包构建要求 `PATH` 中存在 `dsh`：把 harness CLI 与 Node 运行时一并打进 app bundle 的工作留待后续。
- 壳只结束直接 spawn 的进程，不结束其进程组；`DSH_DESKTOP_SERVER` 形式的管道命令可能残留子进程。对壳的 SIGKILL（强制退出）会跳过所有退出路径并遗留服务端。
- macOS 是已验证目标；Windows 与 Linux 的 webview 后端未经测试。
