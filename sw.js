self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Pulsify', {
      body:  data.body  || '',
      icon:  '/favicon.ico',
      badge: '/favicon.ico',
      tag:   data.tag   || 'pulsify',
      data:  { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const target = event.notification.data?.url || '/';
      const match  = wins.find(w => w.url.startsWith(self.location.origin));
      if (match) { match.focus(); match.navigate(target); }
      else        clients.openWindow(target);
    })
  );
});
