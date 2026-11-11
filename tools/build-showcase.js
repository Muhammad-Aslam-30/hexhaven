// Builds a single self-contained HTML showcase of the living island from the game's own code.
// Usage: node tools/build-showcase.js <output.html>
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../game');

const out = process.argv[2];
if (!out) { console.error('usage: node tools/build-showcase.js <output.html>'); process.exit(1); }
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

// Play out a real setup so the islands carry genuine settlements, cities and roads.
function demo(n, seedTries = 40) {
  const names = ['Aslam', 'Bea', 'Cy', 'Dee', 'Eli', 'Fen'];
  const colors = Object.keys(G.COLORS);
  let best = null;
  for (let k = 0; k < seedTries; k++) {
    const s = G.newState(names.slice(0, n).map((name, i) => ({ id: 'p' + i, token: 't' + i, name, color: colors[i] })));
    G.fitBoard(s);
    G.apply(s, { host: true }, { type: 'host:start', shuffle: false });
    while (s.phase === 'setup') {
      const L = G.publicView(s, new Set()).legal;
      const score = (v) => s.board.vertices[v].hexes.reduce((a, h) => { const x = s.board.hexes[h]; return a + (x.num ? 6 - Math.abs(7 - x.num) : 0); }, 0);
      const target = s.mode.kind === 'road' ? { e: L.edges[Math.floor(Math.random() * L.edges.length)] } : { v: L.vertices.sort((a, b) => score(b) - score(a))[Math.floor(Math.random() * 4)] };
      G.apply(s, { host: true }, { type: 'host:place', target });
    }
    // a couple of cities and extra roads for a lived-in look
    s.players.slice(0, Math.ceil(n / 2)).forEach((p) => {
      const v = Object.keys(s.buildings).find((x) => s.buildings[x].owner === p.id);
      G.apply(s, { host: true }, { type: 'host:mode', kind: 'city', pid: p.id, free: true });
      G.apply(s, { host: true }, { type: 'host:place', target: { v: +v } });
    });
    s.players.forEach((p) => {
      for (let r = 0; r < 2; r++) {
        G.apply(s, { host: true }, { type: 'host:mode', kind: 'road', pid: p.id, free: true });
        const L = G.publicView(s, new Set()).legal.edges;
        if (L.length) G.apply(s, { host: true }, { type: 'host:place', target: { e: L[Math.floor(Math.random() * L.length)] } });
      }
    });
    const hasDesertBandit = s.board.hexes[s.board.robber].res === 'desert';
    if (hasDesertBandit) { best = s; break; }
  }
  const v = G.publicView(best, new Set());
  return { board: v.board, buildings: v.buildings, roads: v.roads, players: v.players.map((p) => ({ id: p.id, name: p.name, hex: p.hex })) };
}

const DATA = { basic: demo(4), extension: demo(6) };

