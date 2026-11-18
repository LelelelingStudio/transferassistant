/* =========================================================================
   ui —— 所有界面渲染与交互
   ========================================================================= */
(function (LTA) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {};
  var currentPanel = 'transfer';
  var primaryPeer = null;       // 默认发送目标（设备码）
  var foundItems = [];          // 扫描/发现到的设备
  var lastTransferSignature = '';

  /* ================= 提示条 ================= */
  var TOAST_TTL = 3000;        // 3 秒自动消失
  var TOAST_MAX = 3;           // 同时最多 3 条，避免刷屏
  var toastSeen = {};          // 文案去重，短时间内重复的不再堆

  function toast(text, kind) {
    var region = els.toastRegion;
    if (!region || !text) return null;

    var now = Date.now();
    if (toastSeen[text] && now - toastSeen[text] < 1200) return null;  // 重复的直接吞掉
    toastSeen[text] = now;

    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.dataset.kind = kind || 'info';

    var txt = document.createElement('span');
    txt.className = 'toast-text';
    txt.textContent = text;

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', LTA.i18n.t('common.close'));
    close.textContent = '×';

    el.appendChild(txt);
    el.appendChild(close);

    var timer = setTimeout(remove, TOAST_TTL);
    close.addEventListener('click', remove);
    el.addEventListener('pointerenter', function () { clearTimeout(timer); });
    el.addEventListener('pointerleave', function () { timer = setTimeout(remove, 1200); });

    function remove() {
      clearTimeout(timer);
      if (!el.parentNode) return;
      el.classList.add('is-leaving');
      setTimeout(function () { el.remove(); }, 180);
    }

    region.appendChild(el);

    // 超量时先淘汰最老的
    var all = region.querySelectorAll('.toast');
    if (all.length > TOAST_MAX) {
      for (var i = 0; i < all.length - TOAST_MAX; i++) {
        try { all[i].remove(); } catch (e) {}
      }
    }

    if (window.ariaNotify) {
      try { window.ariaNotify(text); } catch (e) {}
    }
    return el;
  }

  /* ================= 面板切换 ================= */
  function switchPanel(name) {
    currentPanel = name;
    document.querySelectorAll('.tab').forEach(function (t) {
      var active = t.dataset.panel === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      var active = p.id === 'panel-' + name;
      p.classList.toggle('is-active', active);
      p.hidden = !active;
    });
    if (name === 'chat') renderChat();
    if (name === 'log') renderLog();
  }

  /* ================= 我的设备 ================= */
  function renderDevice() {
    var raw = LTA.store.raw;
    if (els.hdCode) els.hdCode.textContent = raw.deviceCode;
    if (els.myCode) els.myCode.textContent = raw.deviceCode;
    if (els.inName && document.activeElement !== els.inName) {
      els.inName.value = raw.deviceName || '';
    }
    if (els.swHidden) els.swHidden.setAttribute('aria-checked', raw.hidden ? 'true' : 'false');
    if (els.hiddenHint) els.hiddenHint.hidden = !raw.hidden;
    renderStatus(LTA.net.status);
  }

  function renderStatus(status) {
    if (!els.myStatus) return;
    var label = 'device.statusConnecting';
    var state = 'connecting';
    if (status === 'online') { label = 'device.statusOnline'; state = 'online'; }
    else if (status === 'error') { label = 'device.statusError'; state = 'error'; }
    else if (status === 'idle') { label = 'device.statusOffline'; state = 'offline'; }
    els.myStatus.dataset.state = state;
    var span = els.myStatus.querySelector('span');
    if (span) span.textContent = LTA.i18n.t(label);
  }

  /* ================= 附近设备 ================= */
  function upsertFound(item) {
    var idx = -1;
    foundItems.forEach(function (f, i) { if (f.code === item.code) idx = i; });
    if (idx >= 0) foundItems[idx] = Object.assign(foundItems[idx], item);
    else foundItems.push(item);
    renderFound();
  }

  function renderFound() {
    if (!els.foundList) return;
    if (els.foundCount) els.foundCount.textContent = String(foundItems.length);
    els.foundList.innerHTML = '';
    if (els.foundEmpty) els.foundEmpty.hidden = foundItems.length > 0;

    foundItems.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'list-item';
      var trusted = LTA.store.isTrusted(item.code);
      li.innerHTML =
        '<div class="item-main">' +
        '  <div class="item-title">' +
        LTA.store.escapeHtml(item.name || (LTA.i18n.t('common.unknown'))) +
        (trusted ? ' <span class="tag tag-trust">' + LTA.i18n.t('connect.trusted') + '</span>' : '') +
        (item.hidden ? ' <span class="tag tag-hidden">44</span>' : '') +
        '  </div>' +
        '  <div class="item-sub">#' + item.code + '</div>' +
        '</div>';

      var actions = document.createElement('div');
      actions.className = 'item-actions';

      var connected = false;
      LTA.net.links.forEach(function (l) { if (l.code === item.code && l.isOpen()) connected = true; });

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = connected ? 'btn btn-ghost btn-sm' : 'btn btn-outline btn-sm';
      btn.textContent = connected ? LTA.i18n.t('connect.btnChat') : LTA.i18n.t('connect.btnConnect');
      btn.addEventListener('click', function () {
        if (connected) {
          switchPanel('chat');
          LTA.chat.open('d:' + item.code);
          renderChat();
          return;
        }
        btn.disabled = true;
        btn.textContent = LTA.i18n.t('connect.connecting');
        doConnect(item.code).then(function () {
          btn.disabled = false;
        }).catch(function () {
          btn.disabled = false;
          btn.textContent = LTA.i18n.t('connect.btnConnect');
        });
      });

      actions.appendChild(btn);
      li.appendChild(actions);
      els.foundList.appendChild(li);
    });
  }

  /* ================= 连接 ================= */
  function doConnect(code) {
    code = String(code).replace(/\D/g, '');
    if (!/^\d{4}$/.test(code)) {
      toast(LTA.i18n.t('toast.connectFail', { code: code || '----' }), 'warn');
      return Promise.reject(new Error('bad-code'));
    }
    if (code === LTA.store.raw.deviceCode) {
      toast(LTA.i18n.t('toast.connectSelf'), 'warn');
      return Promise.reject(new Error('self'));
    }
    LTA.log.info('尝试连接 #' + code);
    return LTA.net.connectCode(code).then(function (link) {
      primaryPeer = link.code;
      LTA.log.ok('连接成功 #' + link.code);
      renderAll();
      return link;
    }).catch(function (err) {
      LTA.log.warn('连接失败 #' + code, err && err.message);
      toast(LTA.i18n.t('toast.connectFail', { code: code }), 'error');
      throw err;
    });
  }

  /* ================= 扫描 ================= */
  var scanFailed = false;

  function startScan(deep) {
    if (LTA.scanner.running) return;
    if (!LTA.net.peer) {
      toast(LTA.i18n.t('err.signal'), 'error');
      return;
    }
    if (els.scanMeter) els.scanMeter.hidden = false;
    if (els.btnScan) els.btnScan.disabled = true;
    LTA.scanner.start({
      deep: !!deep,
      progress: function (p) {
        if (els.scanBar) els.scanBar.style.width = p.pct + '%';
        if (!els.scanText) return;
        els.scanText.textContent = p.quick
          ? LTA.i18n.t('connect.querying')
          : LTA.i18n.t('connect.scanning', { pct: p.pct, n: p.scanned });
      },
      paused: function (isPaused) {
        // 恢复后不手写数字，交给下一次 progress 覆盖，避免闪一下 0
        if (isPaused && els.scanText) els.scanText.textContent = LTA.i18n.t('connect.scanPaused');
      },
      found: function (item) {
        upsertFound(item);
        LTA.log.info('发现设备 #' + item.code + (item.name ? ' · ' + item.name : ''));
      },
      done: function (r) {
        if (els.btnScan) {
          els.btnScan.disabled = false;
          els.btnScan.textContent = r.failed ? LTA.i18n.t('connect.deepScan') : LTA.i18n.t('connect.rescan');
        }
        if (els.scanText) {
          els.scanText.textContent = r.failed
            ? LTA.i18n.t('connect.queryFail')
            : LTA.i18n.t('connect.scanDone', { n: r.found });
        }
        if (r.failed && !deep) {
          scanFailed = true;
          toast(LTA.i18n.t('connect.queryFail'), 'warn');   // 只提示一次，不刷屏
        }
        if (!r.failed) scanFailed = false;
      }
    });
  }

  function stopScan() {
    LTA.scanner.stop();
    if (els.btnScan) { els.btnScan.disabled = false; els.btnScan.textContent = LTA.i18n.t('connect.rescan'); }
  }

  /* ================= 传输队列 ================= */
  function stateLabel(rec) {
    switch (rec.state) {
      case 'waiting': return rec.note || LTA.i18n.t('transfer.waiting');
      case 'preparing': return LTA.i18n.t('transfer.preparing');
      case 'paused': return LTA.i18n.t('transfer.paused');
      case 'done': return LTA.i18n.t('transfer.done');
      case 'error': return rec.note || LTA.i18n.t('transfer.failed');
      case 'rejected': return LTA.i18n.t('transfer.rejected');
      case 'canceled': return LTA.i18n.t('transfer.cancelled');
      default: return '';
    }
  }

  function renderTransfers() {
    if (!els.transferList) return;
    var items = LTA.transfer.items;
    if (els.transferEmpty) els.transferEmpty.hidden = items.length > 0;
    if (els.transferNotice) els.transferNotice.hidden = !LTA.transfer.hasActive();

    els.transferList.innerHTML = '';
    items.slice().reverse().forEach(function (rec) {
      var pct = rec.size ? Math.min(100, Math.round((rec.doneBytes / rec.size) * 100)) : 0;
      var li = document.createElement('li');
      li.className = 'titem';
      li.dataset.state = rec.state;

      var head = document.createElement('div');
      head.className = 'titem-head';
      var name = document.createElement('span');
      name.className = 'titem-name';
      name.textContent = rec.name;
      name.title = rec.name;
      var size = document.createElement('span');
      size.className = 'titem-size';
      size.textContent = LTA.store.formatBytes(rec.size);
      head.appendChild(name);
      head.appendChild(size);

      var bar = document.createElement('div');
      bar.className = 'bar';
      var fill = document.createElement('i');
      fill.style.width = pct + '%';
      bar.appendChild(fill);

      var meta = document.createElement('div');
      meta.className = 'titem-meta';
      var left = document.createElement('span');
      var who = rec.dir === 'out'
        ? LTA.i18n.t('transfer.sendTo', { name: rec.peerName })
        : LTA.i18n.t('transfer.fromName', { name: rec.peerName });
      var detail = stateLabel(rec);
      if (rec.state === 'active') {
        detail += ' · ' + pct + '%';
        if (rec.speed) detail += ' · ' + LTA.i18n.t('transfer.speed', { speed: LTA.store.formatBytes(rec.speed) });
      }
      left.textContent = who + ' · ' + detail;
      meta.appendChild(left);

      var actions = document.createElement('div');
      actions.className = 'titem-actions';

      if (rec.dir === 'out' && (rec.state === 'active' || rec.state === 'waiting')) {
        actions.appendChild(makeAction(LTA.i18n.t('transfer.pause'), function () { LTA.transfer.pause(rec.id); }));
      }
      if (rec.dir === 'out' && rec.state === 'paused') {
        actions.appendChild(makeAction(LTA.i18n.t('transfer.resume'), function () { LTA.transfer.resume(rec.id); }));
      }
      if (rec.state === 'active' || rec.state === 'waiting' || rec.state === 'paused') {
        var cancelBtn = makeAction(LTA.i18n.t('transfer.cancel'), function () { LTA.transfer.cancel(rec.id); });
        cancelBtn.classList.add('btn-danger');
        actions.appendChild(cancelBtn);
      }

      meta.appendChild(actions);
      li.appendChild(head);
      li.appendChild(bar);
      li.appendChild(meta);
      els.transferList.appendChild(li);
    });
  }

  function makeAction(label, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost btn-sm';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  /* ================= 已连接设备 ================= */
  function renderPeers() {
    if (!els.peerList) return;
    els.peerList.innerHTML = '';
    var count = 0;
    LTA.net.links.forEach(function (link) {
      if (!link.isOpen()) return;
      count++;
      var li = document.createElement('li');
      li.className = 'list-item';
      li.innerHTML =
        '<div class="item-main">' +
        '  <div class="item-title">' + LTA.store.escapeHtml(link.name || LTA.i18n.t('common.unknown')) +
        (LTA.store.isTrusted(link.code) ? ' <span class="tag tag-trust">' + LTA.i18n.t('connect.trusted') + '</span>' : '') +
        '  </div>' +
        '  <div class="item-sub">#' + link.code + '</div>' +
        '</div>';
      var actions = document.createElement('div');
      actions.className = 'item-actions';

      var chatBtn = makeAction(LTA.i18n.t('connect.btnChat'), function () {
        switchPanel('chat');
        LTA.chat.open('d:' + link.code);
        renderChat();
      });
      chatBtn.classList.add('btn-outline');

      var discBtn = makeAction(LTA.i18n.t('peers.disconnect'), function () {
        link.close();
        setTimeout(renderAll, 60);
      });

      actions.appendChild(chatBtn);
      actions.appendChild(discBtn);
      li.appendChild(actions);
      els.peerList.appendChild(li);
    });
    if (els.peerEmpty) els.peerEmpty.hidden = count > 0;
  }

  /* ================= 聊天 ================= */
  function renderConvList() {
    if (!els.convList) return;
    var list = LTA.chat.convs();
    els.convList.innerHTML = '';
    if (els.convEmpty) els.convEmpty.hidden = list.length > 0;

    list.forEach(function (c) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'conv-item' + (LTA.chat.activeId === c.id ? ' is-active' : '');
      var initial = c.kind === 'group' ? 'G' : (c.code || '?').slice(0, 2);
      btn.innerHTML =
        '<span class="conv-avatar">' + initial + '</span>' +
        '<span class="conv-meta">' +
        '  <span class="conv-name">' + LTA.store.escapeHtml(c.title) + '</span>' +
        '  <span class="conv-sub"></span>' +
        '</span>';
      btn.querySelector('.conv-sub').textContent = c.lastText
        ? c.lastText
        : (c.kind === 'group' ? ('#' + c.code) : ('#' + c.code));
      if (c.unread) {
        var badge = document.createElement('span');
        badge.className = 'conv-badge';
        badge.textContent = String(c.unread);
        btn.appendChild(badge);
      } else {
        var dot = document.createElement('span');
        dot.className = 'conv-dot' + (c.online ? '' : ' is-off');
        btn.appendChild(dot);
      }
      btn.addEventListener('click', function () {
        LTA.chat.open(c.id);
        renderChat();
      });
      li.appendChild(btn);
      els.convList.appendChild(li);
    });
  }

  function renderChatHeader() {
    var conv = LTA.chat.activeId ? LTA.chat.convs().filter(function (c) { return c.id === LTA.chat.activeId; })[0] : null;
    if (els.chatTitle) {
      els.chatTitle.textContent = conv ? conv.title : LTA.i18n.t('chat.noConv');
    }
    if (els.chatSub) {
      if (!conv) els.chatSub.textContent = '';
      else if (conv.kind === 'group') els.chatSub.textContent = '#' + conv.code + ' · ' + LTA.i18n.t('chat.memberOnline', { n: conv.onlineCount || 0 });
      else els.chatSub.textContent = (conv.online ? '● ' : '○ ') + '#' + conv.code;
    }
    if (els.btnChatQr) els.btnChatQr.disabled = !conv;
    if (els.btnChatMembers) els.btnChatMembers.disabled = !conv || conv.kind !== 'group';
  }

  function renderMessages() {
    if (!els.msgList) return;
    var conv = LTA.chat.activeId;
    var list = conv ? LTA.chat.messages(conv) : [];
    if (els.chatEmpty) els.chatEmpty.hidden = list.length > 0;

    var html = '';
    list.forEach(function (m) {
      var mine = m.from === LTA.net.me.code || m.from === 'me';
      var time = new Date(m.ts || Date.now());
      var hh = String(time.getHours()).padStart(2, '0');
      var mm = String(time.getMinutes()).padStart(2, '0');
      var who = mine ? LTA.i18n.t('chat.you') : (m.fromName || ('#' + (m.from || '')));

      var body = '';
      if (m.kind === 'audio' && m.audio) {
        body = '<div class="msg-audio">' +
          '<audio controls preload="none" src="' + LTA.store.escapeHtml(m.audio.url) + '"></audio>' +
          '<span class="audio-dur">' + (m.audio.dur || 0) + '"</span>' +
          '</div>';
      } else if (m.kind === 'file' && m.file) {
        body = '<div class="msg-file">' +
          '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h6l4 4V20.5H7z"/><path d="M13 3.5v4h4"/></svg>' +
          '<span>' + LTA.store.escapeHtml(m.file.name) + ' · ' + LTA.store.formatBytes(m.file.size) + '</span>' +
          '</div>';
      } else {
        body = '<div class="msg-bubble">' + LTA.store.escapeHtml(m.text || '') + '</div>';
      }

      html += '<li class="msg ' + (mine ? 'msg-mine' : 'msg-theirs') + '">' +
        '<div class="msg-head"><span>' + LTA.store.escapeHtml(who) + '</span><span>' + hh + ':' + mm + '</span></div>' +
        body +
        '</li>';
    });

    els.msgList.innerHTML = html;
    // 保留滚动位置：只有本来就在底部时才自动贴底
    els.msgScroll.scrollTop = els.msgScroll.scrollHeight;
  }

  function renderMembers() {
    if (!els.chatMembers) return;
    var conv = LTA.chat.activeId;
    if (!conv || conv.indexOf('g:') !== 0) {
      els.chatMembers.hidden = true;
      return;
    }
    var code = conv.slice(2);
    var members = LTA.chat.membersOf(code);
    els.chatMembers.innerHTML = '';
    members.forEach(function (m) {
      var pill = document.createElement('span');
      pill.className = 'member-pill' + (m.online ? '' : ' is-off');
      pill.innerHTML = '<i></i>' + LTA.store.escapeHtml(m.name || ('#' + (m.code || '')));
      els.chatMembers.appendChild(pill);
    });
    els.chatMembers.hidden = false;
  }

  function renderChat() {
    renderConvList();
    renderChatHeader();
    renderMessages();
    renderMembers();
  }

  /* ================= 日志 ================= */
  function renderLog() {
    if (!els.logList) return;
    var entries = LTA.log.entries();
    els.logList.innerHTML = '';
    if (els.logEmpty) els.logEmpty.hidden = entries.length > 0;
    entries.slice().reverse().forEach(function (e) {
      var li = document.createElement('li');
      li.className = 'log-row';
      li.dataset.level = e.level;
      li.innerHTML = '<span class="log-time">' + e.time + '</span><span class="log-text"></span>';
      li.querySelector('.log-text').textContent = e.text + (e.detail ? ' · ' + e.detail : '');
      els.logList.appendChild(li);
    });
  }

  /* ================= 二维码 ================= */
  function showQR(kind, code, title) {
    var box = els.qrBox;
    if (!box) return;
    box.innerHTML = '';
    var base = (location.protocol === 'file:' || location.origin === 'null')
      ? 'https://transferassistant.leleleling.site/'
      : location.origin + location.pathname;
    var url = base + (kind === 'group' ? '?group=' + code : '?code=' + code);
    var text = url;

    try {
      if (typeof qrcode !== 'undefined') {
        var qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        var svg = box.querySelector('svg');
        if (svg) { svg.setAttribute('width', '100%'); svg.removeAttribute('height'); }
      } else {
        box.innerHTML = '<p class="hint">' + LTA.store.escapeHtml(text) + '</p>';
      }
    } catch (e) {
      box.innerHTML = '<p class="hint">' + LTA.store.escapeHtml(text) + '</p>';
      LTA.log.warn('二维码生成失败', e && e.message);
    }

    if (els.qrTitle) els.qrTitle.textContent = title || LTA.i18n.t('qr.title');
    if (els.qrCodeLine) els.qrCodeLine.textContent = code;
    if (els.qrSub) els.qrSub.textContent = kind === 'group' ? LTA.i18n.t('qr.hintGroup') : LTA.i18n.t('qr.hintDevice');
    document.getElementById('dlg-qr').showModal();
  }

  /* ================= 对话框：连接 / 文件 ================= */
  function bindDialogs() {
    els.dlgConnect = $('dlg-connect');
    els.dlgFile = $('dlg-file');

    LTA.net.setAskHandlers({
      connect: function (link) {
        return new Promise(function (resolve) {
          if (els.dcBody) {
            els.dcBody.textContent = LTA.i18n.t('incoming.body', {
              name: link.name || LTA.i18n.t('common.unknown'),
              code: link.code || '----'
            });
          }
          var dlg = els.dlgConnect;
          dlg.returnValue = '';
          dlg.addEventListener('close', function handler() {
            dlg.removeEventListener('close', handler);
            var value = dlg.returnValue;
            dlg.returnValue = '';
            resolve(value === 'accept');
          }, { once: true });
          dlg.showModal();
        });
      },
      file: askFile
    });
  }

  /* ================= 摄像头扫码 ================= */
  var scanQrState = { stream: null, raf: 0, active: false, onCode: null };

  function stopScanQr() {
    scanQrState.active = false;
    if (scanQrState.raf) { cancelAnimationFrame(scanQrState.raf); scanQrState.raf = 0; }
    if (scanQrState.stream) {
      scanQrState.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      scanQrState.stream = null;
    }
    var video = $('scanqr-video');
    if (video) { try { video.pause(); video.srcObject = null; } catch (e) {} }
  }

  function extractCode(text) {
    if (!text) return null;
    var m = String(text).match(/(?:code=)(\d{4})/);
    if (m) return m[1];
    if (/^\d{4}$/.test(text.trim())) return text.trim();
    var m2 = String(text).match(/\/(\d{4})(?:$|[?#])/);
    if (m2) return m2[1];
    return null;
  }

  function openScanQr() {
    var dlg = $('dlg-scanqr');
    var video = $('scanqr-video');
    var hint = $('scanqr-hint');
    if (!dlg || !video) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (hint) hint.textContent = LTA.i18n.t('scanQr.unsupported');
      toast(LTA.i18n.t('scanQr.unsupported'), 'warn');
      return;
    }

    dlg.returnValue = '';
    dlg.addEventListener('close', stopScanQr, { once: true });
    stopScanQr();
    dlg.showModal();

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(function (stream) {
        scanQrState.stream = stream;
        scanQrState.active = true;
        video.srcObject = stream;
        return video.play().catch(function () {});
      })
      .then(function () {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        var detector = ('BarcodeDetector' in window) ? new BarcodeDetector({ formats: ['qr_code'] }) : null;

        function tick() {
          if (!scanQrState.active) return;
          if (video.readyState >= 2 && video.videoWidth) {
            var w = video.videoWidth, h = video.videoHeight;
            canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);

            function handle(text) {
              var code = extractCode(text);
              if (!code) return false;
              stopScanQr();
              try { dlg.close(); } catch (e) {}
              var input = $('in-code');
              if (input) input.value = code;
              toast(LTA.i18n.t('scanQr.got', { code: code }), 'ok');
              doConnect(code).catch(function () {});
              return true;
            }

            if (detector) {
              detector.detect(canvas).then(function (codes) {
                for (var i = 0; i < codes.length; i++) {
                  if (handle(codes[i].rawValue)) return;
                }
                scanQrState.raf = requestAnimationFrame(tick);
              }).catch(function () { scanQrState.raf = requestAnimationFrame(tick); });
            } else if (typeof jsQR !== 'undefined') {
              var data = ctx.getImageData(0, 0, w, h);
              var found = jsQR(data.data, w, h, { inversionAttempts: 'dontInvert' });
              if (found && handle(found.data)) return;
              scanQrState.raf = requestAnimationFrame(tick);
            }
          } else {
            scanQrState.raf = requestAnimationFrame(tick);
          }
        }
        scanQrState.raf = requestAnimationFrame(tick);
      })
      .catch(function () {
        if (hint) hint.textContent = LTA.i18n.t('scanQr.denied');
        toast(LTA.i18n.t('scanQr.denied'), 'warn');
      });
  }

  function askFile(rec) {
    return new Promise(function (resolve) {
      var body = els.dfBody;
      if (body) {
        body.textContent = LTA.i18n.t('incomingFile.bodyOne', {
          name: rec.peerName || LTA.i18n.t('common.unknown'),
          file: rec.name,
          size: LTA.store.formatBytes(rec.size)
        });
      }
      var dlg = els.dlgFile;
      dlg.returnValue = '';
      dlg.addEventListener('close', function handler() {
        dlg.removeEventListener('close', handler);
        var value = dlg.returnValue;
        dlg.returnValue = '';
        resolve(value === 'accept');
      }, { once: true });
      dlg.showModal();
    });
  }

  /* ================= 事件绑定 ================= */
  function bind() {
    els = {
      hdCode: $('hd-code'),
      myCode: $('my-code'),
      myStatus: $('my-status'),
      inName: $('in-name'),
      swHidden: $('sw-hidden'),
      hiddenHint: $('hidden-hint'),
      foundList: $('found-list'),
      foundCount: $('found-count'),
      foundEmpty: $('found-empty'),
      scanMeter: $('scan-meter'),
      scanBar: $('scan-bar'),
      scanText: $('scan-text'),
      btnScan: $('btn-scan'),
      btnScanQr: $('btn-scanqr'),
      btnScanStop: $('btn-scan-stop'),
      transferList: $('transfer-list'),
      transferEmpty: $('transfer-empty'),
      transferNotice: $('transfer-notice'),
      peerList: $('peer-list'),
      peerEmpty: $('peer-empty'),
      convList: $('conv-list'),
      convEmpty: $('conv-empty'),
      chatTitle: $('chat-title'),
      chatSub: $('chat-sub'),
      chatMembers: $('chat-members'),
      msgScroll: $('msg-scroll'),
      msgList: $('msg-list'),
      chatEmpty: $('chat-empty'),
      recorderBar: $('recorder-bar'),
      recTime: $('rec-time'),
      recBar: $('rec-bar'),
      inMsg: $('in-msg'),
      logList: $('log-list'),
      logEmpty: $('log-empty'),
      qrBox: $('qr-box'),
      qrTitle: $('qr-title'),
      qrCodeLine: $('qr-code-line'),
      qrSub: $('qr-sub'),
      dcBody: $('dc-body'),
      dfBody: $('df-body'),
      toastRegion: $('toast-region'),
      groupError: $('group-error'),
      fileInput: $('file-input'),
      chatFileInput: $('chat-file-input')
    };

    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchPanel(tab.dataset.panel); });
    });

    // 设备码 / 名称
    ['btn-mycode', 'btn-code-qr'].forEach(function (id) {
      var b = $(id);
      if (b) b.addEventListener('click', function () {
        showQR('device', LTA.store.raw.deviceCode, LTA.i18n.t('qr.mine'));
      });
    });
    var btnQrSelf = $('btn-qr-self');
    if (btnQrSelf) btnQrSelf.addEventListener('click', function () {
      showQR('device', LTA.store.raw.deviceCode, LTA.i18n.t('qr.mine'));
    });

    if (els.inName) {
      els.inName.addEventListener('input', function () {
        LTA.store.patch({ deviceName: els.inName.value.slice(0, 18) });
        LTA.net.refreshMeta();
      });
    }

    if (els.swHidden) els.swHidden.addEventListener('click', function () {
      var next = !LTA.store.raw.hidden;
      LTA.store.patch({ hidden: next });
      LTA.net.init();
      renderDevice();
      LTA.log.info(next ? '已开启不可查找模式（真实地址 44' + LTA.store.raw.deviceCode + '）' : '已关闭不可查找模式');
    });

    // 连接表单
    var form = $('form-connect');
    if (form) form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var code = ($('in-code').value || '').replace(/\D/g, '').slice(0, 4);
      if (!code) return;
      doConnect(code).catch(function () {});
    });

    if (els.btnScan) els.btnScan.addEventListener('click', function () {
      if (LTA.scanner.running) stopScan(); else startScan(scanFailed);
    });
    if (els.btnScanQr) els.btnScanQr.addEventListener('click', openScanQr);
    if (els.btnScanStop) els.btnScanStop.addEventListener('click', stopScan);

    // 传输
    var dropzone = $('dropzone');
    if (dropzone) {
      dropzone.addEventListener('click', function () { els.fileInput.click(); });
      dropzone.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); els.fileInput.click(); }
      });
      ['dragenter', 'dragover'].forEach(function (t) {
        dropzone.addEventListener(t, function (ev) {
          ev.preventDefault();
          dropzone.classList.add('is-over');
        });
      });
      ['dragleave', 'drop'].forEach(function (t) {
        dropzone.addEventListener(t, function (ev) {
          ev.preventDefault();
          dropzone.classList.remove('is-over');
        });
      });
      dropzone.addEventListener('drop', function (ev) {
        var files = ev.dataTransfer && ev.dataTransfer.files;
        if (files && files.length) sendToPrimary(files);
      });
    }
    if (els.fileInput) els.fileInput.addEventListener('change', function () {
      if (els.fileInput.files && els.fileInput.files.length) sendToPrimary(els.fileInput.files);
      els.fileInput.value = '';
    });

    var btnClearDone = $('btn-clear-finished');
    if (btnClearDone) btnClearDone.addEventListener('click', function () {
      LTA.transfer.clearFinished();
      renderTransfers();
    });

    // 蓝牙 / 分享
    var btnShare = $('btn-share-files');
    if (btnShare) btnShare.addEventListener('click', function () {
      LTA.bt.shareFiles(LTA.transfer.lastPicked || []).catch(function () {});
    });

    var btnGatt = $('btn-gatt');
    if (btnGatt) btnGatt.addEventListener('click', function () {
      LTA.bt.connectGatt().catch(function () {});
    });

    // 聊天
    var formChat = $('form-chat');
    if (formChat) formChat.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var text = els.inMsg.value;
      var res = LTA.chat.sendText(text);
      if (res.ok) {
        els.inMsg.value = '';
        renderChat();
      } else {
        toast(LTA.i18n.t('chat.nothingToSend'), 'warn');
      }
    });

    var btnAttach = $('btn-attach');
    if (btnAttach) btnAttach.addEventListener('click', function () {
      if (!LTA.chat.activeId) { toast(LTA.i18n.t('chat.nothingToSend'), 'warn'); return; }
      els.chatFileInput.click();
    });
    if (els.chatFileInput) els.chatFileInput.addEventListener('change', function () {
      var files = els.chatFileInput.files;
      if (files && files.length) {
        var res = LTA.chat.sendFiles(files);
        if (!res.ok) toast(LTA.i18n.t('toast.offline'), 'warn');
        renderChat();
      }
      els.chatFileInput.value = '';
    });

    var btnRecord = $('btn-record');
    if (btnRecord) btnRecord.addEventListener('click', toggleRecord);
    var btnRecStop = $('btn-rec-stop');
    if (btnRecStop) btnRecStop.addEventListener('click', function () { LTA.recorder.stop(); });

    // 群聊
    var btnNewGroup = $('btn-new-group');
    if (btnNewGroup) btnNewGroup.addEventListener('click', function () {
      var dlg = $('dlg-group');
      els.groupError.hidden = true;
      $('in-group-code').value = '';
      $('in-group-name').value = '';
      dlg.showModal();
    });

    var formGroup = $('form-group');
    if (formGroup) formGroup.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var code = ($('in-group-code').value || '').replace(/\D/g, '');
      if (!/^\d{4}$/.test(code)) {
        els.groupError.textContent = LTA.i18n.t('group.badCode');
        els.groupError.hidden = false;
        return;
      }
      var name = ($('in-group-name').value || '').trim();
      $('dlg-group').close();
      var wasExisting = LTA.chat.convs().some(function (c) { return c.id === 'g:' + code; });
      LTA.chat.joinGroup(code, name).then(function (result) {
        toast(LTA.i18n.t(result === 'hub' ? 'chat.groupCreated' : 'chat.groupJoined', { code: code }), 'ok');
        switchPanel('chat');
        LTA.chat.open('g:' + code);
        renderAll();
      }).catch(function () {
        toast(LTA.i18n.t('chat.groupFailed'), 'error');
      });
    });

    var btnGroupCancel = $('btn-group-cancel');
    if (btnGroupCancel) btnGroupCancel.addEventListener('click', function () { $('dlg-group').close(); });

    var btnChatMembers = $('btn-chat-members');
    if (btnChatMembers) btnChatMembers.addEventListener('click', function () {
      var conv = LTA.chat.activeId;
      if (!conv) return;
      var members = LTA.chat.membersOf(conv.slice(2));
      var names = members.map(function (m) { return (m.online ? '● ' : '○ ') + (m.name || ('#' + (m.code || ''))); });
      toast(names.join('   ') || LTA.i18n.t('chat.noConv'), 'info');
      renderMembers();
    });

    var btnChatQr = $('btn-chat-qr');
    if (btnChatQr) btnChatQr.addEventListener('click', function () {
      var conv = LTA.chat.activeId;
      if (!conv) return;
      if (conv.indexOf('g:') === 0) showQR('group', conv.slice(2), LTA.i18n.t('chat.qr'));
      else showQR('device', conv.slice(2), LTA.i18n.t('qr.mine'));
    });

    var btnLogClear = $('btn-log-clear');
    if (btnLogClear) btnLogClear.addEventListener('click', function () {
      LTA.log.clear();
      renderLog();
    });
  }

  function sendToPrimary(files) {
    LTA.transfer.lastPicked = Array.prototype.slice.call(files);
    var target = null;
    if (primaryPeer) {
      LTA.net.links.forEach(function (l) { if (l.code === primaryPeer && l.isOpen()) target = l; });
    }
    if (!target) {
      LTA.net.links.forEach(function (l) { if (!target && l.isOpen()) target = l; });
    }
    if (!target) {
      toast(LTA.i18n.t('peers.empty'), 'warn');
      return;
    }
    primaryPeer = target.code;
    LTA.transfer.sendFiles(target, files);
    renderTransfers();
  }

  /* ---------- 录音 ---------- */
  var recStartAt = 0;
  function toggleRecord() {
    if (LTA.recorder.isRecording()) { LTA.recorder.stop(); return; }
    if (!LTA.chat.activeId) { toast(LTA.i18n.t('chat.nothingToSend'), 'warn'); return; }

    var started = LTA.recorder.start({
      onTick: function (elapsed, max) {
        if (els.recorderBar) els.recorderBar.hidden = false;
        if (els.recTime) els.recTime.textContent = (elapsed / 1000).toFixed(1) + 's / ' + (max / 1000) + 's';
        if (els.recBar) els.recBar.style.width = Math.min(100, (elapsed / max) * 100) + '%';
      },
      onDone: function (res) {
        if (els.recorderBar) els.recorderBar.hidden = true;
        if (els.recBar) els.recBar.style.width = '0%';
        LTA.chat.sendAudio(res.blob, res.duration).then(function (r) {
          if (!r.ok) {
            toast(r.reason === 'too-large' ? LTA.i18n.t('chat.tooLong') : LTA.i18n.t('chat.nothingToSend'), 'warn');
          }
          renderChat();
        });
      },
      onError: function () {
        if (els.recorderBar) els.recorderBar.hidden = true;
        toast(LTA.i18n.t('chat.micDenied'), 'warn');
      }
    });

    if (started) {
      if (els.recorderBar) els.recorderBar.hidden = false;
      toast(LTA.i18n.t('chat.recording') + ' · ' + LTA.i18n.t('chat.tooLong'), 'info');
    }
  }

  /* ================= 渲染全部 ================= */
  function renderAll() {
    renderDevice();
    renderFound();
    renderTransfers();
    renderPeers();
    renderChat();
    renderStatus(LTA.net.status);
  }

  LTA.ui = {
    bind: bind,
    bindDialogs: bindDialogs,
    renderAll: renderAll,
    renderDevice: renderDevice,
    renderFound: renderFound,
    renderTransfers: renderTransfers,
    renderPeers: renderPeers,
    renderChat: renderChat,
    renderLog: renderLog,
    renderStatus: renderStatus,
    switchPanel: switchPanel,
    toast: toast,
    doConnect: doConnect,
    upsertFound: upsertFound,
    showQR: showQR,
    askFile: askFile,
    sendToPrimary: sendToPrimary,
    get primaryPeer() { return primaryPeer; }
  };
})(window.LTA = window.LTA || {});
