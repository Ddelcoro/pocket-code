/* Pocket Code SW — cache the shell, never the API; handle push notifications */
const V = 'pc-v192';
const SHELL = ['/theme.js?v=192', '/', '/release.json?v=192', '/app.css?v=192', '/app.js?v=192', '/cli-updates.js?v=192', '/workspace.js?v=192', '/sidechat.js?v=192', '/projects.js?v=192', '/documents.js?v=192', '/links.js?v=192', '/tasks.js?v=192', '/coordination.js?v=192', '/inbox.js?v=192', '/vault.js?v=192', '/secret-detect.js?v=192', '/phrases.js?v=192', '/approvals.js?v=192', '/split.js?v=192', '/tips.js?v=192', '/format.js?v=192', '/voice-text.js?v=192', '/voice.js?v=192', '/voice-worklet.js?v=192', '/vendor/marked.js?v=192', '/vendor/purify.js?v=192', '/manifest.webmanifest', '/icon-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname.startsWith('/share/')) return; // network only; documents are never cached
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && e.request.method === 'GET') {
        const copy = r.clone();
        caches.open(V).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })) // split-view panes load /?pane=1
  );
});

self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { }
  const opts = {
    body: d.body || '',
    tag: d.tag || 'pc',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/', ...(d.vaultRequest ? { vaultRequest: String(d.vaultRequest) } : {}), ...(d.snooze && typeof d.snooze === 'object' ? { snooze: d.snooze } : {}) },
  };
  // 1.41: a Vault request carries Allow and Deny, answered from the notification without opening Pocket.
  // 1.50: a due task or reminder carries Tomorrow (and Done for a task), answered the same way.
  if (Array.isArray(d.actions) && d.actions.length) opts.actions = d.actions.filter(a => a && a.action && a.title).map(a => ({ action: String(a.action), title: String(a.title) }));
  // 1.50: the count of due items on the app icon, when this device asked for it (the server sends it only then).
  // 1.50.2: set after the notification is shown and guarded, so a browser that refuses the badge never costs the notification.
  const setBadge = () => { if (typeof d.badge !== 'number' || !('setAppBadge' in self.navigator)) return; try { const p = d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge(); return p && p.catch(() => {}); } catch { } };
  e.waitUntil(self.registration.showNotification(d.title || 'Pocket Code', opts).then(setBadge, setBadge));
});
// 1.89: a notification opens only a page on Pocket's own origin; any other link (//host, /\host, a full outside address)
// opens Pocket's start page instead, whichever server code sent the push.
const ownPage = url => { try { const u = new URL(url, self.location.origin); return u.origin === self.location.origin ? u.href : '/'; } catch { return '/'; } };
const openUrl = url => clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
  url = ownPage(url);
  // split-view panes are window clients too; open the notification in the top-level window
  for (const c of list) if (c.frameType !== 'nested' && 'focus' in c) { c.navigate(url); return c.focus(); }
  return clients.openWindow(url);
});
// Allow answers once (never Always allow from a lock screen); Deny denies. If the answer does not land, Pocket opens at
// that request and says why (1.93, Damon): signed out, the Vault locked, already answered or expired, or offline.
const missedWhy = status => status === 401 || status === 403 ? 'signin' : status === 423 ? 'locked' : status === 404 || status === 409 ? 'gone' : 'error';
const answerVault = (request, action, url) => {
  const missed = why => openUrl('/#/vault/request/' + encodeURIComponent(request) + '?missed=' + why + '&tap=' + (action === 'allow' ? 'allow' : 'deny'));
  return fetch('/api/vault/act', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'answer', request, decision: action === 'allow' ? 'once' : 'deny' }),
  }).then(r => { if (!r.ok) return missed(missedWhy(r.status)); }, () => missed('offline'));
};
// 1.50: Tomorrow moves a due task or project reminder to 9 AM tomorrow in this device's zone; Done finishes a task.
// Both go through the ordinary routes with the signed-in cookie; if the answer does not land, Pocket opens instead.
const tomorrowNine = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); };
const post = (path, body) => fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const answerDue = (snooze, action, url) => {
  const req = snooze.task && !snooze.project
    ? post('/api/tasks/act', action === 'done' ? { action: 'update', task: snooze.task, done: true } : { action: 'update', task: snooze.task, dueAt: tomorrowNine() })
    : post('/api/board/act', { action: 'remind', project: snooze.project, at: tomorrowNine(), task: snooze.task || undefined, text: snooze.label || '' });
  return req.then(r => { if (!r.ok) return openUrl(url); }, () => openUrl(url));
};
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {}, url = data.url || '/';
  if ((e.action === 'allow' || e.action === 'deny') && data.vaultRequest) { e.waitUntil(answerVault(data.vaultRequest, e.action, url)); return; }
  if ((e.action === 'later' || e.action === 'done') && data.snooze) { e.waitUntil(answerDue(data.snooze, e.action, url)); return; }
  e.waitUntil(openUrl(url));
});
