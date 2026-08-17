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
const { spawn, execFile } = require('child_process');
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
    fontSize: ['small', 'medium', 'large'].includes(c.fontSize) ? c.fontSize : 'small',
  };
}

/* 字体缩放：读取页面 --dsw-font-*-font-size 变量并按系数内联覆盖（布局不动，纯字体） */
const FONT_SCALES = { small: 0.85, medium: 1.0, large: 1.15 };

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
  mainWindow.on('closed', () => { mainWindow = null; });
  // 页面加载/重载后应用字体缩放（SPA 重路由不触发，但服务重启重载会）
  mainWindow.webContents.on('did-finish-load', () => applyFontScale(mainWindow));

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
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

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
  });

  app.on('window-all-closed', () => {
    // 托盘常驻：不退出（退出走托盘菜单）
  });

  app.on('before-quit', async (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;
      await stopService();
      app.quit();
    }
  });

  app.on('will-quit', () => {
    if (serviceProc) {
      try { process.kill(serviceProc.pid, 'SIGKILL'); } catch {}
    }
  });
}
