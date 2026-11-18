/* =========================================================================
   net —— 点对点连接层
   · 设备码即寻址：正常 lt-1234；不可查找 lt-441234（对外仍显示 1234）
   · 任意设备既是服务端也是客户端，没有中心节点
   · 信令只负责握手，实际文件/消息走 WebRTC DataChannel
   ========================================================================= */
(function (LTA) {
  'use strict';

  var PREFIX = 'lt-';        // 命名空间，避免与公共信令上别人的 id 冲突
  var HIDDEN_MARK = '44';    // 隐藏模式真实地址 = 44 + 四位码

  var peer = null;
  var status = 'idle';       // idle | connecting | online | error
  var links = new Map();     // peerId -> Link
  var known = new Map();     // peerId -> meta（附近设备池，最多 40 个）
  var handlers = {};         // type -> fn(link, msg)
  var listeners = { status: [], link: [], closed: [], discovered: [] };
  var pendingProbes = new Map(); // peerId -> resolver
  var askHandlers = { connect: null, file: null };
  var selfMeta = { code: '', name: '', hidden: false };

  var MAX_KNOWN = 40;

  /* ---------------- 工具 ---------------- */
  function peerIdForCode(code, hidden) {
    code = String(code).replace(/\D/g, '').slice(-6);
    return PREFIX + (hidden ? HIDDEN_MARK : '') + code;
  }

  function codeFromPeerId(pid) {
    if (!pid || pid.indexOf(PREFIX) !== 0) return null;
    var rest = pid.slice(PREFIX.length);
    if (rest.indexOf(HIDDEN_MARK) === 0 && rest.length > 4) {
      return { code: rest.slice(2), hidden: true };
    }
    if (/^\d{4}$/.test(rest.slice(0, 4))) {
      return { code: rest.slice(0, 4), hidden: false };
    }
    return { code: rest, hidden: false };
  }

  function emit(kind, a, b) {
    (listeners[kind] || []).forEach(function (fn) {
      try { fn(a, b); } catch (e) { console.warn('[lta] listener error', e); }
    });
  }

  function setStatus(s) {
    status = s;
    emit('status', s);
  }

  /* ---------------- Link：DataConnection 的包装 ---------------- */
  function Link(conn, role, codeOverride) {
    this.conn = conn;
    this.peerId = conn.peer;
    this.role = role;            // 'out' | 'in'
    this.state = 'new';          // new | discovered | pending | connected
    var parsed = codeFromPeerId(conn.peer) || { code: '', hidden: false };
    this.code = codeOverride || parsed.code;
    this.hidden = parsed.hidden;
    this.name = '';
    this.isTrusted = false;
    this.createdAt = Date.now();
    this._listeners = {};
    this._bind();
  }

  Link.prototype.on = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
    return this;
  };

  Link.prototype._fire = function (type, data) {
    var fns = this._listeners[type] || [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](data); } catch (e) { console.warn('[lta] link listener', e); }
    }
  };

  Link.prototype._bind = function () {
    var self = this;
    var conn = this.conn;

    conn.on('data', function (raw) {
      var msg = raw;
      if (typeof raw === 'string') {
        try { msg = JSON.parse(raw); } catch (e) { return; }
      }
      if (!msg || !msg.t) return;
      self._handle(msg);
    });

    conn.on('close', function () {
      links.delete(self.peerId);
      self._fire('close');
      emit('closed', self);
      LTA.log.info('连接断开：' + (self.name || self.code || self.peerId));
    });

    conn.on('error', function (err) {
      LTA.log.warn('连接出错：' + (self.name || self.peerId), err && err.message);
    });
  };

  Link.prototype._handle = function (msg) {
    var self = this;
    switch (msg.t) {
      case 'ping':
        self.name = msg.name || self.name;
        self.code = msg.code || self.code;
        self.hidden = !!msg.hidden;
        safeSend(self, { t: 'pong', name: selfMeta.name, code: selfMeta.code, hidden: selfMeta.hidden });
        if (self.state === 'new') self.state = 'discovered';
        rememberDiscovery(self);
        break;

      case 'pong':
        self.name = msg.name || self.name;
        self.code = msg.code || self.code;
        self.hidden = !!msg.hidden;
        if (self.state === 'new') self.state = 'discovered';
        self._fire('pong', self);
        rememberDiscovery(self);
        break;

      case 'hello':
        // 对方主动要求建立正式连接
        self.name = msg.name || self.name;
        self.code = msg.code || self.code;
        self.isTrusted = !!msg.trusted || LTA.store.isTrusted(self.code);
        if (self.isTrusted || LTA.store.raw.autoAcceptConnect || !askHandlers.connect) {
          accept(self);
        } else {
          self.state = 'pending';
          self._fire('pending', self);
          askHandlers.connect(self).then(function (ok) {
            if (ok) accept(self); else reject(self);
          });
        }
        break;

      case 'accept':
        self.state = 'connected';
        self.name = msg.name || self.name;
        links.set(self.peerId, self);
        self._fire('connected', self);
        emit('link', self, 'connected');
        LTA.log.ok('已连接：' + (self.name || self.code));
        break;

      case 'reject':
        self.state = 'rejected';
        self._fire('rejected');
        try { self.conn.close(); } catch (e) {}
        break;

      case 'bye':
        try { self.conn.close(); } catch (e) {}
        break;

      default:
        var fn = handlers[msg.t];
        if (fn) {
          try { fn(self, msg); } catch (e) { console.warn('[lta] handler error', msg.t, e); }
        }
    }
  };

  Link.prototype.send = function (obj) {
    return safeSend(this, obj);
  };

  Link.prototype.close = function () {
    try { this.conn.close(); } catch (e) {}
    links.delete(this.peerId);
  };

  Link.prototype.isOpen = function () {
    try { return !!(this.conn && this.conn.open); } catch (e) { return false; }
  };

  Link.prototype.buffered = function () {
    try {
      var dc = this.conn.dataChannel;
      return dc ? dc.bufferedAmount : 0;
    } catch (e) { return 0; }
  };

  function safeSend(link, obj) {
    try {
      if (!link.conn || !link.conn.open) return false;
      link.conn.send(obj);
      return true;
    } catch (e) {
      console.warn('[lta] send failed', e);
      return false;
    }
  }

  /* ---------------- 握手动作 ---------------- */
  function accept(link) {
    link.state = 'connected';
    link.isTrusted = LTA.store.isTrusted(link.code);
    links.set(link.peerId, link);
    safeSend(link, { t: 'accept', name: selfMeta.name, code: selfMeta.code, hidden: selfMeta.hidden });
    link._fire('connected', link);
    emit('link', link, 'connected');
    LTA.log.ok('接受连接：' + (link.name || link.code));
  }

  function reject(link) {
    link.state = 'rejected';
    safeSend(link, { t: 'reject' });
    setTimeout(function () { try { link.conn.close(); } catch (e) {} }, 60);
    LTA.log.info('拒绝连接：' + (link.name || link.code));
  }

  function greet(link) {
    // 新连接先互相 ping，拿到对方名字与设备码，不触发任何弹窗
    safeSend(link, { t: 'ping', name: selfMeta.name, code: selfMeta.code, hidden: selfMeta.hidden });
  }

  function rememberDiscovery(link) {
    if (!link.code) return;
    var key = link.peerId;
    if (known.size >= MAX_KNOWN && !known.has(key)) {
      var oldest = null;
      known.forEach(function (v, k) { if (!oldest) oldest = k; });
      if (oldest) known.delete(oldest);
    }
    known.set(key, {
      peerId: key,
      code: link.code,
      hidden: link.hidden,
      name: link.name,
      trusted: LTA.store.isTrusted(link.code),
      seenAt: Date.now()
    });
    emit('discovered', known.get(key));
  }

  /* ---------------- Peer 生命周期 ---------------- */
  var retryTimer = null;
  var claimTries = 0;

  function buildPeerConfig() {
    var sig = LTA.store.raw.signal || LTA.store.DEFAULT_SIGNAL;
    return {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      },
      host: sig.host || undefined,
      port: sig.port || undefined,
      path: sig.path || '/',
      key: sig.key || 'peerjs',
      secure: sig.secure !== false
    };
  }

  function init() {
    destroy(true);
    var cfgRaw = LTA.store.raw;
    selfMeta.code = cfgRaw.deviceCode;
    selfMeta.hidden = !!cfgRaw.hidden;
    selfMeta.name = LTA.store.deviceLabel();

    if (typeof Peer === 'undefined') {
      setStatus('error');
      LTA.log.error(LTA.i18n.t('err.browserIncompatible'));
      return;
    }
    if (!window.isSecureContext) {
      LTA.log.warn(LTA.i18n.t('err.notSecure'));
    }

    var myId = peerIdForCode(selfMeta.code, selfMeta.hidden);
    setStatus('connecting');
    LTA.log.info('开始建立连接，本机地址 ' + myId + '（' + (selfMeta.hidden ? '不可查找' : '可查找') + '）');

    var opts = buildPeerConfig();
    try {
      peer = new Peer(myId, opts);
    } catch (e) {
      setStatus('error');
      LTA.log.error(LTA.i18n.t('err.browserIncompatible'), e && e.message);
      return;
    }

    peer.on('open', function (id) {
      setStatus('online');
      LTA.log.ok('已上线：' + id);
      emit('status', 'online');
    });

    peer.on('connection', function (conn) {
      var link = new Link(conn, 'in');
      conn.on('open', function () {
        greet(link);
        emit('link', link, 'incoming');
      });
    });

    peer.on('disconnected', function () {
      LTA.log.warn('与信令服务断开，正在重连…');
      if (peer && !peer.destroyed) {
        try { peer.reconnect(); } catch (e) {}
      }
    });

    peer.on('error', function (err) {
      var type = err && err.type;
      if (type === 'peer-unavailable') {
        // 扫描/连接目标不存在：交给探测逻辑收尾，不打扰用户
        var m = String(err.message || '');
        var pid = m.split(' ').pop();
        if (pendingProbes.has(pid)) {
          pendingProbes.get(pid)(null);
          pendingProbes.delete(pid);
        }
        return;
      }
      if (type === 'unavailable-id') {
        // 设备码被别人占了：自动换一个没被占用的，用户不用管
        if (claimTries < 5) {
          claimTries++;
          var next = LTA.store.randomCode();
          LTA.log.warn('设备码 #' + selfMeta.code + ' 已被占用，自动换成 #' + next);
          if (LTA.ui && LTA.ui.toast) {
            LTA.ui.toast(LTA.i18n.t('toast.codeReplaced', { old: selfMeta.code, code: next }), 'warn');
          }
          LTA.store.patch({ deviceCode: next });
          setTimeout(init, 400);
          return;
        }
        setStatus('error');
        LTA.log.error(LTA.i18n.t('toast.idTaken', { code: selfMeta.code }));
        emit('status', 'id-taken');
        return;
      }
      if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
        setStatus('error');
        LTA.log.error(LTA.i18n.t('err.signal'), err && err.message);
        emit('status', 'signal-error');
        return;
      }
      LTA.log.warn('信令提示：' + type, err && err.message);
    });
  }

  function destroy(silent) {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    links.forEach(function (l) { try { l.conn.close(); } catch (e) {} });
    links.clear();
    known.clear();
    pendingProbes.clear();
    if (peer) {
      try { peer.destroy(); } catch (e) {}
      peer = null;
    }
    setStatus('idle');
    if (!silent) LTA.log.info('连接层已重置');
  }

  /* ---------------- 探测与连接 ---------------- */
  function probe(peerId, timeout) {
    if (!peer || peer.destroyed || peer.disconnected) return Promise.reject(new Error('not-ready'));
    timeout = timeout || 900;
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = null;
      var link = null;

      function finish(result, transient) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        pendingProbes.delete(peerId);
        if (!result && link) { try { link.conn.close(); } catch (e) {} }
        if (transient) reject(new Error(transient));
        else resolve(result);
      }

      timer = setTimeout(function () { finish(null, 'timeout'); }, timeout);
      pendingProbes.set(peerId, finish);

      var conn;
      try {
        conn = peer.connect(peerId, { reliable: true });
      } catch (e) { return finish(null, 'connect-throw'); }
      if (!conn) return finish(null, 'connect-throw');   // PeerJS 在未就绪时会返回 undefined
      link = new Link(conn, 'out');

      conn.on('open', function () {
        greet(link);
      });
      link.on('pong', function () { finish(link); });
      conn.on('error', function (e) {
        // peer-unavailable 是“这台设备不在线”的确切答案；其他错误属于链路抖动，可重试
        if (e && e.type === 'peer-unavailable') finish(null);
        else finish(null, 'conn-error');
      });
      conn.on('close', function () { if (!done) finish(null, 'conn-close'); });
    });
  }

  /** 手动输入 4 位码：先试正常地址，再试 44 前缀的隐藏地址 */
  function connectCode(code) {
    code = String(code).replace(/\D/g, '');
    if (!/^\d{4}$/.test(code)) return Promise.reject(new Error('bad-code'));
    if (code === selfMeta.code) return Promise.reject(new Error('self'));

    var candidates = [peerIdForCode(code, false), peerIdForCode(code, true)];

    // internal 名册若能确认在线，直接连 internal，省一次盲探
    var reg = LTA.registry;
    if (reg && reg.ready) {
      return reg.lookup(code).then(function (hit) {
        if (hit && hit.online) {
          return reg.connect(code).then(function (link) {
            return formalize(link);
          });
        }
        return null;
      }, function () { return null; }).then(function (doneLink) {
        if (doneLink) return doneLink;
        return legacyConnect();
      });
    }
    return legacyConnect();

    function legacyConnect() {

    // 附近设备池里已经有，直接复用
    var cached = null;
    known.forEach(function (v) {
      if (v.code === code && !cached) cached = v;
    });
    if (cached && links.has(cached.peerId)) {
      return Promise.resolve(links.get(cached.peerId));
    }

    var i = 0;
      function next() {
        if (i >= candidates.length) return Promise.reject(new Error('unreachable'));
        var pid = candidates[i++];
        return probe(pid, 1600).then(function (link) {
          if (!link) return next();
          return formalize(link);
        });
      }
      return next().catch(function (err) {
        if (err && err.message === 'rejected') throw err;
        // 主信令不通时，最后再试 internal 直连（不可查找设备也在这条路上）
        if (reg && reg.connect) return reg.connect(code).then(formalize);
        throw err;
      });
    }
  }

  /** 探测到的链路上发起正式连接请求（对方会弹确认框） */
  function formalize(link) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function onConnected(l) {
        if (settled) return; settled = true;
        resolve(l);
      }
      function onRejected() {
        if (settled) return; settled = true;
        reject(new Error('rejected'));
      }
      link.on('connected', onConnected);
      link.on('rejected', onRejected);

      link.state = 'pending';
      safeSend(link, {
        t: 'hello',
        name: selfMeta.name,
        code: selfMeta.code,
        hidden: selfMeta.hidden,
        trusted: LTA.store.isTrusted(link.code)
      });

      // 对方若已把我们设为信任设备，会直接 accept；否则等 askHandlers 流程
      setTimeout(function () {
        if (settled) return;
        // 超时视作失败，避免用户干等
        if (link.state !== 'connected') {
          settled = true;
          try { link.conn.close(); } catch (e) {}
          reject(new Error('timeout'));
        }
      }, 20000);
    });
  }

  /** 入站链路（连接层回调里拿到的），供扫描/群聊复用 */
  function wrap(conn) { return new Link(conn, 'out'); }

  /** internal 信令的链路：地址是 i1234，需要显式把设备码填进去 */
  function wrapWith(conn, code) { return new Link(conn, 'out', code); }

  LTA.net = {
    PREFIX: PREFIX,
    idFor: peerIdForCode,
    codeFrom: codeFromPeerId,
    init: init,
    destroy: destroy,
    probe: probe,
    connectCode: connectCode,
    wrap: wrap,
    wrapWith: wrapWith,
    accept: accept,
    reject: reject,
    greet: greet,
    send: safeSend,
    peerConfig: buildPeerConfig,
    on: function (kind, fn) { (listeners[kind] = listeners[kind] || []).push(fn); },
    onMessage: function (type, fn) { handlers[type] = fn; },
    setAskHandlers: function (obj) { askHandlers = Object.assign(askHandlers, obj || {}); },
    get links() { return links; },
    get known() { return known; },
    get status() { return status; },
    get me() { return selfMeta; },
    get peer() { return peer; },
    refreshMeta: function () {
      selfMeta.name = LTA.store.deviceLabel();
    },
    clearKnown: function () { known.clear(); }
  };
})(window.LTA = window.LTA || {});
