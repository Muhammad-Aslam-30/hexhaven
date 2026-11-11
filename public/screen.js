// Host screen (laptop, with controls) and TV screen (display only).
'use strict';

const IS_TV = new URLSearchParams(location.search).has('tv');
const ROLE = IS_TV ? 'tv' : 'host';
document.body.classList.toggle('tv', IS_TV);
if (IS_TV) document.title = 'Hexhaven — TV';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RES = ['wood', 'brick', 'wool', 'grain', 'ore'];
const ICON = { wood: '🌲', brick: '🧱', wool: '🐑', grain: '🌾', ore: '🪨' };
const KIND = { road: 'road', settlement: 'settlement', city: 'city' };

const socket = io();
let V = null;
let selPid = null;
let lastTurnKey = null;
let lastRollId = null;
let editPid = null;
let joinIp = null;
let lobbyPeek = new URLSearchParams(location.search).has('island');

// When the game is hosted online, the host controls need the admin key (remembered on this computer).
const savedKey = () => { try { return localStorage.getItem('hexhaven-key') || undefined; } catch { return undefined; } };
socket.on('connect', () => socket.emit('hello', { role: ROLE, key: IS_TV ? undefined : savedKey() }));
socket.on('needKey', (d) => {
  if (IS_TV) return;
  if (!d.hasKey) { toast('Host controls are off on this server (no admin key set). Opening the TV view.', true); setTimeout(() => { location.href = '/'; }, 2500); return; }
  const k = prompt(d.wrong ? 'That key is wrong. Admin key:' : 'This game is online. Enter the admin key to use the host controls:');
  if (!k) { location.href = '/'; return; }
  try { localStorage.setItem('hexhaven-key', k.trim()); } catch { /* private mode */ }
  socket.emit('hello', { role: ROLE, key: k.trim() });
});
socket.on('state', (v) => { V = v; render(); });
socket.on('err', (m) => toast(m, true));

const act = (type, extra = {}) => socket.emit('act', { type, ...extra });

// Living island (canvas under the board) + day/night preference shared by host and TV windows.
const scene = IslandScene.create({ world: $('sceneWorld'), shade: $('sceneShade'), glow: $('sceneGlow'), viewOf: BoardRenderer.viewOf });
const DN_KEY = 'hexhaven-daynight';
const dayNightOn = () => { try { return localStorage.getItem(DN_KEY) !== '0'; } catch { return true; } };
scene.setDayNight(dayNightOn());
$('chkDayNight').checked = dayNightOn();
$('chkDayNight').addEventListener('change', (e) => {
  try { localStorage.setItem(DN_KEY, e.target.checked ? '1' : '0'); } catch { /* storage blocked */ }
  scene.setDayNight(e.target.checked);
});
window.addEventListener('storage', (e) => {
  if (e.key !== DN_KEY) return;
  scene.setDayNight(e.newValue !== '0');
  $('chkDayNight').checked = e.newValue !== '0';
});
const playerById = (id) => V.players.find((p) => p.id === id);
const dot = (p) => `<span class="dot" style="background:${p.hex}"></span>`;
const cur = () => (V.turn ? V.players[V.turn.idx] : null);

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- Rendering ----------
function render() {
  const c = cur();
  const sbp = V.turn && V.turn.sbp;
  const turnKey = V.turn ? `${V.turn.idx}:${V.turn.num}:${sbp ? sbp.pid : ''}` : '';
  if (turnKey !== lastTurnKey) { lastTurnKey = turnKey; selPid = sbp ? sbp.pid : c ? c.id : null; realPick = [null, null]; }
  if (V.mode && V.mode.pid && V.mode.kind !== 'bandit' && V.mode.kind !== 'remove') selPid = V.mode.pid;

  const events = trackAnimations();
  BoardRenderer.render($('board'), V, {
    interactive: !IS_TV,
    onPick: (t) => act('host:place', { target: t.hex != null ? t.hex : t }),
    anim,
  });
  $('fx').setAttribute('viewBox', $('board').getAttribute('viewBox'));
  scene.update(V, { intro: anim.intro });
  playEffects(events);
  renderBanner(c);
  renderDice();
  renderLobby();
  renderTurnCard(c);
  renderTools();
  renderPending(c);
  renderPlayers(c);
  renderLog();
  renderWinner();
  if (editPid) renderEdit();
}

