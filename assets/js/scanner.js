/* =========================================================================
   scanner —— 遍历 0000–9999 探测在线设备
   参数：并发 16，单个探测超时 800ms。探测只建立“发现”级链路（不弹确认）。
   链路抖动导致的失败不算“已扫过”，会进补扫队列，避免整表假阴性。
   ========================================================================= */
(function (LTA) {
  'use strict';

  var CONCURRENCY = 16;
  var PROBE_TIMEOUT = 800;
  var TOTAL = 10000;
  var MAX_RETRY_ROUND = 3;

  var running = false;
  var stopped = false;
  var queue = [];
  var retry = [];
  var round = 0;
  var scanned = 0;          // 拿到确定答案的号码数
  var active = 0;
  var foundCount = 0;
  var waiting = false;

  var hooks = { progress: null, found: null, done: null, paused: null };
  var lastEmit = 0;

  function pad(n) { return String(n).padStart(4, '0'); }

  function ready() {
    return !!(LTA.net.peer && LTA.net.peer.open && !LTA.net.peer.disconnected && LTA.net.status === 'online');
  }

  function progress(force) {
    var now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    var pct = scanned / TOTAL * 100;
    pct = pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
    if (hooks.progress) hooks.progress({ pct: pct, scanned: scanned, found: foundCount });
  }

  function fillQueue() {
    queue = [];
    for (var i = 0; i < TOTAL; i++) queue.push(pad(i));
  }

  /* 一次探测结束：确定答案才计数；抖动失败进补扫队列 */
  function settle(link, code, transient) {
    active--;

    if (transient) {
      if (round < MAX_RETRY_ROUND) retry.push(code);
    } else {
      scanned++;
    }

    if (link) {
      foundCount++;
      if (hooks.found) {
        try {
          hooks.found({
            code: code,
            peerId: LTA.net.idFor(code, false),
            name: link.name || '',
            hidden: false,
            link: link
          });
        } catch (e) { console.warn(e); }
      }
    }

    progress(!!link);

    if (stopped) {
      if (active === 0) finish();
      return;
    }
    step();
  }

  function step() {
    if (stopped) return;

    if (!ready()) {
      if (!queue.length && !retry.length && active === 0) { finish(); return; }
      if (!waiting) {
        waiting = true;
        if (hooks.paused) hooks.paused(true);
        LTA.log.warn('信令暂时断开，扫描暂停，恢复后自动继续');
      }
      setTimeout(step, 500);
      return;
    }
    if (waiting) {
      waiting = false;
      if (hooks.paused) hooks.paused(false);
    }

    while (!stopped && active < CONCURRENCY && queue.length) {
      var code = queue.shift();

      if (code === LTA.net.me.code) { scanned++; progress(); continue; }

      active++;
      (function (c) {
        LTA.net.probe(LTA.net.idFor(c, false), PROBE_TIMEOUT)
          .then(function (link) { settle(link, c, false); })
          .catch(function () { settle(null, c, true); });
      })(code);
    }

    if (!queue.length && active === 0) {
      if (retry.length && round < MAX_RETRY_ROUND) {
        round++;
        queue = retry.slice();
        retry = [];
        LTA.log.info('补扫第 ' + round + ' 轮，剩余 ' + queue.length + ' 个号码');
        setTimeout(step, 300);
        return;
      }
      finish();
    }
  }

  function finish() {
    if (!running) return;
    running = false;
    stopped = false;
    waiting = false;
    queue = [];
    retry = [];
    progress(true);
    if (hooks.done) hooks.done({ found: foundCount, scanned: scanned });
    LTA.log.ok('扫描结束，共发现 ' + foundCount + ' 台设备（有效探测 ' + scanned + ' 个号码）');
  }

  /* ---------------- 快速查找：向 internal 名册要在线名单 ---------------- */
  function startQuick(opts) {
    hooks = Object.assign({ progress: null, found: null, done: null, paused: null }, opts || {});
    running = true;
    stopped = false;
    foundCount = 0;
    scanned = 0;
    LTA.log.info('向 internal 名册查询在线设备');
    progress(true);

    return LTA.registry.query().then(function (items) {
      var mine = LTA.store && LTA.store.raw ? LTA.store.raw.deviceCode : '';
      (items || []).forEach(function (it) {
        if (!it || !it.code) return;
        if (String(it.code) === String(mine)) return;   // 自己不算“附近设备”
        foundCount++;
        scanned++;
        if (hooks.found) {
          try {
            hooks.found({ code: it.code, peerId: it.id || ('i' + it.code), name: it.name || '', hidden: !!it.hidden });
          } catch (e) {}
        }
      });
      running = false;
      progress(true);
      if (hooks.done) hooks.done({ found: foundCount, scanned: scanned, quick: true });
      LTA.log.ok('名册返回 ' + foundCount + ' 台在线设备');
      return { found: foundCount, quick: true };
    }).catch(function () {
      running = false;
      if (hooks.done) hooks.done({ found: 0, scanned: 0, quick: true, failed: true });
      return { found: 0, quick: true, failed: true };
    });
  }

  function start(opts) {
    if (running) return false;

    // 默认只问 internal 名册（秒出结果）；名册不可用时明确失败，全表扫描必须显式触发
    if (!opts || !opts.deep) {
      return startQuick(opts);
    }

    hooks = Object.assign({ progress: null, found: null, done: null, paused: null }, opts || {});
    running = true;
    stopped = false;
    waiting = false;
    round = 0;
    scanned = 0;
    active = 0;
    foundCount = 0;
    retry = [];
    lastEmit = 0;
    fillQueue();

    if (!LTA.net.peer) {
      running = false;
      LTA.log.warn('连接层还没就绪，无法扫描，请先确认已上线');
      return false;
    }

    LTA.log.info('开始扫描 0000–9999（并发 ' + CONCURRENCY + '，超时 ' + PROBE_TIMEOUT + 'ms）');
    progress(true);
    step();
    return true;
  }

  function stop() {
    if (!running) return;
    stopped = true;
    queue = [];
    retry = [];
    LTA.log.info('扫描已手动停止');
    if (active === 0) finish();
  }

  LTA.scanner = {
    start: start,
    startQuick: startQuick,
    stop: stop,
    CONCURRENCY: CONCURRENCY,
    PROBE_TIMEOUT: PROBE_TIMEOUT,
    TOTAL: TOTAL,
    get running() { return running; }
  };
})(window.LTA = window.LTA || {});