const html = `<title>Hexhaven Island</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Figtree:wght@400;600;800&display=swap">
<style>
/* Layout: one living island on a full-bleed stage, a quiet control bar, then a field guide to its six lands. */
:root {
  --sea-deep: #071d33; --sea: #0d2c4a; --panel: #10304f; --line: #1f4a70;
  --foam: #eaf5fb; --muted: #9fb8cc; --sand: #e9d9a6; --sun: #ffcf6b;
  --display: 'Young Serif', Georgia, 'Times New Roman', serif;
  --body: 'Figtree', system-ui, 'Segoe UI', sans-serif;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { background: var(--sea-deep); color: var(--foam); font-family: var(--body); font-size: 16px; line-height: 1.5; margin: 0; }
.wrap { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 22px 40px; max-width: 1240px; margin: 0 auto; display: grid; gap: 18px; }
header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 20px; }
h1 { font-family: var(--display); font-weight: 400; font-size: clamp(30px, 5vw, 52px); line-height: 1; margin: 0; color: var(--sand); letter-spacing: .5px; text-wrap: balance; }
header p { margin: 0; color: var(--muted); max-width: 60ch; }
.stage { position: relative; width: 100%; aspect-ratio: 16 / 10; max-height: 78vh; border-radius: 18px; overflow: hidden; background: #0a3254; box-shadow: 0 30px 80px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.06); }
.stage .scene { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; display: block; }
.stage .shade { mix-blend-mode: multiply; }
.stage .glow { mix-blend-mode: screen; }
.stage svg { position: absolute; inset: 0; width: 100%; height: 100%; filter: brightness(calc(1 - var(--night, 0) * .18)); }
.stage svg .win { fill: #ffd56b; opacity: calc(.1 + var(--night, 0) * .9); stroke: rgba(80,50,10,.5); stroke-width: .6; }
.clock { position: absolute; left: 14px; top: 14px; background: rgba(7,29,51,.72); border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 6px 14px; font-weight: 800; font-size: 14px; letter-spacing: .6px; text-transform: uppercase; backdrop-filter: blur(4px); }
.controls { display: flex; flex-wrap: wrap; gap: 14px 26px; align-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 12px 16px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.seg button { font: inherit; font-weight: 600; color: var(--muted); background: transparent; border: 0; padding: 8px 14px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--sand); color: #2b2118; }
.field { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 14px; font-weight: 600; }
.field input[type=range] { width: 170px; accent-color: var(--sun); }
.btn { font: inherit; font-weight: 700; background: transparent; color: var(--foam); border: 1px solid var(--line); border-radius: 10px; padding: 8px 14px; cursor: pointer; }
.btn:hover, .seg button:hover { color: var(--foam); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--sun); outline-offset: 2px; }
h2 { font-family: var(--display); font-weight: 400; font-size: 26px; margin: 10px 0 0; color: var(--sand); }
.guide { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
.land { background: var(--sea); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; min-width: 0; }
.land h3 { margin: 0 0 4px; font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 8px; }
.land h3 i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.land p { margin: 0; color: var(--muted); font-size: 14px; }
.note { color: var(--muted); font-size: 13px; margin: 0; }
#board [data-anim] { transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  #board [data-anim="intro"] { animation: tileIn .75s cubic-bezier(.2,1.3,.4,1) both; }
}
@keyframes tileIn { from { opacity: 0; transform: translateY(-34px) scale(.45) rotate(-18deg); } to { opacity: 1; transform: none; } }
@media (max-width: 560px) { .stage { aspect-ratio: 4 / 5; } .field input[type=range] { width: 120px; } }
</style>
<div class="wrap">
  <header>
    <h1>Hexhaven Island</h1>
    <p>The living board from the Hexhaven party game. Every tile is drawn and animated in real time, and the wind, the sea and the time of day all change as you watch.</p>
  </header>
  <div class="stage" id="stage">
    <canvas id="sceneWorld" class="scene" aria-hidden="true"></canvas>
    <canvas id="sceneShade" class="scene shade" aria-hidden="true"></canvas>
    <canvas id="sceneGlow" class="scene glow" aria-hidden="true"></canvas>
    <svg id="board" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Hex island board with number tokens, harbours, settlements, cities and roads"></svg>
    <div class="clock" id="clock">Morning</div>
  </div>
  <div class="controls">
    <div class="seg" role="group" aria-label="Island size">
      <button id="bBasic" aria-pressed="true">Basic · 4 players</button>
      <button id="bExt" aria-pressed="false">Extended · 6 players</button>
    </div>
    <label class="field" for="time">Time of day <input id="time" type="range" min="0" max="999" value="200"></label>
    <label class="field" for="auto"><input id="auto" type="checkbox" checked> Let the day pass</label>
    <label class="field" for="wind">Wind <input id="wind" type="range" min="0" max="250" value="100"></label>
    <button class="btn" id="replay">Rebuild the island</button>
  </div>
  <h2>What lives on each tile</h2>
  <div class="guide">
    <div class="land"><h3><i style="background:#2f7a47"></i>Forest · wood</h3><p>Pines and oaks bend with each gust. Deer cross between clearings to graze, and flocks burst out of the canopy.</p></div>
    <div class="land"><h3><i style="background:#94c45e"></i>Pasture · wool</h3><p>Sheep stand in the meadow, lowering their heads to graze and lifting them to look around. Grass sways and a butterfly drifts past.</p></div>
    <div class="land"><h3><i style="background:#e6b440"></i>Fields · grain</h3><p>The wheat bends as gusts roll across the island. The windmill speeds up in the wind and crows circle the scarecrow.</p></div>
    <div class="land"><h3><i style="background:#c4622d"></i>Hills · brick</h3><p>Kiln smoke trails off with the wind and the fire flickers. A worker wheels clay from the pit to the brick stacks.</p></div>
    <div class="land"><h3><i style="background:#8b97a5"></i>Quarry · ore</h3><p>Blue ore veins glint, clouds drift past the peaks and pebbles tumble down. An eagle circles while the mine cart rolls out with a load.</p></div>
    <div class="land"><h3><i style="background:#e2cd96"></i>Desert · bandit's hideout</h3><p>Heat shimmers over the dunes, sand blows in the wind, a tumbleweed bounces through and a camel caravan plods past.</p></div>
  </div>
  <p class="note">Around the island, sailing boats leave wakes, boats bob at every harbour, gulls wheel overhead and fish leap. At night the windows light up and the moon rises over the water. If your device asks for reduced motion, everything shows as a still picture.</p>
</div>
<script>${pub('art.js')}</script>
<script>${pub('board.js')}</script>
<script>${pub('island.js')}</script>
<script>
const DATA = ${JSON.stringify(DATA)};
const $ = (id) => document.getElementById(id);
const scene = IslandScene.create({ world: $('sceneWorld'), shade: $('sceneShade'), glow: $('sceneGlow'), viewOf: BoardRenderer.viewOf });
scene.setCycle(100);
let current = 'basic';
function show(key) {
  current = key;
  const d = DATA[key];
  const view = { ...d, legal: { vertices: [], edges: [], hexes: [] }, mode: null, turn: null };
  const t0 = performance.now();
  BoardRenderer.render($('board'), view, { anim: { intro: t0, fresh: new Map() } });
  scene.update(view, { intro: t0 });
  $('bBasic').setAttribute('aria-pressed', key === 'basic');
  $('bExt').setAttribute('aria-pressed', key === 'extension');
}
$('bBasic').onclick = () => show('basic');
$('bExt').onclick = () => show('extension');
$('replay').onclick = () => show(current);
const applyTime = () => scene.setTime($('auto').checked ? null : +$('time').value / 1000);
$('time').addEventListener('input', () => { $('auto').checked = false; applyTime(); });
$('auto').addEventListener('change', applyTime);
$('wind').addEventListener('input', () => scene.setWind(+$('wind').value / 100));
const label = (p) => p < 0.25 ? 'Morning' : p < 0.5 ? 'Afternoon' : p < 0.6 ? 'Dusk' : p < 0.86 ? 'Night' : p < 0.95 ? 'Dawn' : 'Morning';
setInterval(() => { const p = scene.phase(); $('clock').textContent = label(p); if ($('auto').checked) $('time').value = Math.round(p * 1000); }, 400);
show('basic');
</script>
`;

fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB');
