# DeepSeek Harness Desktop

**English** | [简体中文](README.zh-CN.md)

Wrap the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) local Web UI (`dsh web`, default `http://127.0.0.1:3080`) into a macOS desktop app: automatic service start/stop, menu-bar tray, launch at login, auto-update, font scaling — ready to use out of the box.

## Relationship to DeepSeek Desktop

This repo coexists with [uptick-ds-desktop](https://github.com/xinster/uptick-ds-desktop) (a standalone agentic client), each serving a different purpose:

| | This shell (uptick-dsh-desktop) | Lightweight client (uptick-ds-desktop) |
|---|---|---|
| Engine | Full DSH: subagents / workflows / goals / skills / plugins | Custom agentic: toolchain / permission dialogs / workspace |
| UI | Official DSH Web UI | Custom Codex-style interface |
| Focus | Full orchestration capabilities | Lightweight, controllable local execution |

## Features

- 🚀 **Service self-management**: on startup, checks `127.0.0.1:3080` — reuses an existing service; otherwise spawns `npx @deepseek-ai/dsh web` and polls until ready (120s timeout)
- 🖥️ **Desktop window**: 1440×900 loading the official Web UI; external links open in the system browser; error page shown when the service is unavailable
- 📌 **Menu-bar tray**: show/hide, **launch at login**, **font size** (small/medium/large), **check for updates…**, restart service, open logs, open in browser, quit
- 🔤 **Font scaling**: extracts all `--dsw-font-*-font-size` CSS variables at runtime and scales them by level (small 0.85x / medium 1.0x / large 1.15x) — layout untouched, pure type-size adjustment, small by default
- 🔄 **Auto-update**: with `updateUrl` configured in `config.json` (JSON: `{version, url, notes}`), silently checks on startup → confirm dialog → downloads zip → replaces in place (rollback on failure) → prompts to restart
- 🛡️ **Exit cleanup**: terminates the self-started service child process on quit; notifies if the service exits unexpectedly
- 💰 **Balance/usage floating card**: persistent card above the Settings entry in the left sidebar — live balance (topped-up/granted split), **peak/off-peak badge** (official peak pricing: UTC 01–04 / 06–10 is peak, off-peak is half price), **today's token usage** (locally aggregated from DSH session logs: input/output/call count; requires zstd (`brew install zstd`)), refreshed every minute; follows the app's light/dark theme; click to expand details
- 🪵 **Logs**: service output written to `userData/service.log`, one-click open from the tray
- 🔒 **Single instance**: unified userData; only one instance allowed regardless of launch method

## Get It / Share It (two ways)

### Option A: Full desktop app (recommended, most complete)

macOS installers (Apple Silicon / Intel) are available from **GitHub Releases**:

> <https://github.com/xinster/uptick-dsh-desktop/releases>

After downloading `DeepSeekHarnessDesktop-macos-<arch>.dmg`:

1. Double-click to mount → drag `DeepSeekHarnessDesktop.app` into Applications
2. If macOS warns "cannot verify developer" on first launch: **right-click the app → Open** (or run `xattr -dr com.apple.quarantine /Applications/DeepSeekHarnessDesktop.app` in Terminal)
3. On launch it automatically starts the local DSH service (requires Node.js and `npx @deepseek-ai/dsh web` on the machine); balance reads `DEEPSEEK_API_KEY` from `~/.dsh/.credentials.yaml`

### Option B: Tampermonkey userscript (lightweight, for users already running `dsh web`)

Install [Tampermonkey](https://www.tampermonkey.net/) in your browser, then import `dsh-usage-card.user.js` from the repo root (or download it from the Releases assets). The floating card appears automatically at `http://127.0.0.1:3080`.

- On first use, click "Set API Key" in the card and paste your DeepSeek API key (stored only in the browser's localStorage)
- Shows balance + peak/off-peak badge; the browser sandbox cannot read local session files, so **today's token usage is only available in the full app (Option A)**

## Architecture

```
main.js            # all logic (no renderer layer; loads the official UI)
├── service mgmt   # startService / waitForService / stopService / restartService
├── window         # createWindow: loads 3080, external-link handling, error page, did-finish-load font scaling
├── tray           # Tray + menu (show / autostart / font / update / restart / logs / quit)
├── auto-update    # fetchJson / streamDownload / unzip / backup-replace-rollback
├── font scaling   # applyFontScale: extract CSS variables → inline overrides
└── lifecycle      # single-instance lock, before-quit service child cleanup
error.html         # error page when the service is unavailable
```

## Configuration (userData/config.json)

| Key | Default | Description |
|---|---|---|
| `port` | `3080` | DSH Web UI port |
| `command` | `npx @deepseek-ai/dsh web` | Full command to start the service (quote-aware splitting) |
| `openAtLogin` | `false` | Launch at login |
| `fontSize` | `small` | Font level: small / medium / large |
| `updateUrl` | `""` | Auto-update manifest URL (JSON: version/url/notes) |

userData defaults to `~/Library/Application Support/DeepSeek Harness Desktop` (standard macOS location).

## Development

```bash
npm install
npm start            # dev mode (starts the service first)
npm run smoke        # smoke test: port detection + page load
npm run pack         # package into dist/
```

Restricted environment (no write access to the default userData):
```bash
DSH_SHELL_USER_DATA=<writable dir> electron .
```

## Troubleshooting

- **Service not starting**: check the tray menu "Open service log"; make sure Node.js is installed (`npx` available)
- **Font not changing**: tray "Font size" takes effect immediately; if you customized the DSH theme you may need to reopen the window
- **Update failing**: look for `update failed` in the log; make sure the manifest `url` is a directly downloadable zip (ditto extracts the .app)

## License

MIT © 2026 Brian <brian@starrycoffee.com>
