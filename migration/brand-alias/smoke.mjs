// Read-only smoke tests. Usage: node smoke.mjs https://zeno.<brand>.workers.dev
const branded = (process.argv[2] || '').replace(/\/$/, '');
const legacy = 'https://zeno.rlaehdus2477.workers.dev';
if (!/^https:\/\/zeno\.[a-z0-9-]+\.workers\.dev$/.test(branded) || branded === legacy) {
  throw Error('Supply the new branded URL: https://zeno.<brand>.workers.dev');
}
const paths = ['/owner', '/hospital', '/api/ui-version', '/api/public/hospital-status'];
const get = async (base, path) => {
  const response = await fetch(base + path + '?alias_smoke=1', {
    headers: { 'User-Agent': 'ZENO-domain-migration-check/1.0', 'Cache-Control': 'no-cache' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error(base + path + ': HTTP ' + response.status);
  return { text: await response.text(), type: response.headers.get('content-type') || '' };
};
for (const path of paths) {
  const [oldResult, newResult] = await Promise.all([get(legacy, path), get(branded, path)]);
  if (path.startsWith('/api/')) {
    const oldData = JSON.parse(oldResult.text);
    const newData = JSON.parse(newResult.text);
    if (path === '/api/ui-version' &&
        (oldData.owner !== newData.owner || oldData.hospital !== newData.hospital)) {
      throw Error(path + ': public and branded UI versions disagree');
    }
    if (path.endsWith('hospital-status') && (!oldData.settings || !newData.settings)) {
      throw Error(path + ': missing settings payload');
    }
  } else {
    if (!oldResult.text.includes('ZENO') || !newResult.text.includes('ZENO')) {
      throw Error(path + ': ZENO UI marker missing');
    }
  }
  console.log('PASS', path, '(old and new)');
}
console.log('Read-only routing checks passed. Manual Android/PWA, login and booking tests still required.');
