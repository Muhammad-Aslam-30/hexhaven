// Phone controller: a player's private hand, dev cards, trading and turn actions.
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RES = ['wood', 'brick', 'wool', 'grain', 'ore'];
const ICON = { wood: '🌲', brick: '🧱', wool: '🐑', grain: '🌾', ore: '🪨' };
const COST = {
  road: { wood: 1, brick: 1 }, settlement: { wood: 1, brick: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 }, dev: { wool: 1, grain: 1, ore: 1 },
};
const DEV_HELP = {
  knight: 'Move the bandit and rob someone',
  roadBuilding: 'Build 2 roads for free',
  yearOfPlenty: 'Take any 2 resources from the bank',
  monopoly: 'Everyone gives you all of one resource',
  victoryPoint: '+1 VP — keep it secret, counts automatically',
};
const TOKEN_KEY = 'hexhaven-token';
const store = {
  get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

const socket = io();
let V = null;
let joined = false;
let pickColor = null;
let sheet = null; // { kind: 'trade'|'yop'|'mono', ... }
let seenNotices = null;
let prevHand = null;
let wasMyTurn = false;
let lastRollId; // undefined until the first game state arrives
let rollPick = [null, null]; // real-dice entry on this phone

socket.on('connect', () => { $('conn').classList.add('hidden'); socket.emit('hello', { role: 'player', token: store.get() }); });
socket.on('disconnect', () => $('conn').classList.remove('hidden'));
socket.on('joined', (d) => {
  joined = !!d.pid;
  store.set(d.pid ? d.token : null);
  if (V) render();
});
socket.on('state', (v) => { V = v; render(); });
socket.on('err', (m) => toast(m, 'err'));

const act = (type, extra = {}) => socket.emit('act', { type, ...extra });
const playerById = (id) => V.players.find((p) => p.id === id);
const cur = () => (V.turn ? V.players[V.turn.idx] : null);
const dot = (hex, sm) => `<span class="dot${sm ? ' sm' : ''}" style="background:${hex}"></span>`;
const handStr = (h) => RES.filter((r) => h[r]).map((r) => ICON[r].repeat(Math.min(h[r], 4)) + (h[r] > 4 ? `×${h[r]}` : '')).join(' ');
const canAfford = (h, c) => RES.every((r) => (h[r] || 0) >= (c[r] || 0));
const total = (h) => RES.reduce((n, r) => n + (h[r] || 0), 0);

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
let tapped = false; // browsers only allow vibration after the first tap
document.addEventListener('pointerdown', () => { tapped = true; }, { once: true });
const buzz = (p) => { try { if (tapped && navigator.vibrate) navigator.vibrate(p); } catch { /* unsupported */ } };

// ---------- Join ----------
function renderJoin() {
  $('join').classList.remove('hidden');
  $('game').classList.add('hidden');
  const inLobby = V.phase === 'lobby';
  $('joinForm').classList.toggle('hidden', !inLobby);
  $('rejoin').classList.toggle('hidden', inLobby);
  if (inLobby) {
    const taken = new Set((V.lobbyPlayers || V.players).map((p) => p.color));
    if (pickColor && taken.has(pickColor)) pickColor = null;
    $('swatches').innerHTML = Object.entries(V.colors).map(([c, hex]) =>
      `<button class="swatch ${pickColor === c ? 'on' : ''}" data-color="${c}" style="background:${hex}" ${taken.has(c) ? 'disabled' : ''}>${c}</button>`).join('');
  } else {
    $('rejoinList').innerHTML = V.players.map((p) =>
      `<button class="btn big" data-claim="${p.id}" style="text-align:left">${dot(p.hex, true)} ${esc(p.name)} ${p.connected ? '<span class="muted">(connected)</span>' : ''}</button>`).join('');
  }
}

// ---------- Game ----------
function render() {
  if (!joined || !V.me) { renderJoin(); return; }
  $('join').classList.add('hidden');
  $('game').classList.remove('hidden');
  const me = V.me, t = V.turn, c = cur();
  const sbp = t && t.sbp;
  const myTurn = !!c && c.id === me.id && !sbp;
  const mySbp = !!sbp && sbp.pid === me.id;
  const pub = playerById(me.id);

  document.documentElement.style.setProperty('--me', pub.hex);
  $('meName').innerHTML = `${dot(pub.hex)}${esc(me.name)}`;
  $('meVp').textContent = V.phase === 'lobby' ? '' : `★ ${me.vpTotal} VP`;

  // Notices (private messages from the server)
  if (seenNotices === null) seenNotices = new Set(me.notices.map((n) => n.id));
  me.notices.forEach((n) => { if (!seenNotices.has(n.id)) { seenNotices.add(n.id); toast(n.text, 'good'); buzz(80); } });
  // Dice throw on every phone when someone rolls (not on first load)
  const rid = t && t.rollId;
  if (rid && rid !== lastRollId && lastRollId !== undefined && t.dice && V.phase === 'play') {
    Dice3D.roll(document.body, t.dice[0], t.dice[1], { size: 64, fixed: true, label: c ? (c.id === me.id ? 'You rolled' : `${c.name} rolled`) : '' });
  }
  lastRollId = rid || null;
  if ((myTurn || mySbp) && !wasMyTurn && V.phase !== 'lobby') buzz([120, 80, 120]);
  wasMyTurn = myTurn || mySbp;

  // Lobby
  const lobby = V.phase === 'lobby';
  $('lobbyWait').classList.toggle('hidden', !lobby);
  ['handSec', 'actions', 'devSec'].forEach((id) => $(id).classList.toggle('hidden', lobby));
  if (lobby) {
    const meP = playerById(me.id), leader = V.players[0] && V.players[0].id === me.id;
    const readyN = V.players.filter((p) => p.ready).length;
    $('turnPill').className = 'turn-pill' + (meP.ready ? '' : ' mine');
    $('turnPill').innerHTML = meP.ready ? `✅ You're ready — waiting for ${V.players.length - readyN} more` : 'Tap <b>Ready</b> when you are set';
    $('lobbyWait').innerHTML = `
      <div class="lobby-island">🏝️ <b>${esc(V.sizeLabel)}</b><span class="muted"> · ${V.players.length} joined · ${readyN} ready</span></div>
      <button class="btn big ${meP.ready ? '' : 'primary'}" data-a="ready">${meP.ready ? '✋ Not ready yet' : '✅ Ready'}</button>
      <div class="muted small">The game starts by itself when everyone is ready (2–6 players).</div>
      ${leader ? `<div class="leader-row"><button class="btn sm" data-a="leaderNewBoard">🔀 New island</button>
        <button class="btn sm" data-a="leaderStart" ${V.players.length < 2 ? 'disabled' : ''}>▶ Start now</button>
        <span class="muted small">You joined first, so you can reshuffle or start early.</span></div>` : ''}
      <div class="row" style="margin-top:6px"><button class="btn sm danger" id="btnLeave">Leave game</button></div>`;
    $('prompts').innerHTML = '';
    renderOthers(c);
    closeMap();
    return;
  }

  // Turn pill
  const pill = $('turnPill');
  pill.className = 'turn-pill' + (myTurn || mySbp ? ' mine' : '');
  if (V.winner) pill.innerHTML = `🏆 ${esc(playerById(V.winner.pid).name)} wins!`;
  else if (mySbp) pill.innerHTML = '🔨 Special build turn — build or buy a card, then tap <b>Done</b>';
  else if (sbp) pill.innerHTML = `🔨 Special building: ${dot(playerById(sbp.pid).hex, true)}${esc(playerById(sbp.pid).name)} (${sbp.at + 1}/${sbp.total})`;
  else if (V.phase === 'setup') pill.innerHTML = myTurn ? `Your turn: place your <b>${t.setup.step}</b> on the map` : `${dot(c.hex, true)}${esc(c.name)} is placing a ${t.setup.step}`;
  else if (myTurn) pill.innerHTML = t.rolled ? `Your turn — rolled <b>${t.dice[0] + t.dice[1]}</b>` : 'Your turn — roll the dice! 🎲';
  else pill.innerHTML = `${dot(c.hex, true)}${esc(c.name)}'s turn${t.rolled ? ` · rolled ${t.dice[0] + t.dice[1]}` : ''}`;

  renderPrompts(myTurn, c);
  renderHand(me);
  renderActions(me, myTurn, mySbp);
  renderDevs(me, myTurn);
  renderOthers(c);
  if (sheet) renderSheet();
  syncMap();
}

// ---------- Map: place pieces and move the bandit from the phone ----------
const RES_NAME = { wood: 'Forest', brick: 'Hills', wool: 'Pasture', grain: 'Fields', ore: 'Quarry', desert: 'Desert' };
let mapOpen = false, mapPick = null, mapZoom = false, mapKey = '';
const placing = () => !!(V && V.me && V.mode && V.mode.pid === V.me.id && ['settlement', 'road', 'city', 'bandit'].includes(V.mode.kind) && V.phase !== 'lobby');
function openMap() { mapOpen = true; $('map').classList.remove('hidden'); renderMap(); }
function closeMap() { mapOpen = false; mapPick = null; $('map').classList.add('hidden'); }
function syncMap() {
  // Open the map automatically each time it's my turn to place something
  const key = placing() ? `${V.mode.kind}:${V.turn && V.turn.num}:${V.turn && V.turn.setup ? V.turn.setup.i : ''}:${Object.keys(V.buildings).length}:${Object.keys(V.roads).length}` : '';
  if (key && key !== mapKey) { mapPick = null; openMap(); }
  else if (!key && mapKey && mapOpen) closeMap();
  mapKey = key;
  if (mapOpen) renderMap();
}
function pickInfo(tg) {
  const B = V.board;
  const tile = (hid) => { const h = B.hexes[hid]; return `${ICON[h.res] || '🏜️'} ${h.num || '–'}`; };
  if (tg.v != null) {
    const v = B.vertices[tg.v];
    const port = v.port ? ` · ⚓ ${v.port === '3:1' ? '3:1 harbour' : `2:1 ${v.port} harbour`}` : '';
    return `Touches ${v.hexes.map(tile).join(' · ')}${port}`;
  }
  if (tg.e != null) return 'Road between these two corners';
  if (tg.hex != null) {
    const h = B.hexes[tg.hex];
    const who = [...new Set(h.corners.map((v) => V.buildings[v]).filter(Boolean).map((b) => b.owner))].filter((id) => id !== V.me.id);
    return `${RES_NAME[h.res]} ${h.num || ''} · ${who.length ? 'can rob ' + who.map((id) => esc(playerById(id).name)).join(', ') : 'nobody to rob here'}`;
  }
  return '';
}
function renderMap() {
  if (!mapOpen || !V) return;
  const live = placing();
  const view = { ...V, mode: V.mode ? { ...V.mode, preview: live ? mapPick : V.mode.preview } : null };
  if (!live) view.legal = { vertices: [], edges: [], hexes: [] };
  BoardRenderer.render($('mapSvg'), view, {
    interactive: live, simple: true,
    onPick: (tg) => { mapPick = tg; act('preview', { target: tg }); renderMap(); buzz(20); },
  });
  $('mapSvg').classList.toggle('zoom', mapZoom);
  const m = V.mode;
  $('mapTitle').textContent = live ? (m.kind === 'bandit' ? '🦹 Move the bandit' : `📍 Place your ${m.kind}`) : '🗺️ The island';
  const cancelable = live && m.kind !== 'bandit' && V.phase === 'play' && !V.turn.freeRoads;
  $('mapFoot').innerHTML = live
    ? (mapPick
      ? `<div class="pick-info">${pickInfo(mapPick)}</div>
         <div class="map-btns"><button class="btn" data-map="clear">Choose again</button><button class="btn primary" data-map="confirm">✓ Confirm</button></div>`
      : `<div class="pick-info muted">Tap a glowing ${m.kind === 'bandit' ? 'tile' : m.kind === 'road' ? 'edge' : 'corner'}. ${mapZoom ? '' : 'Use 🔍 to zoom in.'}</div>
         ${cancelable ? '<div class="map-btns"><button class="btn sm" data-a="cancelBuild">Cancel build</button></div>' : ''}`)
    : '<div class="pick-info muted">Look around. When it’s your turn to place something, the glowing spots appear here.</div>';
}

function renderPrompts(myTurn, c) {
  const me = V.me, t = V.turn;
  const out = [];
  if (t.step === 'discard' && t.discards[me.id]) {
    if (!sheet || sheet.kind !== 'discard') openSheet({ kind: 'discard', sel: {} });
    out.push(`<div class="card prompt"><h3>🦹 A 7 was rolled</h3>You have more than 7 cards — discard <b>${t.discards[me.id]}</b>.<div class="row"><button class="btn primary" data-open="discard">Choose cards</button></div></div>`);
  } else if (t.step === 'discard') {
    out.push(`<div class="card prompt">🦹 Waiting for others to discard…</div>`);
  }
  const m0 = V.mode;
  if (m0 && m0.pid === me.id && ['settlement', 'road', 'city', 'bandit'].includes(m0.kind)) {
    const what = m0.kind === 'bandit' ? '🦹 Move the bandit' : V.phase === 'setup' ? `📍 Place your ${m0.kind}` : `🔨 Place your ${m0.kind}`;
    out.push(`<div class="card prompt"><h3>${what}</h3>${m0.kind === 'bandit' ? 'Pick any tile except where it is now.' : 'Tap a glowing spot on the map, then confirm.'}
      ${t.freeRoads ? ` <b>${t.freeRoads} free road(s) left.</b>` : ''}
      <div class="row"><button class="btn primary" data-map="open">🗺️ Open the map</button>
      ${m0.kind !== 'bandit' && V.phase === 'play' && !t.freeRoads ? '<button class="btn sm" data-a="cancelBuild">Cancel</button>' : ''}</div></div>`);
  }
  if (myTurn && t.step === 'steal') {
    out.push(`<div class="card prompt"><h3>🦹 Who do you rob?</h3><div class="row">${t.victims.map((id) => {
      const p = playerById(id);
      return `<button class="btn" data-steal="${id}">${dot(p.hex, true)}${esc(p.name)} (${p.cards})</button>`;
    }).join('')}</div></div>`);
  }
  V.offers.forEach((o) => {
    const from = playerById(o.from);
    if (o.from === me.id) {
      out.push(`<div class="card prompt"><h3>🤝 Your offer${o.to ? ' to ' + esc(playerById(o.to).name) : ''}</h3>
        You give ${handStr(o.give)} · you get ${handStr(o.want)}
        ${o.declined && o.declined.length ? `<div class="muted">Declined by ${o.declined.map((id) => esc(playerById(id).name)).join(', ')}</div>` : ''}
        <div class="row"><button class="btn sm" data-cancel-offer="${o.id}">Withdraw</button></div></div>`);
      return;
    }
    if (o.to && o.to !== me.id) return;
    if (o.declined && o.declined.includes(me.id)) return;
    if (!o.to && !myTurn && o.from !== c.id) return;
    const ok = canAfford(me.res, o.want);
    out.push(`<div class="card prompt"><h3>🤝 ${dot(from.hex, true)}${esc(from.name)} wants to trade</h3>
      You get ${handStr(o.give)}<br>You give ${handStr(o.want)}
      <div class="row"><button class="btn ok" data-accept="${o.id}" ${ok ? '' : 'disabled'}>${ok ? 'Accept' : "Can't afford"}</button><button class="btn danger" data-decline="${o.id}">Decline</button></div></div>`);
  });
  $('prompts').innerHTML = out.join('');
}

function renderHand(me) {
  const bumped = new Set();
  if (prevHand) RES.forEach((r) => { if (me.res[r] > prevHand[r]) bumped.add(r); });
  prevHand = { ...me.res };
  $('handCount').textContent = `(${total(me.res)})`;
  $('hand').innerHTML = RES.map((r) => `<div class="rc ${r} ${me.res[r] ? '' : 'zero'} ${bumped.has(r) ? 'bump' : ''}">
    <svg class="art" viewBox="-54 -58 108 116" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><use href="#art-${r}-0"/></svg>
    <div class="n">${me.res[r]}</div><div class="nm">${r}</div></div>`).join('');
}

function renderActions(me, myTurn, mySbp) {
  const t = V.turn;
  const main = V.phase === 'play' && !V.winner;
  const ready = main && ((myTurn && t.rolled && !t.step) || mySbp);
  const can = (k) => ready && canAfford(me.res, COST[k]);
  const costLine = (k) => RES.map((r) => ICON[r].repeat(COST[k][r] || 0)).join('');
  const html = [];
  if (V.canUndo) html.push('<button class="btn wide undo-btn" data-a="undoMine">↩️ Undo my last move</button>');
  if (main && myTurn && !t.rolled && !t.step) {
    if (V.diceMode === 'real') {
      const face = (n) => Array.from({ length: 9 }, (_, i) => (({ 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] })[n].includes(i + 1) ? '<i></i>' : '<b></b>')).join('');
      const ok = rollPick[0] && rollPick[1];
      html.push(`<div class="real-roll wide">
        <div class="rr-title">✋ Roll the real dice, then tap what they show</div>
        ${[0, 1].map((i) => `<div class="rr-row"><span class="rr-lbl${i ? '' : ' red'}">${i ? 'White' : 'Red'}</span>
          ${[1, 2, 3, 4, 5, 6].map((n) => `<button class="rr-die${i ? '' : ' red'}${rollPick[i] === n ? ' on' : ''}" data-rd="${i}" data-n="${n}" aria-label="${i ? 'White' : 'Red'} die ${n}">${face(n)}</button>`).join('')}</div>`).join('')}
        <button class="btn primary big" data-realroll ${ok ? '' : 'disabled'}>${ok ? `Confirm ${rollPick[0]} + ${rollPick[1]} = ${rollPick[0] + rollPick[1]}` : 'Tap both dice'}</button>
      </div>`);
    } else html.push('<button class="btn primary big wide" data-a="roll">🎲 Roll dice</button>');
  }
  html.push(`
    <button class="btn act" data-build="road" ${can('road') ? '' : 'disabled'}>🛣️ Road<small>${costLine('road')}</small></button>
    <button class="btn act" data-build="settlement" ${can('settlement') ? '' : 'disabled'}>🏠 Settle<small>${costLine('settlement')}</small></button>
    <button class="btn act" data-build="city" ${can('city') ? '' : 'disabled'}>🏰 City<small>${costLine('city')}</small></button>
    <button class="btn act" data-a="buyDev" ${can('dev') && V.devLeft ? '' : 'disabled'}>📜 Dev card<small>${costLine('dev')} · ${V.devLeft} left</small></button>
    <button class="btn act" data-open="trade" ${main && t.rolled && !t.step && !t.sbp ? '' : 'disabled'}>🤝 Trade<small>bank · players</small></button>
    ${mySbp
      ? '<button class="btn act ok" data-a="sbpDone">✅ Done<small>building</small></button>'
      : `<button class="btn act ${ready ? 'ok' : ''}" data-a="endTurn" ${ready ? '' : 'disabled'}>✅ End turn<small>&nbsp;</small></button>`}`);
  $('actions').innerHTML = html.join('');
}

