'use strict';

/**
 * DeepSeek Harness Desktop — 官方 DSH Web UI 的桌面壳
 *
 * 职责：
 *  1. 检测 / 启动本地 DSH 服务（`npx @deepseek-ai/dsh web`，默认 127.0.0.1:3080）
 *  2. 桌面窗口加载 Web UI
 *  3. 系统托盘常驻（显示/隐藏、重启服务、打开日志、退出）
 *  4. 退出时清理子进程
 */

const { app, BrowserWindow, Tray, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile, execFileSync } = require('child_process');
const http = require('http');
const https = require('https');

const SMOKE_TEST = process.argv.includes('--smoke-test');
const DEFAULT_PORT = 3080;
const DEFAULT_COMMAND = 'npx @deepseek-ai/dsh web';
const START_TIMEOUT_MS = 120000;   // 服务启动等待上限
const POLL_INTERVAL_MS = 500;
const UPDATE_CHECK_DELAY_MS = 5000; // 启动后延迟静默检查更新

// 受限环境下把 userData 指到可写位置
if (process.env.DSH_SHELL_USER_DATA) {
  try { app.setPath('userData', process.env.DSH_SHELL_USER_DATA); } catch {}
}

let mainWindow = null;
let tray = null;
let serviceProc = null;      // 我们 spawn 的服务进程
let serviceExternal = false; // 端口已有服务（非我们启动）
let isQuitting = false;
let startedAt = Date.now();

/* ---------------- 配置 ---------------- */

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  try {
    fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    writeLog(`config save failed: ${e.message}`);
  }
  return next;
}

function config() {
  const c = loadConfig();
  return {
    port: parseInt(c.port, 10) || DEFAULT_PORT,
    command: typeof c.command === 'string' && c.command.trim() ? c.command.trim() : DEFAULT_COMMAND,
    openAtLogin: Boolean(c.openAtLogin),
    updateUrl: typeof c.updateUrl === 'string' && c.updateUrl.trim() ? c.updateUrl.trim() : '',
    fontSize: ['x-small', 'small', 'medium', 'large'].includes(c.fontSize) ? c.fontSize : 'small',
  };
}

/* 字体缩放：读取页面 --dsw-font-*-font-size 变量并按系数内联覆盖（布局不动，纯字体） */
const FONT_SCALES = { 'x-small': 0.75, small: 0.85, medium: 1.0, large: 1.15 };

function applyFontScale(win) {
  if (!win || win.isDestroyed()) return;
  const scale = FONT_SCALES[config().fontSize] || 0.85;
  win.webContents.executeJavaScript(`(() => {
    const scale = ${scale};
    const vars = {};
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          const sel = rule.selectorText || '';
          if ((sel === ':root' || sel.includes('body')) && rule.style) {
            for (const prop of rule.style) {
              if (prop.startsWith('--dsw-font') && prop.endsWith('-font-size')) {
                const v = parseFloat(rule.style.getPropertyValue(prop));
                if (v > 0 && !(prop in vars)) vars[prop] = v;
              }
            }
          }
        }
      } catch {}
    }
    const target = document.body || document.documentElement;
    for (const [name, base] of Object.entries(vars)) {
      target.style.setProperty(name, Math.round(base * scale) + 'px');
    }
    return Object.keys(vars).length;
  })()`).then((n) => {
    writeLog(`font scale applied: ${config().fontSize} (${scale}x, ${n} vars)`);
  }).catch((e) => {
    writeLog(`font scale failed: ${e.message}`);
  });
}

/* ---------------- 余额用量卡片（注入 DSH 页面右下角） ---------------- */

const USAGE_CARD_CSS = `
#ds-usage-card {
  position: fixed; left: 8px; bottom: 56px; z-index: 99999;
  font-family: -apple-system, 'PingFang SC', sans-serif;
  background: rgba(249,250,251,.97);
  border: 1px solid rgba(15,17,21,.08);
  border-radius: 12px;
  color: rgb(15,17,21);
  font-size: 12px;
  padding: 8px 12px;
  cursor: pointer;
  min-width: 170px;
  max-width: 260px;
  backdrop-filter: blur(6px);
  user-select: none;
  box-shadow: 0 8px 24px rgba(15,17,21,.10);
}
#ds-usage-card .ds-usage-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
#ds-usage-card .ds-usage-spacer { flex: 1; }
#ds-usage-card .ds-usage-balance { color: #d97706; }
#ds-usage-card .ds-usage-peak { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 8px; background: rgba(21,128,61,.12); color: #15803d; white-space: nowrap; }
#ds-usage-card .ds-usage-peak.peak { background: rgba(194,65,12,.12); color: #c2410c; }
#ds-usage-card .ds-u-session { color: #15803d; }
#ds-usage-card .ds-u-session.peak { color: #c2410c; }
#ds-usage-card .ds-usage-body { display: none; margin-top: 6px; font-size: 11px; color: rgba(15,17,21,.55); line-height: 1.8; border-top: 1px solid rgba(15,17,21,.08); padding-top: 6px; }
#ds-usage-card.open .ds-usage-body { display: block; }
#ds-usage-card .ds-u-today-detail { font-size: 10px; color: rgba(15,17,21,.45); }
#ds-usage-card .ds-usage-body b { color: rgb(15,17,21); }
#ds-usage-card a { color: #1d4ed8; text-decoration: none; display: inline-block; margin-top: 2px; }
/* 深色主题跟随主应用（DSH 以 body[data-ds-dark-theme] 控制深色） */
body[data-ds-dark-theme] #ds-usage-card {
  background: rgba(27,27,28,.97);
  border-color: rgba(255,255,255,.10);
  color: rgb(249,250,251);
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
}
body[data-ds-dark-theme] #ds-usage-card .ds-usage-balance { color: #f7931e; }
body[data-ds-dark-theme] #ds-usage-card .ds-usage-peak { background: rgba(52,199,89,.16); color: #34c759; }
body[data-ds-dark-theme] #ds-usage-card .ds-usage-peak.peak { background: rgba(255,149,0,.18); color: #ff9500; }
body[data-ds-dark-theme] #ds-usage-card .ds-u-session { color: #34c759; }
body[data-ds-dark-theme] #ds-usage-card .ds-u-session.peak { color: #ff9500; }
body[data-ds-dark-theme] #ds-usage-card .ds-usage-body { color: rgba(249,250,251,.55); border-top-color: rgba(255,255,255,.08); }
body[data-ds-dark-theme] #ds-usage-card .ds-u-today-detail { color: rgba(249,250,251,.45); }
body[data-ds-dark-theme] #ds-usage-card .ds-usage-body b { color: rgb(249,250,251); }
body[data-ds-dark-theme] #ds-usage-card a { color: #7fa0ff; }
`;

