# 🎮 Craft Strike — FPS Multiplayer 3D no Navegador

**Craft Strike** é um FPS multiplayer estilo **Valorant/CS** com visual **Minecraft**, feito em **Node.js + WebSockets + Three.js**. Modo **FFA** (todos contra todos), **PvP infinito** e **respawn infinito** — 100% jogável e online.

![stack](https://img.shields.io/badge/Node-22%2B-green) ![ws](https://img.shields.io/badge/WebSocket-ws-blue) ![three](https://img.shields.io/badge/Three.js-r160-orange)

## ✨ O que tem

- **4 armas**: AK-47 (automática), AWP (sniper com mira), Desert Eagle e Faca (golpe normal + facada)
- **Mapa** "Craft Complex": arena 64×64 com torres, escadas, passarelas e caixotes
- **Jogadores Minecraft-style**: bonecos blocky, cada um com sua cor e tom de pele
- **Física estilo CS**: aceleração, atrito, controle de ar, pulo, colisão AABB
- **Servidor autoritativo** com predição no cliente e reconciliação → jogabilidade sem lag aparente
- **Hitscan server-side** (tiro instantâneo, spread, headshot ×2, recuo real)
- **30Hz de simulação**, interpolação de remotos, kill feed, placar, chat, streaks, líder
- **Áudio 100% sintetizado** (WebAudio, sem arquivos) com atenuação por distância
- **FPS alto**: mapa em 1 draw call, pools de efeitos, sem alocações em hot loops

## 🚀 Como jogar

```bash
cd craft-strike
npm install
npm start
```

Abra **http://localhost:3000** no navegador. Para jogar com amigos:
- Mesma rede: `http://SEU_IP:3000`
- Internet: veja o [PLANO.md](PLANO.md#11-como-rodar-e-jogar-online) (VPS, Render/Railway ou port forwarding)

## 🎯 Controles

| Tecla | Ação |
|---|---|
| WASD | mover |
| Mouse | mirar (pointer lock) |
| Botão esquerdo | atirar |
| Botão direito | mira da AWP / facada pesada |
| Espaço | pular |
| R | recarregar |
| 1-4 / roda | trocar arma |
| Tab | placar |
| Enter | chat |
| M | som on/off |
| Esc | pausar |

## 🧪 Testes

```bash
npm test                 # 22 testes de servidor (2 bots reais)
node test/client.smoke.js  # 16 testes 3D/física (sem navegador)
node test/http.test.js     # 11 testes HTTP estático
```

## 📁 Estrutura

```
craft-strike/
├── server/           # Node: HTTP estático + WebSocket + simulação (game.js)
├── shared/           # Física, armas, mapa e constantes (usados por servidor E cliente)
├── public/           # Cliente: index.html, style.css, js/{main,render,models,hud,net,input,audio}.js
│   └── vendor/       # three.module.min.js (local, sem CDN)
├── test/             # Testes headless
└── PLANO.md          # Plano técnico completo (arquitetura, protocolo, deploy)
```

## 📄 Licença

MIT — pode usar, modificar e publicar livremente.
# tiroporradaebomba
