// ==UserScript==
// @name         DSH Usage Card（DeepSeek Harness 余额/时段浮窗）
// @namespace    https://github.com/xinster/uptick-dsh-desktop
// @version      1.0.0
// @description  在 DeepSeek Harness Web UI（http://127.0.0.1:3080）左侧栏显示余额与高峰/空闲时段浮窗。首次使用点击卡片里的"设置 API Key"填入 DeepSeek API Key（仅保存在本机浏览器 localStorage）。
// @match        http://127.0.0.1:3080/*
// @match        http://localhost:3080/*
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const CARD_CSS = `
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
#ds-usage-card .ds-usage-body b { color: rgb(15,17,21); }
#ds-usage-card .ds-u-key { color: #1d4ed8; text-decoration: underline; cursor: pointer; }
#ds-usage-card a { color: #1d4ed8; text-decoration: none; display: inline-block; margin-top: 2px; }
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
body[data-ds-dark-theme] #ds-usage-card .ds-usage-body b { color: rgb(249,250,251); }
body[data-ds-dark-theme] #ds-usage-card .ds-u-key { color: #7fa0ff; }
body[data-ds-dark-theme] #ds-usage-card a { color: #7fa0ff; }
`;

  let card = null;

  function apiKey() {
    try { return localStorage.getItem('dsh_usage_api_key') || ''; } catch { return ''; }
  }
  function setApiKey(k) {
    try { localStorage.setItem('dsh_usage_api_key', k); } catch {}
  }

  function inject() {
    if (document.getElementById('ds-usage-card')) return;
    const style = document.createElement('style');
    style.textContent = CARD_CSS;
    (document.head || document.documentElement).appendChild(style);
    const d = document.createElement('div');
    d.id = 'ds-usage-card';
    d.innerHTML =
      '<div class="ds-usage-head"><span>💰 余额</span><span class="ds-usage-spacer"></span>' +
      '<span class="ds-usage-balance">…</span><span class="ds-usage-peak">…</span></div>' +
      '<div class="ds-usage-body">' +
      '<div>当前时段 <b class="ds-u-session">…</b></div>' +
      '<div>充值 <b class="ds-u-top">…</b></div>' +
      '<div>赠送 <b class="ds-u-grant">…</b></div>' +
      '<div>更新 <span class="ds-u-time">…</span></div>' +
      '<div class="ds-u-key">设置 API Key</div>' +
      '<a href="https://platform.deepseek.com/usage" target="_blank" rel="noopener">查看用量明细 ↗</a>' +
      '</div>';
    d.querySelector('.ds-usage-head').addEventListener('click', () => d.classList.toggle('open'));
    d.querySelector('.ds-u-key').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const k = prompt('输入 DeepSeek API Key（仅保存在本机浏览器）：', apiKey());
      if (k && k.trim()) { setApiKey(k.trim()); refresh(); }
    });
    document.body.appendChild(d);
    card = d;
  }

  function fetchBalance() {
    const key = apiKey();
    return new Promise((resolve) => {
      if (!key) return resolve(null);
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://api.deepseek.com/user/balance',
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
        timeout: 10000,
        onload: (res) => { try { resolve(JSON.parse(res.responseText)); } catch { resolve(null); } },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null),
      });
    });
  }

  async function refresh() {
    if (!card) return;
    const set = (sel, v) => { const el = card.querySelector(sel); if (el) el.textContent = v; };
    const now = new Date();
    const h = now.getUTCHours() + now.getUTCMinutes() / 60;
    const peak = (h >= 1 && h < 4) || (h >= 6 && h < 10);
    const pk = card.querySelector('.ds-usage-peak');
    if (pk) { pk.textContent = peak ? '高峰' : '空闲'; pk.classList.toggle('peak', peak); }
    const ss = card.querySelector('.ds-u-session');
    if (ss) { ss.textContent = peak ? '高峰（价格翻倍）' : '空闲（半价优惠）'; ss.classList.toggle('peak', peak); }
    set('.ds-u-time', now.toLocaleTimeString('zh-CN'));

    if (!apiKey()) {
      set('.ds-usage-balance', '未设置');
      set('.ds-u-top', '—');
      set('.ds-u-grant', '—');
      const kh = card.querySelector('.ds-u-key');
      if (kh) kh.textContent = '点击设置 API Key →';
      return;
    }
    const bal = await fetchBalance();
    const info = bal && Array.isArray(bal.balance_infos) ? bal.balance_infos[0] : null;
    set('.ds-usage-balance', info ? '¥' + info.total_balance : '不可用');
    set('.ds-u-top', info ? '¥' + info.topped_up_balance : '—');
    set('.ds-u-grant', info ? '¥' + info.granted_balance : '—');
    const kh = card.querySelector('.ds-u-key');
    if (kh) kh.textContent = '设置 API Key';
  }

  function ensure() {
    if (!document.getElementById('ds-usage-card')) { inject(); refresh(); }
  }

  inject();
  refresh();
  setInterval(() => { ensure(); refresh(); }, 60000);
  if (document.body) {
    new MutationObserver(() => { ensure(); }).observe(document.body, { childList: true });
  }
})();
