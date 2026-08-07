// ============================================================
// Craft Strike — Teste do servidor HTTP estático
// Verifica que o navegador consegue carregar todos os arquivos
// do cliente, que 404 funciona e que path-traversal é bloqueado.
// ============================================================

import { startServer } from '../server/index.js';

const PORT = 39131;
const { server } = await startServer(PORT, '127.0.0.1');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✔', l); } else { failed++; console.error('  ✘', l); } };

async function get(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, ct, body: await res.text() };
}

console.log('\n== Craft Strike: teste HTTP estático ==\n');

let r = await get('/');
ok(r.status === 200 && r.body.includes('Craft Strike'), 'GET / serve o index.html');
ok(r.ct.includes('text/html'), 'content-type html');

r = await get('/js/main.js');
ok(r.status === 200 && r.body.includes('import'), 'GET /js/main.js');
ok(r.ct.includes('javascript'), 'content-type js');

r = await get('/shared/physics.js');
ok(r.status === 200 && r.body.includes('movePlayer'), 'GET /shared/physics.js');
ok(r.ct.includes('javascript'), 'content-type js shared');

r = await get('/vendor/three.module.min.js');
ok(r.status === 200 && r.body.length > 100000, `Three.js vendor (${(r.body.length / 1024).toFixed(0)}KB)`);

r = await get('/style.css');
ok(r.status === 200 && r.ct.includes('css'), 'GET /style.css');

r = await get('/nada-existe.js');
ok(r.status === 404, 'arquivo inexistente → 404');

r = await get('/shared/../server/game.js');
ok(r.status === 403 || r.status === 404, 'path traversal bloqueado');

r = await get('/../../etc/passwd');
ok(r.status === 403 || r.status === 404, 'path traversal absoluto bloqueado');

server.close();
console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed === 0 ? 0 : 1);