function shellApiKey() {
  try {
    const t = fs.readFileSync(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
    const m = t.match(/^DEEPSEEK_API_KEY\s*:\s*["']?([^"'\r\n]+)/m);
    return m && m[1] ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function fetchBalance() {
  const key = shellApiKey();
  if (!key) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = https.get({
      hostname: 'api.deepseek.com',
      path: '/user/balance',
      headers: { Authorization: `Bearer ${key}` },
      timeout: 10000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/* ---------------- 今日 token 用量（本地统计 DSH 会话日志） ---------------- */

function todayStartMs() {
  // 北京时间今日零点对应的 epoch ms（本地时区无关）
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 3600 * 1000);
  return Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate()) - 8 * 3600 * 1000;
}

function sessionFiles() {
  const out = [];
  const root = path.join(os.homedir(), '.dsh', 'sessions');
  try {
    if (!fs.existsSync(root)) return out;
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir);
      if (!fs.statSync(p).isDirectory()) continue;
      for (const sub of fs.readdirSync(p)) {
        const f = path.join(p, sub, 'session.jsonl.zstd');
        if (fs.existsSync(f)) out.push(f);
      }
    }
  } catch {}
  return out;
}

// zstd 可执行文件探测：Finder/launchd 启动时 PATH 不含 Homebrew，必须用绝对路径
let ZSTD_BIN = null;
function resolveZstd() {
  if (ZSTD_BIN) return ZSTD_BIN;
  const candidates = [
    process.env.DSH_ZSTD,
    '/opt/homebrew/bin/zstd',   // Apple Silicon Homebrew
    '/usr/local/bin/zstd',      // Intel Homebrew
    '/usr/bin/zstd',
  ].filter(Boolean);
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); ZSTD_BIN = c; return c; } catch {}
  }
  try {
    const which = execFileSync('which', ['zstd'], { encoding: 'utf8', timeout: 3000 }).trim();
    if (which) { ZSTD_BIN = which; return which; }
  } catch {}
  return null;
}

function scanSessionFile(file, onLine) {
  return new Promise((resolve) => {
    const bin = resolveZstd();
    if (!bin) return resolve();
    const child = spawn(bin, ['-dc', '--no-check', file]);
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.length > 30) onLine(line);
      }
      if (buf.length > 2 * 1024 * 1024) buf = buf.slice(-1024);
    });
    child.on('error', () => resolve());
    child.on('close', () => { if (buf.length > 30) onLine(buf); resolve(); });
  });
}

// 今日 token 总数：以亿为单位（如 0.016亿 / 1.25亿）
function fmtTokensYi(n) {
  if (!n) return '0';
  const yi = n / 1e8;
  const s = yi >= 1 ? yi.toFixed(2) : yi.toFixed(3);
  return s.replace(/\.?0+$/, '') + '亿';
}

// 明细：以 M（百万）为单位（如 1.28M / 0.27M）
function fmtTokensM(n) {
  if (!n) return '0';
  const m = n / 1e6;
  return m.toFixed(2).replace(/\.?0+$/, '') + 'M';
}

async function fetchTodayTokens() {
  try {
    if (!resolveZstd()) return null; // 无 zstd：显示"不可用"而不是 0
    const start = todayStartMs();
    const nowMs = Date.now();
    const totals = { input: 0, output: 0, cache: 0, calls: 0 };
    for (const f of sessionFiles()) {
      await scanSessionFile(f, (line) => {
        if (!line.includes('"type":"assistant/chunk"')) return;
        let j;
        try { j = JSON.parse(line); } catch { return; }
        const t = j.time;
        if (typeof t !== 'number' || t < start || t > nowMs) return;
        const c = j.data && j.data.chunk;
        if (!c || c.type !== 'usage' || !c.usage) return;
        const u = c.usage;
        totals.input += u.inputTokens || 0;
        totals.output += u.outputTokens || 0;
        totals.cache += u.cacheReadTokens || 0;
        totals.calls++;
      });
    }
    // 总 token = 输入(未命中) + 输出 + 缓存命中（DeepSeek 平台用量为全量 token）
    const total = totals.input + totals.output + totals.cache;
    return {
      total,
      totalFmt: fmtTokensYi(total),
      // 输入口径与平台一致：总输入 = 缓存命中 + 未命中
      inputFmt: fmtTokensM(totals.input + totals.cache),
      outputFmt: fmtTokensM(totals.output),
      cacheFmt: fmtTokensYi(totals.cache),
      callsFmt: String(totals.calls),
    };
  } catch {
    return null;
  }
}

