# 🎮 CRAFT STRIKE — Plano Técnico Completo

FPS multiplayer 3D no navegador, estilo **Valorant / Counter-Strike**, com visual **Minecraft** (modelos blocky), rodando em **Node.js + WebSockets + Three.js**. Modo **FFA (todos contra todos)**, **PvP infinito**, **respawn infinito**.

---

## 1. Visão geral

| Item | Decisão |
|---|---|
| Nome | Craft Strike |
| Modo de jogo | Free-For-All (todos contra todos), sem times, sem limite de partida |
| Progressão | Placard infinito (abates / mortes / K-D / streak), líder destacado |
| Respawn | Automático após 2,5s (botão "reaparecer agora" economiza ~1s) |
| Armas | AK-47, AWP (sniper), Desert Eagle, Faca |
| Mapa | "Craft Complex" — arena 64×64 com torres, escadas, passarelas e caixotes |
| Jogadores | Minecraft-style: cabeça/torso/braços/pernas blocky, cor por jogador |
| Server | Node.js + `ws` (única dependência), tick 30Hz, sem banco de dados |
| Cliente | Three.js r160 vendored (funciona offline), sem outras libs |

**Objetivos de experiência:** resposta de tiro instantânea (hitscan server-side), movimento estilo CS (aceleração/atrito/controle de ar), 60 FPS estáveis no cliente (mapa em 1 draw call, pools de efeitos, zero alocações em hot loops).

---

