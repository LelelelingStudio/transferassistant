/* =========================================================================
   settings —— 设置面板、外观、语言、信任设备、本地数据
   ========================================================================= */
(function (LTA) {
  'use strict';

  var dlg = null;
  var $ = function (id) { return document.getElementById(id); };

  function reflectTheme() {
    var stored = LTA.theme.get();
    document.querySelectorAll('[data-theme-set]').forEach(function (btn) {
      var v = btn.getAttribute('data-theme-set');
      var active = (v === 'system' && !stored) || (stored && v === stored);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function reflectLang() {
    var setting = LTA.store.raw.lang || 'auto';
    document.querySelectorAll('[data-lang-set]').forEach(function (btn) {
      btn.setAttribute('aria-checked', btn.getAttribute('data-lang-set') === setting ? 'true' : 'false');
    });
  }

  function reflectSwitches() {
    var raw = LTA.store.raw;
    var swC = $('sw-auto-connect');
    var swF = $('sw-auto-file');
    if (swC) swC.setAttribute('aria-checked', raw.autoAcceptConnect ? 'true' : 'false');
    if (swF) swF.setAttribute('aria-checked', raw.autoAcceptFile ? 'true' : 'false');
    var swH = $('sw-hidden');
    if (swH) swH.setAttribute('aria-checked', raw.hidden ? 'true' : 'false');
  }

  function reflectSignal() {
    var sig = LTA.store.raw.signal || {};
    $('in-sig-host').value = sig.host || '';
    $('in-sig-port').value = sig.port || '';
    $('in-sig-path').value = sig.path || '/';
    $('in-sig-key').value = sig.key || '';
  }

  function renderContacts() {
    var listEl = $('contact-list');
    var emptyEl = $('contact-empty');
    if (!listEl) return;
    var list = LTA.store.contacts();
    listEl.innerHTML = '';
    list.forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'contact-item';
      li.innerHTML =
        '<div class="item-main">' +
        '<div class="item-title">' + LTA.store.escapeHtml(c.name || LTA.i18n.t('common.unknown')) + '</div>' +
        '<div class="item-sub">#' + c.code + '</div>' +
        '</div>';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm btn-danger';
      btn.textContent = LTA.i18n.t('settings.remove');
      btn.addEventListener('click', function () {
        LTA.store.removeContact(c.code);
        renderContacts();
        LTA.log.info('已移除信任设备 #' + c.code);
        if (LTA.ui) LTA.ui.renderAll();
      });
      li.appendChild(btn);
      listEl.appendChild(li);
    });
    if (emptyEl) emptyEl.hidden = list.length > 0;
  }

  function open() {
    reflectTheme();
    reflectLang();
    reflectSwitches();
    reflectSignal();
    renderContacts();
    dlg.showModal();
  }

  function toggleTheme() {
    var rendered = LTA.theme.resolved();
    var target = rendered === 'dark' ? 'light' : 'dark';
    // 目标等于系统偏好时视为“撤销手动设置”，交还给系统
    if (target === LTA.theme.system()) LTA.theme.set(null);
    else LTA.theme.set(target);
    LTA.store.patch({ theme: LTA.theme.get() });
    reflectTheme();
  }

  function toggleLang() {
    var cur = LTA.i18n.lang;
    var next = cur === 'zh' ? 'en' : 'zh';
    LTA.store.patch({ lang: next });
    LTA.i18n.set(next);
    reflectLang();
    if (LTA.ui) LTA.ui.renderAll();
  }

  function bind() {
    dlg = $('dlg-settings');

    var btnSettings = $('btn-settings');
    if (btnSettings) btnSettings.addEventListener('click', open);

    var btnTheme = $('btn-theme');
    if (btnTheme) btnTheme.addEventListener('click', toggleTheme);

    var btnLang = $('btn-lang');
    if (btnLang) btnLang.addEventListener('click', toggleLang);

    document.querySelectorAll('[data-theme-set]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.getAttribute('data-theme-set');
        if (v === 'system') LTA.theme.set(null);
        else LTA.theme.set(v);
        LTA.store.patch({ theme: LTA.theme.get() });
        reflectTheme();
      });
    });

    document.querySelectorAll('[data-lang-set]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.getAttribute('data-lang-set');
        LTA.store.patch({ lang: v });
        LTA.i18n.set(v);
        reflectLang();
        if (LTA.ui) LTA.ui.renderAll();
      });
    });

    var swC = $('sw-auto-connect');
    if (swC) swC.addEventListener('click', function () {
      var next = !LTA.store.raw.autoAcceptConnect;
      LTA.store.patch({ autoAcceptConnect: next });
      reflectSwitches();
    });

    var swF = $('sw-auto-file');
    if (swF) swF.addEventListener('click', function () {
      var next = !LTA.store.raw.autoAcceptFile;
      LTA.store.patch({ autoAcceptFile: next });
      reflectSwitches();
    });

    ['in-sig-host', 'in-sig-port', 'in-sig-path', 'in-sig-key'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('change', function () {
        var sig = {
          host: $('in-sig-host').value.trim() || LTA.store.DEFAULT_SIGNAL.host,
          port: parseInt($('in-sig-port').value, 10) || LTA.store.DEFAULT_SIGNAL.port,
          path: $('in-sig-path').value.trim() || '/',
          key: $('in-sig-key').value.trim() || 'peerjs',
          secure: !(parseInt($('in-sig-port').value, 10) === 80)
        };
        LTA.store.patch({ signal: sig });
        LTA.log.info('信令服务已更新，重新建立连接');
        LTA.net.refreshMeta();
        LTA.net.init();
        if (LTA.ui) LTA.ui.toast(LTA.i18n.t('settings.saved'), 'ok');
      });
    });

    var btnClearChat = $('btn-clear-chat');
    if (btnClearChat) btnClearChat.addEventListener('click', function () {
      LTA.store.clearMessages();
      LTA.log.info('聊天记录已清空');
      if (LTA.ui) { LTA.ui.toast(LTA.i18n.t('settings.clearChatDone'), 'ok'); LTA.ui.renderAll(); }
    });

    var btnReset = $('btn-reset');
    if (btnReset) btnReset.addEventListener('click', function () {
      var code = LTA.store.raw.deviceCode;
      LTA.store.reset();
      LTA.store.patch({ deviceCode: code });
      LTA.theme.set(null);
      LTA.i18n.set('auto');
      reflectTheme();
      reflectLang();
      reflectSwitches();
      reflectSignal();
      LTA.net.refreshMeta();
      LTA.net.init();
      if (LTA.ui) { LTA.ui.toast(LTA.i18n.t('settings.resetDone'), 'ok'); LTA.ui.renderAll(); }
    });
  }

  LTA.settings = {
    bind: bind,
    open: open,
    reflect: function () { reflectTheme(); reflectLang(); reflectSwitches(); },
    renderContacts: renderContacts,
    toggleTheme: toggleTheme,
    toggleLang: toggleLang
  };
})(window.LTA = window.LTA || {});
