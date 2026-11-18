/* =========================================================================
   log —— 友好日志：对外只显示人话，底层细节折叠进 detail
   ========================================================================= */
(function (LTA) {
  'use strict';

  var MAX = 300;
  var entries = [];
  var listeners = [];

  function stamp() {
    var d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) {
      return String(n).padStart(2, '0');
    }).join(':');
  }

  function add(level, text, detail) {
    entries.push({ time: stamp(), level: level, text: text, detail: detail || '' });
    if (entries.length > MAX) entries = entries.slice(entries.length - MAX);
    listeners.forEach(function (fn) { try { fn(entries); } catch (e) {} });
  }

  /**
   * 把底层错误翻译成人话。只保留一条可读描述，原始 error 放 detail。
   */
  function humanize(err, fallbackKey) {
    if (!err) return LTA.i18n.t(fallbackKey || 'err.generic');
    var msg = String(err.message || err.type || err);
    var map = [
      [/unavailable-id|ID is taken/i, 'err.browserIdTaken'],
      [/could not connect to server|network|ECONN|socket|websocket/i, 'err.signal'],
      [/peer-unavailable|Could not connect to peer/i, 'err.peerUnavailable'],
      [/isSecureContext|insecure|https/i, 'err.notSecure'],
      [/RTCPeerConnection|not supported|undefined is not/i, 'err.browserIncompatible']
    ];
    for (var i = 0; i < map.length; i++) {
      if (map[i][0].test(msg)) return LTA.i18n.t(map[i][1]);
    }
    return LTA.i18n.t(fallbackKey || 'err.generic');
  }

  LTA.log = {
    add: add,
    ok: function (t, d) { add('ok', t, d); },
    info: function (t, d) { add('info', t, d); },
    warn: function (t, d) { add('warn', t, d); },
    error: function (t, d) { add('error', t, d); },
    humanize: humanize,
    entries: function () { return entries.slice(); },
    clear: function () { entries = []; listeners.forEach(function (fn) { try { fn(entries); } catch (e) {} }); },
    onChange: function (fn) { listeners.push(fn); }
  };
})(window.LTA = window.LTA || {});