function renderDevs(me, myTurn) {
  const t = V.turn;
  if (!me.dev.length) { $('devs').innerHTML = '<div class="empty">None yet. Buy one for 🐑🌾🪨.</div>'; return; }
  const groups = {};
  me.dev.forEach((d) => {
    groups[d.type] = groups[d.type] || { name: d.name, n: 0, ready: 0 };
    groups[d.type].n++;
    if (!d.fresh) groups[d.type].ready++;
  });
  $('devs').innerHTML = Object.entries(groups).map(([type, g]) => {
    const playable = V.phase === 'play' && !V.winner && myTurn && !t.sbp && !t.devPlayed && !t.step && g.ready > 0 && (type === 'knight' || t.rolled);
    const btn = type === 'victoryPoint' ? '<span class="muted">★</span>'
      : `<button class="btn sm primary" data-play="${type}" ${playable ? '' : 'disabled'}>Play</button>`;
    const note = g.ready < g.n && type !== 'victoryPoint' ? ' · new this turn' : '';
    return `<div class="dev"><div class="t">${esc(g.name)} ×${g.n}<small>${DEV_HELP[type]}${note}</small></div>${btn}</div>`;
  }).join('');
}

function renderOthers(c) {
  $('others').innerHTML = V.players.map((p) => `<div class="op ${c && c.id === p.id ? 'cur' : ''}">
    ${dot(p.hex, true)}<span class="nm">${esc(p.name)}${p.id === V.me.id ? ' (you)' : ''}</span>
    ${V.phase === 'lobby' ? '' : `<span class="st">🃏${p.cards} 📜${p.devCount} ⚔️${p.knights}${V.longestRoad === p.id ? ' 🛣️' : ''}${V.largestArmy === p.id ? ' 🛡️' : ''}</span><span class="v">${p.vp}★</span>`}
    ${p.connected ? '' : '<span class="st">offline</span>'}</div>`).join('');
}