async function updateUsagePanel(win) {
  if (!win || win.isDestroyed()) return;
  const [bal, tok] = await Promise.all([fetchBalance(), fetchTodayTokens()]);
  const info = bal && Array.isArray(bal.balance_infos) ? bal.balance_infos[0] : null;
  const hh = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
  const isPeak = (hh >= 1 && hh < 4) || (hh >= 6 && hh < 10);
  writeLog(`balance fetch: ${info ? `total=${info.total_balance} topped=${info.topped_up_balance} granted=${info.granted_balance}` : 'null'} session=${isPeak ? 'peak' : 'off-peak'} todayTokens=${tok ? tok.total : 'n/a'}`);
  const js = `(() => {
    const set = (sel, v) => { const el = document.querySelector('#ds-usage-card ' + sel); if (el) el.textContent = v; };
    ${info
      ? `set('.ds-usage-balance', '¥' + ${JSON.stringify(info.total_balance)});
    set('.ds-u-top', '¥' + ${JSON.stringify(info.topped_up_balance)});
    set('.ds-u-grant', '¥' + ${JSON.stringify(info.granted_balance)});
    set('.ds-u-time', new Date().toLocaleTimeString('zh-CN'));`
      : `set('.ds-usage-balance', '不可用');`}
    ${tok
      ? `set('.ds-u-today', ${JSON.stringify(tok.totalFmt)});
    set('.ds-u-in', ${JSON.stringify(tok.inputFmt)});
    set('.ds-u-out', ${JSON.stringify(tok.outputFmt)});
    set('.ds-u-cache', ${JSON.stringify(tok.cacheFmt)});
    set('.ds-u-calls', ${JSON.stringify(tok.callsFmt)});`
      : `set('.ds-u-today', '不可用');`}
    const now = new Date();
    const h = now.getUTCHours() + now.getUTCMinutes() / 60;
    const peak = (h >= 1 && h < 4) || (h >= 6 && h < 10);
    const pk = document.querySelector('#ds-usage-card .ds-usage-peak');
    if (pk) { pk.textContent = peak ? '高峰' : '空闲'; pk.classList.toggle('peak', peak); }
    const ss = document.querySelector('#ds-usage-card .ds-u-session');
    if (ss) { ss.textContent = peak ? '高峰（价格翻倍）' : '空闲（半价优惠）'; ss.classList.toggle('peak', peak); }
    const card = document.getElementById('ds-usage-card'); if (card) card.style.display = 'block';
  })()`;
  try { await win.webContents.executeJavaScript(js); } catch (e) { writeLog('usage update failed: ' + e.message); }
}


/* ---------------- 外观面板（Look & Feel，客户端启动自动注入） ---------------- */