## 2. Arquitetura

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│        NAVEGADOR        │  WS    │           SERVIDOR           │
│                         │◄──────►│                              │
│  render.js (Three.js)   │  JSON  │  server/index.js (HTTP+WS)   │
│  main.js (orquestração) │        │  server/game.js (simulação)  │
│  models.js (3D blocky)  │        │                              │
│  hud.js / audio.js      │        │  Física compartilhada        │
│  net.js / input.js      │        │  shared/physics.js           │
│                         │        │  shared/map.js / weapons.js  │
└─────────────────────────┘        └──────────────────────────────┘
              ▲                                     ▲
              └───────── shared/*.js ───────────────┘
        (física 100% determinística: predição no
         cliente = simulação no servidor)
```

**Princípio central:** os módulos `shared/` (constantes, armas, mapa, física) são importados **tanto pelo servidor (Node ESM) quanto pelo cliente (navegador ESM)**. Isso garante que a predição local do cliente é matematicamente idêntica à simulação do servidor — a reconciliação nunca luta contra a física.

---

## 3. Autoridade e rede

### Modelo: servidor autoritativo + predição no cliente

- **Movimento:** o cliente envia entrada (teclas + mira absoluta) a 30Hz. O cliente **prevê** sua própria posição com a mesma física do servidor (zero latência percebida). O servidor roda a simulação real e o cliente **reconcilia** (se divergir > 0,6m, corrige com snap).
- **Tiros:** 100% hitscan **server-side**. O servidor raycasta a partir da posição do olho + mira reportada pelo cliente, aplica spread e dano. O cliente só faz o visual (flash, som, tracer) — o servidor decide o resultado.
- **Recuo (recoil):** o cliente aplica soco visual à própria mira e reporta a mira efetiva ao servidor; o servidor raycasta com a mira movida → o recuo é real e justo (como no CS).
- **Mira:** yaw/pitch enviados em modo **absoluto** a cada input → sem acumulação de erro, sem dependência da sensibilidade do servidor.

### Protocolo (JSON compacto)

```
Cliente → Servidor:
  {t:'join', name}                       entrar
  {t:'input', yaw, pitch, k, fire, alt, reload, weapon}   30Hz (k = bitmask WASD+espaço)
  {t:'chat', m}  {t:'ping', ts}  {t:'respawn'}

Servidor → Cliente:
  {t:'welcome', id, cfg}                 sua identidade + config
  {t:'roster', p:[{id,name,color}]}      lista de jogadores (só quando muda)
  {s:[...], e:[...]}                     snapshot 30Hz + eventos do tick
      s[i] = [id,x,y,z,yaw,pitch,hp,weapon,mag,res,alive,score,deaths,streak]
      e[i] = {k:'shot'|'kill'|'hurt'|'respawn'|'reload'|'streak'|'chat'|'sys'|...}
  {t:'pong', ts}
```

**Otimizações de banda:**
- Roster separado do snapshot (nomes/cores só quando mudam).
- Números arredondados (posição 2 casas, ângulo 3 casas).
- Eventos agrupados no snapshot do tick (1 pacote ≈ 1,2KB com 15 jogadores ≈ 36KB/s).
- Backpressure: clientes lentos (bufferedAmount > 512KB) são pulados, sem travar o tick.

**Interpolação de remotos:** o cliente guarda os últimos snapshots e renderiza os outros jogadores com ~90ms de buffer (interpolação posicional + slerp de ângulo + animação de caminhada). Sem teleporte, sem jitter.

---

## 4. Física e movimento (shared/physics.js)

- Player = AABB (0,7 × 1,8m), olhos a 1,62m.
- Movimento estilo CS: aceleração no chão (60), atrito (9), controle de ar reduzido (12), gravidade (20), pulo (8,4 → ~1,75m), velocidade terminal (28).
- Colisão **por eixo** contra caixas AABB do mapa, com resolução de penetração; **sub-passos no eixo Y** para não atravessar caixas finas em queda rápida.
- Limites da arena + **morte ao cair** (kill floor y < -4 → respawn).
- Velocidade por arma (AWP mais lenta; scoped reduz pela metade).

---

## 5. Armas (shared/weapons.js)

| Arma | Tipo | Dano corpo | Dano headshot | Pente | Reserva | Cadência | Recarga | Notas |
|---|---|---|---|---|---|---|---|---|
| AK-47 | rifle automático | 24 | 48 | 30 | 90 | 600 RPM | 2,3s | spread cresce ao atirar |
| AWP | sniper de ferrolho | 100 | 200 | 5 | 15 | 40 RPM | 3,5s | mira com botão direito (FOV 24°) |
| Desert Eagle | pistola semiauto | 50 | 100 | 7 | 35 | 143 RPM | 2,0s | muito precisa |
| Faca | corpo a corpo | 55 (82 pesado) | — | ∞ | — | 100/55 RPM | — | golpe normal + facada (alt), alcance 3,2m |

- **Hitscan** com cone de spread (base + acúmulo por tiro + penalidade por movimento, limitado ao máximo por arma).
- Headshot = caixa 0,44×0,42m no topo do hitbox; dano ×2.
- Munição persistente por arma; troca de arma cancela recarga; recarga automática ao zerar o pente.
- Recuo visual no cliente (soco de câmera) + recuo real no raycast.
- Faca **respeita oclusão** (raycast contra o mapa) — não atravessa paredes.

---

## 6. Mapa — "Craft Complex" (shared/map.js)

Arena de 64×64 metros, tudo em caixas AABB alinhadas aos eixos (estilo Minecraft):

- Chão de grama (topo) com laterais de terra.
- **Muro perimetral** de pedra (4m).
- **4 torres de canto** com escadas (verticalidade, vantagem de ângulo).
- **Plataforma central** elevada com pilares e caixotes.
- **2 passarelas elevadas** cruzando a arena (visadas de AWP).
- **22 caixotes** espalhados (cobertura) + caixote de obsidiana central.
- 10 pontos de spawn verificados contra o mapa (longe de paredes/escadas).
- Nuvens flutuantes animadas (blocos brancos).

---

## 7. Renderização e performance (public/js/)

| Técnica | Detalhe |
|---|---|
| Mapa em **1 draw call** | todas as caixas fundidas numa geometria única com vertex colors (tons de bloco variados como no Minecraft) |
| Modelos blocky | jogadores (cabeça+torso+braços+pernas animáveis, olhos, tom de pele), armas em primeira pessoa montadas de caixas |
| Sombras | PCFSoft 2048² apenas no mapa/jogadores |
| Tone mapping | ACES Filmic (iluminação física r155+) |
| Pools | tracers (24), partículas (240), sprites — zero alocação por tiro |
| Reuso | geometrias/materiais compartilhados entre modelos |
| Pixel ratio | limitado a 1,75× (FPS alto em telas 4K) |
| Áudio | 100% sintetizado em WebAudio (sem arquivos), com **atenuação por distância** |

Efeitos: flash no cano (sprite aditivo + luz pontual), tracers, sangue em cubos, faíscas no impacto, corpos no chão com fade, nametags projetadas 3D→DOM, hitmarker, vinheta de dano, mira de AWP em CSS.

---

## 8. HUD e experiência

- **HUD:** vida, munição (pente/reserva), crosshair, kill feed (com HEADSHOT), placar (Tab, ordenado por abates com K/D e ping), chat, banner de streak (TRIPLE KILL / RAMPAGE / UNSTOPPABLE), líder em destaque, FPS e ping, indicador de recarga.
- **Morte:** tela "VOCÊ MORREU" com assassino/arma e contagem regressiva + botão de respawn.
- **Menu:** apelido, cor do personagem, controles, status do servidor.
- **Controles:** WASD + espaço (pular), mouse (mirar, pointer lock), clique esq (atirar), clique dir (mira/facada), R (recarregar), 1-4/roda (armas), Tab (placar), Enter (chat), M (mudo), Esc (pausa).
- Reconexão: overlay "CONEXÃO PERDIDA" + recarga automática.

---

## 9. Segurança e robustez do servidor

- **Sanitização de nick** (remove `<>&"'` e controle; máx. 16 chars) e chat limitado a 120 chars; o cliente escapa HTML no render.
- **Anti path-traversal** no HTTP (normaliza + prefixo com separador; 403).
- **Heartbeat** (ping/pong a cada 5s) limpa conexões mortas.
- **Backpressure** evita que um cliente lento trave o tick.
- Timeout de join de 10s; shutdown limpo (SIGINT/SIGTERM).

---

## 10. Testes automatizados (`npm test`)

| Teste | O que cobre |
|---|---|
| `test/server.test.js` (22) | join/roster, movimento, pulo, kill por AK-47 com headshot, placar, morte, respawn automático, faca com dano, reload, troca de arma, AWP 1-tiro, chat, ping/pong, queda do mapa, desconexão, respawn manual — 2 bots WebSocket reais contra o servidor |
| `test/client.smoke.js` (16) | builders 3D (mundo, jogador, 4 armas) com o Three.js vendor em Node, física compartilhada (andar, pular, não atravessar parede, muro alto bloqueia), raycasts |
| `test/http.test.js` (11) | servir index/js/shared/vendor/css, content-types, 404, path-traversal bloqueado |

---

## 11. Como rodar e jogar online

### Local
```bash
cd craft-strike
npm install
npm start          # http://localhost:3000
```
Abra `http://localhost:3000` em **2+ abas/navegadores** (ou convide amigos na sua rede via `http://SEU_IP:3000`) e jogue.

### Online de verdade (internet)

**Opção A — VPS (melhor performance):** qualquer VPS Linux (2 vCPU/2GB basta). 
```bash
# na VPS
git clone <seu-repo> && cd craft-strike
npm install
PORT=3000 nohup node server/entry.js > server.log 2>&1 &
# libere a porta 3000 no firewall e acesse http://IP_DA_VPS:3000
```
Dica: use `pm2` ou `systemd` para manter o processo vivo.

**Opção B — PaaS (Render / Railway / Fly.io):** crie um serviço com:
- Build: `npm install` · Start: `npm start` · Porta: `3000`
- O serviço serve HTTP + WS no mesmo endpoint (nenhuma config extra).
- Obs: em HTTPS, o cliente já troca `ws://` por `wss://` automaticamente.

**Opção C — Casa com port forwarding:** roteador → porta 3000 → seu PC, e acesse pelo IP público.

> Limites práticos: ~30-50 jogadores confortáveis em 1 vCPU pequeno; o tick de 30Hz e o JSON compacto mantêm a banda em ~40KB/s por cliente.

---

## 12. Roadmap / evoluções possíveis

- [ ] Modo Bomb (plantar/desarmar) e Team Deathmatch
- [ ] Som de passos com propagação por superfície
- [ ] Hitboxes por membro (perna/braço com dano reduzido)
- [ ] Granadas (flash/smoke) com efeitos 3D
- [ ] Persistência de estatísticas (SQLite) e ranking
- [ ] Anticheat básico (validação de velocidade/ângulo no servidor)
- [ ] Compressão binária do protocolo (DataView em vez de JSON)
- [ ] Matchmaking por região / salas customizadas
