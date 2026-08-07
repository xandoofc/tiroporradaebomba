
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { TICK_MS, TICK_RATE, GAME_NAME } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Montagem virtual de pastas: '/' -> public, '/shared/' -> shared
function resolvePath(urlPath) {
  let fsPath;
  if (urlPath === '/' ) fsPath = path.join(ROOT, 'public', 'index.html');
  else if (urlPath.startsWith('/shared/')) fsPath = path.join(ROOT, 'shared', urlPath.slice('/shared/'.length));
  else fsPath = path.join(ROOT, 'public', urlPath);
  const norm = path.normalize(fsPath);
  if (!norm.startsWith(ROOT)) return null; // anti path-traversal
  return norm;
}

export async function startServer(port = Number(process.env.PORT) || 3100, host = process.env.HOST || '0.0.0.0') {
  const game = new Game();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/') && pathname !== '/') pathname = pathname.slice(0, -1);

  const fsPath = resolvePath(pathname);
  if (!fsPath) { res.writeHead(403); res.end('Forbidden'); return; }
  const norm = path.normalize(fsPath);
  if (norm !== ROOT && !norm.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }

      let data;
      try {
        data = await readFile(fsPath);
      } catch {
        res.writeHead(404); res.end('Not found'); return;
      }
      const ext = path.extname(fsPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    } catch (err) {
      res.writeHead(500); res.end('Server error');
      console.error('[http]', err);
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  let nextId = 1;

  wss.on('connection', (ws) => {
    const id = nextId++;
    ws.id = id;
    ws.isAlive = true;

    ws.send(JSON.stringify({ t: 'welcome', id, cfg: { tickRate: TICK_RATE, game: GAME_NAME, map: 'Craft Complex' } }));

    const joinTimeout = setTimeout(() => {
      if (!ws.joined) { try { ws.close(); } catch {} }
    }, 10000);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      switch (msg.t) {
        case 'join': {
          if (ws.joined) return;
          ws.joined = true;
          clearTimeout(joinTimeout);
          const name = sanitizeName(msg.name);
          game.addPlayer(id, name);
          sendToAll({ t: 'roster', p: game.roster() });
          game.sysMsg(`${name} entrou no servidor`);
          console.log(`[+] ${name} (id ${id}) — ${wss.clients.size} jogadores`);
          break;
        }
        case 'input':
          game.applyInput(id, msg);
          break;
        case 'chat':
          if (ws.joined) game.chat(id, msg.m);
          break;
        case 'ping':
          ws.send(JSON.stringify({ t: 'pong', ts: msg.ts }));
          break;
        case 'respawn':
          if (ws.joined) game.forceRespawn(id);
          break;
      }
    });

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('close', () => {
      if (ws.joined) {
        const p = game.players.get(id);
        if (p) game.sysMsg(`${p.name} saiu do servidor`);
        game.removePlayer(id);
        sendToAll({ t: 'roster', p: game.roster() });
        console.log(`[-] saiu (id ${id}) — ${wss.clients.size} jogadores`);
      }
    });

    ws.on('error', () => {});
  });

  // heartbeats p/ limpar conexões mortas
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 5000);

  // loop do jogo: simula + transmite estado a 30 Hz
  let lastTick = Date.now();
  const loop = setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - lastTick) / 1000, 0.1);
    lastTick = now;
    game.tick(dt);
    broadcastState();
  }, TICK_MS);

  function sendToAll(obj) {
    const raw = JSON.stringify(obj);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) {
        if (ws.bufferedAmount > 1024 * 512) continue; // cliente lento: descarta
        ws.send(raw);
      }
    }
  }

  function broadcastState() {
    sendToAll({ s: game.buildState(), e: game.flushEvents() });
  }

  server.listen(port, host, () => {
    console.log(`\n  █▀▀ █▀█ █▀▀ █▀▀ ▀█▀ █ █▀ █▀█ █ █▀ █▀█`);
    console.log(`  █▄▄ █▀▄ ██▄ ██▄  █  █ ▄█ █▄█ █ ▄█ █▄█`);
    console.log(`\n  ${GAME_NAME} — FPS multiplayer pronto!`);
    console.log(`  ▶ Abra no navegador: http://localhost:${port}`);
    console.log(`  ▶ WebSocket: ws://${host}:${port}/ws  (tick ${TICK_RATE}Hz)\n`);
  });

  const shutdown = () => {
    clearInterval(loop);
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, wss, game };
}

function sanitizeName(name) {
  if (typeof name !== 'string') return 'Jogador';
  const clean = name.replace(/[<>&"\u0000-\u001f]/g, '').trim().slice(0, 16);
  return clean || 'Jogador';
}