const LOOK_FONT_SHORTHANDS = {
  '--dsw-font-markdown-h1': ['700', 24, 34, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-h2': ['700', 22, 32, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-h3': ['700', 20, 30, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-h4': ['600', 16, 28, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-base': ['400', 16, 28, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-base-strong': ['600', 16, 28, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-base-italic': ['italic 400', 16, 28, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-base-strong-italic': ['italic 600', 16, 28, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-table': ['400', 15, 25, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-table-head': ['500', 15, 25, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-small': ['400', 14, 24, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-small-strong': ['600', 14, 24, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-small-italic': ['italic 400', 14, 24, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-small-strong-italic': ['italic 600', 14, 24, 'var(--dsw-font-family)'],
  '--dsw-font-markdown-code': ['400', 14, 22, 'var(--ds-font-family-code)'],
  '--dsw-font-markdown-code-block': ['400', 13, 22, 'var(--ds-font-family-code)'],
  '--dsw-font-markdown-code-block-small': ['400', 12, 18, 'var(--ds-font-family-code)'],
  '--dsw-font-xl-24': ['600', 24, 32, 'var(--dsw-font-family)'],
  '--dsw-font-l-20': ['500', 20, 28, 'var(--dsw-font-family)'],
  '--dsw-font-m-18': ['500', 16, 28, 'var(--dsw-font-family)'],
  '--dsw-font-base-16': ['400', 16, 24, 'var(--dsw-font-family)'],
  '--dsw-font-base-strong-16': ['500', 16, 24, 'var(--dsw-font-family)'],
  '--dsw-font-s-14': ['400', 14, 22, 'var(--dsw-font-family)'],
  '--dsw-font-s-strong-14': ['500', 14, 22, 'var(--dsw-font-family)'],
  '--dsw-font-xs-13': ['400', 13, 20, 'var(--dsw-font-family)'],
  '--dsw-font-xs-strong-13': ['500', 13, 20, 'var(--dsw-font-family)'],
  '--dsw-font-xxs-12': ['400', 12, 18, 'var(--dsw-font-family)'],
  '--dsw-font-xxs-strong-12': ['500', 12, 18, 'var(--dsw-font-family)'],
  '--dsw-font-xxxs-11': ['400', 11, 14, 'var(--dsw-font-family)'],
  '--dsw-font-xxxs-strong-11': ['500', 11, 14, 'var(--dsw-font-family)']
};
const LOOK_FONT_PRESETS = [
  { id: 'xs', label: '特小', scale: 0.75 },
  { id: 'sm', label: '小', scale: 0.85 },
  { id: 'md', label: '中', scale: 1.0 },
  { id: 'lg', label: '大', scale: 1.15 }
];
const LOOK_PALETTES = [
  { id: 'default', label: '默认', tokens: null },
  { id: 'ocean', label: '深海蓝', tokens: { '--dsw-alias-brand-primary': { light: '#2563eb', dark: '#60a5fa' }, '--dsw-alias-state-business-primary': { light: '#2563eb', dark: '#60a5fa' }, '--dsw-alias-state-business-tertiary': { light: '#dbeafe', dark: '#1e3a8a' }, '--dsw-specific-sidebar-fill': { light: '#eaf2ff', dark: '#14223f' }, '--dsw-alias-bg-base': { light: '#f5f8ff', dark: '#101827' }, '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#16233c' }, '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#1b2a47' }, '--dsw-alias-bg-layer-3': { light: '#ffffff', dark: '#20304f' }, '--dsw-specific-bubble': { light: '#e8f0fe', dark: '#1e3a5f' }, '--dsw-specific-bubble-highlight': { light: '#d8e6fc', dark: '#274b75' }, '--dsw-specific-input-major': { light: '#ffffff', dark: '#16233c' } } },
  { id: 'forest', label: '森林绿', tokens: { '--dsw-alias-brand-primary': { light: '#059669', dark: '#34d399' }, '--dsw-alias-state-business-primary': { light: '#059669', dark: '#34d399' }, '--dsw-alias-state-business-tertiary': { light: '#d1fae5', dark: '#064e3b' }, '--dsw-specific-sidebar-fill': { light: '#e9f8f1', dark: '#0c2b21' }, '--dsw-alias-bg-base': { light: '#f3faf7', dark: '#0f1f1a' }, '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#142920' }, '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#183128' }, '--dsw-alias-bg-layer-3': { light: '#ffffff', dark: '#1c382d' }, '--dsw-specific-bubble': { light: '#e2f5ec', dark: '#1c3d30' }, '--dsw-specific-bubble-highlight': { light: '#cdefdd', dark: '#22503e' }, '--dsw-specific-input-major': { light: '#ffffff', dark: '#142920' } } },
  { id: 'ember', label: '暖橙', tokens: { '--dsw-alias-brand-primary': { light: '#ea580c', dark: '#fb923c' }, '--dsw-alias-state-business-primary': { light: '#ea580c', dark: '#fb923c' }, '--dsw-alias-state-business-tertiary': { light: '#ffedd5', dark: '#7c2d12' }, '--dsw-specific-sidebar-fill': { light: '#fef3e8', dark: '#2b1608' }, '--dsw-alias-bg-base': { light: '#fdf8f2', dark: '#1f1408' }, '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#2a1a0d' }, '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#33200f' }, '--dsw-alias-bg-layer-3': { light: '#ffffff', dark: '#3a2512' }, '--dsw-specific-bubble': { light: '#fdeeda', dark: '#3d2712' }, '--dsw-specific-bubble-highlight': { light: '#fce1c0', dark: '#4d3218' }, '--dsw-specific-input-major': { light: '#ffffff', dark: '#2a1a0d' } } }
];
function lookReadPrefs() {
  const defaults = { font: 'sm', palette: 'default', custom: { brand: '#2563eb', bg: '#f5f8ff' } };
  try {
    const raw = localStorage.getItem('dsh.lookandfeel');
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      font: parsed.font || defaults.font,
      palette: parsed.palette || defaults.palette,
      custom: { brand: (parsed.custom && parsed.custom.brand) || defaults.custom.brand, bg: (parsed.custom && parsed.custom.bg) || defaults.custom.bg }
    };
  } catch (e) { return defaults; }
}
function lookSavePrefs(prefs) {
  try { localStorage.setItem('dsh.lookandfeel', JSON.stringify(prefs)); } catch (e) {}
}
function lookIsDark() {
  return document.body && (document.body.dataset.dsDarkTheme !== undefined || document.body.hasAttribute('data-ds-dark-theme'));
}
const LOOK_COLOR_VARS = ['--dsw-alias-brand-primary','--dsw-alias-state-business-primary','--dsw-alias-state-business-tertiary','--dsw-specific-sidebar-fill','--dsw-alias-bg-base','--dsw-alias-bg-layer-1','--dsw-alias-bg-layer-2','--dsw-alias-bg-layer-3','--dsw-specific-bubble','--dsw-specific-bubble-highlight','--dsw-specific-input-major'];
function lookApplyFont(scale) {
  const t = document.body; if (!t) return;
  for (const [name, arr] of Object.entries(LOOK_FONT_SHORTHANDS)) {
    const size = Math.round(arr[1] * scale);
    t.style.setProperty(name, arr[0] + ' ' + size + 'px/' + arr[2] + 'px ' + arr[3]);
  }
}
function lookResetFont() {
  if (!document.body) return;
  for (const name of Object.keys(LOOK_FONT_SHORTHANDS)) document.body.style.removeProperty(name);
}
function lookApplyPalette(tokens) {
  const t = document.body; if (!t) return;
  if (!tokens) { for (const n of LOOK_COLOR_VARS) t.style.removeProperty(n); return; }
  const dark = lookIsDark();
  for (const [name, pair] of Object.entries(tokens)) t.style.setProperty(name, dark ? pair.dark : pair.light);
}
function lookLighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + amt), g = Math.min(255, ((n >> 8) & 255) + amt), b = Math.min(255, (n & 255) + amt);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
function lookDarken(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - amt), g = Math.max(0, ((n >> 8) & 255) - amt), b = Math.max(0, (n & 255) - amt);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
function lookCustomTokens(brand, bg) {
  const isD = lookIsDark();
  const layer = isD ? lookLighten(bg, 14) : '#ffffff';
  const layer2 = isD ? lookLighten(bg, 24) : '#ffffff';
  const layer3 = isD ? lookLighten(bg, 32) : '#ffffff';
  const bubble = isD ? lookLighten(bg, 30) : lookLighten(bg, 8);
  const brandDark = isD ? lookLighten(brand, 40) : brand;
  return {
    '--dsw-alias-brand-primary': { light: brand, dark: brandDark },
    '--dsw-alias-state-business-primary': { light: brand, dark: brandDark },
    '--dsw-alias-state-business-tertiary': { light: lookLighten(brand, 150), dark: lookDarken(brand, 80) },
    '--dsw-specific-sidebar-fill': { light: lookLighten(bg, 12), dark: lookDarken(bg, 16) },
    '--dsw-alias-bg-base': { light: bg, dark: bg },
    '--dsw-alias-bg-layer-1': { light: layer, dark: layer },
    '--dsw-alias-bg-layer-2': { light: layer2, dark: layer2 },
    '--dsw-alias-bg-layer-3': { light: layer3, dark: layer3 },
    '--dsw-specific-bubble': { light: bubble, dark: bubble },
    '--dsw-specific-bubble-highlight': { light: lookLighten(bg, 20), dark: lookLighten(bg, 44) },
    '--dsw-specific-input-major': { light: layer, dark: layer }
  };
}
function injectLookPanel() {
  if (!document.body || document.getElementById('dsh-look-panel') || document.getElementById('dsh-look-fab')) return;
  let prefs = lookReadPrefs();
  const fab = document.createElement('button');
  fab.id = 'dsh-look-fab';
  fab.textContent = '🎨 外观';
  fab.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99998;padding:8px 14px;border-radius:999px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#111);font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none';
  const panel = document.createElement('div');
  panel.id = 'dsh-look-panel';
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99998;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:14px;padding:14px 16px;min-width:280px;box-shadow:0 12px 32px rgba(0,0,0,.15);font-family:-apple-system,"PingFang SC",sans-serif;font-size:13px;color:var(--dsw-alias-label-primary,#111)';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-weight:600;font-size:14px';
  const title = document.createElement('span'); title.textContent = '🎨 外观';
  const close = document.createElement('button'); close.textContent = '×';
  close.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;color:var(--dsw-alias-label-secondary,#666);padding:0 4px';
  close.addEventListener('click', () => { panel.style.display = 'none'; fab.style.display = 'block'; });
  head.appendChild(title); head.appendChild(close);
  panel.appendChild(head);
  // 字体行
  const fontRow = document.createElement('div');
  fontRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0';
  const fontLabel = document.createElement('span');
  fontLabel.style.cssText = 'font-size:13px;color:var(--dsw-alias-label-primary,#111)';
  fontLabel.textContent = '字体大小';
  const fontGroup = document.createElement('div');
  fontGroup.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  const mkBtn = (label, active) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:3px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));font-size:12px;cursor:pointer;background:' + (active ? 'var(--dsw-alias-brand-primary,#2563eb)' : 'transparent') + ';color:' + (active ? '#fff' : 'var(--dsw-alias-label-secondary,#666)');
    return b;
  };
  LOOK_FONT_PRESETS.forEach((f) => {
    const b = mkBtn(f.label, prefs.font === f.id);
    b.addEventListener('click', () => {
      prefs.font = f.id; lookSavePrefs(prefs);
      fontGroup.querySelectorAll('button').forEach((x) => { x.style.background = 'transparent'; x.style.color = 'var(--dsw-alias-label-secondary,#666)'; });
      b.style.background = 'var(--dsw-alias-brand-primary,#2563eb)'; b.style.color = '#fff';
      if (f.scale === 1.0) lookResetFont(); else lookApplyFont(f.scale);
    });
    fontGroup.appendChild(b);
  });
  fontRow.appendChild(fontLabel); fontRow.appendChild(fontGroup);
  panel.appendChild(fontRow);
  // 主题色行
  const palRow = document.createElement('div');
  palRow.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;padding:6px 0;gap:8px';
  const palLabel = document.createElement('span');
  palLabel.style.cssText = 'font-size:13px;color:var(--dsw-alias-label-primary,#111);padding-top:4px';
  palLabel.textContent = '主题色';
  const palRight = document.createElement('div');
  palRight.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:6px';
  const palGroup = document.createElement('div');
  palGroup.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end';
  const customRow = document.createElement('div');
  customRow.style.cssText = 'display:' + (prefs.palette === 'custom' ? 'flex' : 'none') + ';gap:10px;align-items:center';
  const mkColor = (label, value) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary,#666)';
    wrap.textContent = label;
    const input = document.createElement('input');
    input.type = 'color'; input.value = value;
    input.style.cssText = 'width:26px;height:22px;border:none;padding:0;background:none;cursor:pointer';
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  };
  const brandPicker = mkColor('主题', prefs.custom.brand);
  const bgPicker = mkColor('背景', prefs.custom.bg);
  customRow.appendChild(brandPicker.wrap);
  customRow.appendChild(bgPicker.wrap);
  palRight.appendChild(customRow);
  LOOK_PALETTES.forEach((p) => {
    const b = mkBtn(p.label, prefs.palette === p.id);
    b.addEventListener('click', () => {
      prefs.palette = p.id; lookSavePrefs(prefs);
      palGroup.querySelectorAll('button').forEach((x) => { x.style.background = 'transparent'; x.style.color = 'var(--dsw-alias-label-secondary,#666)'; });
      b.style.background = 'var(--dsw-alias-brand-primary,#2563eb)'; b.style.color = '#fff';
      customRow.style.display = 'none';
      lookApplyPalette(p.tokens);
    });
    palGroup.appendChild(b);
  });
  const customBtn = mkBtn('自定义', prefs.palette === 'custom');
  customBtn.addEventListener('click', () => {
    prefs.palette = 'custom'; lookSavePrefs(prefs);
    palGroup.querySelectorAll('button').forEach((x) => { x.style.background = 'transparent'; x.style.color = 'var(--dsw-alias-label-secondary,#666)'; });
    customBtn.style.background = 'var(--dsw-alias-brand-primary,#2563eb)'; customBtn.style.color = '#fff';
    customRow.style.display = 'flex';
    lookApplyPalette(lookCustomTokens(prefs.custom.brand, prefs.custom.bg));
  });
  palGroup.appendChild(customBtn);
  brandPicker.input.addEventListener('input', () => {
    prefs.custom.brand = brandPicker.input.value; lookSavePrefs(prefs);
    if (prefs.palette === 'custom') lookApplyPalette(lookCustomTokens(prefs.custom.brand, prefs.custom.bg));
  });
  bgPicker.input.addEventListener('input', () => {
    prefs.custom.bg = bgPicker.input.value; lookSavePrefs(prefs);
    if (prefs.palette === 'custom') lookApplyPalette(lookCustomTokens(prefs.custom.brand, prefs.custom.bg));
  });
  palRow.appendChild(palLabel); palRow.appendChild(palRight);
  panel.appendChild(palRow);
  const note = document.createElement('div');
  note.textContent = '设置保存在本地；自定义色：主题色 + 主区背景色。';
  note.style.cssText = 'margin-top:8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#999);line-height:1.6';
  panel.appendChild(note);
  fab.addEventListener('click', () => { fab.style.display = 'none'; panel.style.display = 'block'; });
  document.body.appendChild(fab);
  document.body.appendChild(panel);
  // 应用已保存偏好
  const cur = LOOK_FONT_PRESETS.find((f) => f.id === prefs.font);
  if (cur && cur.scale !== 1.0) lookApplyFont(cur.scale);
  if (prefs.palette === 'custom') lookApplyPalette(lookCustomTokens(prefs.custom.brand, prefs.custom.bg));
  else { const cp = LOOK_PALETTES.find((p) => p.id === prefs.palette); if (cp) lookApplyPalette(cp.tokens); }
}