function renderBanner(c) {
  const b = $('banner');
  b.classList.toggle('clickable-banner', V.phase === 'lobby' && lobbyPeek);
  if (V.phase === 'lobby') {
    b.innerHTML = lobbyPeek ? `🏝️ ${esc(V.sizeLabel)} · ${V.players.length} joined — <u>show join code</u>` : '';
    return;
  }
  if (!c) { b.innerHTML = ''; return; }
  const m = V.mode, t = V.turn;
  const who = (p) => `${dot(p)}${esc(p.name)}`;
  let txt;
  if (V.winner) txt = `🏆 ${who(playerById(V.winner.pid))} wins!`;
  else if (V.phase === 'setup') txt = `${who(c)} is placing a ${t.setup.step}${t.setup.i >= V.players.length ? ' (2nd round)' : ''} on their phone`;
  else if (t.step === 'discard') txt = `🦹 Seven! Waiting for ${Object.keys(t.discards).map((id) => esc(playerById(id).name)).join(', ')} to discard`;
  else if (t.step === 'robber') txt = `🦹 ${who(c)} is moving the bandit`;
  else if (t.step === 'steal') txt = `🦹 ${who(c)} — pick someone to rob`;
  else if (m && m.kind === 'remove') txt = '🧹 Tap a piece to remove it';
  else if (m && m.kind === 'bandit') txt = '🦹 Tap a tile to move the bandit';
  else if (m && KIND[m.kind]) txt = `${who(playerById(m.pid))} is building a ${m.kind}${t.freeRoads ? ` (free road ${3 - t.freeRoads}/2)` : ''} — choosing a spot`;
  else if (t.sbp) txt = `🔨 Special build: ${who(playerById(t.sbp.pid))} may build (${t.sbp.at + 1}/${t.sbp.total})`;
  else if (!t.rolled) txt = V.diceMode === 'real' ? `✋ ${who(c)} — roll the real dice and enter the numbers` : `${who(c)}'s turn — roll the dice`;
  else txt = `${who(c)}'s turn`;
  b.innerHTML = txt;
}

function dieHtml(n, red) {
  const P = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[n];
  let h = '';
  for (let i = 1; i <= 9; i++) h += P.includes(i) ? '<i></i>' : '<span></span>';
  return `<div class="die${red ? ' red' : ''}">${h}</div>`;
}

function renderDice() {
  const box = $('dice');
  const d = V.turn && V.turn.dice;
  if (!d || V.phase !== 'play') { box.innerHTML = ''; return; }
  box.innerHTML = dieHtml(d[0], true) + dieHtml(d[1]) + `<div class="dice-sum">${d[0] + d[1]}</div>`;
  if (V.turn.rollId !== lastRollId) {
    if (lastRollId != null) {
      // keep the corner dice hidden while the big dice are in the air
      const wait = MOTION && !Dice3D.REDUCED ? Dice3D.LAND_MS + 900 : 0;
      box.classList.remove('rolling'); box.style.visibility = 'hidden';
      clearTimeout(renderDice.t);
      renderDice.t = setTimeout(() => { box.style.visibility = ''; void box.offsetWidth; box.classList.add('rolling'); }, wait);
    }
    lastRollId = V.turn.rollId;
  }
}

async function loadJoin() {
  try {
    const r = await fetch('/api/join' + (joinIp ? '?ip=' + encodeURIComponent(joinIp) : ''));
    const j = await r.json();
    $('qr').src = j.qr;
    $('joinUrl').textContent = j.url;
    const pick = $('ipPick');
    if (j.addresses.length > 1) {
      pick.classList.remove('hidden');
      pick.innerHTML = j.addresses.map((a) => `<option value="${a.address}" ${j.url.includes(a.address) ? 'selected' : ''}>${a.address} — ${esc(a.name)}</option>`).join('');
    }
  } catch { /* server offline */ }
}

