/* =========================================================================
   main —— 启动与各模块接线
   ========================================================================= */
(function (LTA) {
  'use strict';

  function boot() {
    var raw = LTA.store.raw;

    /* 语言：先定语言，再让所有渲染使用它 */
    LTA.i18n.set(raw.lang || 'auto');
    LTA.settings.bind();
    LTA.ui.bind();
    LTA.ui.bindDialogs();

    /* 静态文案随语言刷新 */
    LTA.i18n.onChange(function () {
      LTA.i18n.apply();
      LTA.settings.reflect();
      LTA.ui.renderAll();
    });

    /* 连接层 */
    LTA.net.on('status', function (status) {
      LTA.ui.renderStatus(status);
      if (status === 'online') {
        LTA.chat.restoreGroups();
        syncRegistry();
      }
      if (status === 'signal-error') {
        LTA.ui.toast(LTA.i18n.t('err.signal'), 'error');
        if (!navigator.onLine) LTA.ui.toast(LTA.i18n.t('toast.offline'), 'warn');
      }
      if (status === 'id-taken') {
        LTA.ui.toast(LTA.i18n.t('toast.idTaken', { code: LTA.store.raw.deviceCode }), 'error');
      }
    });

    LTA.net.on('link', function (link, how) {
      LTA.ui.renderAll();
      if (how === 'connected') {
        LTA.ui.toast((link.name || ('#' + link.code)) + ' · ' + LTA.i18n.t('connect.connected'), 'ok');
      }
    });

    LTA.net.on('closed', function (link) {
      LTA.ui.renderAll();
      LTA.ui.toast(LTA.i18n.t('toast.disconnected', { name: link.name || ('#' + link.code) }), 'warn');
    });

    LTA.net.on('discovered', function (item) {
      LTA.ui.upsertFound({
        code: item.code,
        peerId: item.peerId,
        name: item.name,
        hidden: item.hidden
      });
    });

    /* 传输 / 聊天 / 日志 变化 */
    LTA.transfer.onChange(function () { LTA.ui.renderTransfers(); });
    LTA.chat.onChange(function () { LTA.ui.renderChat(); });
    LTA.log.onChange(function () {
      var panel = document.getElementById('panel-log');
      if (panel && !panel.hidden) LTA.ui.renderLog();
    });

    /* internal 信令（第二套固定信令 + 在线名册） */
    var regCode = null, regHidden = null;
    function syncRegistry() {
      var r = LTA.store.raw;
      var same = (regCode === r.deviceCode) && (regHidden === !!r.hidden);
      if (same && LTA.registry.status !== 'error' && LTA.registry.status !== 'idle') return;
      regCode = r.deviceCode;
      regHidden = !!r.hidden;
      LTA.registry.start(r.deviceCode, LTA.store.deviceLabel(), !!r.hidden);
    }
    LTA.registry.setIncoming(function () {});
    LTA.registry.onRoster(function (items) {
      items.forEach(function (it) {
        if (it.code === LTA.store.raw.deviceCode) return;
        LTA.ui.upsertFound({ code: it.code, peerId: it.id, name: it.name, hidden: !!it.hidden });
      });
    });

    /* 建立连接 */
    LTA.net.init();
    syncRegistry();
    applyDeepLink();
    LTA.chat.startWatchdog();

    /* PWA */
    /* 扫码 / 分享链接带来的 ?code= / ?group= */
    function applyDeepLink() {
      var q;
      try { q = new URLSearchParams(location.search); } catch (e) { return; }
      var code = (q.get('code') || '').trim();
      var group = (q.get('group') || '').trim();
      var tries = 0;

      function go() {
        tries++;
        if (LTA.net.status !== 'online') {
          if (tries < 40) setTimeout(go, 500);
          return;
        }
        if (/^\d{4}$/.test(code)) {
          var input = document.getElementById('in-code');
          if (input) input.value = code;
          LTA.ui.doConnect(code).catch(function () {});
        } else if (/^\d{4}$/.test(group)) {
          LTA.chat.open('g:' + group);
        }
      }
      if (code || group) setTimeout(go, 400);
    }

    LTA.pwa.bindInstall();
    LTA.pwa.register();
    LTA.pwa.onUpdateAvailable(function (reg) {
      var el = LTA.ui.toast(LTA.i18n.t('toast.updateReady'), 'warn');
      if (el) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', function () { LTA.pwa.applyUpdate(reg); });
      }
    });

    /* 网络状态 */
    window.addEventListener('offline', function () {
      LTA.ui.toast(LTA.i18n.t('toast.offline'), 'warn');
      LTA.log.warn('系统网络已断开');
    });
    window.addEventListener('online', function () {
      LTA.log.ok('网络已恢复，正在重建连接');
      LTA.net.init();
    });

    /* 传输中离开页面的提醒 */
    window.addEventListener('beforeunload', function (ev) {
      if (LTA.transfer.hasActive()) {
        ev.preventDefault();
        ev.returnValue = LTA.i18n.t('transfer.keepOpen');
        return ev.returnValue;
      }
      return undefined;
    });

    /* 从二维码/链接带过来的设备码或群号 */
    var params = new URLSearchParams(location.search);
    var code = params.get('code');
    var group = params.get('group');
    if (code && /^\d{4}$/.test(code)) {
      var input = document.getElementById('in-code');
      if (input) input.value = code;
      document.getElementById('btn-settings').blur();
    }
    if (group && /^\d{4}$/.test(group)) {
      LTA.chat.joinGroup(group, '').then(function () {
        LTA.ui.switchPanel('chat');
        LTA.chat.open('g:' + group);
        LTA.ui.renderAll();
      }).catch(function () {});
    }

    /* 首屏渲染 */
    LTA.ui.renderAll();
    LTA.log.ok('了了了传输助手已启动 · 设备码 #' + raw.deviceCode);

    /* 扫描结果里如果目标本来就在，先把名字填上 */
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        document.querySelectorAll('dialog[open]').forEach(function (d) { d.close(); });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.LTA = window.LTA || {});
