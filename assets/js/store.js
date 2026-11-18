/* =========================================================================
   store —— 本地设置 / 信任设备 / 聊天记录（全部 localStorage）
   ========================================================================= */
(function (LTA) {
  'use strict';

  var KEY = {
    settings: 'lta.settings',
    contacts: 'lta.contacts',
    theme: 'lta.theme',
    chatPrefix: 'lta.chat.',
    scanHistory: 'lta.found'
  };

  var DEFAULT_SIGNAL = { host: '0.peerjs.com', port: 443, path: '/', key: 'peerjs', secure: true };

  function defaults() {
    return {
      lang: 'auto',
      theme: null,                       // null = 跟随系统
      deviceCode: randomCode(),
      deviceName: '',
      hidden: false,
      autoAcceptConnect: false,
      autoAcceptFile: false,
      signal: Object.assign({}, DEFAULT_SIGNAL)
    };
  }

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try {
      var v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }

  function read(key, fallback) {
    try { return safeParse(localStorage.getItem(key), fallback); }
    catch (e) { return fallback; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  var settings = read(KEY.settings, null);
  settings = Object.assign(defaults(), settings || {});
  settings.signal = Object.assign({}, DEFAULT_SIGNAL, settings.signal || {});
  if (!/^\d{4}$/.test(String(settings.deviceCode))) settings.deviceCode = randomCode();

  var listeners = [];

  function save() {
    write(KEY.settings, settings);
    listeners.forEach(function (fn) { try { fn(settings); } catch (e) {} });
  }

  function patch(part) {
    settings = Object.assign(settings, part || {});
    if (part && part.signal) settings.signal = Object.assign({}, DEFAULT_SIGNAL, part.signal);
    save();
    return settings;
  }

  function reset() {
    var code = settings.deviceCode;   // 设备码不重置，避免自己突然消失
    settings = defaults();
    settings.deviceCode = code;
    save();
    return settings;
  }

  /* ---------- 工具 ---------- */
  function randomCode() {
    return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 ' + LTA.i18n.t('unit.b');
    if (!bytes || bytes < 0) return '—';
    var units = ['unit.b', 'unit.kb', 'unit.mb', 'unit.gb'];
    var i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    var v = bytes / Math.pow(1024, i);
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + LTA.i18n.t(units[i]);
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + LTA.i18n.t('unit.sec');
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + LTA.i18n.t('unit.min') + (s ? ' ' + s + LTA.i18n.t('unit.sec') : '');
    var h = Math.floor(m / 60);
    return h + LTA.i18n.t('unit.hour') + ' ' + (m % 60) + LTA.i18n.t('unit.min');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function deviceLabel() {
    return settings.deviceName && settings.deviceName.trim()
      ? settings.deviceName.trim()
      : LTA.i18n.t('device.defaultName');
  }

  /* ---------- 信任设备 ---------- */
  function contacts() {
    var list = read(KEY.contacts, []);
    return Array.isArray(list) ? list : [];
  }

  function saveContacts(list) { write(KEY.contacts, list); }

  function isTrusted(code) {
    return contacts().some(function (c) { return c.code === String(code); });
  }

  function addContact(code, name) {
    code = String(code);
    if (!/^\d{4}$/.test(code)) return contacts();
    var list = contacts();
    if (!list.some(function (c) { return c.code === code; })) {
      list.push({ code: code, name: name || '', addedAt: Date.now() });
      saveContacts(list);
    }
    return list;
  }

  function removeContact(code) {
    var list = contacts().filter(function (c) { return c.code !== String(code); });
    saveContacts(list);
    return list;
  }

  /* ---------- 聊天记录 ---------- */
  function chatKey(id) { return KEY.chatPrefix + id; }

  function getMessages(id) {
    var list = read(chatKey(id), []);
    return Array.isArray(list) ? list : [];
  }

  function appendMessage(id, msg) {
    var list = getMessages(id);
    if (msg.id && list.some(function (m) { return m.id === msg.id; })) return list;
    list.push(msg);
    if (list.length > 400) list = list.slice(list.length - 400);
    write(chatKey(id), list);
    return list;
  }

  function chatIds() {
    var ids = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(KEY.chatPrefix) === 0) ids.push(k.slice(KEY.chatPrefix.length));
      }
    } catch (e) {}
    return ids;
  }

  function clearMessages(id) {
    if (id) { try { localStorage.removeItem(chatKey(id)); } catch (e) {} return; }
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(KEY.chatPrefix) === 0) keys.push(k);
    }
    keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
  }

  LTA.store = {
    KEY: KEY,
    get raw() { return settings; },
    patch: patch,
    reset: reset,
    save: save,
    on: function (fn) { listeners.push(fn); },
    randomCode: randomCode,
    deviceLabel: deviceLabel,
    formatBytes: formatBytes,
    formatDuration: formatDuration,
    escapeHtml: escapeHtml,
    contacts: contacts,
    isTrusted: isTrusted,
    addContact: addContact,
    removeContact: removeContact,
    getMessages: getMessages,
    chatIds: chatIds,
    appendMessage: appendMessage,
    clearMessages: clearMessages,
    DEFAULT_SIGNAL: DEFAULT_SIGNAL
  };

  /* 主题：单独存一个键，方便 inline script 在首帧前读取 */
  LTA.theme = {
    get: function () {
      try {
        var v = localStorage.getItem(KEY.theme);
        return (v === 'light' || v === 'dark') ? v : null;
      } catch (e) { return null; }
    },
    set: function (value) {
      var meta = document.querySelector('meta[name="color-scheme"]');
      if (value === 'light' || value === 'dark') {
        try { localStorage.setItem(KEY.theme, value); } catch (e) {}
        meta.content = value;
      } else {
        try { localStorage.removeItem(KEY.theme); } catch (e) {}
        meta.content = 'light dark';
      }
      settings.theme = (value === 'light' || value === 'dark') ? value : null;
      save();
    },
    /* 当前实际渲染出的外观 */
    resolved: function () {
      var stored = LTA.theme.get();
      if (stored) return stored;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
    system: function () {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  };
})(window.LTA = window.LTA || {});
