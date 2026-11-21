self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch (_) { d = { title: 'Grok Bot · now', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Grok Bot · now', { body: d.body || '', icon: 'icons/icon-192.png', data: { url: d.url } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url;
  if (url) e.waitUntil(self.clients.openWindow(url));
});
