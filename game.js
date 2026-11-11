// Hexhaven rules engine — server-authoritative game state for up to 6 players.
'use strict';

const RES = ['wood', 'brick', 'wool', 'grain', 'ore'];
const COST = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
};
const LIMITS = { road: 15, settlement: 5, city: 4 };
const WIN_VP = 10;

// Official component counts. 'basic' = 3–4 players, 'extension' = 5–6 players.
const SIZES = {
  basic: {
    label: 'Basic island (3–4 players)',
    rows: [3, 4, 5, 4, 3],
    tiles: { wood: 4, wool: 4, grain: 4, brick: 3, ore: 3, desert: 1 },
    ports: ['3:1', '3:1', '3:1', '3:1', 'wood', 'brick', 'wool', 'grain', 'ore'],
    bank: 19,
    dev: { knight: 14, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2, victoryPoint: 5 },
    // Number tokens A..R, laid in a counter-clockwise spiral from a corner, skipping the desert.
    spiral: [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11],
  },
  extension: {
    label: 'Extended island (5–6 players)',
    rows: [3, 4, 5, 6, 5, 4, 3],
    tiles: { wood: 6, wool: 6, grain: 6, brick: 5, ore: 5, desert: 2 },
    ports: ['3:1', '3:1', '3:1', '3:1', '3:1', 'wood', 'brick', 'wool', 'wool', 'grain', 'ore'],
    bank: 24,
    dev: { knight: 20, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3, victoryPoint: 5 },
    // Rulebook's random-layout option: any order, but red 6s and 8s may not touch.
    tokens: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
  },
};
const sizeFor = (n) => (n >= 5 ? 'extension' : 'basic');
const MAX_PLAYERS = 6;
const COLORS = {
  red: '#e5484d', blue: '#3b82f6', orange: '#f59e0b',
  white: '#f1f5f9', green: '#22c55e', purple: '#a855f7',
};
const DEV_NAMES = {
  knight: 'Knight', roadBuilding: 'Road Building', yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly', victoryPoint: 'Victory Point',
};

