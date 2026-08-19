// look-and-feel 注入脚本（独立文件，桌面壳读取后注入页面）
// 自包含：所有数据 + 逻辑都在这里，不引用任何外部变量

(function () {
  'use strict';

  var FONT_SHORTHANDS = {
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

  var FONT_PRESETS = [
    { id: 'xs', label: '特小', scale: 0.75 },
    { id: 'sm', label: '小', scale: 0.85 },
    { id: 'md', label: '中', scale: 1.0 },
    { id: 'lg', label: '大', scale: 1.15 }
  ];

  var PALETTES = [
    { id: 'default', label: '默认', tokens: null },
    { id: 'ocean', label: '深海蓝', tokens: { '--dsw-alias-brand-primary': { light: '#2563eb', dark: '#60a5fa' }, '--dsw-alias-state-business-primary': { light: '#2563eb', dark: '#60a5fa' }, '--dsw-alias-state-business-tertiary': { light: '#dbeafe', dark: '#1e3a8a' }, '--dsw-specific-sidebar-fill': { light: '#eaf2ff', dark: '#14223f' }, '--dsw-alias-bg-base': { light: '#f5f8ff', dark: '#101827' }, '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#16233c' }, '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#1b2a47' }, '--dsw-alias-bg-layer-3': { light: '#ffffff', dark: '#20304f' }, '--dsw-specific-bubble': { light: '#e8f0fe', dark: '#1e3a5f' }, '--dsw-specific-bubble-highlight': { light: '#d8e6fc', dark: '#274b75' }, '--dsw-specific-input-major': { light: '#ffffff', dark: '#16233c' } } },
    { id: 'forest', label: '森林绿', tokens: { '--dsw-alias-brand-primary': { light: '#059669', dark: '#34d399' }, '--dsw-alias-state-business-primary': { light: '#059669', dark: '#34d399' }, '--dsw-alias-state-business-tertiary': { light: '#d1fae5', dark: '#064e3b' }, '--dsw-specific-sidebar-fill': { light: '#e9f8f1', dark: '#0c2b21' }, '--dsw-alias-bg-base': { light: '#f3faf7', dark: '#0f1f1a' }, '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#142920' }, '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#183128' }, '--dsw-alias-bg-layer-3': { light: '#ffffff', dark: '#1c382d' }, '--dsw-specific-bubble': { light: '#e2f5ec', dark: '#1c3d30' }, '--dsw-specific-bubble-highlight': { light: '#cdefdd', dark: '#22503e' }, '--dsw-specific-input-major': { light: '#ffffff', dark: '#142920' } } },
    { id: 'ember', label: '暖橙', tokens: { '--dsw-alias-brand-primary': { light: '#ea580c', dark: '#fb923c' }, '--dsw-alias-state-business-primary': { light: '#ea580c', dark: '#fb923c' }, '--dsw-alias-state-business-tertiary': { light: '#ffedd5', dark: '#7c2d12' }, '--dsw-specific-sidebar-fill': { light: '#fef3e8', dark: '#2b1608' }, '--dsw-alias-bg-base': { light: '#fdf8f2', dark: '#1f1408' }, '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#2a1a0d' }, '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#33200f' }, '--dsw-alias-bg-layer-3': { light: '#ffffff', dark: '#3a2512' }, '--dsw-specific-bubble': { light: '#fdeeda', dark: '#3d2712' }, '--dsw-specific-bubble-highlight': { light: '#fce1c0', dark: '#4d3218' }, '--dsw-specific-input-major': { light: '#ffffff', dark: '#2a1a0d' } } }
  ];

  var COLOR_VARS = ['--dsw-alias-brand-primary', '--dsw-alias-state-business-primary', '--dsw-alias-state-business-tertiary', '--dsw-specific-sidebar-fill', '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3', '--dsw-specific-bubble', '--dsw-specific-bubble-highlight', '--dsw-specific-input-major'];

  function readPrefs() {
    var defaults = { font: 'sm', palette: 'default', custom: { brand: '#2563eb', bg: '#f5f8ff' } };
    try {
      var raw = localStorage.getItem('dsh.lookandfeel');
      if (!raw) return defaults;
      var parsed = JSON.parse(raw);
      return {
        font: parsed.font || defaults.font,
        palette: parsed.palette || defaults.palette,
        custom: { brand: (parsed.custom && parsed.custom.brand) || defaults.custom.brand, bg: (parsed.custom && parsed.custom.bg) || defaults.custom.bg }
      };
    } catch (e) { return defaults; }
  }

  function savePrefs(prefs) {
    try { localStorage.setItem('dsh.lookandfeel', JSON.stringify(prefs)); } catch (e) {}
  }

  function isDark() {
    return document.body && (document.body.dataset.dsDarkTheme !== undefined || document.body.hasAttribute('data-ds-dark-theme'));
  }

  function applyFont(scale) {
    var t = document.body; if (!t) return;
    for (var name in FONT_SHORTHANDS) {
      var arr = FONT_SHORTHANDS[name];
      var size = Math.round(arr[1] * scale);
      t.style.setProperty(name, arr[0] + ' ' + size + 'px/' + arr[2] + 'px ' + arr[3]);
    }
  }

  function resetFont() {
    if (!document.body) return;
    for (var name in FONT_SHORTHANDS) document.body.style.removeProperty(name);
  }

  function applyPalette(tokens) {
    var t = document.body; if (!t) return;
    if (!tokens) { for (var i = 0; i < COLOR_VARS.length; i++) t.style.removeProperty(COLOR_VARS[i]); return; }
    var dark = isDark();
    for (var name in tokens) t.style.setProperty(name, dark ? tokens[name].dark : tokens[name].light);
  }

  function lighten(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, (n >> 16) + amt), g = Math.min(255, ((n >> 8) & 255) + amt), b = Math.min(255, (n & 255) + amt);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  function darken(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.max(0, (n >> 16) - amt), g = Math.max(0, ((n >> 8) & 255) - amt), b = Math.max(0, (n & 255) - amt);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  function customTokens(brand, bg) {
    var d = isDark();
    var layer = d ? lighten(bg, 14) : '#ffffff';
    var layer2 = d ? lighten(bg, 24) : '#ffffff';
    var layer3 = d ? lighten(bg, 32) : '#ffffff';
    var bubble = d ? lighten(bg, 30) : lighten(bg, 8);
    var brandDark = d ? lighten(brand, 40) : brand;
    return {
      '--dsw-alias-brand-primary': { light: brand, dark: brandDark },
      '--dsw-alias-state-business-primary': { light: brand, dark: brandDark },
      '--dsw-alias-state-business-tertiary': { light: lighten(brand, 150), dark: darken(brand, 80) },
      '--dsw-specific-sidebar-fill': { light: lighten(bg, 12), dark: darken(bg, 16) },
      '--dsw-alias-bg-base': { light: bg, dark: bg },
      '--dsw-alias-bg-layer-1': { light: layer, dark: layer },
      '--dsw-alias-bg-layer-2': { light: layer2, dark: layer2 },
      '--dsw-alias-bg-layer-3': { light: layer3, dark: layer3 },
      '--dsw-specific-bubble': { light: bubble, dark: bubble },
      '--dsw-specific-bubble-highlight': { light: lighten(bg, 20), dark: lighten(bg, 44) },
      '--dsw-specific-input-major': { light: layer, dark: layer }
    };
  }

  function mount() {
    if (!document.body || document.getElementById('dsh-look-panel') || document.getElementById('dsh-look-fab')) return;
    var prefs = readPrefs();

    var fab = document.createElement('button');
    fab.id = 'dsh-look-fab';
    fab.textContent = '🎨 外观';
    fab.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99998;padding:8px 14px;border-radius:999px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#111);font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none';

    var panel = document.createElement('div');
    panel.id = 'dsh-look-panel';
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99998;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:14px;padding:14px 16px;min-width:280px;box-shadow:0 12px 32px rgba(0,0,0,.15);font-family:-apple-system,"PingFang SC",sans-serif;font-size:13px;color:var(--dsw-alias-label-primary,#111)';

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-weight:600;font-size:14px';
    var title = document.createElement('span'); title.textContent = '🎨 外观';
    var close = document.createElement('button'); close.textContent = '×';
    close.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;color:var(--dsw-alias-label-secondary,#666);padding:0 4px';
    close.addEventListener('click', function () { panel.style.display = 'none'; fab.style.display = 'block'; });
    head.appendChild(title); head.appendChild(close);
    panel.appendChild(head);

    var fontRow = document.createElement('div');
    fontRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0';
    var fontLabel = document.createElement('span');
    fontLabel.style.cssText = 'font-size:13px;color:var(--dsw-alias-label-primary,#111)';
    fontLabel.textContent = '字体大小';
    var fontGroup = document.createElement('div');
    fontGroup.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';

    function mkBtn(label, active) {
      var b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'padding:3px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));font-size:12px;cursor:pointer;background:' + (active ? 'var(--dsw-alias-brand-primary,#2563eb)' : 'transparent') + ';color:' + (active ? '#fff' : 'var(--dsw-alias-label-secondary,#666)');
      return b;
    }

    FONT_PRESETS.forEach(function (f) {
      var b = mkBtn(f.label, prefs.font === f.id);
      b.addEventListener('click', function () {
        prefs.font = f.id; savePrefs(prefs);
        fontGroup.querySelectorAll('button').forEach(function (x) { x.style.background = 'transparent'; x.style.color = 'var(--dsw-alias-label-secondary,#666)'; });
        b.style.background = 'var(--dsw-alias-brand-primary,#2563eb)'; b.style.color = '#fff';
        if (f.scale === 1.0) resetFont(); else applyFont(f.scale);
      });
      fontGroup.appendChild(b);
    });
    fontRow.appendChild(fontLabel); fontRow.appendChild(fontGroup);
    panel.appendChild(fontRow);

    var palRow = document.createElement('div');
    palRow.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;padding:6px 0;gap:8px';
    var palLabel = document.createElement('span');
    palLabel.style.cssText = 'font-size:13px;color:var(--dsw-alias-label-primary,#111);padding-top:4px';
    palLabel.textContent = '主题色';
    var palRight = document.createElement('div');
    palRight.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:6px';
    var palGroup = document.createElement('div');
    palGroup.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end';

    var customRow = document.createElement('div');
    customRow.style.cssText = 'display:' + (prefs.palette === 'custom' ? 'flex' : 'none') + ';gap:10px;align-items:center';

    function mkColor(label, value) {
      var wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary,#666)';
      wrap.textContent = label;
      var input = document.createElement('input');
      input.type = 'color'; input.value = value;
      input.style.cssText = 'width:26px;height:22px;border:none;padding:0;background:none;cursor:pointer';
      wrap.appendChild(input);
      return { wrap: wrap, input: input };
    }
    var brandPicker = mkColor('主题', prefs.custom.brand);
    var bgPicker = mkColor('背景', prefs.custom.bg);
    customRow.appendChild(brandPicker.wrap);
    customRow.appendChild(bgPicker.wrap);
    palRight.appendChild(palGroup);
    palRight.appendChild(customRow);

    PALETTES.forEach(function (p) {
      var b = mkBtn(p.label, prefs.palette === p.id);
      b.addEventListener('click', function () {
        prefs.palette = p.id; savePrefs(prefs);
        palGroup.querySelectorAll('button').forEach(function (x) { x.style.background = 'transparent'; x.style.color = 'var(--dsw-alias-label-secondary,#666)'; });
        b.style.background = 'var(--dsw-alias-brand-primary,#2563eb)'; b.style.color = '#fff';
        customRow.style.display = 'none';
        applyPalette(p.tokens);
      });
      palGroup.appendChild(b);
    });

    var customBtn = mkBtn('自定义', prefs.palette === 'custom');
    customBtn.addEventListener('click', function () {
      prefs.palette = 'custom'; savePrefs(prefs);
      palGroup.querySelectorAll('button').forEach(function (x) { x.style.background = 'transparent'; x.style.color = 'var(--dsw-alias-label-secondary,#666)'; });
      customBtn.style.background = 'var(--dsw-alias-brand-primary,#2563eb)'; customBtn.style.color = '#fff';
      customRow.style.display = 'flex';
      applyPalette(customTokens(prefs.custom.brand, prefs.custom.bg));
    });
    palGroup.appendChild(customBtn);

    brandPicker.input.addEventListener('input', function () {
      prefs.custom.brand = brandPicker.input.value; savePrefs(prefs);
      if (prefs.palette === 'custom') applyPalette(customTokens(prefs.custom.brand, prefs.custom.bg));
    });
    bgPicker.input.addEventListener('input', function () {
      prefs.custom.bg = bgPicker.input.value; savePrefs(prefs);
      if (prefs.palette === 'custom') applyPalette(customTokens(prefs.custom.brand, prefs.custom.bg));
    });

    palRow.appendChild(palLabel); palRow.appendChild(palRight);
    panel.appendChild(palRow);

    var note = document.createElement('div');
    note.textContent = '设置保存在本地；自定义色：主题色 + 主区背景色。';
    note.style.cssText = 'margin-top:8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#999);line-height:1.6';
    panel.appendChild(note);

    fab.addEventListener('click', function () { fab.style.display = 'none'; panel.style.display = 'block'; });
    document.body.appendChild(fab);
    document.body.appendChild(panel);

    var cur = null;
    for (var i = 0; i < FONT_PRESETS.length; i++) if (FONT_PRESETS[i].id === prefs.font) cur = FONT_PRESETS[i];
    if (cur && cur.scale !== 1.0) applyFont(cur.scale);
    if (prefs.palette === 'custom') applyPalette(customTokens(prefs.custom.brand, prefs.custom.bg));
    else {
      for (var j = 0; j < PALETTES.length; j++) if (PALETTES[j].id === prefs.palette) applyPalette(PALETTES[j].tokens);
    }
  }

  mount();
})();
