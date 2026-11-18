/* =========================================================================
   i18n —— 轻量多语言框架（中文 / English）
   用法：
     LTA.i18n.t('key', {n: 3})
     LTA.i18n.apply(root)     // 把 data-i18n / data-i18n-ph / data-i18n-label 刷一遍
   新增语言只需在 STRINGS 里加一列。
   ========================================================================= */
(function (LTA) {
  'use strict';

  var STRINGS = {
    zh: {
      'a11y.skip': '跳到主要内容',
      'brand.name': '了了了传输助手',
      'nav.transfer': '文件传输',
      'nav.chat': '聊天',
      'nav.log': '运行日志',
      'common.close': '关闭',
      'common.cancel': '取消',
      'common.confirm': '确定',
      'common.copy': '复制',
      'common.copied': '已复制',
      'common.unknown': '未知设备',

      'device.title': '我的设备',
      'device.codeLabel': '设备码',
      'device.nameLabel': '设备名称',
      'device.namePlaceholder': '给这台设备起个名字',
      'device.codeHint': '设备码自动分配且固定不变，告诉对方或让对方扫码即可连接。',
      'device.randomCode': '随机换码',
      'device.showQr': '我的二维码',
      'device.hidden': '不可查找模式',
      'device.hiddenHint': '开启后，别人扫描附近设备不会发现你；但知道你 4 位码的人手动输入仍能连上。',
      'device.statusConnecting': '正在建立',
      'device.statusOnline': '已上线',
      'device.statusOffline': '离线',
      'device.statusError': '连接异常',
      'device.defaultName': '我的设备',

      'connect.title': '连接设备',
      'connect.inputPlaceholder': '输入 4 位设备码',
      'connect.btn': '连接',
      'connect.scanBtn': '扫描附近设备',
      'connect.scanQr': '扫码连接',
      'connect.deepScan': '强制全表扫描',
      'toast.codeReplaced': '设备码 #{old} 已被占用，已自动换成 #{code}',
      'connect.querying': '正在查询在线名单…',
      'connect.queryFail': '在线名单暂时拿不到，稍后再试',
      'connect.rescan': '重新扫描',
      'connect.stop': '停止',
      'connect.scanning': '扫描中 {pct}% · 已探测 {n}/10000',
      'connect.scanDone': '扫完，发现 {n} 台',
      'scanQr.title': '扫码连接',
      'scanQr.hint': '把对方的二维码放进框里，识别后会自动填入设备码并发起连接。',
      'scanQr.unsupported': '这个浏览器不支持摄像头扫码',
      'scanQr.denied': '没拿到摄像头权限，可以在浏览器设置里允许后再试',
      'scanQr.got': '识别到设备码 {code}，正在连接…',
      'connect.scanPaused': '扫描暂停：正在等信令恢复…',
      'connect.scanHint': '向 internal 在线名单要结果，通常一两秒；拿不到时可改用全表扫描。仅同一局域网 / 同一信令有效。',
      'connect.nearby': '附近设备',
      'connect.empty': '还没有发现设备。先扫描，或直接输入对方的 4 位码。',
      'connect.trusted': '信任设备',
      'connect.connecting': '连接中…',
      'connect.connected': '已连接',
      'connect.btnConnect': '连接',
      'connect.btnChat': '聊天',

      'transfer.title': '传输队列',
      'transfer.clearFinished': '清除已完成',
      'transfer.drop': '拖文件到这里，或点击选择文件',
      'transfer.dropHint': '支持多文件同时传 · 电脑与手机互通 · 单块 500KB 可断点续传',
      'transfer.empty': '暂无传输任务。',
      'transfer.keepOpen': '传输过程中请不要关闭页面，未完成的文件会丢失。',
      'transfer.pause': '暂停',
      'transfer.resume': '继续',
      'transfer.cancel': '取消',
      'transfer.speed': '{speed}/秒',
      'transfer.waiting': '等待对方确认…',
      'transfer.preparing': '准备中…',
      'transfer.paused': '已暂停',
      'transfer.done': '已完成',
      'transfer.failed': '失败',
      'transfer.rejected': '对方拒绝了',
      'transfer.cancelled': '已取消',
      'transfer.eta': '剩余 {time}',
      'transfer.chunk': '分块 {i}/{n}',
      'transfer.sendTo': '发给 {name}',
      'transfer.fromName': '来自 {name}',
      'transfer.unknownError': '传输中断，请重试',

      'peers.title': '已连接',
      'peers.empty': '还没有连接任何设备。',
      'peers.disconnect': '断开',

      'bt.title': '蓝牙 / 系统分享',
      'bt.hint': '没网或网速很差时，用系统分享把文件发给对方（AirDrop、蓝牙、附近分享都在这里）。',
      'bt.share': '系统分享发送文件',
      'bt.gatt': '连接 BLE 设备',
      'bt.gattHint': '浏览器无法自己当蓝牙外设，所以网页之间不能直连蓝牙。要走蓝牙请用上面的系统分享。',
      'bt.pickFirst': '请先选择要分享的文件。',
      'bt.unsupported': '这台设备或浏览器不支持系统分享，可以改用局域网传输。',
      'bt.gattNoDevice': '没有找到可用的蓝牙设备。',

      'chat.title': '聊天',
      'chat.noConv': '选择一个会话',
      'chat.noConvHint': '连接一台设备，或在右上角创建 / 加入群聊，就能开始发消息、传文件和录音。',
      'chat.noConvList': '先连接设备，或创建一个群聊。',
      'chat.inputPlaceholder': '说点什么…',
      'chat.send': '发送',
      'chat.members': '成员',
      'chat.qr': '群二维码',
      'chat.stopRecord': '停止并发送',
      'chat.recording': '录音中',
      'chat.tooLong': '录音最长 60 秒',
      'chat.micDenied': '麦克风权限被拒绝，无法录音。',
      'chat.noMic': '这台设备没有可用的麦克风。',
      'chat.nothingToSend': '还没有可以发送的会话。',
      'chat.you': '我',
      'chat.group': '群聊',
      'chat.memberOnline': '{n} 人在线',
      'chat.leave': '退出',
      'chat.groupJoined': '已加入群聊 {code}',
      'chat.groupCreated': '已创建群聊 {code}',
      'chat.groupFailed': '群聊建立失败，换个群号再试。',
      'chat.inviteHint': '把群号或二维码发给对方，就能拉人进群。',

      'group.title': '群聊',
      'group.hint': '群号与设备码是两套号码。任何成员都能当节点，一个人掉线其他人还能继续聊。',
      'group.codeLabel': '群号（4 位数字）',
      'group.codePlaceholder': '例如 2048',
      'group.nameLabel': '群名称',
      'group.namePlaceholder': '例如 客厅局域网',
      'group.join': '加入',
      'group.badCode': '群号需要 4 位数字。',
      'group.notFound': '暂时连不上这个群，确认群号后再试一次。',

      'logo.title': '',

      'log.title': '运行日志',
      'log.hint': '这里记录发生了什么。看不懂没关系，出问题时把这行文字发给对方即可。',
      'log.clear': '清空',
      'log.empty': '暂无日志。',

      'settings.title': '设置',
      'settings.appearance': '外观与语言',
      'settings.theme': '外观',
      'settings.themeSystem': '跟随系统',
      'settings.themeLight': '浅色',
      'settings.themeDark': '深色',
      'settings.lang': '语言',
      'settings.langAuto': '自动',
      'settings.permission': '连接与文件',
      'settings.acceptConnect': '陌生设备可直接连接',
      'settings.acceptFile': '陌生设备可直接传文件',
      'settings.contacts': '信任设备',
      'settings.contactsHint': '信任设备发来的文件和消息不再弹确认。数据只存在这台设备的浏览器里。',
      'settings.contactsEmpty': '暂无信任设备。',
      'settings.remove': '移除',
      'settings.trust': '设为信任',
      'settings.signal': '信令服务',
      'settings.signalHint': '默认用公共 PeerJS 服务建立握手。自己架了服务器的话填在这里，内网也可以用自己的地址。',
      'settings.signalHost': '主机',
      'settings.signalPort': '端口',
      'settings.signalPath': '路径',
      'settings.signalKey': 'Key',
      'settings.data': '本地数据',
      'settings.clearChat': '清空聊天记录',
      'settings.reset': '恢复默认设置',
      'settings.dataHint': '联系人、聊天记录、设置都保存在本机浏览器。清缓存或换浏览器会丢失。',
      'settings.close': '完成',
      'settings.saved': '设置已保存',
      'settings.clearChatDone': '聊天记录已清空',
      'settings.resetDone': '已恢复默认设置',

      'qr.title': '扫码连接',
      'qr.mine': '我的设备码',
      'qr.group': '群号',
      'qr.hintDevice': '让对方用相机或扫码工具扫描，会自动打开这个页面。',
      'qr.hintGroup': '扫到的人打开页面后输入这个群号即可进群。',

      'incoming.title': '有设备请求连接',
      'incoming.reject': '拒绝',
      'incoming.accept': '允许连接',
      'incoming.body': '「{name}」想连接到这台设备（设备码 {code}）。允许后双方可以互传文件和聊天。',
      'incoming.trustHint': '在设置里把对方加入信任设备，下次就不再弹窗。',

      'incomingFile.title': '对方要发文件给你',
      'incomingFile.accept': '接收',
      'incomingFile.body': '「{name}」想发送 {n} 个文件，共 {size}。接收后请不要关闭页面。',
      'incomingFile.bodyOne': '「{name}」想发送文件「{file}」（{size}）。接收后请不要关闭页面。',

      'toast.idTaken': '设备码 {code} 已被占用，请换一个。',
      'toast.offline': '网络看起来不通，可以试试蓝牙 / 系统分享。',
      'toast.slowNet': '当前网速很慢，大文件建议改用系统分享或靠近路由器。',
      'toast.copied': '已复制到剪贴板',
      'toast.connectFail': '没连上 {code}，确认对方在线、号码没输错。',
      'toast.connectSelf': '这是你自己的设备码。',
      'toast.disconnected': '与 {name} 的连接断开了。',
      'toast.installed': '已安装到桌面',
      'toast.updateReady': '有新版本，点一下即可更新。',
      'toast.offlineReady': '离线缓存就绪，断网也能打开。',
      'toast.fileSaved': '文件已保存到下载目录',
      'toast.warnClose': '传输未完成，关闭页面会丢失进度。',

      'err.title': '出了点小问题',
      'err.browserIdTaken': '这个设备码刚刚被别的设备抢走了，换一个随机码就好。',
      'err.signal': '连接不上信令服务。可能是网络被限制，或者需要自己搭一个信令服务器。',
      'err.peerUnavailable': '对方不在线，或者号码输错了。',
      'err.browserIncompatible': '这个浏览器不支持网页点对点传输，建议换 Chrome、Edge 或 Safari 新版本。',
      'err.notSecure': '网页需要在 https 或 localhost 下才能传文件。',
      'err.generic': '操作没成功，请再试一次。',

      'unit.b': 'B', 'unit.kb': 'KB', 'unit.mb': 'MB', 'unit.gb': 'GB',
      'unit.sec': '秒', 'unit.min': '分', 'unit.hour': '小时'
    },

    en: {
      'a11y.skip': 'Skip to main content',
      'brand.name': 'Lelele Transfer Assistant',
      'nav.transfer': 'Transfer',
      'nav.chat': 'Chat',
      'nav.log': 'Logs',
      'common.close': 'Close',
      'common.cancel': 'Cancel',
      'common.confirm': 'Confirm',
      'common.copy': 'Copy',
      'common.copied': 'Copied',
      'common.unknown': 'Unknown device',

      'device.title': 'This device',
      'device.codeLabel': 'Code',
      'device.nameLabel': 'Device name',
      'device.namePlaceholder': 'Name this device',
      'device.codeHint': 'Your code is assigned automatically and stays fixed. Share it or let the other device scan your QR code.',
      'device.randomCode': 'New code',
      'device.showQr': 'My QR code',
      'device.hidden': 'Unlisted mode',
      'device.hiddenHint': 'Others will not find you when scanning, but anyone who knows your 4-digit code can still connect.',
      'device.statusConnecting': 'Connecting',
      'device.statusOnline': 'Online',
      'device.statusOffline': 'Offline',
      'device.statusError': 'Connection error',
      'device.defaultName': 'My device',

      'connect.title': 'Connect',
      'connect.inputPlaceholder': 'Enter 4-digit code',
      'connect.btn': 'Connect',
      'connect.scanBtn': 'Scan nearby',
      'connect.scanQr': 'Scan QR',
      'connect.deepScan': 'Full sweep instead',
      'toast.codeReplaced': '#{old} was taken — switched to #{code}',
      'connect.querying': 'Asking the online roster…',
      'connect.queryFail': 'Roster unavailable, try again later',
      'connect.rescan': 'Scan again',
      'connect.stop': 'Stop',
      'connect.scanning': 'Scanning {pct}% · {n}/10000 probed',
      'connect.scanDone': 'Done · {n} found',
      'scanQr.title': 'Scan QR code',
      'scanQr.hint': 'Put the other device\'s QR code in the frame. The device code is filled in and we connect automatically.',
      'scanQr.unsupported': 'This browser cannot use the camera to scan',
      'scanQr.denied': 'Camera permission denied — allow it in your browser settings and retry',
      'scanQr.got': 'Found device #{code}, connecting…',
      'connect.scanPaused': 'Scan paused: waiting for signaling…',
      'connect.scanHint': 'Asks the internal roster — usually a second or two. If it is unreachable, switch to a full sweep. Same LAN / same signaling only.',
      'connect.nearby': 'Nearby devices',
      'connect.empty': 'Nothing found yet. Scan, or type the other device code.',
      'connect.trusted': 'Trusted',
      'connect.connecting': 'Connecting…',
      'connect.connected': 'Connected',
      'connect.btnConnect': 'Connect',
      'connect.btnChat': 'Chat',

      'transfer.title': 'Transfers',
      'transfer.clearFinished': 'Clear finished',
      'transfer.drop': 'Drop files here, or click to pick',
      'transfer.dropHint': 'Multiple files · phone to computer · 500KB chunks, resumable',
      'transfer.empty': 'No transfers yet.',
      'transfer.keepOpen': 'Keep this page open while transferring, unfinished files are lost.',
      'transfer.pause': 'Pause',
      'transfer.resume': 'Resume',
      'transfer.cancel': 'Cancel',
      'transfer.speed': '{speed}/s',
      'transfer.waiting': 'Waiting for approval…',
      'transfer.preparing': 'Preparing…',
      'transfer.paused': 'Paused',
      'transfer.done': 'Done',
      'transfer.failed': 'Failed',
      'transfer.rejected': 'Rejected',
      'transfer.cancelled': 'Cancelled',
      'transfer.eta': '{time} left',
      'transfer.chunk': 'Chunk {i}/{n}',
      'transfer.sendTo': 'To {name}',
      'transfer.fromName': 'From {name}',
      'transfer.unknownError': 'Transfer interrupted, try again',

      'peers.title': 'Connected',
      'peers.empty': 'No device connected yet.',
      'peers.disconnect': 'Disconnect',

      'bt.title': 'Bluetooth / share sheet',
      'bt.hint': 'When there is no network or it is very slow, hand files over with the system share sheet (AirDrop, Bluetooth, Nearby Share).',
      'bt.share': 'Share files via system',
      'bt.gatt': 'Connect BLE device',
      'bt.gattHint': 'A browser cannot act as a Bluetooth peripheral, so two web pages cannot talk over Bluetooth. Use the share sheet above for Bluetooth.',
      'bt.pickFirst': 'Pick the files to share first.',
      'bt.unsupported': 'This device or browser has no share sheet. Use LAN transfer instead.',
      'bt.gattNoDevice': 'No usable Bluetooth device found.',

      'chat.title': 'Chat',
      'chat.noConv': 'Pick a conversation',
      'chat.noConvHint': 'Connect a device, or create / join a group from the top right, then send messages, files and voice notes.',
      'chat.noConvList': 'Connect a device or create a group first.',
      'chat.inputPlaceholder': 'Say something…',
      'chat.send': 'Send',
      'chat.members': 'Members',
      'chat.qr': 'Group QR',
      'chat.stopRecord': 'Stop & send',
      'chat.recording': 'Recording',
      'chat.tooLong': 'Voice notes are capped at 60s',
      'chat.micDenied': 'Microphone permission denied.',
      'chat.noMic': 'No usable microphone on this device.',
      'chat.nothingToSend': 'No conversation to send to yet.',
      'chat.you': 'Me',
      'chat.group': 'Group',
      'chat.memberOnline': '{n} online',
      'chat.leave': 'Leave',
      'chat.groupJoined': 'Joined group {code}',
      'chat.groupCreated': 'Created group {code}',
      'chat.groupFailed': 'Could not start the group, try another code.',
      'chat.inviteHint': 'Send the group code or QR to invite people.',

      'group.title': 'Group',
      'group.hint': 'Group codes are separate from device codes. Every member can act as a node, so one dropout does not end the chat.',
      'group.codeLabel': 'Group code (4 digits)',
      'group.codePlaceholder': 'e.g. 2048',
      'group.nameLabel': 'Group name',
      'group.namePlaceholder': 'e.g. Living room',
      'group.join': 'Join',
      'group.badCode': 'Group code must be 4 digits.',
      'group.notFound': 'Cannot reach that group, check the code and try again.',

      'log.title': 'Logs',
      'log.hint': 'A plain record of what happened. If something breaks, send this line to the other side.',
      'log.clear': 'Clear',
      'log.empty': 'Nothing logged yet.',

      'settings.title': 'Settings',
      'settings.appearance': 'Look & language',
      'settings.theme': 'Appearance',
      'settings.themeSystem': 'System',
      'settings.themeLight': 'Light',
      'settings.themeDark': 'Dark',
      'settings.lang': 'Language',
      'settings.langAuto': 'Auto',
      'settings.permission': 'Connections & files',
      'settings.acceptConnect': 'Accept unknown devices automatically',
      'settings.acceptFile': 'Accept files from unknown devices automatically',
      'settings.contacts': 'Trusted devices',
      'settings.contactsHint': 'Files and messages from trusted devices skip the prompt. Stored only in this browser.',
      'settings.contactsEmpty': 'No trusted device yet.',
      'settings.remove': 'Remove',
      'settings.trust': 'Trust',
      'settings.signal': 'Signaling',
      'settings.signalHint': 'Defaults to the public PeerJS service. If you host your own server, fill it in here — even on a LAN.',
      'settings.signalHost': 'Host',
      'settings.signalPort': 'Port',
      'settings.signalPath': 'Path',
      'settings.signalKey': 'Key',
      'settings.data': 'Local data',
      'settings.clearChat': 'Clear chat history',
      'settings.reset': 'Reset settings',
      'settings.dataHint': 'Contacts, chats and settings live in this browser. Clearing the cache or switching browsers loses them.',
      'settings.close': 'Done',
      'settings.saved': 'Settings saved',
      'settings.clearChatDone': 'Chat history cleared',
      'settings.resetDone': 'Settings restored',

      'qr.title': 'Scan to connect',
      'qr.mine': 'My device code',
      'qr.group': 'Group code',
      'qr.hintDevice': 'Scan it with a camera; the page opens automatically.',
      'qr.hintGroup': 'Anyone who scans it can type this group code to join.',

      'incoming.title': 'A device wants to connect',
      'incoming.reject': 'Reject',
      'incoming.accept': 'Allow',
      'incoming.body': '“{name}” wants to connect to this device (code {code}). Once allowed you can exchange files and messages.',
      'incoming.trustHint': 'Add it to trusted devices in settings to skip this next time.',

      'incomingFile.title': 'Incoming files',
      'incomingFile.accept': 'Accept',
      'incomingFile.body': '“{name}” wants to send {n} files, {size} in total. Keep this page open after accepting.',
      'incomingFile.bodyOne': '“{name}” wants to send “{file}” ({size}). Keep this page open after accepting.',

      'toast.idTaken': 'Code {code} is taken, pick another one.',
      'toast.offline': 'Looks like there is no network — try Bluetooth / share sheet.',
      'toast.slowNet': 'The link is slow; for big files use the share sheet or move closer to the router.',
      'toast.copied': 'Copied to clipboard',
      'toast.connectFail': 'Could not reach {code}. Check the device is online and the code is right.',
      'toast.connectSelf': 'That is this device’s own code.',
      'toast.disconnected': 'Connection with {name} dropped.',
      'toast.installed': 'Installed',
      'toast.updateReady': 'A new version is ready — tap to update.',
      'toast.offlineReady': 'Offline cache ready, the app opens without network.',
      'toast.fileSaved': 'File saved to downloads',
      'toast.warnClose': 'Transfer unfinished — closing the page loses progress.',

      'err.title': 'Something went wrong',
      'err.browserIdTaken': 'Another device just took this code. Pick a random one.',
      'err.signal': 'Cannot reach the signaling service. The network may block it, or you may need your own server.',
      'err.peerUnavailable': 'The other device is offline, or the code is wrong.',
      'err.browserIncompatible': 'This browser does not support peer-to-peer web transfer. Try a recent Chrome, Edge or Safari.',
      'err.notSecure': 'The page must run on https or localhost to transfer files.',
      'err.generic': 'That did not work, please try again.',

      'unit.b': 'B', 'unit.kb': 'KB', 'unit.mb': 'MB', 'unit.gb': 'GB',
      'unit.sec': 's', 'unit.min': 'min', 'unit.hour': 'h'
    }
  };

  var listeners = [];
  var current = 'zh';

  function normalize(lang) {
    if (!lang) return 'zh';
    var l = String(lang).toLowerCase();
    if (l.indexOf('zh') === 0) return 'zh';
    if (l.indexOf('en') === 0) return 'en';
    return 'en';
  }

  function resolve(setting) {
    if (setting === 'zh' || setting === 'en') return setting;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'zh';
    return normalize(nav);
  }

  function format(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
    });
  }

  function t(key, vars) {
    var table = STRINGS[current] || STRINGS.zh;
    var s = table[key];
    if (s === undefined) s = (STRINGS.zh[key] !== undefined ? STRINGS.zh[key] : key);
    return format(s, vars);
  }

  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (!k) return;
      el.textContent = t(k);
    });
    root.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    root.querySelectorAll('[data-i18n-label]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-label')));
    });
  }

  function set(setting) {
    current = resolve(setting);
    document.documentElement.lang = current === 'zh' ? 'zh-Hans' : 'en';
    apply();
    listeners.forEach(function (fn) { try { fn(current); } catch (e) {} });
  }

  LTA.i18n = {
    t: t,
    apply: apply,
    set: set,
    get lang() { return current; },
    onChange: function (fn) { listeners.push(fn); },
    normalize: normalize
  };
})(window.LTA = window.LTA || {});
