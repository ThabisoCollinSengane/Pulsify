const fs = require('fs');

const filePath = './feeds.html';
const content = fs.readFileSync(filePath, 'utf8');

const oldCode = `async function initFeed() {
  const sb = getSB();
  if (sb) {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) _sbUser = session.user;
    });
  }
  await render();
}`;

const newCode = `async function initFeed() {
  const sb = getSB();
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      _sbUser = session.user;
      if (!_uid) _uid = session.user.id;
    }
  }
  await render();
}`;

if (content.includes(oldCode)) {
  const result = content.replace(oldCode, newCode);
  fs.writeFileSync(filePath, result, 'utf8');
  console.log('feeds.html patched OK');
} else {
  console.error('ERROR: pattern not found in feeds.html - check backup');
}