// ---------- Sheets (trade, discard, card choices) ----------
function openSheet(s) { sheet = s; $('sheet').classList.remove('hidden'); renderSheet(); }
function closeSheet() { sheet = null; $('sheet').classList.add('hidden'); }

function stepper(r, val, max, key) {
  return `<div class="stepper"><span>${ICON[r]}</span>
    <button data-step="${key}" data-r="${r}" data-d="-1">−</button><b>${val}</b>
    <button data-step="${key}" data-r="${r}" data-d="1" ${val >= max ? 'disabled' : ''}>+</button>
    <span class="have">${key === 'want' ? '' : `have ${V.me.res[r]}`}</span></div>`;
}

function renderSheet() {
  const me = V.me, s = sheet, t = V.turn;
  let h = '';
  if (s.kind === 'discard') {
    const need = t.discards[me.id];
    if (!need) { closeSheet(); return; }
    const n = total(s.sel);
    h = `<h3>Discard ${need} cards</h3>${RES.map((r) => stepper(r, s.sel[r] || 0, me.res[r], 'sel')).join('')}
      <button class="btn primary big" data-do="discard" ${n === need ? '' : 'disabled'}>Discard ${n}/${need}</button>`;
  } else if (s.kind === 'trade') {
    if (!(V.phase === 'play' && t.rolled && !t.step)) { closeSheet(); return; }
    const c = cur();
    const myTurn = c.id === me.id;
    h = `<h3>Trade <button class="btn sm" data-close>Close</button></h3>
      <div class="tabs"><button data-tab="bank" class="${s.tab === 'bank' ? 'on' : ''}" ${myTurn ? '' : 'disabled'}>🏦 Bank / harbour</button><button data-tab="players" class="${s.tab === 'players' ? 'on' : ''}">👥 Players</button></div>`;
    if (s.tab === 'bank' && myTurn) {
      const ratio = me.ratios;
      h += `<div class="mini">You give</div><div class="pick">${RES.map((r) => `<button data-give="${r}" class="${s.give === r ? 'on' : ''}" ${me.res[r] >= ratio[r] ? '' : 'disabled'}>${ICON[r]}<small>${ratio[r]}:1</small></button>`).join('')}</div>
        <div class="mini">You get 1</div><div class="pick">${RES.map((r) => `<button data-get="${r}" class="${s.get === r ? 'on' : ''}" ${r === s.give || !V.bank[r] ? 'disabled' : ''}>${ICON[r]}<small>bank ${V.bank[r]}</small></button>`).join('')}</div>
        <button class="btn primary big" style="margin-top:14px" data-do="bank" ${s.give && s.get && s.give !== s.get ? '' : 'disabled'}>Trade ${s.give ? ratio[s.give] + ' ' + ICON[s.give] : ''} → 1 ${s.get ? ICON[s.get] : ''}</button>`;
    } else {
      s.tab = 'players';
      const targets = myTurn ? V.players.filter((p) => p.id !== me.id) : [c];
      if (!myTurn) s.to = c.id;
      h += `<div class="mini">Trade with</div><div class="chips">
          ${myTurn ? `<button data-to="" class="${!s.to ? 'on' : ''}">Anyone</button>` : ''}
          ${targets.map((p) => `<button data-to="${p.id}" class="${s.to === p.id ? 'on' : ''}">${dot(p.hex, true)}${esc(p.name)}</button>`).join('')}</div>
        <div class="cols"><div><div class="mini">You give</div>${RES.map((r) => stepper(r, s.give2[r] || 0, me.res[r], 'give2')).join('')}</div>
        <div><div class="mini">You want</div>${RES.map((r) => stepper(r, s.want[r] || 0, 9, 'want')).join('')}</div></div>
        <button class="btn primary big" data-do="offer" ${total(s.give2) && total(s.want) ? '' : 'disabled'}>Send offer</button>`;
    }
  } else if (s.kind === 'yop') {
    h = `<h3>Year of Plenty <button class="btn sm" data-close>Close</button></h3><div class="muted">Pick 2 resources (can be the same).</div>
      ${RES.map((r) => stepper(r, s.sel[r] || 0, Math.min(2, V.bank[r]), 'sel')).join('')}
      <button class="btn primary big" data-do="yop" ${total(s.sel) === 2 ? '' : 'disabled'}>Take them</button>`;
  } else if (s.kind === 'mono') {
    h = `<h3>Monopoly <button class="btn sm" data-close>Close</button></h3><div class="muted">Everyone gives you all of:</div>
      <div class="pick" style="margin-top:10px">${RES.map((r) => `<button data-mono="${r}" class="${s.res === r ? 'on' : ''}">${ICON[r]}<small>${r}</small></button>`).join('')}</div>
      <button class="btn primary big" style="margin-top:14px" data-do="mono" ${s.res ? '' : 'disabled'}>Claim ${s.res || ''}</button>`;
  }
  $('sheetCard').innerHTML = h;
}

