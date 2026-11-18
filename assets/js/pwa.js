/* =========================================================================
   pwa —— 离线缓存注册 + 安装/更新提示
   ========================================================================= */
(function (LTA) {
  'use strict';

  var deferredPrompt = null;
  var updateReady = false;
  var onInstallAvailable = null;
  var onUpdateAvailable = null;

  function register() {
    if (!('serviceWorker' in navigator)) {
      LTA.log.info('这个浏览器不支持离线缓存（Service Worker）');
      return;
    }
    if (!window.isSecureContext) {
      LTA.log.warn('离线缓存需要 https 或 localhost，当前页面环境不满足');
      return;
    }

    navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      LTA.log.ok('离线缓存已注册');
      if (reg.waiting) markUpdate(reg);
      reg.addEventListener('updatefound', function () {
        var worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) markUpdate(reg);
        });
      });
      // 首屏之后主动检查一次更新
      setTimeout(function () { try { reg.update(); } catch (e) {} }, 8000);
    }).catch(function (err) {
      LTA.log.warn('离线缓存注册失败：' + (err && err.message));
    });

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (updateReady) window.location.reload();
    });

    navigator.serviceWorker.addEventListener('message', function (ev) {
      if (ev.data && ev.data.type === 'offline-ready') {
        if (LTA.ui && LTA.ui.toast) LTA.ui.toast(LTA.i18n.t('toast.offlineReady'), 'ok');
      }
    });
  }

  function markUpdate(reg) {
    if (updateReady) return;
    updateReady = true;
    LTA.log.warn('发现新版本');
    if (onUpdateAvailable) onUpdateAvailable(reg);
  }

  function applyUpdate(reg) {
    if (!reg || !reg.waiting) {
      // 没有待激活的版本就直接重载
      window.location.reload();
      return;
    }
    reg.waiting.postMessage({ type: 'skip-waiting' });
  }

  function bindInstall() {
    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      deferredPrompt = ev;
      if (onInstallAvailable) onInstallAvailable();
    });
    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      LTA.log.ok(LTA.i18n.t('toast.installed'));
      if (LTA.ui && LTA.ui.toast) LTA.ui.toast(LTA.i18n.t('toast.installed'), 'ok');
    });
  }

  function promptInstall() {
    if (!deferredPrompt) return Promise.resolve(false);
    deferredPrompt.prompt();
    return deferredPrompt.userChoice.then(function (choice) {
      deferredPrompt = null;
      return choice && choice.outcome === 'accepted';
    });
  }

  LTA.pwa = {
    register: register,
    bindInstall: bindInstall,
    promptInstall: promptInstall,
    applyUpdate: applyUpdate,
    get installable() { return !!deferredPrompt; },
    onInstallAvailable: function (fn) { onInstallAvailable = fn; },
    onUpdateAvailable: function (fn) { onUpdateAvailable = fn; }
  };
})(window.LTA = window.LTA || {});
