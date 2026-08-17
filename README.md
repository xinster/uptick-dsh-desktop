# DeepSeek Harness Desktop（官方 Web UI 桌面壳）

把官方 DeepSeek Harness 的本地 Web UI（`dsh web`，默认 `http://127.0.0.1:3080`）包装成 macOS 桌面应用：自动启停服务、托盘常驻、开箱即用。

与 `ds-desktop`（独立轻量客户端）并存，各司其职：
- **本壳**：完整 DSH 能力（子代理、workflow、goal、技能、插件），UI 为官方 Web UI
- **ds-desktop**：独立 agentic 客户端（自研工具链/权限/工作区），仅 DeepSeek API

## 已部署

- `/Applications/DeepSeekHarnessDesktop.app`（鲸鱼图标，与 DeepSeek Desktop 区分）
- 工程源码：本目录

## 功能

- 🚀 **服务自管理**：启动时检测 `127.0.0.1:3080`——已有服务则复用，否则自动 `npx @deepseek-ai/dsh web` 拉起并轮询就绪（120s 超时）
- 🖥️ **桌面窗口**：1440×900 加载官方 Web UI；外链自动转系统浏览器
- 📌 **系统托盘常驻**：显示/隐藏、**开机自启**（勾选即注册登录项，静默启动）、**检查更新…**、重启服务、打开服务日志、在浏览器打开、退出
- 🔄 **自动更新**：`config.json` 配置 `updateUrl`（JSON：`{version, url, notes}`）后自动启用——启动后静默检查，发现新版弹窗确认，下载 zip → 解压 → 替换应用包（失败自动回滚）→ 提示重启生效；未配置 URL 时托盘「检查更新…」会提示如何开启
- 🛡️ **退出清理**：退出时终止自启的服务子进程；服务意外退出会弹窗提醒
- 🪵 **服务日志**：写入 userData/service.log，托盘可一键打开
- ⚙️ **配置**：`userData/config.json`（可选 `port` / `command` / `openAtLogin` / `updateUrl`）

## 开发

```bash
npm install
npm start                     # 开发模式（会先拉起服务）
npm run smoke                 # 冒烟：端口检测 + 页面加载
npm run pack                  # 打包到 dist/
```

受限环境（无默认 userData 写权限）：
```bash
DSH_SHELL_USER_DATA=<可写目录> electron .
```

## 技术栈

- Electron 33（contextIsolation + sandbox）
- 服务管理：`child_process.spawn(shell)` + 端口轮询（`http.get`）
- 托盘：模板图标（自动适配深浅色菜单栏）