class GameError extends Error {}
const fail = (m) => { throw new GameError(m); };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const emptyHand = () => ({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
const handSize = (h) => RES.reduce((n, r) => n + (h[r] || 0), 0);
const handText = (h) => RES.filter((r) => h[r] > 0).map((r) => `${h[r]} ${r}`).join(', ');

// ---------- Board ----------
// Basic island: rings 2 → 1 → 0, each walked counter-clockwise (on screen) from the chosen corner.
function spiralOrder(hexes) {
  const dist = (h) => Math.hypot(h.x, h.y);
  const ring = (h) => (dist(h) < 0.1 ? 0 : dist(h) < 2 ? 1 : 2);
  const ang = (h) => Math.atan2(h.y, h.x);
  const corners = hexes.filter((h) => ring(h) === 2 && h.nb.length === 3);
  const a0 = ang(corners[Math.floor(Math.random() * corners.length)]);
  const TAU = Math.PI * 2;
  const ccw = (h) => { let a = (a0 - ang(h)) % TAU; if (a < -1e-9) a += TAU; return a < 1e-9 ? 0 : a; };
  return [2, 1, 0].flatMap((r) => hexes.filter((h) => ring(h) === r).sort((p, q) => ccw(p) - ccw(q)));
}

function buildBoard(size = 'extension') {
  const cfg = SIZES[size];
  const ROWS = cfg.rows;
  const mid = (ROWS.length - 1) / 2;
  const SQ3 = Math.sqrt(3);
  const hexes = [], vertices = [], edges = [];
  const vmap = new Map(), emap = new Map();
  const vkey = (x, y) => Math.round(x * 100) + ',' + Math.round(y * 100);

  ROWS.forEach((len, i) => {
    for (let j = 0; j < len; j++) {
      const h = { id: hexes.length, x: (j - (len - 1) / 2) * SQ3, y: (i - mid) * 1.5, corners: [], res: null, num: null };
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 180) * (60 * k - 90);
        const x = h.x + Math.cos(a), y = h.y + Math.sin(a);
        const key = vkey(x, y);
        let v = vmap.get(key);
        if (!v) {
          v = { id: vertices.length, x: +x.toFixed(4), y: +y.toFixed(4), hexes: [], adj: [], edges: [], port: null };
          vertices.push(v);
          vmap.set(key, v);
        }
        v.hexes.push(h.id);
        h.corners.push(v.id);
      }
      hexes.push(h);
    }
  });

  hexes.forEach((h) => {
    for (let k = 0; k < 6; k++) {
      const a = Math.min(h.corners[k], h.corners[(k + 1) % 6]);
      const b = Math.max(h.corners[k], h.corners[(k + 1) % 6]);
      const key = a + '-' + b;
      let e = emap.get(key);
      if (!e) {
        e = { id: edges.length, v: [a, b], hexes: [] };
        edges.push(e);
        emap.set(key, e);
        vertices[a].edges.push(e.id); vertices[b].edges.push(e.id);
        vertices[a].adj.push(b); vertices[b].adj.push(a);
      }
      e.hexes.push(h.id);
    }
  });
  hexes.forEach((h) => {
    h.nb = hexes.filter((o) => o !== h && Math.hypot(o.x - h.x, o.y - h.y) < SQ3 + 0.01).map((o) => o.id);
  });

  // Terrain: shuffled face down, then turned over (official variable set-up).
  const tiles = shuffle(Object.entries(cfg.tiles).flatMap(([t, n]) => Array(n).fill(t)));
  hexes.forEach((h, i) => { h.res = tiles[i]; });

  if (cfg.spiral) {
    // Official lettered tokens A..R along the spiral; the desert is skipped.
    const order = spiralOrder(hexes).filter((h) => h.res !== 'desert');
    order.forEach((h, i) => { h.num = cfg.spiral[i]; h.letter = String.fromCharCode(65 + i); });
  } else {
    // Random order, re-dealt until no red 6/8 tokens touch.
    const nums = cfg.tokens.slice();
    const land = hexes.filter((h) => h.res !== 'desert');
    const hot = (n) => n === 6 || n === 8;
    for (let tries = 0; tries < 20000; tries++) {
      shuffle(nums);
      land.forEach((h, i) => { h.num = nums[i]; });
      if (!land.some((h) => hot(h.num) && h.nb.some((n) => hot(hexes[n].num)))) break;
    }
  }

  // Harbours spaced evenly around the coast; harbour markers shuffled onto them.
  const coast = edges.filter((e) => e.hexes.length === 1).map((e) => {
    const a = vertices[e.v[0]], b = vertices[e.v[1]];
    return { e, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }).sort((p, q) => Math.atan2(p.my, p.mx) - Math.atan2(q.my, q.mx));
  const types = shuffle(cfg.ports.slice());
  const offset = Math.floor(Math.random() * coast.length);
  const ports = types.map((t, k) => {
    const c = coast[(Math.floor((k * coast.length) / types.length) + offset) % coast.length];
    const h = hexes[c.e.hexes[0]];
    const dx = c.mx - h.x, dy = c.my - h.y, d = Math.hypot(dx, dy);
    c.e.v.forEach((v) => { vertices[v].port = t; });
    return { edge: c.e.id, type: t, x: +(c.mx + (dx / d) * 0.62).toFixed(4), y: +(c.my + (dy / d) * 0.62).toFixed(4) };
  });

  const deserts = hexes.filter((h) => h.res === 'desert');
  return { size, hexes, vertices, edges, ports, robber: deserts[Math.floor(Math.random() * deserts.length)].id };
}

function makeDeck(size) {
  const d = [];
  for (const [t, n] of Object.entries(SIZES[size].dev)) for (let i = 0; i < n; i++) d.push(t);
  return shuffle(d);
}

// In the lobby, keep the island matched to the number of players.
function fitBoard(s) {
  if (s.phase !== 'lobby') return;
  const size = sizeFor(s.players.length);
  if (s.board.size !== size) { s.board = buildBoard(size); s.devDeck = makeDeck(size); }
}

function newState(oldPlayers = []) {
  const size = sizeFor(oldPlayers.length);
  return {
    phase: 'lobby',
    board: buildBoard(size),
    players: oldPlayers.map((p) => ({
      id: p.id, token: p.token, name: p.name, color: p.color,
      res: emptyHand(), dev: [], knights: 0,
    })),
    buildings: {}, // vertexId -> {owner, type}
    roads: {}, // edgeId -> owner
    devDeck: makeDeck(size),
    turn: null,
    mode: null,
    longestRoad: null,
    largestArmy: null,
    offers: [],
    log: [],
    notices: [],
    winner: null,
    seq: 1,
    diceMode: 'digital', // 'digital' = tap to roll · 'real' = roll physical dice and enter the numbers
  };
}

// ---------- Helpers ----------
const P = (s, pid) => s.players.find((p) => p.id === pid) || fail('Unknown player');
const current = (s) => (s.turn ? s.players[s.turn.idx] : null);
const colorName = (p) => p.name;
function log(s, text) {
  s.log.push({ id: s.seq++, text, t: Date.now() });
  if (s.log.length > 200) s.log.shift();
}
function notify(s, pid, text) {
  s.notices.push({ id: s.seq++, pid, text });
  if (s.notices.length > 60) s.notices.shift();
}
function bank(s) {
  const b = {};
  const each = SIZES[s.board.size || 'extension'].bank;
  RES.forEach((r) => { b[r] = each - s.players.reduce((n, p) => n + p.res[r], 0); });
  return b;
}
function canAfford(p, cost) { return RES.every((r) => (p.res[r] || 0) >= (cost[r] || 0)); }
function pay(p, cost) {
  if (!canAfford(p, cost)) fail(`${p.name} can't afford that (needs ${handText(cost)})`);
  RES.forEach((r) => { p.res[r] -= cost[r] || 0; });
}
function countPieces(s, pid) {
  const c = { road: 0, settlement: 0, city: 0 };
  Object.values(s.roads).forEach((o) => { if (o === pid) c.road++; });
  Object.values(s.buildings).forEach((b) => { if (b.owner === pid) c[b.type]++; });
  return c;
}

function roadLength(s, pid) {
  const { vertices, edges } = s.board;
  let best = 0;
  const used = new Set();
  const dfs = (v, len) => {
    if (len > best) best = len;
    for (const eid of vertices[v].edges) {
      if (s.roads[eid] !== pid || used.has(eid)) continue;
      const e = edges[eid];
      const other = e.v[0] === v ? e.v[1] : e.v[0];
      used.add(eid);
      const b = s.buildings[other];
      if (b && b.owner !== pid) { if (len + 1 > best) best = len + 1; } else dfs(other, len + 1);
      used.delete(eid);
    }
  };
  const starts = new Set();
  Object.entries(s.roads).forEach(([eid, o]) => { if (o === pid) edges[eid].v.forEach((v) => starts.add(v)); });
  starts.forEach((v) => dfs(v, 0));
  return best;
}

function updateAwards(s) {
  // Longest road (min 5). Holder keeps it on a tie.
  const lens = {};
  s.players.forEach((p) => { lens[p.id] = roadLength(s, p.id); });
  const max = Math.max(0, ...Object.values(lens));
  const holder = s.longestRoad;
  let next = null;
  if (max >= 5) {
    if (holder && lens[holder] === max) next = holder;
    else {
      const leaders = s.players.filter((p) => lens[p.id] === max);
      next = leaders.length === 1 ? leaders[0].id : null;
    }
  }
  if (next !== holder) {
    log(s, next ? `🛣️ ${P(s, next).name} now holds the Longest Road (${max})` : '🛣️ Nobody holds the Longest Road now');
    s.longestRoad = next;
  }
  // Largest army (min 3), must strictly beat the holder.
  const la = s.largestArmy;
  s.players.forEach((p) => {
    if (p.knights >= 3 && p.id !== s.largestArmy && (!s.largestArmy || p.knights > P(s, s.largestArmy).knights)) {
      s.largestArmy = p.id;
    }
  });
  if (la !== s.largestArmy) log(s, `⚔️ ${P(s, s.largestArmy).name} now holds the Largest Army`);
}

function vp(s, p, includeHidden) {
  let n = 0;
  Object.values(s.buildings).forEach((b) => { if (b.owner === p.id) n += b.type === 'city' ? 2 : 1; });
  if (s.longestRoad === p.id) n += 2;
  if (s.largestArmy === p.id) n += 2;
  if (includeHidden) n += p.dev.filter((d) => d.type === 'victoryPoint').length;
  return n;
}

function checkWin(s) {
  if (s.winner || s.phase !== 'play') return;
  const p = current(s);
  if (p && vp(s, p, true) >= WIN_VP) {
    s.winner = p.id;
    log(s, `🏆 ${p.name} wins with ${vp(s, p, true)} victory points!`);
  }
}

function tradeRatios(s, pid) {
  const r = {};
  RES.forEach((x) => { r[x] = 4; });
  Object.entries(s.buildings).forEach(([vid, b]) => {
    if (b.owner !== pid) return;
    const port = s.board.vertices[vid].port;
    if (port === '3:1') RES.forEach((x) => { r[x] = Math.min(r[x], 3); });
    else if (port) r[port] = 2;
  });
  return r;
}

// ---------- Legal placements ----------
function legalTargets(s, mode) {
  const out = { vertices: [], edges: [], hexes: [] };
  if (!mode) return out;
  const { vertices, edges, hexes } = s.board;
  const pid = mode.pid;
  const free = (v) => !s.buildings[v] && !vertices[v].adj.some((a) => s.buildings[a]);
  const touchesOwnRoad = (v) => vertices[v].edges.some((e) => s.roads[e] === pid);
  const setup = s.phase === 'setup';

  switch (mode.kind) {
    case 'settlement':
      vertices.forEach((v) => {
        if (mode.ignore ? !s.buildings[v.id] : free(v.id) && (setup || touchesOwnRoad(v.id))) out.vertices.push(v.id);
      });
      break;
    case 'city':
      Object.entries(s.buildings).forEach(([v, b]) => { if (b.owner === pid && b.type === 'settlement') out.vertices.push(+v); });
      break;
    case 'road':
      edges.forEach((e) => {
        if (s.roads[e.id] != null) return;
        if (mode.ignore) return out.edges.push(e.id);
        if (setup) { if (s.turn.setup && e.v.includes(s.turn.setup.last)) out.edges.push(e.id); return; }
        const ok = e.v.some((v) => {
          const b = s.buildings[v];
          if (b && b.owner === pid) return true;
          if (b && b.owner !== pid) return false;
          return vertices[v].edges.some((x) => x !== e.id && s.roads[x] === pid);
        });
        if (ok) out.edges.push(e.id);
      });
      break;
    case 'bandit':
      hexes.forEach((h) => { if (h.id !== s.board.robber) out.hexes.push(h.id); });
      break;
    case 'remove':
      out.vertices = Object.keys(s.buildings).map(Number);
      out.edges = Object.keys(s.roads).map(Number);
      break;
  }
  return out;
}

// ---------- Turn flow ----------
function setupPlayerIdx(s, i) {
  const n = s.players.length;
  return i < n ? i : 2 * n - 1 - i;
}

function startGame(s, shuffleOrder) {
  if (s.players.length < 2) fail('Need at least 2 players to start');
  fitBoard(s);
  s.devDeck = makeDeck(s.board.size);
  if (shuffleOrder) shuffle(s.players);
  s.phase = 'setup';
  s.turn = { idx: 0, num: 0, rolled: false, dice: null, devPlayed: false, freeRoads: 0, step: null, discards: {}, victims: [], setup: { i: 0, step: 'settlement', last: null } };
  s.mode = { kind: 'settlement', pid: s.players[0].id, free: true };
  log(s, `🎲 Game started! Turn order: ${s.players.map((p) => p.name).join(' → ')}`);
  log(s, `${s.players[0].name}: place your first settlement`);
}

function advanceSetup(s) {
  const t = s.turn;
  t.setup.i++;
  const n = s.players.length;
  if (t.setup.i >= 2 * n) {
    s.phase = 'play';
    t.setup = null;
    t.idx = 0; t.num = 1;
    s.mode = null;
    log(s, `✅ Setup done. ${s.players[0].name}, roll the dice!`);
    return;
  }
  t.idx = setupPlayerIdx(s, t.setup.i);
  t.setup.step = 'settlement';
  t.setup.last = null;
  s.mode = { kind: 'settlement', pid: current(s).id, free: true };
  log(s, `${current(s).name}: place your ${t.setup.i >= n ? 'second' : 'first'} settlement`);
}

function produce(s, sum) {
  const owed = {};
  s.board.hexes.forEach((h) => {
    if (h.num !== sum || h.id === s.board.robber) return;
    h.corners.forEach((v) => {
      const b = s.buildings[v];
      if (!b) return;
      owed[b.owner] = owed[b.owner] || emptyHand();
      owed[b.owner][h.res] += b.type === 'city' ? 2 : 1;
    });
  });
  const bk = bank(s);
  RES.forEach((r) => {
    const takers = Object.keys(owed).filter((pid) => owed[pid][r] > 0);
    const total = takers.reduce((n, pid) => n + owed[pid][r], 0);
    if (total <= bk[r]) return;
    if (takers.length === 1) owed[takers[0]][r] = bk[r];
    else { takers.forEach((pid) => { owed[pid][r] = 0; }); log(s, `🏦 The bank ran out of ${r} — nobody receives it`); }
  });
  const got = [];
  Object.entries(owed).forEach(([pid, h]) => {
    const p = P(s, pid);
    RES.forEach((r) => { p.res[r] += h[r]; });
    if (handSize(h) > 0) { got.push(`${p.name}: ${handText(h)}`); notify(s, pid, `You received ${handText(h)}`); }
  });
  log(s, got.length ? `📦 ${got.join(' · ')}` : '📦 Nobody produced anything');
}

function doRoll(s, d1, d2) {
  const t = s.turn;
  if (s.phase !== 'play') fail('The game is not in the main phase');
  if (t.rolled) fail('Dice already rolled this turn');
  if (t.step) fail('Finish the bandit first');
  const real = !!(d1 && d2);
  d1 = d1 || 1 + Math.floor(Math.random() * 6);
  d2 = d2 || 1 + Math.floor(Math.random() * 6);
  t.dice = [d1, d2];
  t.rolled = true;
  t.rollId = s.seq++;
  const sum = d1 + d2;
  log(s, `🎲 ${current(s).name} rolled ${sum} (${d1}+${d2})${real ? ' · real dice' : ''}`);
  if (sum === 7) {
    t.discards = {};
    s.players.forEach((p) => {
      const n = handSize(p.res);
      if (n > 7) { t.discards[p.id] = Math.floor(n / 2); notify(s, p.id, `A 7! Discard ${Math.floor(n / 2)} cards`); }
    });
    if (Object.keys(t.discards).length) {
      t.step = 'discard';
      log(s, `🦹 Seven! Waiting for discards: ${Object.keys(t.discards).map((pid) => P(s, pid).name).join(', ')}`);
    } else beginRobber(s);
  } else produce(s, sum);
}

function beginRobber(s) {
  s.turn.step = 'robber';
  s.mode = { kind: 'bandit', pid: current(s).id };
  log(s, `🦹 ${current(s).name}: move the bandit`);
}

function moveBandit(s, hexId) {
  const h = s.board.hexes[hexId] || fail('Bad tile');
  if (hexId === s.board.robber) fail('The bandit must move to a different tile');
  s.board.robber = hexId;
  s.mode = null;
  const t = s.turn;
  log(s, `🦹 Bandit moved to a ${h.res}${h.num ? ' ' + h.num : ''} tile`);
  if (!t || t.step !== 'robber') return;
  const me = current(s).id;
  const victims = [...new Set(h.corners.map((v) => s.buildings[v]).filter(Boolean).map((b) => b.owner))]
    .filter((pid) => pid !== me && handSize(P(s, pid).res) > 0);
  if (victims.length === 0) { t.step = null; log(s, '🦹 Nobody to steal from'); }
  else if (victims.length === 1) steal(s, victims[0]);
  else { t.step = 'steal'; t.victims = victims; log(s, `🦹 ${current(s).name}: choose who to steal from`); }
}

function steal(s, victimId) {
  const t = s.turn;
  const thief = current(s);
  const v = P(s, victimId);
  const pool = [];
  RES.forEach((r) => { for (let i = 0; i < v.res[r]; i++) pool.push(r); });
  t.step = null; t.victims = [];
  if (!pool.length) { log(s, `🦹 ${v.name} had nothing to steal`); return; }
  const r = pool[Math.floor(Math.random() * pool.length)];
  v.res[r]--; thief.res[r]++;
  log(s, `🦹 ${thief.name} stole a card from ${v.name}`);
  notify(s, thief.id, `You stole 1 ${r} from ${v.name}`);
  notify(s, v.id, `${thief.name} stole 1 ${r} from you`);
}

// 5–6 players: after each turn, every other player (in turn order) may build or buy
// development cards with the cards in hand — no trading and no playing development cards.
const canBuildSomething = (s, p) => ['road', 'settlement', 'city'].some((k) => canAfford(p, COST[k]))
  || (s.devDeck.length > 0 && canAfford(p, COST.dev));

function nextSpecialBuilder(s) {
  const t = s.turn;
  while (t.sbp.at < t.sbp.queue.length) {
    const p = P(s, t.sbp.queue[t.sbp.at]);
    if (canBuildSomething(s, p)) {
      notify(s, p.id, 'Special building phase: build or buy a development card now, then tap Done');
      return;
    }
    t.sbp.at++; // nothing affordable — skip them automatically
  }
  t.sbp = null;
  advanceTurn(s);
}

function endTurn(s, force) {
  const t = s.turn;
  if (s.phase !== 'play') fail('Not in the main phase');
  if (t.sbp) { if (!force) fail('The special building phase is still running'); t.sbp = null; return advanceTurn(s); }
  if (!force && !t.rolled) fail('Roll the dice first');
  if (!force && t.step) fail('Finish the bandit first');
  if (s.board.size === 'extension' && s.players.length > 1) {
    const n = s.players.length;
    t.step = null; t.discards = {}; t.victims = []; t.freeRoads = 0;
    s.mode = null;
    s.offers = [];
    t.sbp = { queue: Array.from({ length: n - 1 }, (_, k) => s.players[(t.idx + 1 + k) % n].id), at: 0 };
    log(s, `🔨 Special building phase after ${current(s).name}'s turn`);
    return nextSpecialBuilder(s);
  }
  advanceTurn(s);
}

function advanceTurn(s) {
  const t = s.turn;
  t.idx = (t.idx + 1) % s.players.length;
  t.num++;
  Object.assign(t, { rolled: false, dice: t.dice, devPlayed: false, freeRoads: 0, step: null, discards: {}, victims: [] });
  s.mode = null;
  s.offers = [];
  log(s, `➡️ ${current(s).name}'s turn`);
}

// ---------- Building ----------
function place(s, target, byHost) {
  const m = s.mode || fail('Pick a tool first');
  const legal = legalTargets(s, m);
  const p = m.pid != null ? P(s, m.pid) : null;
  const setup = s.phase === 'setup';

  if (m.kind === 'bandit') {
    if (!legal.hexes.includes(target)) fail('The bandit must move to a different tile');
    return moveBandit(s, target);
  }
  if (m.kind === 'remove') {
    if (target.v != null && s.buildings[target.v]) { log(s, `🧹 Host removed ${P(s, s.buildings[target.v].owner).name}'s ${s.buildings[target.v].type}`); delete s.buildings[target.v]; }
    else if (target.e != null && s.roads[target.e] != null) { log(s, `🧹 Host removed ${P(s, s.roads[target.e]).name}'s road`); delete s.roads[target.e]; }
    else fail('Nothing there to remove');
    updateAwards(s);
    return;
  }

  const pieces = countPieces(s, p.id);
  const cur = current(s);
  const freeRoad = m.kind === 'road' && s.turn && s.turn.freeRoads > 0 && cur && cur.id === p.id;
  const free = setup || m.free || freeRoad;

  if (m.kind === 'settlement') {
    const v = target.v;
    if (!legal.vertices.includes(v)) fail('You can’t build a settlement there');
    if (pieces.settlement >= LIMITS.settlement) fail(`${p.name} has no settlements left (max ${LIMITS.settlement})`);
    if (!free) pay(p, COST.settlement);
    s.buildings[v] = { owner: p.id, type: 'settlement' };
    log(s, `🏠 ${p.name} built a settlement`);
    if (setup) {
      s.turn.setup.last = v;
      s.turn.setup.step = 'road';
      if (s.turn.setup.i >= s.players.length) {
        const gain = emptyHand();
        s.board.vertices[v].hexes.forEach((hid) => { const h = s.board.hexes[hid]; if (h.res !== 'desert') gain[h.res]++; });
        RES.forEach((r) => { p.res[r] += gain[r]; });
        if (handSize(gain)) { log(s, `📦 ${p.name} collects ${handText(gain)}`); notify(s, p.id, `Starting resources: ${handText(gain)}`); }
      }
      s.mode = { kind: 'road', pid: p.id, free: true };
      log(s, `${p.name}: place a road next to it`);
      return;
    }
  } else if (m.kind === 'city') {
    const v = target.v;
    if (!legal.vertices.includes(v)) fail('A city must replace one of your settlements');
    if (pieces.city >= LIMITS.city) fail(`${p.name} has no cities left (max ${LIMITS.city})`);
    if (!free) pay(p, COST.city);
    s.buildings[v] = { owner: p.id, type: 'city' };
    log(s, `🏰 ${p.name} upgraded to a city`);
  } else if (m.kind === 'road') {
    const e = target.e;
    if (!legal.edges.includes(e)) fail('You can’t build a road there');
    if (pieces.road >= LIMITS.road) fail(`${p.name} has no roads left (max ${LIMITS.road})`);
    if (!free) pay(p, COST.road);
    s.roads[e] = p.id;
    log(s, `🛣️ ${p.name} built a road${freeRoad ? ' (free)' : ''}`);
    if (setup) { advanceSetup(s); return; }
    if (freeRoad) {
      s.turn.freeRoads--;
      if (s.turn.freeRoads > 0 && pieces.road + 1 < LIMITS.road) { updateAwards(s); return; } // keep road mode for the 2nd free road
      s.turn.freeRoads = 0;
    }
  }
  s.mode = null;
  updateAwards(s);
}

// ---------- Development cards ----------
function buyDev(s, p) {
  if (!s.devDeck.length) fail('No development cards left');
  pay(p, COST.dev);
  const type = s.devDeck.pop();
  p.dev.push({ type, turn: s.turn.num });
  log(s, `🃏 ${p.name} bought a development card`);
  notify(s, p.id, `You got: ${DEV_NAMES[type]}`);
}

function playDev(s, p, a) {
  const t = s.turn;
  if (t.devPlayed) fail('Only one development card per turn');
  if (t.step) fail('Finish the bandit first');
  const idx = p.dev.findIndex((d) => d.type === a.card && d.turn !== t.num);
  if (idx < 0) fail(p.dev.some((d) => d.type === a.card) ? 'You can’t play a card on the turn you bought it' : 'You don’t have that card');
  const bk = bank(s);
  switch (a.card) {
    case 'knight':
      p.knights++;
      log(s, `⚔️ ${p.name} played a Knight`);
      p.dev.splice(idx, 1); t.devPlayed = true;
      updateAwards(s);
      beginRobber(s);
      return;
    case 'roadBuilding': {
      const left = LIMITS.road - countPieces(s, p.id).road;
      if (left <= 0) fail('You have no roads left');
      t.freeRoads = Math.min(2, left);
      s.mode = { kind: 'road', pid: p.id };
      log(s, `🛣️ ${p.name} played Road Building — place ${t.freeRoads} free road(s)`);
      break;
    }
    case 'yearOfPlenty': {
      const pick = (a.res || []).filter((r) => RES.includes(r));
      if (pick.length !== 2) fail('Choose 2 resources');
      const need = {}; pick.forEach((r) => { need[r] = (need[r] || 0) + 1; });
      Object.entries(need).forEach(([r, n]) => { if (bk[r] < n) fail(`The bank doesn’t have ${n} ${r}`); });
      pick.forEach((r) => { p.res[r]++; });
      log(s, `🌾 ${p.name} played Year of Plenty (${pick.join(' + ')})`);
      break;
    }
    case 'monopoly': {
      const r = a.res;
      if (!RES.includes(r)) fail('Choose a resource');
      let n = 0;
      s.players.forEach((o) => {
        if (o.id === p.id || !o.res[r]) return;
        n += o.res[r];
        notify(s, o.id, `${p.name}'s Monopoly took your ${o.res[r]} ${r}`);
        o.res[r] = 0;
      });
      p.res[r] += n;
      log(s, `💰 ${p.name} played Monopoly on ${r} and collected ${n}`);
      break;
    }
    case 'victoryPoint':
      fail('Victory Point cards count automatically — keep them secret!');
      break;
    default: fail('Unknown card');
  }
  p.dev.splice(idx, 1);
  t.devPlayed = true;
}

// ---------- Trading ----------
function cleanHand(h) {
  const out = emptyHand();
  RES.forEach((r) => {
    const n = Math.floor(Number((h || {})[r]) || 0);
    if (n < 0 || n > 30) fail('Bad card count');
    out[r] = n;
  });
  return out;
}

function respondOffer(s, pid, id, accept) {
  const o = s.offers.find((x) => x.id === id) || fail('That offer is gone');
  if (o.from === pid) fail('That’s your own offer');
  if (o.to && o.to !== pid) fail('That offer isn’t for you');
  const cur = current(s).id;
  if (o.from !== cur && pid !== cur) fail('Only the player whose turn it is can trade');
  if (!accept) {
    if (o.to) s.offers = s.offers.filter((x) => x !== o);
    else o.declined = [...new Set([...(o.declined || []), pid])];
    log(s, `❌ ${P(s, pid).name} declined ${P(s, o.from).name}'s offer`);
    return;
  }
  const a = P(s, o.from), b = P(s, pid);
  if (!canAfford(a, o.give)) fail(`${a.name} no longer has those cards`);
  if (!canAfford(b, o.want)) fail('You don’t have the cards they want');
  RES.forEach((r) => { a.res[r] += o.want[r] - o.give[r]; b.res[r] += o.give[r] - o.want[r]; });
  s.offers = s.offers.filter((x) => x !== o);
  log(s, `🤝 ${a.name} traded ${handText(o.give)} to ${b.name} for ${handText(o.want)}`);
  notify(s, a.id, `${b.name} accepted your trade`);
}

// ---------- Action dispatch ----------
// actor: { host: true } or { pid }
function apply(s, actor, a) {
  const host = !!actor.host;
  const me = actor.pid ? P(s, actor.pid) : null;
  const cur = current(s);
  const isCur = me && cur && cur.id === me.id;
  const needTurn = () => { if (!isCur) fail('It’s not your turn'); };
  const needMain = () => {
    if (s.phase !== 'play') fail('Not available during setup');
    if (s.winner) fail('The game is over');
  };
  const sbp = s.turn && s.turn.sbp;
  const sbpPid = sbp ? sbp.queue[sbp.at] : null;
  const noSbp = () => { if (sbp) fail('Special building phase: only building and buying development cards'); };
  const needRolled = () => { needMain(); noSbp(); needTurn(); if (!s.turn.rolled) fail('Roll the dice first'); if (s.turn.step) fail('Finish the bandit first'); };
  // Building/buying: the current player after rolling, or the player whose special build turn it is.
  const needBuilder = () => {
    if (sbp) { needMain(); if (!me || me.id !== sbpPid) fail(`It’s ${P(s, sbpPid).name}’s special build turn`); } else needRolled();
  };

  if (a.type.startsWith('host:') && !host) fail('Only the host can do that');

  switch (a.type) {
    // ----- player actions -----
    case 'roll': {
      needMain(); noSbp(); needTurn();
      if (s.diceMode === 'real') {
        const d1 = Math.floor(a.d1), d2 = Math.floor(a.d2);
        if (!(d1 >= 1 && d1 <= 6 && d2 >= 1 && d2 <= 6)) fail('Enter both dice (1–6)');
        doRoll(s, d1, d2);
      } else doRoll(s);
      break;
    }
    case 'endTurn': needMain(); noSbp(); needTurn(); endTurn(s); break;
    case 'sbpDone':
      if (!sbp || !me || me.id !== sbpPid) fail('It’s not your special build turn');
      if (s.mode && s.mode.pid === me.id) s.mode = null;
      sbp.at++;
      nextSpecialBuilder(s);
      break;
    case 'requestBuild': {
      needBuilder();
      if (!['road', 'settlement', 'city'].includes(a.kind)) fail('Unknown build');
      if (countPieces(s, me.id)[a.kind] >= LIMITS[a.kind]) fail(`You have no ${a.kind === 'city' ? 'cities' : a.kind + 's'} left (max ${LIMITS[a.kind]})`);
      if (!(s.turn.freeRoads > 0 && a.kind === 'road') && !canAfford(me, COST[a.kind])) fail(`You need ${handText(COST[a.kind])}`);
      s.mode = { kind: a.kind, pid: me.id };
      if (!legalTargets(s, s.mode)[a.kind === 'road' ? 'edges' : 'vertices'].length) { s.mode = null; fail(`There’s nowhere you can build a ${a.kind} right now`); }
      log(s, `🔨 ${me.name} wants to build a ${a.kind} — host, tap a glowing spot`);
      break;
    }
    case 'cancelBuild':
      if (s.mode && s.mode.pid === me.id && s.mode.kind !== 'bandit' && s.phase === 'play' && !s.turn.freeRoads) s.mode = null;
      break;

    // ----- self-hosted play: players place their own pieces and the bandit from their phones -----
    case 'place': {
      if (!s.mode || s.mode.pid !== me.id || s.mode.kind === 'remove') fail('There’s nothing for you to place right now');
      if (s.winner) fail('The game is over');
      const tg = a.target || {};
      place(s, s.mode.kind === 'bandit' ? Number(tg.hex) : { v: tg.v != null ? Number(tg.v) : undefined, e: tg.e != null ? Number(tg.e) : undefined });
      break;
    }
    case 'preview': // the spot a player is considering, shown on the TV before they confirm
      if (s.mode && s.mode.pid === me.id) s.mode.preview = a.target && typeof a.target === 'object' ? { v: a.target.v, e: a.target.e, hex: a.target.hex } : null;
      break;
    case 'ready': {
      if (s.phase !== 'lobby') fail('The game has already started');
      me.ready = !me.ready;
      if (s.players.length >= 2 && s.players.every((p) => p.ready)) { log(s, '✅ Everyone is ready'); startGame(s, true); }
      break;
    }
    case 'leaderStart':
      if (s.phase !== 'lobby') fail('The game has already started');
      if (s.players[0].id !== me.id) fail(`Only ${s.players[0].name} (first to join) can start early`);
      startGame(s, true);
      break;
    case 'leaderNewBoard':
      if (s.phase !== 'lobby') fail('Only before the game starts');
      if (s.players[0].id !== me.id) fail(`Only ${s.players[0].name} (first to join) can reshuffle the island`);
      s.board = buildBoard(sizeFor(s.players.length));
      s.players.forEach((p) => { p.ready = false; });
      log(s, `🔀 ${me.name} reshuffled the island`);
      break;
    case 'buyDev': needBuilder(); buyDev(s, me); break;
    case 'playDev':
      needMain(); noSbp(); needTurn();
      if (a.card !== 'knight' && !s.turn.rolled) fail('Roll the dice first (only Knights can be played before rolling)');
      playDev(s, me, a);
      break;
    case 'discard': {
      const need = s.turn && s.turn.discards[me.id];
      if (!need) fail('You don’t need to discard');
      const h = cleanHand(a.cards);
      if (handSize(h) !== need) fail(`Discard exactly ${need} cards`);
      pay(me, h);
      delete s.turn.discards[me.id];
      log(s, `🗑️ ${me.name} discarded ${need} cards`);
      if (!Object.keys(s.turn.discards).length && s.turn.step === 'discard') beginRobber(s);
      break;
    }
    case 'steal':
      needTurn();
      if (s.turn.step !== 'steal' || !s.turn.victims.includes(a.victim)) fail('You can’t steal from them');
      steal(s, a.victim);
      break;
    case 'bankTrade': {
      needRolled();
      if (!RES.includes(a.give) || !RES.includes(a.get) || a.give === a.get) fail('Pick two different resources');
      const times = Math.max(1, Math.min(10, Math.floor(a.times || 1)));
      const ratio = tradeRatios(s, me.id)[a.give];
      if (me.res[a.give] < ratio * times) fail(`You need ${ratio * times} ${a.give}`);
      if (bank(s)[a.get] < times) fail(`The bank is out of ${a.get}`);
      me.res[a.give] -= ratio * times; me.res[a.get] += times;
      log(s, `🏦 ${me.name} traded ${ratio * times} ${a.give} with the bank for ${times} ${a.get}`);
      break;
    }
    case 'offer': {
      needMain(); noSbp();
      if (s.turn.step) fail('Finish the bandit first');
      if (!s.turn.rolled) fail('Wait until the dice are rolled');
      const give = cleanHand(a.give), want = cleanHand(a.want);
      if (!handSize(give) || !handSize(want)) fail('Choose what to give and what you want');
      if (!canAfford(me, give)) fail('You don’t have those cards');
      const to = a.to || null;
      if (to) { if (to === me.id) fail('Pick another player'); P(s, to); }
      if (!isCur && to !== cur.id) fail(`You can only trade with ${cur.name} (it’s their turn)`);
      s.offers = s.offers.filter((o) => o.from !== me.id);
      s.offers.push({ id: s.seq++, from: me.id, to, give, want, declined: [] });
      log(s, `🤝 ${me.name} offers ${handText(give)} for ${handText(want)}${to ? ' to ' + P(s, to).name : ''}`);
      break;
    }
    case 'acceptOffer': noSbp(); respondOffer(s, me.id, a.id, true); break;
    case 'declineOffer': respondOffer(s, me.id, a.id, false); break;
    case 'cancelOffer': s.offers = s.offers.filter((o) => !(o.id === a.id && o.from === me.id)); break;

    // ----- host actions -----
    case 'host:newBoard':
      if (s.phase !== 'lobby') fail('Only before the game starts');
      s.board = buildBoard(sizeFor(s.players.length));
      break;
    case 'host:start':
      if (s.phase !== 'lobby') fail('Already started');
      startGame(s, a.shuffle);
      break;
    case 'host:kick':
      if (s.phase !== 'lobby') fail('Only in the lobby');
      s.players = s.players.filter((p) => p.id !== a.pid);
      fitBoard(s);
      break;
    case 'host:movePlayer': {
      if (s.phase !== 'lobby') fail('Only in the lobby');
      const i = s.players.findIndex((p) => p.id === a.pid), j = i + (a.dir || 0);
      if (i < 0 || j < 0 || j >= s.players.length) break;
      [s.players[i], s.players[j]] = [s.players[j], s.players[i]];
      break;
    }
    case 'host:roll': {
      if (s.phase !== 'play') fail('Finish setup first');
      const d1 = Math.floor(a.d1), d2 = Math.floor(a.d2);
      if (a.d1 != null && !(d1 >= 1 && d1 <= 6 && d2 >= 1 && d2 <= 6)) fail('Dice must be 1–6');
      doRoll(s, a.d1 != null ? d1 : 0, a.d1 != null ? d2 : 0);
      break;
    }
    case 'host:diceMode':
      if (!['digital', 'real'].includes(a.mode)) fail('Unknown dice mode');
      s.diceMode = a.mode;
      log(s, a.mode === 'real' ? '✋ Real dice: roll at the table and enter the numbers' : '🎲 Digital dice: tap Roll to throw');
      break;
    case 'host:endTurn': endTurn(s, true); break;
    case 'host:sbpSkip':
      if (!sbp) fail('No special building phase running');
      if (s.mode && s.mode.pid === sbpPid) s.mode = null;
      log(s, `⏭️ Host skipped ${P(s, sbpPid).name}'s special build`);
      sbp.at++;
      nextSpecialBuilder(s);
      break;
    case 'host:setTurn':
      if (s.phase !== 'play') fail('Only in the main phase');
      if (!(a.idx >= 0 && a.idx < s.players.length)) fail('Bad player');
      s.turn.sbp = null;
      s.turn.idx = a.idx; s.turn.rolled = false; s.turn.step = null; s.turn.devPlayed = false; s.mode = null; s.offers = [];
      log(s, `➡️ Host passed the turn to ${current(s).name}`);
      break;
    case 'host:mode':
      if (!a.kind) { s.mode = s.phase === 'setup' ? s.mode : null; break; }
      if (!['road', 'settlement', 'city', 'bandit', 'remove'].includes(a.kind)) fail('Unknown tool');
      if (s.phase === 'lobby') fail('Start the game first');
      if (a.kind === 'bandit' || a.kind === 'remove') s.mode = { kind: a.kind, pid: cur ? cur.id : null };
      else s.mode = { kind: a.kind, pid: a.pid || (cur && cur.id), free: !!a.free, ignore: !!a.ignore };
      if (s.mode.pid) P(s, s.mode.pid);
      break;
    case 'host:place': place(s, a.target, true); break;
    case 'host:adjust': {
      const p = P(s, a.pid);
      if (!RES.includes(a.res)) fail('Bad resource');
      const d = Math.sign(a.delta);
      if (d > 0 && bank(s)[a.res] <= 0) fail(`Bank has no ${a.res}`);
      if (d < 0 && p.res[a.res] <= 0) break;
      p.res[a.res] += d;
      log(s, `✏️ Host ${d > 0 ? 'gave' : 'took'} 1 ${a.res} ${d > 0 ? 'to' : 'from'} ${p.name}`);
      break;
    }
    case 'host:steal':
      if (s.turn.step !== 'steal' || !s.turn.victims.includes(a.victim)) fail('Not a valid victim');
      steal(s, a.victim);
      break;
    case 'host:skipDiscards':
      if (s.turn.step !== 'discard') fail('Nobody is discarding');
      log(s, `⏭️ Host skipped remaining discards`);
      s.turn.discards = {};
      beginRobber(s);
      break;
    case 'host:skipRobber':
      if (!['robber', 'steal'].includes(s.turn && s.turn.step)) fail('No bandit step');
      s.turn.step = null; s.turn.victims = []; s.mode = null;
      log(s, '⏭️ Host skipped the bandit step');
      break;
    case 'host:clearWinner': s.winner = null; s.continued = true; break;
    default: fail('Unknown action: ' + a.type);
  }
  if (!s.continued) checkWin(s);
}

// ---------- Views ----------
function publicView(s, connected) {
  const t = s.turn;
  return {
    phase: s.phase,
    board: s.board,
    buildings: s.buildings,
    roads: s.roads,
    players: s.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, hex: COLORS[p.color],
      cards: handSize(p.res), devCount: p.dev.length, knights: p.knights,
      roadLen: roadLength(s, p.id), vp: vp(s, p, false),
      pieces: countPieces(s, p.id),
      connected: connected.has(p.id),
      ready: !!p.ready,
    })),
    turn: t && {
      idx: t.idx, num: t.num, rolled: t.rolled, dice: t.dice, rollId: t.rollId, step: t.step,
      discards: t.discards, victims: t.victims, freeRoads: t.freeRoads, devPlayed: t.devPlayed,
      setup: t.setup && { i: t.setup.i, step: t.setup.step },
      sbp: t.sbp && { pid: t.sbp.queue[t.sbp.at], at: t.sbp.at, total: t.sbp.queue.length },
    },
    sizeLabel: SIZES[s.board.size || 'extension'].label,
    diceMode: s.diceMode || 'digital',
    mode: s.mode,
    legal: legalTargets(s, s.mode),
    longestRoad: s.longestRoad,
    largestArmy: s.largestArmy,
    offers: s.offers,
    log: s.log.slice(-60),
    winner: s.winner && { pid: s.winner, vp: vp(s, P(s, s.winner), true) },
    bank: bank(s),
    devLeft: s.devDeck.length,
    colors: COLORS,
  };
}

function playerView(s, pid, connected) {
  const v = publicView(s, connected);
  const p = s.players.find((x) => x.id === pid);
  if (!p) return v;
  v.me = {
    id: p.id, name: p.name, color: p.color, res: p.res,
    dev: p.dev.map((d) => ({ type: d.type, name: DEV_NAMES[d.type], fresh: !!s.turn && d.turn === s.turn.num })),
    vpTotal: vp(s, p, true),
    ratios: tradeRatios(s, pid),
    notices: s.notices.filter((n) => n.pid === pid).slice(-5),
  };
  return v;
}

function hostView(s, connected) {
  const v = publicView(s, connected);
  v.hands = Object.fromEntries(s.players.map((p) => [p.id, p.res]));
  return v;
}

module.exports = {
  RES, COST, COLORS, SIZES, MAX_PLAYERS, GameError, newState, fitBoard, apply, publicView, playerView, hostView,
};