function injectUsagePanel(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.insertCSS(USAGE_CARD_CSS).catch(() => {});
  win.webContents.executeJavaScript(`(() => {
    if (document.getElementById('ds-usage-card')) return;
    const d = document.createElement('div');
    d.id = 'ds-usage-card';
    d.innerHTML = '<div class="ds-usage-head"><span>💰 余额</span><span class="ds-usage-spacer"></span><span class="ds-usage-balance">…</span><span class="ds-usage-peak">…</span></div>' +
      '<div class="ds-usage-body">' +
      '<div>当前时段 <b class="ds-u-session">…</b></div>' +
      '<div>今日 tokens <b class="ds-u-today">…</b></div>' +
      '<div class="ds-u-today-detail">输入 <b class="ds-u-in">…</b> · 输出 <b class="ds-u-out">…</b></div>' +
      '<div class="ds-u-today-detail">其中缓存 <b class="ds-u-cache">…</b> · <b class="ds-u-calls">…</b> 次调用</div>' +
      '<div>充值 <b class="ds-u-top">…</b></div>' +
      '<div>赠送 <b class="ds-u-grant">…</b></div>' +
      '<div>更新 <span class="ds-u-time">…</span></div>' +
      '<a href="https://platform.deepseek.com/usage" target="_blank" rel="noopener">查看用量明细 ↗</a>' +
      '</div>';
    d.querySelector('.ds-usage-head').addEventListener('click', () => d.classList.toggle('open'));
    d.querySelector('a').addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://platform.deepseek.com/usage', '_blank');
    });
    // 拖拽支持：鼠标按住头部可拖动浮窗，位置记忆在 localStorage
    (function setupDrag() {
      const saved = localStorage.getItem('dsh.usageCard.pos');
      if (saved) {
        try {
          const p = JSON.parse(saved);
          d.style.left = p.left + 'px';
          d.style.top = p.top + 'px';
          d.style.bottom = 'auto';
        } catch (e) {}
      }
      const head = d.querySelector('.ds-usage-head');
      let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
      head.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        const r = d.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        origLeft = r.left; origTop = r.top;
        d.style.bottom = 'auto';
        d.style.left = r.left + 'px';
        d.style.top = r.top + 'px';
        d.style.cursor = 'grabbing';
        d.style.transition = 'none';
        e.preventDefault();
        e.stopPropagation();
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const nl = origLeft + (e.clientX - startX);
        const nt = origTop + (e.clientY - startY);
        d.style.left = Math.max(0, nl) + 'px';
        d.style.top = Math.max(0, nt) + 'px';
      });
      window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        d.style.cursor = 'pointer';
        d.style.transition = '';
        try {
          const r = d.getBoundingClientRect();
          localStorage.setItem('dsh.usageCard.pos', JSON.stringify({ left: r.left, top: r.top }));
        } catch (e) {}
      });
    })();
    document.body.appendChild(d);
  })()`).catch(() => {});
  updateUsagePanel(win);
  writeLog('usage panel injected');
}

