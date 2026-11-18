/* =========================================================================
   record —— 语音消息（MediaRecorder，最长 60 秒，webm/opus）
   ========================================================================= */
(function (LTA) {
  'use strict';

  var MAX_MS = 60000;
  var media = null;
  var chunks = [];
  var startedAt = 0;
  var tickTimer = null;
  var stopTimer = null;
  var onTick = null;
  var onDone = null;
  var onError = null;
  var mime = '';

  function pickMime() {
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < list.length; i++) {
      if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }

  function isRecording() { return !!(media && media.state === 'recording'); }

  function start(opts) {
    opts = opts || {};
    onTick = opts.onTick || null;
    onDone = opts.onDone || null;
    onError = opts.onError || null;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      if (onError) onError(new Error('unsupported'));
      LTA.log.warn(LTA.i18n.t('chat.noMic'));
      return false;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      mime = pickMime();
      try {
        media = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch (e) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        LTA.log.error(LTA.i18n.t('chat.noMic'), e && e.message);
        if (onError) onError(e);
        return;
      }
      mime = media.mimeType || mime;

      chunks = [];
      media.ondataavailable = function (ev) {
        if (ev.data && ev.data.size) chunks.push(ev.data);
      };
      media.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var dur = Math.min(MAX_MS, Date.now() - startedAt) / 1000;
        var blob = new Blob(chunks, { type: mime || 'audio/webm' });
        clearTimers();
        LTA.log.info('录音结束，时长 ' + dur.toFixed(1) + 's，' + LTA.store.formatBytes(blob.size));
        if (onDone) onDone({ blob: blob, mime: mime || 'audio/webm', duration: dur });
        media = null;
      };
      media.onerror = function (e) {
        LTA.log.error('录音出错', e && (e.error && e.error.message));
        clearTimers();
        if (onError) onError(e);
      };

      media.start(250);
      startedAt = Date.now();
      LTA.log.info('开始录音');

      tickTimer = setInterval(function () {
        var elapsed = Date.now() - startedAt;
        if (onTick) onTick(elapsed, MAX_MS);
        if (elapsed >= MAX_MS) stop();
      }, 120);

      stopTimer = setTimeout(function () { stop(); }, MAX_MS + 60);
    }).catch(function (err) {
      LTA.log.warn(LTA.i18n.t('chat.micDenied'), err && err.message);
      if (onError) onError(err);
    });

    return true;
  }

  function clearTimers() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  }

  function stop() {
    if (!media) return;
    if (media.state === 'recording') {
      try { media.stop(); } catch (e) {}
    }
  }

  function abort() {
    onDone = null;
    clearTimers();
    if (media && media.state === 'recording') {
      try { media.stop(); } catch (e) {}
    } else {
      media = null;
    }
  }

  LTA.recorder = {
    start: start,
    stop: stop,
    abort: abort,
    isRecording: isRecording,
    MAX_MS: MAX_MS
  };
})(window.LTA = window.LTA || {});
