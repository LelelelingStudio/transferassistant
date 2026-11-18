/* =========================================================================
   registry —— internal 信令（第二套固定信令 + 在线名册）
   思路：
   · 每台设备除了主信令（lt-xxxx）外，还在 internal 信令上以 ixxxx 上线
   · internal 上有一个固定的“名册节点”（id 固定），谁先占住谁当，其他人连它登记
   · 查找设备 = 直接向名册节点要一份在线名单，不用再扫 0000–9999
   · 输入 4 位码 = 先问名册“这个号码在不在”，在就直接连，省掉盲探
   ========================================================================= */
(function (LTA) {
  'use strict';

  var REG_ID = 'ltareg-leleleling-transferassistant';  // 固定的名册节点 id
  var IDP = 'i';                                       // internal 地址前缀：i1234 / i441234
  var BEAT = 22000;
  var STALE = 75000;

  var peerNode = null;   // 只有名册节点才有
  var memberTimer = null;
  var startTimer = null;
  var attempts = 0;
  var peerSelf = null;   // 自己的 internal 地址
  var nodeConn = null;   // 成员连到名册节点的链路
  var members = new Map(); // 名册节点：code -> conn
  var roster = new Map();  // code -> { code, name, ts, id }
  var self = { code: '', name: '', hidden: false };
  var st = 'idle';         // idle | connecting | ready | error
  var beatTimer = null;
  var pruneTimer = null;
  var waiters = [];        // 等待 reg-list / reg-hit 的回调
  var listeners = { roster: [], status: [] };
  var incoming = null;     // 入站 internal 连接回调

  function emit(kind, a) {
    (listeners[kind] || []).forEach(function (fn) { try { fn(a); } catch (e) {} });
  }

  function setStatus(s) {
    if (s === 'ready') { attempts = 0; clearTimeout(startTimer); startTimer = null; }
    st = s; emit('status', s);
  }
  function isReady() { return st === 'ready'; }

  function idFor(code, hidden) {
    return IDP + (hidden ? '44' : '') + String(code);
  }

  function cfg() { return LTA.net.peerConfig(); }

  function selfId() { return idFor(self.code, self.hidden); }

  function touchSelf() {
    if (!self.code) return;
    roster.set(self.code, { code: self.code, name: self.name, ts: Date.now(), id: selfId() });
  }

  function listItems() {
    var now = Date.now();
    var out = [];
    if (self.hidden) return out;   // 不可查找模式不出现在任何在线名单里
    roster.forEach(function (v) {
      if (now - v.ts > STALE) return;
      out.push({ code: v.code, name: v.name, id: v.id, hidden: /^i44/.test(v.id) });
    });
    return out;
  }

  function flushWaiters(kind, payload) {
    var keep = [];
    waiters.forEach(function (w) {
      if (w.kind !== kind) { keep.push(w); return; }
      clearTimeout(w.timer);
      try { w.resolve(payload); } catch (e) {}
    });
    waiters = keep;
  }

  function ask(kind, extra, ms) {
    return new Promise(function (resolve, reject) {
      if (!nodeConn || !nodeConn.open) return reject(new Error('no-node'));
      var w = { kind: kind, resolve: resolve };
      w.timer = setTimeout(function () {
        waiters = waiters.filter(function (x) { return x !== w; });
        reject(new Error('timeout'));
      }, ms || 2000);
      waiters.push(w);
      try { nodeConn.send(Object.assign({ t: kind }, extra || {})); } catch (e) { reject(new Error('send-fail')); }
    });
  }

  /* ---------------- 名册节点侧 ---------------- */
  function nodeBroadcast() {
    var payload = { t: 'reg-list', items: listItems() };
    members.forEach(function (conn) {
      try { if (conn.open) conn.send(payload); } catch (e) {}
    });
  }

  function becomeNode() {
    if (peerNode) return;
    try {
      peerNode = new Peer(REG_ID, cfg());
    } catch (e) { return; }

    peerNode.on('open', function () {
      touchSelf();
      clearTimeout(memberTimer);
      if (nodeConn) { try { nodeConn.close(); } catch (e) {} nodeConn = null; stopBeat(); }
      setStatus('ready');
      LTA.log.ok('internal 名册节点就位');
      nodeBroadcast();
      startPrune();
    });

    peerNode.on('connection', function (conn) {
      conn.on('data', function (raw) {
        var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!msg || !msg.t) return;

        if (msg.t === 'reg-join') {
          var code = String(msg.code || '').slice(0, 4);
          if (!/^\d{4}$/.test(code)) return;
          members.set(code, conn);
          roster.set(code, { code: code, name: msg.name || '', ts: Date.now(), id: msg.id || idFor(code, false) });
          try { conn.send({ t: 'reg-list', items: listItems() }); } catch (e) {}
          nodeBroadcast();
          emit('roster', listItems());
          LTA.log.info('internal 上线：#' + code + (msg.name ? ' · ' + msg.name : ''));
          return;
        }

        if (msg.t === 'reg-query') {
          try { conn.send({ t: 'reg-list', items: listItems() }); } catch (e) {}
          return;
        }

        if (msg.t === 'reg-lookup') {
          var want = String(msg.code || '');
          var item = roster.get(want);
          var alive = !!(item && Date.now() - item.ts <= STALE);
          try { conn.send({ t: 'reg-hit', code: want, online: alive, name: alive ? item.name : '', id: alive ? item.id : '' }); } catch (e) {}
          return;
        }
      });

      conn.on('close', function () {
        var code = null;
        members.forEach(function (c, k) { if (c === conn) code = k; });
        if (code) {
          members.delete(code);
          roster.delete(code);
          nodeBroadcast();
          emit('roster', listItems());
        }
      });
    });

    peerNode.on('error', function (err) {
      var type = err && err.type;
      if (type === 'unavailable-id') {
        try { peerNode.destroy(); } catch (e) {}
        peerNode = null;
        becomeMember();
        return;
      }
      LTA.log.warn('internal 信令异常：' + type);
    });

    peerNode.on('disconnected', function () {
      if (peerNode && !peerNode.destroyed) { try { peerNode.reconnect(); } catch (e) {} }
    });
  }

  function startPrune() {
    stopPrune();
    pruneTimer = setInterval(function () {
      var changed = false;
      var now = Date.now();
      roster.forEach(function (v, k) {
        if (now - v.ts > STALE && k !== self.code) { roster.delete(k); changed = true; }
      });
      if (changed) { nodeBroadcast(); emit('roster', listItems()); }
    }, 30000);
  }

  function stopPrune() { if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; } }

  /* ---------------- 成员侧 ---------------- */
  function becomeMember() {
    if (nodeConn && nodeConn.open) return;

    try {
      nodeConn = peerSelf.connect(REG_ID, { reliable: true });
      if (!nodeConn) { setStatus('error'); return; }
    } catch (e) { setStatus('error'); return; }

    clearTimeout(memberTimer);
    memberTimer = setTimeout(function () {
      // 节点连不上（NAT / 不同网络）：4 秒后放弃本次尝试，标记为不可用并重试
      if (!peerSelf || peerSelf.destroyed) return;
      if (nodeConn && nodeConn.open) return;
      if (peerNode && peerNode.open) return;   // 自己就是名册节点，不需要成员链路
      try { if (nodeConn) nodeConn.close(); } catch (e) {}
      nodeConn = null;
      stopBeat();
      setStatus('error');
      LTA.log.warn('internal 名册节点连不上，稍后重试');
      setTimeout(function () {
        if (!peerSelf || peerSelf.destroyed) return;
        if (peerNode && peerNode.open) return;
        if (peerSelf.open) becomeMember();
      }, 6000);
    }, 4000);

    nodeConn.on('open', function () {
      clearTimeout(memberTimer);
      setStatus('ready');
      try {
        nodeConn.send({ t: 'reg-join', code: self.code, name: self.name, id: selfId() });
      } catch (e) {}
      startBeat();
      LTA.log.ok('已加入 internal 名册');
    });

    nodeConn.on('data', function (raw) {
      var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!msg || !msg.t) return;
      if (msg.t === 'reg-list') {
        roster.clear();
        (msg.items || []).forEach(function (it) {
          roster.set(it.code, { code: it.code, name: it.name, ts: Date.now(), id: it.id });
        });
        touchSelf();
        emit('roster', listItems());
        flushWaiters('query', listItems());
        return;
      }
      if (msg.t === 'reg-hit') {
        var it = { code: msg.code, online: !!msg.online, name: msg.name || '', id: msg.id || '' };
        if (it.online) roster.set(it.code, { code: it.code, name: it.name, ts: Date.now(), id: it.id });
        flushWaiters('lookup', it);
      }
    });

    nodeConn.on('close', function () {
      nodeConn = null;
      stopBeat();
      setStatus('error');
      LTA.log.warn('internal 名册断开，稍后重试');
      setTimeout(function () {
        if (peerSelf && peerSelf.open) becomeMember();
        else if (peerNode) { /* 节点模式无需重试 */ }
      }, 3000);
    });

    nodeConn.on('error', function () {
      nodeConn = null;
      stopBeat();
    });
  }

  function startBeat() {
    stopBeat();
    beatTimer = setInterval(function () {
      if (nodeConn && nodeConn.open) {
        try { nodeConn.send({ t: 'reg-join', code: self.code, name: self.name, id: selfId() }); } catch (e) {}
      }
    }, BEAT);
  }

  function stopBeat() { if (beatTimer) { clearInterval(beatTimer); beatTimer = null; } }

  /* ---------------- 生命周期 ---------------- */
  function start(code, name, hidden) {
    stop();
    self.code = String(code || '').replace(/\D/g, '').slice(-4);
    self.name = name || '';
    self.hidden = !!hidden;
    if (!/^\d{4}$/.test(self.code)) { setStatus('idle'); return; }

    setStatus('connecting');

    // 信令卡住时自己重来一次（最多 2 次）
    clearTimeout(startTimer);
    startTimer = setTimeout(function () {
      if (st !== 'connecting') return;
      if (attempts >= 2) { setStatus('error'); return; }
      attempts++;
      LTA.log.warn('internal 启动超时，重试第 ' + attempts + ' 次');
      start(self.code, self.name, self.hidden);
    }, 6000);

    // 先给自己开 internal 地址
    try {
      peerSelf = new Peer(selfId(), cfg());
      peerSelf.on('open', function () {
        if (self.hidden) {
          // 不可查找模式：不进名册、不当节点，但保留 internal 地址供 4 位码直连
          setStatus('ready');
          LTA.log.info('不可查找模式：不加入 internal 名册');
          return;
        }
        touchSelf();
        becomeMember();
      });
      peerSelf.on('error', function (err) {
        var type = err && err.type;
        if (type === 'unavailable-id') {
          LTA.log.warn('internal 地址被占用：' + selfId());
        }
      });
      peerSelf.on('connection', function (conn) {
        if (incoming) incoming(conn);
        function setup() {
          if (!LTA.net || !LTA.net.wrapWith) return;
          var link = LTA.net.wrapWith(conn, self.code);
          LTA.net.greet(link);       // 同一套 ping/pong 握手
        }
        if (conn.open) setup(); else conn.on('open', setup);
      });
    } catch (e) { setStatus('error'); return; }

    // 再抢名册节点；抢不到就当成员（不可查找模式不抢）
    if (!self.hidden) {
      setTimeout(function () { if (!nodeConn || !nodeConn.open) becomeNode(); }, 300);
    }
  }

  function stop() {
    clearTimeout(startTimer);
    startTimer = null;
    clearTimeout(memberTimer);
    memberTimer = null;
    stopBeat();
    stopPrune();
    waiters = [];
    members.clear();
    roster.clear();
    nodeConn = null;
    if (peerNode) { try { peerNode.destroy(); } catch (e) {} peerNode = null; }
    if (peerSelf) { try { peerSelf.destroy(); } catch (e) {} peerSelf = null; }
    st = 'idle';
  }

  /** 要一份在线名单（1~3 秒内返回） */
  function query() {
    if (st !== 'ready') return Promise.reject(new Error('not-ready'));
    var local = listItems();
    if (peerNode && peerNode.open) return Promise.resolve(local);
    return ask('reg-query', {}, 2500).then(function (items) { return items || local; }, function () { return local; });
  }

  /** 问某个 4 位码在不在线 */
  function lookup(code) {
    if (st !== 'ready') return Promise.resolve({ code: code, online: false, unknown: true });
    var local = roster.get(String(code));
    if (local && Date.now() - local.ts <= STALE) {
      return Promise.resolve({ code: String(code), online: true, name: local.name, id: local.id });
    }
    if (peerNode && peerNode.open) {
      return Promise.resolve({ code: String(code), online: false });
    }
    return ask('reg-lookup', { code: String(code) }, 2500).catch(function () {
      return { code: String(code), online: false, unknown: true };
    });
  }

  /** internal 直连：先 i1234 再 i441234 */
  function connect(code) {
    if (!peerSelf || !peerSelf.open) return Promise.reject(new Error('not-ready'));
    var candidates = [idFor(code, false), idFor(code, true)];
    var i = 0;
    function next() {
      if (i >= candidates.length) return Promise.reject(new Error('unreachable'));
      var pid = candidates[i++];
      return new Promise(function (resolve, reject) {
        var conn;
        try { conn = peerSelf.connect(pid, { reliable: true }); } catch (e) { return reject(new Error('throw')); }
        if (!conn) return reject(new Error('no-conn'));
        var done = false;
        var timer = setTimeout(function () { if (done) return; done = true; try { conn.close(); } catch (e) {} reject(new Error('timeout')); }, 1500);
        conn.on('open', function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          var link = LTA.net.wrapWith(conn, code);
          resolve(link);
        });
        conn.on('error', function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(new Error('error'));
        });
      }).catch(function () { return next(); });
    }
    return next();
  }

  LTA.registry = {
    REG_ID: REG_ID,
    idFor: idFor,
    start: start,
    stop: stop,
    query: query,
    lookup: lookup,
    connect: connect,
    get status() { return st; },
    get ready() { return isReady(); },
    get isNode() { return !!(peerNode && peerNode.open); },
    get items() { return listItems(); },
    onRoster: function (fn) { listeners.roster.push(fn); },
    onStatus: function (fn) { listeners.status.push(fn); },
    setIncoming: function (fn) { incoming = fn; }
  };
})(window.LTA = window.LTA || {});
