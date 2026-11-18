/* =========================================================================
   chat —— 私聊 + 群聊（去中心化）
   · 私聊复用已连接的设备链路
   · 群聊用一个“会跑的排班节点”：谁先来谁当节点（ltg-群号），
     节点掉线后其他成员会重新推举一个节点，所以一个人掉线不影响全局
   ========================================================================= */
(function (LTA) {
  'use strict';

  var GROUP_PREFIX = 'ltg-';
  var MAX_MEMORY = 600;

  var groups = {};              // code -> group runtime
  var seen = [];                // 已处理的群消息 id（去重）
  var activeId = null;
  var unread = {};
  var listeners = [];
  var watchdog = null;
  var joinedGroups = null;      // localStorage 缓存

  function emit() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function mid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function peerIdForGroup(code) { return GROUP_PREFIX + code; }

  function remember(id) {
    if (seen.indexOf(id) !== -1) return false;
    seen.push(id);
    if (seen.length > MAX_MEMORY) seen = seen.slice(seen.length - MAX_MEMORY);
    return true;
  }

  /* ---------------- 已加入的群（持久化） ---------------- */
  function loadJoined() {
    if (joinedGroups) return joinedGroups;
    try {
      joinedGroups = JSON.parse(localStorage.getItem('lta.groups') || '[]');
      if (!Array.isArray(joinedGroups)) joinedGroups = [];
    } catch (e) { joinedGroups = []; }
    return joinedGroups;
  }

  function saveJoined() {
    try { localStorage.setItem('lta.groups', JSON.stringify(loadJoined())); } catch (e) {}
  }

  function persistGroup(code, name) {
    var list = loadJoined();
    var found = list.filter(function (g) { return g.code === code; })[0];
    if (found) { if (name) found.name = name; }
    else list.push({ code: code, name: name || '', joinedAt: Date.now() });
    saveJoined();
  }

  /* ---------------- 会话列表 ---------------- */
  function directConvs() {
    var out = [];
    LTA.net.links.forEach(function (link) {
      if (link.state !== 'connected' && link.state !== 'connected') return;
      out.push({
        id: 'd:' + link.code,
        kind: 'direct',
        title: link.name || ('#' + link.code),
        code: link.code,
        online: link.isOpen(),
        link: link
      });
    });
    return out;
  }

  function groupConvs() {
    return loadJoined().map(function (g) {
      var runtime = groups[g.code];
      var onlineCount = runtime ? Array.from(runtime.members.values()).filter(function (m) {
        return m.link && m.link.isOpen();
      }).length : 0;
      return {
        id: 'g:' + g.code,
        kind: 'group',
        title: (g.name || (LTA.i18n.t('chat.group') + ' ' + g.code)),
        code: g.code,
        online: !!runtime,
        onlineCount: onlineCount,
        memberCount: runtime ? runtime.members.size : 0
      };
    });
  }

  function convs() {
    var list = groupConvs().concat(directConvs());

    // 本地有聊天记录但当前没连上的会话，也要出现在列表里（离线可读）
    var known = {};
    list.forEach(function (c) { known[c.id] = 1; });
    (LTA.store.chatIds ? LTA.store.chatIds() : []).forEach(function (id) {
      if (known[id]) return;
      if (id.indexOf('g:') === 0) {
        list.push({
          id: id, kind: 'group', code: id.slice(2),
          title: LTA.i18n.t('chat.groupTitle', { code: id.slice(2) }),
          online: false, unread: unread[id] || 0
        });
      } else if (id.indexOf('d:') === 0) {
        var msgs0 = LTA.store.getMessages(id);
        var last0 = msgs0[msgs0.length - 1];
        var code0 = id.slice(2);
        list.push({
          id: id, kind: 'direct', code: code0,
          title: (last0 && last0.fromName) || ('#' + code0),
          online: false, unread: unread[id] || 0
        });
      }
      known[id] = 1;
    });

    list.forEach(function (c) {
      var msgs = LTA.store.getMessages(c.id);
      var last = msgs[msgs.length - 1];
      c.lastTime = last ? last.ts : 0;
      c.lastText = last ? preview(last) : '';
      c.unread = unread[c.id] || 0;
    });
    list.sort(function (a, b) {
      if ((b.lastTime || 0) !== (a.lastTime || 0)) return (b.lastTime || 0) - (a.lastTime || 0);
      return a.kind === 'group' ? -1 : 1;
    });
    return list;
  }

  function preview(msg) {
    if (msg.kind === 'audio') return '[语音]';
    if (msg.kind === 'file') return '[文件] ' + (msg.file && msg.file.name || '');
    return msg.text || '';
  }

  function findConv(id) {
    var all = convs();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function open(id) {
    activeId = id;
    unread[id] = 0;
    emit();
    return id;
  }

  function messages(id) {
    return LTA.store.getMessages(id || activeId);
  }

  /* ---------------- 私聊发送 ---------------- */
  function activeLink() {
    if (!activeId || activeId.indexOf('d:') !== 0) return null;
    var code = activeId.slice(2);
    var found = null;
    LTA.net.links.forEach(function (link) {
      if (link.code === code && link.isOpen()) found = link;
    });
    return found;
  }

  function deliver(payload, conv) {
    var msg = Object.assign({
      t: 'chat-msg',
      conv: conv.id,
      id: mid(),
      from: LTA.net.me.code,
      fromName: LTA.store.deviceLabel(),
      ts: Date.now()
    }, payload);

    LTA.store.appendMessage(conv.id, normalizeForStore(msg));
    remember(msg.id);

    if (conv.kind === 'direct') {
      var link = activeLink();
      if (!link) return { ok: false, reason: 'offline' };
      LTA.net.send(link, msg);
    } else {
      var g = groups[conv.code];
      if (!g) return { ok: false, reason: 'group' };
      sendToGroup(g, msg, null);
    }
    emit();
    return { ok: true, msg: msg };
  }

  function normalizeForStore(msg) {
    return {
      id: msg.id,
      ts: msg.ts,
      from: msg.from,
      fromName: msg.fromName,
      kind: msg.kind || 'text',
      text: msg.text || '',
      file: msg.file || null,
      audio: msg.audio || null,
      conv: msg.conv
    };
  }

  function sendText(text) {
    text = String(text || '').trim();
    if (!text) return { ok: false };
    var conv = findConv(activeId);
    if (!conv) return { ok: false, reason: 'noconv' };
    return deliver({ kind: 'text', text: text }, conv);
  }

  function sendFiles(fileList) {
    var conv = findConv(activeId);
    if (!conv) return { ok: false, reason: 'noconv' };
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return { ok: false };

    if (conv.kind === 'direct') {
      var link = activeLink();
      if (!link) return { ok: false, reason: 'offline' };
      LTA.transfer.sendFiles(link, files);
      files.forEach(function (f) {
        deliver({ kind: 'file', file: { name: f.name, size: f.size, type: f.type } }, conv);
      });
      return { ok: true };
    }

    var g = groups[conv.code];
    if (!g) return { ok: false, reason: 'group' };
    var links = groupLinks(g);
    if (!links.length) return { ok: false, reason: 'offline' };
    links.forEach(function (l) {
      if (l.isOpen()) LTA.transfer.sendFiles(l, files);
    });
    files.forEach(function (f) {
      deliver({ kind: 'file', file: { name: f.name, size: f.size, type: f.type } }, conv);
    });
    return { ok: true };
  }

  function sendAudio(blob, duration) {
    var conv = findConv(activeId);
    if (!conv) return Promise.resolve({ ok: false, reason: 'noconv' });
    if (blob.size > 900 * 1024) {
      return Promise.resolve({ ok: false, reason: 'too-large' });
    }
    return blobToDataURL(blob).then(function (dataUrl) {
      deliver({
        kind: 'audio',
        audio: { url: dataUrl, dur: Math.round(duration * 10) / 10, mime: blob.type }
      }, conv);
      return { ok: true };
    });
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  /* ---------------- 群聊 ---------------- */
  function groupRuntime(code, name) {
    var g = groups[code];
    if (!g) {
      g = groups[code] = {
        code: code,
        name: name || '',
        isHub: false,
        hubPeer: null,
        hubLink: null,
        members: new Map(),   // peerId -> {peerId, name, deviceCode, link, role}
        links: new Map(),     // peerId -> link（成员侧直连，可选）
        retry: 0
      };
    }
    if (name) g.name = name;
    return g;
  }

  function groupLinks(g) {
    var out = [];
    if (g.hubLink && g.hubLink.isOpen()) out.push(g.hubLink);
    g.links.forEach(function (l) { if (l.isOpen()) out.push(l); });
    if (g.isHub) {
      g.members.forEach(function (m) { if (m.link && m.link.isOpen()) out.push(m.link); });
    }
    // 去重
    var seenIds = {};
    return out.filter(function (l) {
      if (seenIds[l.peerId]) return false;
      seenIds[l.peerId] = 1;
      return true;
    });
  }

  function sendToGroup(g, msg, exceptPeerId) {
    var links = groupLinks(g);
    links.forEach(function (link) {
      if (exceptPeerId && link.peerId === exceptPeerId) return;
      LTA.net.send(link, msg);
    });
  }

  function roster(g) {
    var arr = [];
    if (g.isHub) {
      g.members.forEach(function (m) {
        arr.push({ peerId: m.peerId, name: m.name || '', deviceCode: m.deviceCode || '', online: !!(m.link && m.link.isOpen()) });
      });
    }
    return arr;
  }

  function broadcastRoster(g) {
    if (!g.isHub) return;
    var payload = {
      t: 'group-roster',
      code: g.code,
      name: g.name,
      hubId: peerIdForGroup(g.code),
      members: roster(g)
    };
    g.members.forEach(function (m) {
      if (m.link && m.link.isOpen()) LTA.net.send(m.link, payload);
    });
    emit();
  }

  /** 加入群：先试着当节点，当不了就连已有的节点 */
  function joinGroup(code, name) {
    code = String(code).replace(/\D/g, '');
    if (!/^\d{4}$/.test(code)) return Promise.reject(new Error('bad-code'));

    var g = groupRuntime(code, name);
    persistGroup(code, name || g.name);

    return new Promise(function (resolve) {
      attemptNode(g, function (result) {
        LTA.log.info('群 ' + code + '：' + (result === 'hub' ? '本机成为节点' : '已连上现有节点'));
        emit();
        resolve(result);
      });
    });
  }

  function attemptNode(g, done) {
    if (g.isHub) return done('hub');
    if (g.hubLink && g.hubLink.isOpen()) return done('client');

    if (!LTA.net.peer || LTA.net.status !== 'online') {
      // 等主连接上线后再试
      setTimeout(function () { if (!g.isHub && !(g.hubLink && g.hubLink.isOpen())) attemptNode(g, done); }, 1500);
      return;
    }

    // 1) 尝试成为节点
    var hubId = peerIdForGroup(g.code);
    var tryHub = function () {
      var cfg = LTA.net.peerConfig();
      var hp = null;
      try { hp = new Peer(hubId, cfg); } catch (e) { hp = null; }
      if (!hp) return tryClient();

      var settled = false;
      hp.on('open', function () {
        if (settled) return;
        settled = true;
        g.isHub = true;
        g.hubPeer = hp;
        LTA.log.ok('本机成为群 ' + g.code + ' 的节点');
        hp.on('connection', function (conn) {
          var link = LTA.net.wrap(conn);
          conn.on('open', function () {
            // 等对方发 group-hello，这里先登记占位
            g.members.set(link.peerId, { peerId: link.peerId, name: '', deviceCode: '', link: link });
          });
          link.on('close', function () {
            g.members.delete(link.peerId);
            broadcastRoster(g);
            emit();
          });
        });
        done('hub');
      });
      hp.on('error', function (err) {
        var type = err && err.type;
        if (type === 'unavailable-id' && !settled) {
          settled = true;
          try { hp.destroy(); } catch (e) {}
          LTA.log.info('群 ' + g.code + ' 已有节点，改为连过去');
          tryClient();
          return;
        }
        if (!settled && (type === 'network' || type === 'server-error')) {
          settled = true;
          try { hp.destroy(); } catch (e) {}
          setTimeout(function () { attemptNode(g, done); }, 3000);
        }
      });
    };

    // 2) 连已有节点
    var tryClient = function () {
      var conn = null;
      try { conn = LTA.net.peer.connect(hubId, { reliable: true }); } catch (e) { conn = null; }
      if (!conn) return;
      var link = LTA.net.wrap(conn);
      var settled = false;

      conn.on('open', function () {
        settled = true;
        g.hubLink = link;
        LTA.net.send(link, {
          t: 'group-hello',
          code: g.code,
          name: LTA.store.deviceLabel(),
          deviceCode: LTA.net.me.code
        });
        LTA.log.info('已接入群 ' + g.code + ' 的节点');
        done('client');
      });
      link.on('close', function () {
        if (g.hubLink === link) g.hubLink = null;
        emit();
      });
      setTimeout(function () {
        if (!settled) {
          try { conn.close(); } catch (e) {}
        }
      }, 4000);
    };

    tryHub();
  }

  function leaveGroup(code) {
    var g = groups[code];
    if (g) {
      if (g.hubPeer) { try { g.hubPeer.destroy(); } catch (e) {} }
      if (g.hubLink) { try { g.hubLink.conn.close(); } catch (e) {} }
      g.members.forEach(function (m) { if (m.link) { try { m.link.conn.close(); } catch (e) {} } });
      delete groups[code];
    }
    joinedGroups = loadJoined().filter(function (x) { return x.code !== code; });
    saveJoined();
    if (activeId === 'g:' + code) activeId = null;
    emit();
    LTA.log.info('已退出群 ' + code);
  }

  function membersOf(code) {
    var g = groups[code];
    if (!g) return [];
    var list = [];
    if (g.isHub) {
      g.members.forEach(function (m) {
        list.push({ peerId: m.peerId, name: m.name || ('#' + (m.deviceCode || '')), online: !!(m.link && m.link.isOpen()), self: m.deviceCode === LTA.net.me.code });
      });
    }
    list.push({ peerId: 'self', name: LTA.store.deviceLabel(), online: true, self: true });
    return list;
  }

  function restoreGroups() {
    loadJoined().forEach(function (g) {
      groupRuntime(g.code, g.name);
    });
    // 延迟一点再逐个接入，避免和主连接初始化抢资源
    setTimeout(function () {
      loadJoined().forEach(function (g) { attemptNode(groupRuntime(g.code, g.name), function () { emit(); }); });
    }, 1200);
  }

  function startWatchdog() {
    if (watchdog) return;
    watchdog = setInterval(function () {
      Object.keys(groups).forEach(function (code) {
        var g = groups[code];
        if (g.isHub) return;
        var alive = g.hubLink && g.hubLink.isOpen();
        // 记录最近一次活着的时间，断线超过 10 秒就重新推举节点
        if (alive) { g.lastAlive = Date.now(); return; }
        if (!g.lastAlive) g.lastAlive = Date.now() - 11000;
        if (Date.now() - g.lastAlive > 10000) {
          LTA.log.warn('群 ' + code + ' 的节点失联，尝试重新推举');
          g.lastAlive = Date.now();
          attemptNode(g, function () { emit(); });
        }
      });
    }, 12000);
  }

  /* ---------------- 协议 ---------------- */
  LTA.net.onMessage('group-hello', function (link, msg) {
    var code = String(msg.code || '').replace(/\D/g, '');
    var g = groups[code];
    if (!g) return;
    if (!g.isHub) return;   // 只有节点处理入群

    g.members.set(link.peerId, {
      peerId: link.peerId,
      name: msg.name || '',
      deviceCode: msg.deviceCode || '',
      link: link
    });
    // 给新手发名单，给所有人发更新
    LTA.net.send(link, {
      t: 'group-roster',
      code: g.code,
      name: g.name,
      hubId: peerIdForGroup(g.code),
      members: roster(g)
    });
    broadcastRoster(g);
    LTA.log.ok('新成员加入群 ' + code + '：' + (msg.name || msg.deviceCode));
    emit();
  });

  LTA.net.onMessage('group-roster', function (link, msg) {
    var g = groups[String(msg.code || '')];
    if (!g) return;
    if (msg.name) g.name = msg.name;
    g.roster = msg.members || [];
    // 成员侧：把 roster 转成只读成员表，供 UI 显示
    g.remoteMembers = g.roster.filter(function (m) {
      return m.deviceCode !== LTA.net.me.code;
    });
    emit();
  });

  LTA.net.onMessage('group-name', function (link, msg) {});

  LTA.net.onMessage('chat-msg', function (link, msg) {
    var convId = msg.conv;
    if (!convId) return;

    // 私聊消息：会话 id 用“对方设备码”，收发两端都能对上
    if (convId.indexOf('g:') === -1) {
      var directId = 'd:' + (msg.from || '');
      var stored = normalizeForStore(msg);
      LTA.store.appendMessage(directId, stored);
      if (activeId !== directId) unread[directId] = (unread[directId] || 0) + 1;
      emit();
      return;
    }

    var code = convId.slice(2);
    var g = groups[code];
    var fresh = remember(msg.id);
    LTA.store.appendMessage(convId, normalizeForStore(msg));
    if (activeId !== convId) unread[convId] = (unread[convId] || 0) + 1;
    if (fresh && g) {
      // 转发：节点负责广播，成员也转一份给节点，减少漏消息
      if (g.isHub) sendToGroup(g, msg, link.peerId);
      else if (g.hubLink && g.hubLink.isOpen() && g.hubLink.peerId !== link.peerId) {
        LTA.net.send(g.hubLink, msg);
      }
    }
    emit();
  });

  /* ---------------- 对外 ---------------- */
  LTA.chat = {
    convs: convs,
    open: open,
    get activeId() { return activeId; },
    messages: messages,
    sendText: sendText,
    sendFiles: sendFiles,
    sendAudio: sendAudio,
    joinGroup: joinGroup,
    leaveGroup: leaveGroup,
    membersOf: membersOf,
    preview: preview,
    restoreGroups: restoreGroups,
    startWatchdog: startWatchdog,
    onChange: function (fn) { listeners.push(fn); },
    onLinkChange: function () { emit(); }
  };
})(window.LTA = window.LTA || {});
