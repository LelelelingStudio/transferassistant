/* =========================================================================
   transfer —— 分块文件传输（500KB 逻辑块 + 64KB base64 帧）
   · 多文件并发（同时最多 2 个）
   · 暂停只丢弃“正在发的那一块”，恢复时重发该块，已收块保留
   · 接收端先落浏览器缓存，页面关闭即丢失（UI 会持续提醒）
   ========================================================================= */
(function (LTA) {
  'use strict';

  var CHUNK = 512 * 1024;         // 500KB
  var FRAME = 64 * 1024;          // 单帧 base64 字符数
  var MAX_ACTIVE = 2;             // 同时进行的文件数
  var BUFFER_LIMIT = 4 * 1024 * 1024;

  var items = [];                 // 对外列表
  var queue = [];
  var activeSlots = 0;
  var listeners = [];

  function emit() {
    listeners.forEach(function (fn) { try { fn(items); } catch (e) {} });
  }

  function uid() {
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- 编码工具 ---------- */
  function ab2b64(buf) {
    var bytes = new Uint8Array(buf);
    var out = [];
    var step = 8192;
    for (var i = 0; i < bytes.length; i += step) {
      out.push(String.fromCharCode.apply(null, bytes.subarray(i, i + step)));
    }
    return btoa(out.join(''));
  }

  function b642ab(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var out = new Uint8Array(len);
    for (var i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function waitBuffer(link) {
    return new Promise(function (resolve) {
      (function check() {
        if (!link.isOpen()) return resolve(false);
        if (link.buffered() < BUFFER_LIMIT) return resolve(true);
        setTimeout(check, 15);
      })();
    });
  }

  /* ---------- 记录 ---------- */
  function makeRecord(fields) {
    var rec = Object.assign({
      id: uid(),
      name: 'file',
      size: 0,
      type: '',
      dir: 'out',           // out / in
      state: 'waiting',     // waiting | active | paused | done | error | rejected | canceled
      doneBytes: 0,
      chunkIndex: 0,
      chunks: 0,
      speed: 0,
      peerName: '',
      peerCode: '',
      createdAt: Date.now(),
      note: ''
    }, fields);
    items.push(rec);
    emit();
    return rec;
  }

  function find(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function setState(rec, state, note) {
    rec.state = state;
    if (note !== undefined) rec.note = note;
    if (state === 'done' || state === 'error' || state === 'rejected' || state === 'canceled') {
      rec.speed = 0;
    }
    emit();
  }

  /* ---------- 发送 ---------- */
  function sendFiles(link, fileList) {
    if (!link || !link.isOpen()) {
      LTA.log.warn('没有可用连接，无法发送');
      return [];
    }
    var files = Array.prototype.slice.call(fileList || []);
    var made = [];
    files.forEach(function (file) {
      var rec = makeRecord({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        dir: 'out',
        link: link,
        peerName: link.name || link.code,
        peerCode: link.code,
        chunks: Math.ceil(file.size / CHUNK) || 1,
        file: file
      });
      made.push(rec);
      queue.push(rec);
    });
    LTA.log.info('准备发送 ' + made.length + ' 个文件，共 ' + LTA.store.formatBytes(
      made.reduce(function (s, r) { return s + r.size; }, 0)
    ));
    pump();
    return made;
  }

  function pump() {
    while (activeSlots < MAX_ACTIVE && queue.length) {
      var rec = queue.shift();
      if (!rec || !rec.link || !rec.link.isOpen()) {
        if (rec) setState(rec, 'error', LTA.i18n.t('transfer.unknownError'));
        continue;
      }
      activeSlots++;
      runSend(rec).catch(function (err) {
        if (rec.state !== 'canceled' && rec.state !== 'rejected') {
          setState(rec, 'error', LTA.log.humanize(err, 'transfer.unknownError'));
          LTA.log.error('发送失败：' + rec.name, err && err.message);
        }
      }).then(function () {
        activeSlots--;
        pump();
      });
    }
  }

  function runSend(rec) {
    var link = rec.link;
    return new Promise(function (resolve, reject) {
      rec.resolveAccept = resolve;
      rec.rejectAccept = reject;
      rec.state = 'waiting';
      rec.note = LTA.i18n.t('transfer.waiting');
      emit();
      LTA.net.send(link, {
        t: 'file-offer',
        id: rec.id,
        name: rec.name,
        size: rec.size,
        type: rec.type,
        chunks: rec.chunks,
        chunkSize: CHUNK,
        fromName: LTA.store.deviceLabel(),
        fromCode: LTA.net.me.code
      });
      LTA.log.info('已发出文件请求：' + rec.name);
    }).then(function () {
      return transmit(rec, link);
    });
  }

  function transmit(rec, link) {
    // 每次起循环都换一个 token，旧的循环发现 token 变了就自己退出
    var token = (rec._token || 0) + 1;
    rec._token = token;
    rec.state = 'active';
    rec.note = '';
    emit();

    function alive() { return rec._token === token; }

    function nextChunk() {
      if (!alive()) return Promise.reject(new Error('stale'));
      if (rec.state === 'canceled' || rec.state === 'error') return Promise.reject(new Error('canceled'));
      if (rec.state === 'paused') return Promise.reject(new Error('paused'));
      if (rec.chunkIndex >= rec.chunks) return Promise.resolve();

      var i = rec.chunkIndex;
      var offset = i * CHUNK;
      var slice = rec.file.slice(offset, Math.min(offset + CHUNK, rec.size));

      return readAsArrayBuffer(slice).then(function (buf) {
        var b64 = ab2b64(buf);
        var total = Math.max(1, Math.ceil(b64.length / FRAME));
        var seq = 0;

        function frame() {
          if (!alive()) return Promise.reject(new Error('stale'));
          if (rec.state === 'canceled') return Promise.reject(new Error('canceled'));
          if (rec.state === 'paused') return Promise.reject(new Error('paused'));
          if (!link.isOpen()) return Promise.reject(new Error('closed'));
          if (seq >= total) return waitAck(rec, i);
          return waitBuffer(link).then(function (ok) {
            if (!ok) return Promise.reject(new Error('closed'));
            LTA.net.send(link, {
              t: 'file-part',
              id: rec.id,
              i: i,
              seq: seq,
              total: total,
              data: b64.substr(seq * FRAME, FRAME)
            });
            seq++;
            var sentBytes = offset + Math.min((seq / total) * slice.size, slice.size);
            rec.doneBytes = Math.min(rec.size, Math.max(rec.doneBytes, sentBytes));
            return frame();
          });
        }

        return frame().then(function () {
          rec.chunkIndex = i + 1;
          return nextChunk();
        });
      });
    }

    return nextChunk().then(function () {
      LTA.net.send(link, { t: 'file-done', id: rec.id });
      rec.doneBytes = rec.size;
      setState(rec, 'done', LTA.i18n.t('transfer.done'));
      LTA.log.ok('发送完成：' + rec.name);
    }).catch(function (err) {
      if (err && err.message === 'stale') return;   // 被暂停/取消后的旧循环，交给新循环
      if (err && err.message === 'paused') {
        // 当前这块未确认，保留 chunkIndex 指向它，恢复时重发
        setState(rec, 'paused', LTA.i18n.t('transfer.paused'));
        return;
      }
      if (rec.state === 'canceled') return;
      if (rec.state === 'rejected') return;
      if (err && err.message === 'closed') {
        setState(rec, 'error', LTA.i18n.t('transfer.unknownError'));
        LTA.log.warn('连接中断，传输中止：' + rec.name);
        return;
      }
      throw err;
    });
  }

  function readAsArrayBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function waitAck(rec, index) {
    return new Promise(function (resolve, reject) {
      rec._ack = { index: index, resolve: resolve, reject: reject };
      // 速度采样
      sampleSpeed(rec);
    });
  }

  function sampleSpeed(rec) {
    var lastBytes = rec._lastBytes || 0;
    var lastTime = rec._lastTime || Date.now();
    var now = Date.now();
    var dt = (now - lastTime) / 1000;
    if (dt > 0.35) {
      rec.speed = Math.max(0, (rec.doneBytes - lastBytes) / dt);
      rec._lastBytes = rec.doneBytes;
      rec._lastTime = now;
      emit();
      if (rec.speed > 0 && rec.speed < 120 * 1024 && !rec._slowWarned) {
        rec._slowWarned = true;
        if (LTA.ui && LTA.ui.toast) LTA.ui.toast(LTA.i18n.t('toast.slowNet'), 'warn');
      }
    }
  }

  /* ---------- 接收 ---------- */
  function handleOffer(link, msg) {
    var trusted = LTA.store.isTrusted(msg.fromCode) || link.isTrusted;
    var uiReady = !!(LTA.ui && LTA.ui.askFile);
    var accept = trusted || LTA.store.raw.autoAcceptFile || !uiReady;

    var rec = makeRecord({
      id: msg.id,
      name: msg.name || 'file',
      size: Number(msg.size) || 0,
      type: msg.type || 'application/octet-stream',
      dir: 'in',
      state: accept ? 'active' : 'waiting',
      chunks: Number(msg.chunks) || 1,
      link: link,
      peerName: msg.fromName || link.name || msg.fromCode,
      peerCode: msg.fromCode || link.code,
      parts: new Map(),
      blobParts: []
    });

    LTA.log.info('收到文件请求：' + rec.name + '（' + LTA.store.formatBytes(rec.size) + '）');

    if (accept) {
      LTA.net.send(link, { t: 'file-accept', id: rec.id });
      attachIncoming(rec);
      if (LTA.ui && LTA.ui.toast) LTA.ui.toast(LTA.i18n.t('incomingFile.title') + ' · ' + rec.name, 'info');
    } else {
      LTA.ui.askFile(rec).then(function (ok) {
        if (ok) {
          LTA.net.send(link, { t: 'file-accept', id: rec.id });
          setState(rec, 'active');
          attachIncoming(rec);
        } else {
          LTA.net.send(link, { t: 'file-reject', id: rec.id });
          setState(rec, 'rejected', LTA.i18n.t('transfer.rejected'));
        }
      });
    }
  }

  function attachIncoming(rec) {
    rec.startedAt = Date.now();
    // 接收端不需要再把 link 当成可写目标，只做统计
    var tick = setInterval(function () {
      if (rec.state === 'done' || rec.state === 'error' || rec.state === 'rejected') {
        clearInterval(tick);
      }
      sampleSpeed(rec);
    }, 500);
  }

  function handlePart(link, msg) {
    var rec = find(msg.id);
    if (!rec || rec.dir !== 'in') return;
    if (rec.state !== 'active') return;

    var i = msg.i, seq = msg.seq, total = msg.total;
    var holder = rec.parts.get(i);
    if (!holder || seq === 0) {
      holder = { arr: new Array(total), n: 0, total: total };
      rec.parts.set(i, holder);
    }
    if (holder.arr[seq] === undefined) {
      holder.arr[seq] = msg.data;
      holder.n++;
    }

    // 字节进度用块序号推算，避免逐帧抖动
    rec.doneBytes = Math.min(rec.size, i * CHUNK);

    if (holder.n >= holder.total) {
      var b64 = holder.arr.join('');
      rec.parts.delete(i);
      if (i < rec.chunkIndex) {
        // 这一块此前已收全并入 blob（续传重发），只补 ack，不再追加
        LTA.net.send(link, { t: 'file-chunk-ack', id: rec.id, i: i });
        return;
      }
      try {
        rec.blobParts.push(b642ab(b64));
      } catch (e) {
        LTA.log.error('分块解码失败', e && e.message);
      }
      rec.chunkIndex = i + 1;
      rec.doneBytes = Math.min(rec.size, (i + 1) * CHUNK);
      LTA.net.send(link, { t: 'file-chunk-ack', id: rec.id, i: i });
      emit();
      if (!rec.keepOpen) { /* 首次收到块后开始提醒 */ }
      rec.keepOpen = true;
    }
  }

  function handleDone(link, msg) {
    var rec = find(msg.id);
    if (!rec || rec.dir !== 'in') return;

    var blob = new Blob(rec.blobParts, { type: rec.type });
    rec.blobParts = [];
    rec.doneBytes = rec.size;
    saveBlob(blob, rec.name);
    setState(rec, 'done', LTA.i18n.t('transfer.done'));
    LTA.net.send(link, { t: 'file-complete', id: rec.id });
    LTA.log.ok('接收完成：' + rec.name + '（' + LTA.store.formatBytes(blob.size) + '）');
    if (LTA.ui && LTA.ui.toast) LTA.ui.toast(LTA.i18n.t('toast.fileSaved') + ' · ' + rec.name, 'ok');
  }

  function saveBlob(blob, name) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name || 'file';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        a.remove();
      }, 4000);
    } catch (e) {
      LTA.log.error('保存文件失败', e && e.message);
    }
  }

  /* ---------- 控制 ---------- */
  function pause(id) {
    var rec = find(id);
    if (!rec || rec.dir !== 'out') return;
    if (rec.state !== 'active') return;

    rec._token = (rec._token || 0) + 1;      // 作废正在跑的发送循环
    rec.state = 'paused';
    rec.note = LTA.i18n.t('transfer.paused');
    if (rec._ack) {
      var a = rec._ack; rec._ack = null;
      try { a.reject(new Error('paused')); } catch (e) {}
    }
    emit();
    LTA.net.send(rec.link, { t: 'file-pause', id: rec.id });
    LTA.log.info('暂停：' + rec.name + '（当前块未确认，继续时重发）');
  }

  function resume(id) {
    var rec = find(id);
    if (!rec || rec.dir !== 'out') return;
    if (rec.state !== 'paused') return;
    if (!rec.link || !rec.link.isOpen()) {
      setState(rec, 'error', LTA.i18n.t('transfer.unknownError'));
      return;
    }
    rec._ack = null;
    rec.state = 'active';
    rec.note = '';
    emit();
    LTA.net.send(rec.link, { t: 'file-resume', id: rec.id });
    // 重新起一条发送循环，从尚未确认的那一块开始
    transmit(rec, rec.link).catch(function () {});
    LTA.log.info('继续：' + rec.name + '，从第 ' + (rec.chunkIndex + 1) + ' 块重发');
  }

  function cancel(id) {
    var rec = find(id);
    if (!rec) return;
    rec.state = 'canceled';
    rec.note = LTA.i18n.t('transfer.cancelled');
    emit();
    if (rec.link && rec.link.isOpen()) LTA.net.send(rec.link, { t: 'file-cancel', id: rec.id });
    if (rec.rejectAccept) { var r = rec.rejectAccept; rec.rejectAccept = null; r(new Error('canceled')); }
    LTA.log.info('取消：' + rec.name);
  }

  function clearFinished() {
    items = items.filter(function (r) {
      return !(r.state === 'done' || r.state === 'error' || r.state === 'rejected' || r.state === 'canceled');
    });
    emit();
  }

  function hasActive() {
    return items.some(function (r) {
      return r.state === 'active' || r.state === 'waiting' || r.state === 'paused';
    });
  }

  /* ---------- 注册协议 ---------- */
  LTA.net.onMessage('file-offer', handleOffer);

  LTA.net.onMessage('file-accept', function (link, msg) {
    var rec = find(msg.id);
    if (!rec || rec.dir !== 'out') return;
    if (rec.resolveAccept) { var r = rec.resolveAccept; rec.resolveAccept = null; r(); }
  });

  LTA.net.onMessage('file-reject', function (link, msg) {
    var rec = find(msg.id);
    if (!rec || rec.dir !== 'out') return;
    setState(rec, 'rejected', LTA.i18n.t('transfer.rejected'));
    if (rec.rejectAccept) { var r = rec.rejectAccept; rec.rejectAccept = null; r(new Error('rejected')); }
  });

  LTA.net.onMessage('file-part', handlePart);
  LTA.net.onMessage('file-done', handleDone);

  LTA.net.onMessage('file-chunk-ack', function (link, msg) {
    var rec = find(msg.id);
    if (!rec || rec.dir !== 'out') return;
    if (rec.state === 'paused' || rec.state === 'canceled') return;
    if (rec._ack && rec._ack.index === msg.i) {
      var ack = rec._ack;
      rec._ack = null;
      rec.doneBytes = Math.min(rec.size, (msg.i + 1) * CHUNK);
      sampleSpeed(rec);
      emit();
      ack.resolve();
    }
  });

  LTA.net.onMessage('file-complete', function (link, msg) {
    var rec = find(msg.id);
    if (!rec) return;
    LTA.log.ok('对方已确认收到：' + rec.name);
  });

  LTA.net.onMessage('file-cancel', function (link, msg) {
    var rec = find(msg.id);
    if (!rec) return;
    setState(rec, 'canceled', LTA.i18n.t('transfer.cancelled'));
    LTA.log.info('对方取消了传输：' + rec.name);
  });

  LTA.net.onMessage('file-pause', function (link, msg) {
    var rec = find(msg.id);
    if (!rec) return;
    rec.note = LTA.i18n.t('transfer.paused');
    if (rec.dir === 'in' && rec.state === 'active') rec.state = 'paused';
    emit();
  });

  LTA.net.onMessage('file-resume', function (link, msg) {
    var rec = find(msg.id);
    if (!rec) return;
    rec.note = '';
    if (rec.dir === 'in' && rec.state === 'paused') rec.state = 'active';
    emit();
  });

  LTA.transfer = {
    sendFiles: sendFiles,
    pause: pause,
    resume: resume,
    cancel: cancel,
    clearFinished: clearFinished,
    hasActive: hasActive,
    find: find,
    onChange: function (fn) { listeners.push(fn); },
    get items() { return items; },
    CHUNK: CHUNK
  };
})(window.LTA = window.LTA || {});
