# desktop/

[English](README.md) | 中文

承载 [DeepSeek Harness Web GUI](../packages/bundle/web-app/README.md) 的 Tauri 桌面壳。壳负责 `dsh web` 服务端的完整生命周期；harness 后端本身保持不变，仍以 Node 进程运行。

## 组成

- `src-tauri/` — Rust 壳：启动服务端、等待就绪、把 GUI URL 载入窗口、退出时停止服务端。
- `ui/` — 服务端启动期间显示的占位页；就绪后由 harness GUI 接管。
- `runtime/` — 纯依赖 deploy-root 清单，其闭包构成内置于应用的 dsh 单文件可执行。
- `src-tauri/resources/` — 构建产物：单文件 `dsh` 可执行与 node-pty 的 `dsh-spawn-helper`，经 `bundle.resources` 打入 app。

webview 是纯浏览器表面：壳不暴露任何 Tauri IPC，GUI 与后端之间的 HTTP/WebSocket 通信与浏览器中完全一致。

## 服务端生命周期

壳启动时以 `dsh web --port 0` 拉起服务端（端口由 OS 分配），解析 web profile 打印的就绪行（`dsh web: http://127.0.0.1:<port>`），随后把窗口导航到该 URL。关闭窗口即退出应用；任何退出路径下壳都会先向子进程发送 SIGTERM，3 秒宽限期后发送 SIGKILL。服务端 stdout 以 `[dsh]` 前缀转发到壳的终端。

服务端命令解析顺序：

1. 环境变量 `DSH_DESKTOP_SERVER` — 按空白拆分的命令词。
2. 开发构建 — 检出仓库中已构建的 CLI：`node apps/cli/lib/bin.js web --port 0`，工作目录为仓库根。
3. 打包构建 — app 资源内内置的 `dsh` 可执行，工作目录为 `$HOME`。
4. 未内置可执行的打包构建 — 从 `PATH` 解析 `dsh web --port 0`，工作目录为 `$HOME`。

## 前置条件

- Rust 工具链（rustc 1.77+）与 Tauri CLI：`cargo install tauri-cli --locked`。
- 开发运行需要已构建的检出仓库（`pnpm install && pnpm run build`）；开发壳 spawn 的是 `apps/cli/lib/bin.js`。
- 打包构建需要已构建的检出仓库与网络（单文件构建脚本 [`scripts/build-exe-for-desktop-shell.ts`](../../scripts/build-exe-for-desktop-shell.ts) 会下载 Node 基础镜像与 `@yao-pkg/pkg`）。

## 运行

```sh
cd desktop && cargo tauri dev
# 或在仓库根目录执行：pnpm run desktop:dev
```

窗口先显示占位页，服务端就绪后切换到 GUI。服务端启动失败（或运行中崩溃）时，窗口与终端都会显示原因。

## 构建

```sh
# 在仓库根目录执行：先构建单文件 dsh，再构建 app + dmg
pnpm run desktop:build
```

单独构建单文件：`pnpm run desktop:exe`（参数：`--targets=node24-macos-arm64,node24-macos-x64`、`--skip-build`、`--dry-run`）。

产物：`src-tauri/target/release/bundle/macos/DeepSeek Harness.app` 与 `src-tauri/target/release/bundle/dmg/DeepSeek Harness_<version>_aarch64.dmg`。两者均未签名、可在本机直接运行；app 自带服务端，无需单独安装 `dsh`。

## 已知限制与后续工作

- 服务端运行在独立进程组中，停机信号发给整个进程组；对壳的 SIGKILL（强制退出）仍会跳过所有退出路径并遗留服务端。
- macOS 是已验证目标；Windows 与 Linux 的 webview 后端未经测试。
- 内置的 `dsh` 可执行是未签名的嵌套二进制：要发布给他人双击即用（免 Gatekeeper 拦截），签名与公证时必须连同它一起签名。
- API 凭证：从 Finder 启动的应用不会继承 shell 环境变量；请通过 GUI 的凭证面板设置 `DEEPSEEK_API_KEY`。
- 首次启动时应用会把闭包实体化到 `$DSH_HOME/profiles/node_modules`（约数百 MB）；此后用仓库源码跑 `dsh` 会因该目录不是软链而报错，删除该目录即可恢复。
