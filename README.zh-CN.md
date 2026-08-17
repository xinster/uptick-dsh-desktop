# DeepSeek Harness Desktop

**简体中文** | [English](README.md)

把官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的本地 Web UI（`dsh web`，默认 `http://127.0.0.1:3080`）包装成 macOS 桌面应用：自动启停服务、托盘常驻、开机自启、自动更新、字体缩放，开箱即用。

## 与 DeepSeek Desktop 的关系

本仓库与 [uptick-ds-desktop](https://github.com/xinster/uptick-ds-desktop)（独立 agentic 客户端）并存，各司其职：

| | 本壳 (uptick-dsh-desktop) | 轻量客户端 (uptick-ds-desktop) |
|---|---|---|
| 内核 | 完整 DSH：子代理 / workflow / goal / 技能 / 插件 | 自研 agentic：工具链 / 权限弹窗 / 工作区 |
| UI | 官方 DSH Web UI | 自有 Codex 风格界面 |
| 定位 | 完整编排能力 | 轻量可控的本地执行 |

## 功能

- 🚀 **服务自管理**：启动时检测 `127.0.0.1:3080`——已有服务直接复用；否则自动 `npx @deepseek-ai/dsh web` 拉起并轮询就绪（120s 超时）
- 🖥️ **桌面窗口**：1440×900 加载官方 Web UI；外链自动转系统浏览器；服务异常显示错误页
- 📌 **托盘常驻**：显示/隐藏、**开机自启**、**字体大小**（小/中/大）、**检查更新…**、重启服务、打开日志、在浏览器打开、退出
- 🔤 **字体缩放**：运行时提取页面全部 `--dsw-font-*-font-size` CSS 变量按档位缩放（小 0.85x / 中 1.0x / 大 1.15x），布局不动、纯字号调节，默认小字体
- 🔄 **自动更新**：`config.json` 配置 `updateUrl`（JSON：`{version, url, notes}`）后启动静默检查 → 弹窗确认 → 下载 zip → 解压替换（失败自动回滚）→ 提示重启
- 🛡️ **退出清理**：退出时终止自启的服务子进程；服务意外退出弹窗提醒
- 💰 **余额/用量浮窗**：左侧栏 Settings 上方常驻浮窗——实时余额（充值/赠送拆分）、**高峰/空闲时段**徽章（官方峰谷定价：UTC 01–04 / 06–10 为高峰，空闲半价）、**今日 token 用量**（本地统计 DSH 会话日志，输入/输出/调用次数），每 5 分钟刷新；点击展开明细
- 🪵 **日志**：服务输出写 `userData/service.log`，托盘一键打开
- 🔒 **单实例**：统一 userData，任何启动方式只允许一个实例

## 获取与分享（两种方式）

### 方式 A：完整桌面应用（推荐，功能最全）

macOS（Apple 芯片 / Intel）安装包从 **GitHub Releases** 下载：

> <https://github.com/xinster/uptick-dsh-desktop/releases>

下载 `DeepSeekHarnessDesktop-macos-<架构>.dmg` 后：

1. 双击挂载 → 把 `DeepSeekHarnessDesktop.app` 拖入「应用程序」
2. 首次打开若提示"无法验证开发者"：**右键点 App → 打开**（或终端执行 `xattr -dr com.apple.quarantine /Applications/DeepSeekHarnessDesktop.app`）
3. 启动后自动拉起本地 DSH 服务（需本机装有 Node.js 与 `npx @deepseek-ai/dsh web`），余额读取 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`

### 方式 B：油猴脚本（已在使用 `dsh web` 的轻量用户）

浏览器装 [Tampermonkey](https://www.tampermonkey.net/) 后，导入仓库根目录的 `dsh-usage-card.user.js`（或直接从 Releases 附件下载），访问 `http://127.0.0.1:3080` 自动出现浮窗。

- 首次使用点击卡片里的「设置 API Key」填入 DeepSeek API Key（仅存本机浏览器 localStorage）
- 显示余额 + 高峰/空闲时段；浏览器沙箱读不到本地会话文件，**今日 token 用量仅完整版（方式 A）支持**

## 架构

```
main.js            # 全部逻辑（壳无渲染层，加载官方 UI）
├── 服务管理        # startService / waitForService / stopService / restartService
├── 窗口            # createWindow：加载 3080、外链处理、错误页、did-finish-load 字体缩放
├── 托盘            # Tray + 菜单（显示/自启/字体/更新/重启/日志/退出）
├── 自动更新        # fetchJson / streamDownload / unzip / 备份替换回滚
├── 字体缩放        # applyFontScale：提取 CSS 变量 → 内联覆盖
└── 生命周期        # 单实例锁、before-quit 清理服务子进程
error.html         # 服务不可用时的错误页
```

## 配置（userData/config.json）

| 键 | 默认 | 说明 |
|---|---|---|
| `port` | `3080` | DSH Web UI 端口 |
| `command` | `npx @deepseek-ai/dsh web` | 启动服务的完整命令（引号感知拆分） |
| `openAtLogin` | `false` | 开机自启 |
| `fontSize` | `small` | 字体档位：small / medium / large |
| `updateUrl` | `""` | 自动更新 manifest 地址（JSON：version/url/notes） |

userData 默认位于 `~/Library/Application Support/DeepSeek Harness Desktop`（macOS 标准位置）。

## 开发

```bash
npm install
npm start            # 开发模式（先拉起服务）
npm run smoke        # 冒烟：端口检测 + 页面加载
npm run pack         # 打包到 dist/
```

受限环境（无默认 userData 写权限）：
```bash
DSH_SHELL_USER_DATA=<可写目录> electron .
```

## 故障排查

- **服务没起来**：托盘「打开服务日志」查看；确认本机有 Node.js（`npx` 可用）
- **字体没变化**：托盘「字体大小」切换后立即生效；若自定义了 DSH 主题可能需重启窗口
- **更新失败**：日志里看 `update failed`；确认 manifest 的 url 可直接下载 zip（ditto 解压 .app）

## License

MIT © 2026 Brian <brian@starrycoffee.com>