// ---------- Input ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.color) { pickColor = d.color; renderJoin(); return; }
  if (b.id === 'btnJoin') return socket.emit('join', { name: $('name').value, color: pickColor });
  if (b.id === 'btnLeave') { socket.emit('leave'); store.set(null); joined = false; return; }
  if (d.claim) return socket.emit('join', { claim: d.claim });
  if (d.map) {
    if (d.map === 'open') openMap();
    else if (d.map === 'close') closeMap();
    else if (d.map === 'zoom') { mapZoom = !mapZoom; renderMap(); }
    else if (d.map === 'clear') { mapPick = null; act('preview', { target: null }); renderMap(); }
    else if (d.map === 'confirm' && mapPick) { act('place', { target: mapPick }); mapPick = null; renderMap(); }
    return;
  }
  if (d.rd !== undefined) { rollPick[+d.rd] = +d.n; return render(); }
  if (d.realroll !== undefined) { act('roll', { d1: rollPick[0], d2: rollPick[1] }); rollPick = [null, null]; return; }
  if (d.a) return act(d.a);
  if (d.build) return act('requestBuild', { kind: d.build });
  if (d.steal) return act('steal', { victim: d.steal });
  if (d.accept) return act('acceptOffer', { id: +d.accept });
  if (d.decline) return act('declineOffer', { id: +d.decline });
  if (d.cancelOffer) return act('cancelOffer', { id: +d.cancelOffer });
  if (d.play) {
    if (d.play === 'yearOfPlenty') return openSheet({ kind: 'yop', sel: {} });
    if (d.play === 'monopoly') return openSheet({ kind: 'mono' });
    const label = { knight: 'Play your Knight? You will move the bandit.', roadBuilding: 'Play Road Building? You get 2 free roads.' }[d.play];
    if (label && !confirm(label)) return;
    return act('playDev', { card: d.play });
  }
  if (d.open === 'trade') { const myTurn = cur().id === V.me.id; return openSheet({ kind: 'trade', tab: myTurn ? 'bank' : 'players', give2: {}, want: {}, to: myTurn ? '' : cur().id }); }
  if (d.open === 'discard') return openSheet({ kind: 'discard', sel: {} });
  if (d.close !== undefined) return closeSheet();
  if (!sheet) return;
  if (d.tab) { sheet.tab = d.tab; return renderSheet(); }
  if (d.give) { sheet.give = d.give; if (sheet.get === d.give) sheet.get = null; return renderSheet(); }
  if (d.get) { sheet.get = d.get; return renderSheet(); }
  if (d.to !== undefined) { sheet.to = d.to; return renderSheet(); }
  if (d.mono) { sheet.res = d.mono; return renderSheet(); }
  if (d.step) {
    const obj = sheet[d.step];
    obj[d.r] = Math.max(0, (obj[d.r] || 0) + +d.d);
    return renderSheet();
  }
  switch (d.do) {
    case 'discard': act('discard', { cards: sheet.sel }); return closeSheet();
    case 'bank': act('bankTrade', { give: sheet.give, get: sheet.get }); sheet.give = sheet.get = null; return renderSheet();
    case 'offer': act('offer', { to: sheet.to || null, give: sheet.give2, want: sheet.want }); return closeSheet();
    case 'yop': {
      const res = [];
      RES.forEach((r) => { for (let i = 0; i < (sheet.sel[r] || 0); i++) res.push(r); });
      act('playDev', { card: 'yearOfPlenty', res }); return closeSheet();
    }
    case 'mono': act('playDev', { card: 'monopoly', res: sheet.res }); return closeSheet();
  }
});
$('sheet').addEventListener('click', (e) => {
  if (e.target === $('sheet') && !(sheet && sheet.kind === 'discard')) closeSheet();
});
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