function renderLobby() {
  const lob = $('lobby');
  const show = (V.phase === 'lobby' && !lobbyPeek) || lob.dataset.forced === '1';
  lob.classList.toggle('hidden', !show);
  if (!show) return;
  if (!$('qr').src) loadJoin();
  $('pcount').textContent = `(${V.players.length}/6)`;
  $('diceModeLobby').innerHTML = '<span>Dice</span>' + diceModeSwitch();
  $('sizeInfo').innerHTML = `<b>${esc(V.sizeLabel)}</b><br><span>${V.board.size === 'extension'
    ? '30 tiles · 2 deserts · 11 harbours · special building phase'
    : '19 tiles · 1 desert · 9 harbours · switches to the extended island at 5 players'}</span>`;
  const inLobby = V.phase === 'lobby';
  $('lobbyPlayers').innerHTML = V.players.length
    ? V.players.map((p, i) => `<li>${dot(p)}<span class="sp">${esc(p.name)}</span>${p.ready ? '<span class="ready-tick">✓ ready</span>' : ''}${inLobby && !IS_TV ? `
        <button data-mv="${p.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button data-mv="${p.id}" data-dir="1" ${i === V.players.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-kick="${p.id}" title="Remove">✕</button>` : ''}</li>`).join('')
    : '<li class="empty">Nobody yet — scan the code!</li>';
  $('btnStart').disabled = V.players.length < 2;
  $('btnStart').classList.toggle('hidden', !inLobby);
  $('btnNewBoard').parentElement.classList.toggle('hidden', !inLobby);
}

function renderTurnCard(c) {
  const el = $('turnCard');
  if (V.phase === 'lobby' || !c) { el.innerHTML = '<div class="what">Waiting in the lobby…</div>'; return; }
  const t = V.turn;
  const status = V.phase === 'setup' ? `Setup — place a ${t.setup.step}`
    : t.sbp ? `Turn over — special building phase` : t.rolled ? `Rolled ${t.dice[0] + t.dice[1]}` : 'Needs to roll';
  const canRoll = V.phase === 'play' && !t.rolled && !t.step && !t.sbp;
  const real = V.diceMode === 'real';
  const picker = real && canRoll ? `
    <div class="host-only real-entry">
      <div class="real-hint">Roll the dice at the table, then tap both faces <span>(or type them, e.g. 4 then 6)</span></div>
      ${[0, 1].map((i) => `<div class="pick-row"><span class="pick-label ${i ? '' : 'red'}">${i ? 'White' : 'Red'}</span>
        ${[1, 2, 3, 4, 5, 6].map((n) => `<button class="pick-die${i ? '' : ' red'}${realPick[i] === n ? ' on' : ''}" data-die="${i}" data-n="${n}" aria-label="${i ? 'White' : 'Red'} die ${n}">${miniDie(n)}</button>`).join('')}</div>`).join('')}
      <button class="btn primary" id="btnRealRoll" ${realPick[0] && realPick[1] ? '' : 'disabled'}>${realPick[0] && realPick[1] ? `✋ Confirm ${realPick[0]} + ${realPick[1]} = ${realPick[0] + realPick[1]}` : 'Pick both dice'}</button>
    </div>` : '';
  el.innerHTML = `
    <div class="card-title">Current turn · round ${Math.max(1, Math.ceil((t.num || 1) / V.players.length))}</div>
    <div class="who">${dot(c)}${esc(c.name)}</div>
    <div class="what">${status}</div>
    ${V.phase === 'play' ? `
    <div class="row host-only dice-mode">${diceModeSwitch()}</div>
    ${picker}
    <div class="row host-only">
      ${real ? '' : `<button class="btn primary" id="btnRoll" ${canRoll ? '' : 'disabled'}>🎲 Roll (R)</button>`}
      <button class="btn" id="btnEnd">End turn (E)</button>
    </div>` : ''}`;
}
const miniDie = (n) => {
  const P = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[n];
  return Array.from({ length: 9 }, (_, i) => (P.includes(i + 1) ? '<i></i>' : '<b></b>')).join('');
};
const diceModeSwitch = () => `<div class="seg" role="group" aria-label="Dice">
  <button data-dicemode="digital" aria-pressed="${V.diceMode !== 'real'}">🎲 Digital dice</button>
  <button data-dicemode="real" aria-pressed="${V.diceMode === 'real'}">✋ Real dice</button></div>`;
let realPick = [null, null];
function submitRealRoll() {
  if (!(realPick[0] && realPick[1])) return;
  act('host:roll', { d1: realPick[0], d2: realPick[1] });
  realPick = [null, null];
}

function renderTools() {
  if (IS_TV || V.phase === 'lobby') { $('playerPick').innerHTML = ''; return; }
  $('playerPick').innerHTML = V.players.map((p) => `<button data-pick="${p.id}" class="${p.id === selPid ? 'on' : ''}">${dot(p)}${esc(p.name)}</button>`).join('');
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', !!V.mode && V.mode.kind === b.dataset.tool));
}

function renderPending(c) {
  const el = $('pending');
  const t = V.turn;
  const parts = [];
  if (t && t.step === 'discard') {
    parts.push(`<div class="card-title">Discarding</div>${Object.entries(t.discards).map(([id, n]) => `${dot(playerById(id))}${esc(playerById(id).name)} must discard <b>${n}</b>`).join('<br>')}
      <div class="host-only"><button class="btn sm" data-a="host:skipDiscards">Skip discards</button></div>`);
  }
  if (t && t.sbp) {
    const b = playerById(t.sbp.pid);
    parts.push(`<div class="card-title">Special building phase · ${t.sbp.at + 1} of ${t.sbp.total}</div>
      ${dot(b)}<b>${esc(b.name)}</b> may build or buy a development card (no trading, no playing cards). They tap <i>Done</i> on their phone.
      <div class="host-only"><button class="btn sm" data-a="host:sbpSkip">Skip ${esc(b.name)}</button></div>`);
  }
  if (t && t.step === 'robber') parts.push(`<div class="card-title">Bandit</div>Tap any tile on the board to move the bandit.<div class="host-only"><button class="btn sm" data-a="host:skipRobber">Skip</button></div>`);
  if (t && t.step === 'steal') {
    parts.push(`<div class="card-title">${esc(c.name)} robs…</div><div class="host-only">${t.victims.map((id) => `<button class="btn" data-steal="${id}">${dot(playerById(id))}${esc(playerById(id).name)}</button>`).join('')}</div><div class="tv-only">Choosing on their phone…</div>`);
  }
  if (V.offers.length) {
    parts.push(`<div class="card-title">Trade offers</div>${V.offers.map((o) => {
      const f = playerById(o.from), to = o.to && playerById(o.to);
      const h = (x) => RES.filter((r) => x[r]).map((r) => `${x[r]}${ICON[r]}`).join(' ');
      return `<div>${dot(f)}<b>${esc(f.name)}</b> gives ${h(o.give)} for ${h(o.want)} → ${to ? esc(to.name) : 'anyone'}</div>`;
    }).join('')}`);
  }
  el.classList.toggle('hidden', !parts.length);
  el.innerHTML = parts.join('<hr style="border-color:#4a3d18">');
}

function renderPlayers(c) {
  $('players').innerHTML = V.players.map((p) => `
    <div class="pl ${c && c.id === p.id ? 'cur' : ''}" data-edit="${p.id}">
      <div class="stripe" style="background:${p.hex}"></div>
      <div>
        <div class="name">${esc(p.name)}
          ${V.longestRoad === p.id ? '<span class="badge">🛣️ Longest</span>' : ''}
          ${V.largestArmy === p.id ? '<span class="badge">⚔️ Army</span>' : ''}
          ${p.connected ? '' : '<span class="off">● offline</span>'}</div>
        <div class="stats">
          <span title="Resource cards">🃏 <b>${p.cards}</b></span>
          <span title="Development cards">📜 <b>${p.devCount}</b></span>
          <span title="Knights played">⚔️ <b>${p.knights}</b></span>
          <span title="Longest continuous road">🛣️ <b>${p.roadLen}</b> long</span>
          <span title="Pieces left in supply">left: 🏠${5 - p.pieces.settlement} 🏰${4 - p.pieces.city} ▬${15 - p.pieces.road}</span>
        </div>
      </div>
      <div class="vp">${p.vp}<small>VP</small></div>
    </div>`).join('');
}

function renderLog() {
  const el = $('log');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  el.innerHTML = V.log.map((l) => `<div>${esc(l.text)}</div>`).join('');
  if (atBottom || !el.dataset.init) { el.scrollTop = el.scrollHeight; el.dataset.init = 1; }
}

function renderWinner() {
  const el = $('winner');
  if (!V.winner) { el.classList.add('hidden'); return; }
  const p = playerById(V.winner.pid);
  el.classList.remove('hidden');
  el.innerHTML = `<div class="w-card"><h2>🏆</h2><div style="font-size:42px;font-weight:900">${dot(p)}${esc(p.name)} wins!</div>
    <div class="hint">${V.winner.vp} victory points</div>
    <div class="row host-only"><button class="btn" data-a="host:clearWinner">Keep playing</button><button class="btn primary" data-a="host:newGame">New game</button></div></div>`;
}

function renderEdit() {
  const p = playerById(editPid);
  if (!p || !V.hands) { closeModal(); return; }
  const h = V.hands[p.id];
  const idx = V.players.indexOf(p);
  $('modalCard').innerHTML = `<h3>${dot(p)}${esc(p.name)}'s hand</h3>
    <p class="hint" style="margin-top:-6px">Fix mistakes: give or take cards. Bank: ${RES.map((r) => `${ICON[r]}${V.bank[r]}`).join(' ')}</p>
    ${RES.map((r) => `<div class="res-row"><span>${ICON[r]} ${r}</span><button data-adj="${r}" data-d="-1">−</button><b>${h[r]}</b><button data-adj="${r}" data-d="1">+</button></div>`).join('')}
    <div class="row">
      ${V.phase === 'play' ? `<button class="btn" data-setturn="${idx}">Make it their turn</button>` : ''}
      <button class="btn primary" data-close style="margin-left:auto">Done</button>
    </div>`;
}
function closeModal() { editPid = null; $('modal').classList.add('hidden'); }

// ---------- Save slots ----------
const savesCall = (d) => new Promise((ok) => socket.emit('saves', d, ok));
async function saveGame() {
  const def = `game ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-')}`;
  const name = prompt('Save the game as:', def);
  if (!name) return;
  const r = await savesCall({ op: 'save', name });
  toast(r.error || `💾 Saved as “${r.name}”`, !!r.error);
}
async function openLoad() {
  const r = await savesCall({ op: 'list' });
  if (r.error) return toast(r.error, true);
  const row = (x) => `<button class="btn save-row" data-load="${esc(x.name)}"><b>${esc(x.auto ? `Start of ${x.name.slice(5).replace('turn-', 'turn ').replace(/ 0+/, ' ')}` : x.name)}</b>
    <span class="hint">${esc(x.info)} · ${new Date(x.savedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></button>`;
  const named = r.saves.filter((x) => !x.auto), auto = r.saves.filter((x) => x.auto);
  $('modalCard').innerHTML = `<h3>📂 Load a game</h3>
    <p class="hint" style="margin-top:-6px">Players stay connected. Loading can be undone with ↩️ Undo.</p>
    <div class="save-list">
      ${named.length ? `<div class="card-title">Saved games</div>${named.map(row).join('')}` : '<p class="hint">No named saves yet. Use 💾 Save.</p>'}
      ${auto.length ? `<div class="card-title">Start of each turn (this game)</div>${auto.map(row).join('')}` : ''}
    </div>
    <div class="row"><button class="btn primary" data-close style="margin-left:auto">Close</button></div>`;
  $('modal').classList.remove('hidden');
}
async function loadGame(name) {
  if (!confirm(`Load “${name}”? The current game is replaced (you can undo it).`)) return;
  const r = await savesCall({ op: 'load', name });
  toast(r.error || `📂 Loaded “${r.name}”`, !!r.error);
  if (!r.error) closeModal();
}

// ---------- Animations & effects ----------
const MOTION = TerrainArt.MOTION;
const anim = { intro: null, fresh: new Map() };
const prev = { sig: null, b: {}, r: {}, robber: null, rollId: null };

// Compare with the last state to find what just happened.
function trackAnimations() {
  const now = performance.now();
  for (const [k, t] of anim.fresh) if (now - t > 3000) anim.fresh.delete(k);
  const snap = () => {
    prev.b = { ...V.buildings }; prev.r = { ...V.roads };
    prev.robber = V.board.robber; prev.rollId = V.turn && V.turn.rollId;
  };
  const sig = V.board.hexes.map((h) => h.res + ':' + h.num).join('|');
  if (sig !== prev.sig) { anim.intro = now; prev.sig = sig; snap(); return []; }
  const ev = [];
  Object.entries(V.buildings).forEach(([vid, b]) => {
    const p = prev.b[vid];
    if (!p || p.type !== b.type) { anim.fresh.set('v' + vid + b.type, now); ev.push({ type: 'build', vid: +vid, owner: b.owner }); }
  });
  Object.entries(V.roads).forEach(([eid, owner]) => {
    if (prev.r[eid] == null) { anim.fresh.set('e' + eid, now); ev.push({ type: 'road', eid: +eid, owner }); }
  });
  if (V.board.robber !== prev.robber) { anim.fresh.set('robber', now); ev.push({ type: 'robber' }); }
  const rid = V.turn && V.turn.rollId;
  if (rid && rid !== prev.rollId && V.turn.dice) {
    const sum = V.turn.dice[0] + V.turn.dice[1];
    // Token pops and gold rings wait for the 3D dice to land.
    const wait = MOTION && !Dice3D.REDUCED ? Dice3D.LAND_MS : 0;
    ev.push({ type: 'roll', sum, d1: V.turn.dice[0], d2: V.turn.dice[1], who: cur() && cur().name });
    anim.fresh.set('rollring', now + wait);
    V.board.hexes.forEach((h) => { if (h.num === sum && h.id !== V.board.robber) anim.fresh.set('tok' + h.id, now + wait); });
  }
  snap();
  return ev;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const S = 60;
function fxAdd(html) {
  const fx = $('fx');
  if (!fx.querySelector('defs')) fx.innerHTML = `<defs><clipPath id="fxclip"><rect x="-13" y="-17" width="26" height="30" rx="3"/></clipPath>
    <filter id="fxshadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity=".45"/></filter></defs>`;
  const g = document.createElementNS(SVGNS, 'g');
  g.innerHTML = html;
  fx.appendChild(g);
  return g;
}
function fxRun(el, frames, o) {
  const a = el.animate(frames, { fill: 'both', ...o });
  a.onfinish = () => el.remove();
  return a;
}
const hexPts = (h, r = 1) => Array.from({ length: 6 }, (_, k) => {
  const a = (Math.PI / 180) * (60 * k - 90);
  return `${((h.x + Math.cos(a) * r) * S).toFixed(1)},${((h.y + Math.sin(a) * r) * S).toFixed(1)}`;
}).join(' ');

function burst(x, y, color, n = 8, dist = 34) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, el = fxAdd(`<circle r="3.5" fill="${color}" stroke="#fff" stroke-width="1"/>`);
    fxRun(el, [
      { transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1 },
      { transform: `translate(${x + Math.cos(a) * dist}px,${y + Math.sin(a) * dist}px) scale(.2)`, opacity: 0 },
    ], { duration: 650, easing: 'cubic-bezier(.2,.8,.3,1)' });
  }
  const ring = fxAdd(`<circle r="10" fill="none" stroke="${color}" stroke-width="3"/>`);
  fxRun(ring, [{ transform: `translate(${x}px,${y}px) scale(.5)`, opacity: 1 }, { transform: `translate(${x}px,${y}px) scale(3.2)`, opacity: 0 }], { duration: 700, easing: 'ease-out' });
}