/* ---------------- 日志 ---------------- */

function logFile() {
  return path.join(app.getPath('userData'), 'service.log');
}

function writeLog(line) {
  const ts = new Date().toISOString();
  try {
    fs.appendFileSync(logFile(), `[${ts}] ${line}\n`);
  } catch {}
}

/* ---------------- 服务管理 ---------------- */

function checkPort(port, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForService(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkPort(port)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function startService() {
  const { port, command } = config();

  // 端口已有服务 → 直接复用
  if (await checkPort(port)) {
    serviceExternal = true;
    writeLog(`port ${port} already serving — reusing external service`);
    console.log(`[shell] port ${port} already serving (external)`);
    return { ok: true, external: true };
  }

  writeLog(`starting: ${command} (port ${port})`);
  console.log(`[shell] spawning: ${command}`);
  serviceExternal = false;

  // 命令来自本地配置文件（用户自己配置），用 shell 语义执行以支持引号/管道等
  serviceProc = spawn(command, {
    cwd: app.getPath('userData'),
    env: { ...process.env, DSH_WEB_PORT: String(port) },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serviceProc.stdout.on('data', (d) => writeLog(`[svc] ${String(d).trim()}`));
  serviceProc.stderr.on('data', (d) => writeLog(`[svc] ${String(d).trim()}`));
  serviceProc.on('exit', (code) => {
    writeLog(`service exited code=${code}`);
    console.log(`[shell] service exited code=${code}`);
    serviceProc = null;
    if (!isQuitting && !SMOKE_TEST) {
      // 服务意外退出：提示用户
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '服务已停止',
        message: 'DeepSeek Harness 本地服务意外退出。',
        detail: '可以通过托盘菜单「重启服务」重新启动。',
        buttons: ['知道了'],
      });
    }
  });

  const ready = await waitForService(port, START_TIMEOUT_MS);
  if (!ready) {
    writeLog('service failed to become ready in time');
    return { ok: false, error: `服务 ${START_TIMEOUT_MS / 1000} 秒内未就绪。请在托盘菜单「打开日志」查看原因。` };
  }
  writeLog('service ready');
  return { ok: true, external: false };
}

async function restartService() {
  const { port } = config();
  await stopService();
  serviceExternal = false;
  serviceProc = null;
  const result = await startService();
  if (result.ok && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
  }
  return result;
}

function stopService() {
  return new Promise((resolve) => {
    if (serviceProc && serviceProc.pid) {
      const pid = serviceProc.pid;
      writeLog(`stopping service pid=${pid}`);
      try { process.kill(pid, 'SIGTERM'); } catch {}
      setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch {}
        resolve();
      }, 2000);
    } else {
      resolve();
    }
  });
}

