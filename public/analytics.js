(function () {
  var STORAGE_KEY = 'mb_session_id';
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'sid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  var sid;
  try {
    sid = localStorage.getItem(STORAGE_KEY);
    if (!sid) { sid = uuid(); localStorage.setItem(STORAGE_KEY, sid); }
  } catch (_) { sid = uuid(); }

  function track(event, meta) {
    try {
      var body = JSON.stringify({ event: event, sessionId: sid, meta: meta || null });
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon('/api/track', blob)) return;
      }
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
      }).catch(function () { });
    } catch (_) { }
  }

  window.MBAnalytics = { track: track, sessionId: sid };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { track('visit'); });
  } else {
    track('visit');
  }
})();