function playEffects(events) {
  if (!MOTION || !events.length) return;
  const B = V.board;
  const colorOf = (pid) => (playerById(pid) || {}).hex || '#fff';
  events.forEach((ev) => {
    if (ev.type === 'roll' && !ev.landed) {
      // Throw the 3D dice across the board, then pay out once they've settled.
      const wrap = document.querySelector('.board-wrap');
      const size = Math.max(56, Math.min(110, Math.min(wrap.clientWidth, wrap.clientHeight) * 0.11));
      Dice3D.roll(wrap, ev.d1, ev.d2, { size, label: ev.who ? `${ev.who} rolled` : '' })
        .then(() => playEffects([{ ...ev, landed: true }]));
      return;
    }
    if (ev.type === 'roll') {
      if (ev.sum === 7) {
        const w = document.querySelector('.board-wrap');
        w.classList.remove('seven'); void w.offsetWidth; w.classList.add('seven');
        setTimeout(() => w.classList.remove('seven'), 1500);
        return;
      }
      let n = 0;
      B.hexes.filter((h) => h.num === ev.sum && h.id !== B.robber).forEach((h) => {
        const flash = fxAdd(`<polygon points="${hexPts(h, 0.96)}" fill="#fff8d0"/>`);
        fxRun(flash, [{ opacity: 0.75 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' });
        const ring = fxAdd(`<polygon points="${hexPts(h, 0.96)}" fill="none" stroke="#ffe066" stroke-width="6" style="transform-box:fill-box;transform-origin:center"/>`);
        fxRun(ring.firstChild, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0 }], { duration: 1000, easing: 'ease-out' });
        setTimeout(() => ring.remove(), 1100);
        const x0 = h.x * S, y0 = h.y * S;
        h.corners.forEach((vid) => {
          const b = V.buildings[vid];
          if (!b) return;
          const v = B.vertices[vid], x1 = v.x * S, y1 = v.y * S;
          for (let c = 0; c < (b.type === 'city' ? 2 : 1); c++) {
            const coin = fxAdd(`<g filter="url(#fxshadow)"><rect x="-16" y="-20" width="32" height="42" rx="5" fill="#fffaf0" stroke="#3a2a16" stroke-opacity=".35"/>
              <g clip-path="url(#fxclip)"><use href="#art-${h.res}-0" transform="translate(0,-2) scale(.3)"/></g>
              <rect x="-13" y="15" width="26" height="4" rx="2" fill="${colorOf(b.owner)}"/></g>`);
            const lift = 34 + c * 10;
            fxRun(coin, [
              { transform: `translate(${x0}px,${y0}px) scale(.2)`, opacity: 0 },
              { transform: `translate(${x0}px,${y0 - lift}px) scale(1.25) rotate(-8deg)`, opacity: 1, offset: 0.3 },
              { transform: `translate(${x1}px,${y1 - 6}px) scale(.95)`, opacity: 1, offset: 0.8 },
              { transform: `translate(${x1}px,${y1}px) scale(.3)`, opacity: 0 },
            ], { duration: 1600, delay: 250 + n * 140 + c * 180, easing: 'cubic-bezier(.35,.6,.35,1)' });
            n++;
          }
        });
      });
    } else if (ev.type === 'robber') {
      const h = B.hexes[B.robber], x = (h.x + (h.num ? -0.5 : 0)) * S, y = (h.y + 0.12 + 0.3) * S;
      for (let i = 0; i < 10; i++) {
        const a = Math.PI + (i / 9) * Math.PI, el = fxAdd(`<circle r="${5 + (i % 3) * 2}" fill="#e8dcc0"/>`);
        fxRun(el, [
          { transform: `translate(${x}px,${y}px) scale(.4)`, opacity: 0.9 },
          { transform: `translate(${x + Math.cos(a) * 30}px,${y + Math.sin(a) * 12 - 4}px) scale(1.4)`, opacity: 0 },
        ], { duration: 800, delay: 380, easing: 'ease-out' });
      }
    } else if (ev.type === 'build') {
      const v = B.vertices[ev.vid];
      setTimeout(() => burst(v.x * S, v.y * S, colorOf(ev.owner), 10, 38), 380);
    } else if (ev.type === 'road') {
      const e = B.edges[ev.eid], a = B.vertices[e.v[0]], b = B.vertices[e.v[1]];
      burst(((a.x + b.x) / 2) * S, ((a.y + b.y) / 2) * S, colorOf(ev.owner), 6, 24);
    }
  });
}

// ---------- Host interactions ----------
document.addEventListener('click', (e) => {
  if (IS_TV || !V) return;
  const t = e.target.closest('button, .pl, [data-a]');
  if (!t) return;
  const d = t.dataset;
  if (d.a) return act(d.a);
  if (d.dicemode) { realPick = [null, null]; return act('host:diceMode', { mode: d.dicemode }); }
  if (d.die !== undefined) { realPick[+d.die] = +d.n; renderTurnCard(cur()); return; }
  if (d.tool !== undefined) {
    if (!d.tool) return act('host:mode', { kind: null });
    return act('host:mode', { kind: d.tool, pid: selPid, free: $('chkFree').checked, ignore: $('chkIgnore').checked });
  }
  if (d.pick) { selPid = d.pick; renderTools(); if (V.mode && KIND[V.mode.kind]) act('host:mode', { kind: V.mode.kind, pid: selPid, free: $('chkFree').checked, ignore: $('chkIgnore').checked }); return; }
  if (d.steal) return act('host:steal', { victim: d.steal });
  if (d.mv) return act('host:movePlayer', { pid: d.mv, dir: +d.dir });
  if (d.kick) return act('host:kick', { pid: d.kick });
  if (d.adj) return act('host:adjust', { pid: editPid, res: d.adj, delta: +d.d });
  if (d.setturn) { act('host:setTurn', { idx: +d.setturn }); return closeModal(); }
  if (d.close !== undefined) return closeModal();
  if (d.load) return loadGame(d.load);
  if (d.edit && V.phase !== 'lobby') { editPid = d.edit; $('modal').classList.remove('hidden'); renderEdit(); return; }
  switch (t.id) {
    case 'btnRoll': return act('host:roll');
    case 'btnRealRoll': return submitRealRoll();
    case 'btnEnd': return act('host:endTurn');
    case 'btnSetDice': return act('host:roll', { d1: +$('d1').value, d2: +$('d2').value });
    case 'btnStart': return act('host:start', { shuffle: $('chkShuffle').checked });
    case 'btnNewBoard': return act('host:newBoard');
    case 'btnUndo': return act('host:undo');
    case 'btnSave': return saveGame();
    case 'btnLoad': return openLoad();
    case 'btnNewGame':
      if (confirm('Start a new game? Players stay joined, the island and hands are reset.')) act('host:newGame');
      return;
    case 'btnPresent': return togglePresent();
    case 'btnTV': window.open('/tv', 'hexhaven-tv', 'width=1280,height=720'); return;
    case 'btnQR': {
      const lob = $('lobby');
      if (V.phase === 'lobby') { lobbyPeek = !lobbyPeek; lob.dataset.forced = '0'; }
      else lob.dataset.forced = lob.dataset.forced === '1' ? '0' : '1';
      render();
      return;
    }
  }
});
// "View island": hide the join card to look at the board (works on the TV window too).
$('btnPeek').addEventListener('click', () => { lobbyPeek = true; $('lobby').dataset.forced = '0'; render(); });
$('lobby').addEventListener('click', (e) => {
  if (e.target !== $('lobby')) return;
  if (V.phase === 'lobby') lobbyPeek = true;
  $('lobby').dataset.forced = '0';
  render();
});
$('banner').addEventListener('click', () => { if (V && V.phase === 'lobby' && lobbyPeek) { lobbyPeek = false; render(); } });
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
$('ipPick').addEventListener('change', (e) => { joinIp = e.target.value; loadJoin(); });

function togglePresent() {
  document.body.classList.toggle('present');
  $('btnPresent').textContent = document.body.classList.contains('present') ? '👁️ Show controls' : '🙈 Hide controls';
}

document.addEventListener('keydown', (e) => {
  if (IS_TV || !V || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return act('host:undo'); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  // Type a real roll: first digit = red die, second = white die (works in either dice mode)
  if (/^[1-6]$/.test(k) && V.phase === 'play' && V.turn && !V.turn.rolled && !V.turn.step && !V.turn.sbp) {
    if (realPick[0] == null || realPick[1] != null) realPick = [+k, null];
    else { realPick[1] = +k; submitRealRoll(); }
    renderTurnCard(cur());
    if (realPick[0] && !realPick[1]) toast(`Red die ${realPick[0]} — now type the white die`);
    return;
  }
  if (k === 'backspace' && realPick[0]) { realPick = [null, null]; renderTurnCard(cur()); return; }
  if (k === 'r' && V.phase === 'play') {
    if (V.diceMode === 'real') toast('Real dice mode — type the two numbers, or tap the dice faces');
    else act('host:roll');
  }
  else if (k === 'e' && V.phase === 'play') act('host:endTurn');
  else if (k === 'escape') { if (editPid) closeModal(); else act('host:mode', { kind: null }); }
  else if (k === 'p') togglePresent();
});