/* ---------------- 窗口 ---------------- */

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'DeepSeek Harness Desktop',
    backgroundColor: '#0d0d0d',
    icon: path.join(__dirname, 'assets', 'icon.icns'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  // macOS 标准行为：红色关闭 = 隐藏到后台（Dock 点击恢复），托盘退出/Cmd+Q 才真正退出
  mainWindow.on('close', (e) => {
    if (!isQuitting && !SMOKE_TEST) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  // 页面加载/重载后应用字体缩放（SPA 重路由不触发，但服务重启重载会）
  mainWindow.webContents.on('did-finish-load', () => {
    applyFontScale(mainWindow);
    injectUsagePanel(mainWindow);
        const lookScript = () => {
      // 从 app.asar 内资源读取注入脚本，避免字符串转义问题
      const scriptPath = path.join(__dirname, 'look-inject.js');
      try {
        const lookJs = fs.readFileSync(scriptPath, 'utf8');
        // 捕获页面 console 错误（诊断用）
        mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
          if (level >= 3) writeLog('renderer console[' + level + ']: ' + message);
        });
        mainWindow.webContents.executeJavaScript(lookJs)
          .then(() => writeLog('look panel injected'))
          .catch((e) => writeLog('look panel inject failed: ' + e.message));
      } catch (e) {
        writeLog('look panel script read failed: ' + e.message);
      }
    };
    lookScript();
    setTimeout(lookScript, 1500);
    setTimeout(lookScript, 4000);
  });

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, target) => {
    if (!target.startsWith(`http://127.0.0.1:${config().port}`)) {
      e.preventDefault();
      if (/^https?:/i.test(target)) shell.openExternal(target);
    }
  });

  // 加载失败：显示错误页
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    if (code === -3) return; // ERR_ABORTED（正常重定向）
    writeLog(`page load failed: ${code} ${desc}`);
    mainWindow.loadFile(path.join(__dirname, 'error.html'), {
      query: { code: String(code), desc },
    });
  });

  return mainWindow;
}

/* ---------------- 开机自启 ---------------- */

function applyLoginItem() {
  try {
    app.setLoginItemSettings({
      openAtLogin: config().openAtLogin,
      openAsHidden: true,
    });
    writeLog(`login item: ${config().openAtLogin ? 'enabled' : 'disabled'}`);
  } catch (e) {
    writeLog(`login item failed: ${e.message}`);
  }
}

/* ---------------- 自动更新（自建轻量更新器） ---------------- */

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('manifest 解析失败')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

function streamDownload(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败 HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (d) => {
        got += d.length;
        if (onProgress && total) onProgress(got, total);
      });
      res.pipe(out);
      out.on('finish', () => { out.close(() => resolve()); });
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
  });
}

function unzip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    execFile('/usr/bin/ditto', ['-x', '-k', zipPath, destDir], (err) => {
      if (err) reject(new Error(`解压失败: ${err.message}`));
      else resolve();
    });
  });
}

function findAppBundle() {
  // exe: .../DeepSeekHarnessDesktop.app/Contents/MacOS/DeepSeekHarnessDesktop
  const exe = app.getPath('exe');
  const root = path.resolve(path.dirname(exe), '..', '..');
  return root.endsWith('.app') ? root : null;
}

async function checkForUpdates(manual) {
  const { updateUrl } = config();
  const current = app.getVersion();
  if (!updateUrl) {
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '检查更新',
        message: '未配置更新源',
        detail: '在 userData/config.json 中设置 updateUrl（指向含 version/url/notes 的 JSON）即可启用自动更新。',
        buttons: ['知道了'],
      });
    }
    return;
  }
  try {
    const manifest = await fetchJson(updateUrl);
    if (!manifest || !manifest.version || !manifest.url) {
      throw new Error('manifest 缺少 version/url 字段');
    }
    const cmp = compareVersions(manifest.version, current);
    if (cmp <= 0) {
      if (manual) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '检查更新',
          message: `当前已是最新版本（${current}）`,
          buttons: ['好的'],
        });
      }
      return;
    }
    writeLog(`update available: ${current} -> ${manifest.version}`);
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: `DeepSeek Harness Desktop ${manifest.version} 可用（当前 ${current}）`,
      detail: manifest.notes || '点击「立即更新」下载并安装。',
      buttons: ['立即更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response !== 0) return;

    const appRoot = findAppBundle();
    if (!appRoot) throw new Error('无法定位应用包路径');
    const updateDir = path.join(app.getPath('userData'), 'update');
    fs.mkdirSync(updateDir, { recursive: true });
    const zipPath = path.join(updateDir, `update-${manifest.version}.zip`);
    const extractDir = path.join(updateDir, `extract-${manifest.version}`);

    writeLog(`downloading ${manifest.url}`);
    await streamDownload(manifest.url, zipPath, (got, total) => {
      const pct = Math.round((got / total) * 100);
      if (pct % 25 === 0) writeLog(`download ${pct}%`);
    });
    writeLog('downloaded, extracting');
    await unzip(zipPath, extractDir);

    // 找到解压出的 .app（zip 顶层可能是 .app 或包含它的目录）
    const candidates = [extractDir, path.join(extractDir, 'mac'), path.join(extractDir, 'darwin-arm64')];
    let newApp = null;
    for (const c of candidates) {
      const match = fs.readdirSync(c, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.endsWith('.app'));
      if (match) { newApp = path.join(c, match.name); break; }
    }
    if (!newApp) throw new Error('解压内容中未找到 .app');

    // 备份 → 替换 → 失败回滚
    const backup = `${appRoot}.bak`;
    writeLog(`replacing ${appRoot}`);
    fs.rmSync(backup, { recursive: true, force: true });
    fs.renameSync(appRoot, backup);
    try {
      fs.mkdirSync(path.dirname(appRoot), { recursive: true });
      fs.cpSync(newApp, appRoot, { recursive: true });
      fs.chmodSync(path.join(appRoot, 'Contents', 'MacOS', path.basename(newApp, '.app')), 0o755);
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (e) {
      // 回滚
      fs.rmSync(appRoot, { recursive: true, force: true });
      fs.renameSync(backup, appRoot);
      throw new Error(`替换失败，已回滚: ${e.message}`);
    }
    writeLog(`updated to ${manifest.version}`);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新完成',
      message: `已更新到 ${manifest.version}`,
      detail: '请退出并重新启动应用以生效。',
      buttons: ['好的'],
    });
  } catch (e) {
    writeLog(`update failed: ${e.message}`);
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '更新失败',
        message: e.message,
        detail: '详情见服务日志。',
        buttons: ['知道了'],
      });
    }
  }
}

