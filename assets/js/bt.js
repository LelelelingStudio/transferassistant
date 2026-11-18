/* =========================================================================
   bt —— 蓝牙 / 系统分享通道
   说明：浏览器不能把自己变成蓝牙外设，所以两个网页之间无法直连 BLE。
   真正能落地的两条路：
     1) 系统分享面板（AirDrop / 蓝牙 / 附近分享，手机与电脑原生可用）
     2) Web Bluetooth 连接外部 BLE 设备（需对端是硬件，不是网页）
   ========================================================================= */
(function (LTA) {
  'use strict';

  function canShareFiles() {
    return !!(navigator.canShare && navigator.share);
  }

  function shareFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) {
      LTA.log.warn(LTA.i18n.t('bt.pickFirst'));
      return Promise.reject(new Error('empty'));
    }
    if (!canShareFiles()) {
      LTA.log.warn(LTA.i18n.t('bt.unsupported'));
      return Promise.reject(new Error('unsupported'));
    }
    var payload = { files: list };
    if (navigator.canShare(payload)) {
      LTA.log.info('调起系统分享，共 ' + list.length + ' 个文件');
      return navigator.share(payload).then(function () {
        LTA.log.ok('系统分享已完成');
      }).catch(function (err) {
        // 用户主动取消不算错误
        if (err && err.name === 'AbortError') return;
        LTA.log.warn('系统分享失败：' + (err && err.message));
        throw err;
      });
    }
    LTA.log.warn(LTA.i18n.t('bt.unsupported'));
    return Promise.reject(new Error('unsupported'));
  }

  /**
   * Web Bluetooth：连接外部 BLE 设备并枚举服务/特征。
   * 这一步主要是给“有 BLE 硬件桥”的场景用，普通网页之间用不上。
   */
  function connectGatt() {
    if (!navigator.bluetooth) {
      LTA.log.warn('当前浏览器不支持 Web Bluetooth（部分浏览器与 iOS 均不支持）');
      return Promise.reject(new Error('unsupported'));
    }
    LTA.log.info('请求蓝牙设备…');
    return navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [0x1800, 0x1801, 0x180f, 0xffe0, 0xfff0]
    }).then(function (device) {
      LTA.log.ok('已选择蓝牙设备：' + (device.name || device.id));
      return device.gatt.connect().then(function (server) {
        return server.getPrimaryServices().then(function (services) {
          var info = [];
          services.forEach(function (s) { info.push(s.uuid); });
          LTA.log.ok('已连接，服务数 ' + services.length + '：' + info.join(' / '));
          return services;
        });
      });
    }).catch(function (err) {
      LTA.log.warn('蓝牙连接未完成：' + (err && (err.name || err.message)));
      throw err;
    });
  }

  LTA.bt = {
    canShareFiles: canShareFiles,
    shareFiles: shareFiles,
    connectGatt: connectGatt
  };
})(window.LTA = window.LTA || {});