/* ---------------- 托盘 ---------------- */

function updateTrayTitle() {
  if (!tray) return;
  const { port } = config();
  tray.setToolTip(`DeepSeek Harness Desktop\nhttp://127.0.0.1:${port}${serviceExternal ? '（外部服务）' : ''}`);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'trayTemplate.png');
  tray = new Tray(iconPath);
  tray.setToolTip('DeepSeek Harness Desktop');

  const menu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏窗口',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else { mainWindow.show(); mainWindow.focus(); }
      },
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: config().openAtLogin,
      click: (item) => {
        saveConfig({ openAtLogin: item.checked });
        applyLoginItem();
      },
    },
    { type: 'separator' },
    {
      label: '字体大小',
      submenu: [
        { label: '特小', type: 'radio', checked: config().fontSize === 'x-small', click: () => { saveConfig({ fontSize: 'x-small' }); applyFontScale(mainWindow); } },
        { label: '小', type: 'radio', checked: config().fontSize === 'small', click: () => { saveConfig({ fontSize: 'small' }); applyFontScale(mainWindow); } },
        { label: '中', type: 'radio', checked: config().fontSize === 'medium', click: () => { saveConfig({ fontSize: 'medium' }); applyFontScale(mainWindow); } },
        { label: '大', type: 'radio', checked: config().fontSize === 'large', click: () => { saveConfig({ fontSize: 'large' }); applyFontScale(mainWindow); } },
      ],
    },
    {
      label: '检查更新…',
      click: () => checkForUpdates(true),
    },
    { label: '重启服务', click: async () => {
        const r = await restartService();
        if (!r.ok) dialog.showMessageBox(mainWindow, { type: 'error', title: '重启失败', message: r.error || '未知错误' });
      } },
    { label: '打开服务日志', click: () => shell.openPath(logFile()) },
    { label: '在浏览器打开', click: () => shell.openExternal(`http://127.0.0.1:${config().port}`) },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });
  updateTrayTitle();
}

/* ---------------- 冒烟测试 ---------------- */

async function runSmoke() {
  console.log('[smoke] shell smoke test');
  const { port } = config();
  const alive = await checkPort(port);
  console.log(`[smoke] port ${port} reachable: ${alive}`);
  if (!alive) {
    // 尝试自启动（不依赖外部服务）
    const r = await startService();
    if (!r.ok) {
      console.error(`[smoke] FAILED: ${r.error}`);
      console.log('SMOKE_RESULT_FAIL');
      app.exit(1);
      return;
    }
  }
  const w = createWindow(`http://127.0.0.1:${port}`);
  w.webContents.once('did-finish-load', () => {
    console.log('[smoke] UI loaded OK');
    console.log('SMOKE_RESULT_OK');
    app.exit(0);
  });
  // 兜底：15s 内未加载完也退出
  setTimeout(() => {
    console.log('SMOKE_RESULT_FAIL');
    app.exit(1);
  }, 15000);
}

/* ---------------- 生命周期 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  function focusMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  }

  app.on('second-instance', () => focusMainWindow());
  // macOS：点击 Dock 图标时恢复隐藏/最小化的窗口（红色关闭只隐藏不销毁）
  app.on('activate', () => focusMainWindow());

  app.whenReady().then(async () => {
    const { port } = config();
    let url;
    if (SMOKE_TEST) {
      runSmoke();
      return;
    }
    const result = await startService();
    if (result.ok) {
      url = `http://127.0.0.1:${port}`;
      createWindow(url);
    } else {
      // 服务启动失败：显示错误窗口
      createWindow(`file://${path.join(__dirname, 'error.html')}?desc=${encodeURIComponent(result.error || '')}`);
    }
    createTray();
    applyLoginItem();
    // 启动后延迟静默检查更新（未配置 updateUrl 时跳过）
    if (config().updateUrl && !SMOKE_TEST) {
      setTimeout(() => checkForUpdates(false), UPDATE_CHECK_DELAY_MS);
    }
    // 余额卡片每 5 分钟刷新
    setInterval(() => { if (mainWindow && !mainWindow.isDestroyed()) updateUsagePanel(mainWindow); }, 60000);
  });

  app.on('window-all-closed', () => {
    // 托盘常驻：不退出（退出走托盘菜单）
  });

  app.on('before-quit', (e) => {
    // 任何退出路径（托盘菜单 / 顶部菜单 Cmd+Q / dock 退出）都先标记 isQuitting，
    // 这样窗口 close 处理器会放行而不是隐藏窗口。
    if (!isQuitting) {
      isQuitting = true;
      // 不 preventDefault：让 Electron 正常关闭窗口并退出；
      // 服务子进程的清理统一在 will-quit 中同步完成。
    }
  });

  app.on('will-quit', () => {
    if (serviceProc && serviceProc.pid) {
      writeLog('will-quit: killing service pid=' + serviceProc.pid);
      try { process.kill(serviceProc.pid, 'SIGKILL'); } catch {}
      serviceProc = null;
    }
    if (tray) { try { tray.destroy(); } catch {} }
  });
}
