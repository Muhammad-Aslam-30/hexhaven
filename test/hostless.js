// Self-hosted games: players do everything through phone actions — no host actions at all.
'use strict';
const G = require('../game');
const assert = require('assert');

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const legal = (s) => G.publicView(s, new Set()).legal;

function tryAct(s, actor, a) {
  const before = JSON.stringify(s);
  try { G.apply(s, actor, a); return true; } catch (e) {
    if (!(e instanceof G.GameError)) throw e;
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, JSON.parse(before));
    return false;
  }
}

function placeFor(s, pid) {
  const L = legal(s), k = s.mode.kind;
  const target = k === 'bandit' ? { hex: pick(L.hexes) } : k === 'road' ? { e: pick(L.edges) } : { v: pick(L.vertices) };
  G.apply(s, { pid }, { type: 'preview', target });
  assert.deepStrictEqual(s.mode.preview && (s.mode.preview.v ?? s.mode.preview.e ?? s.mode.preview.hex), target.v ?? target.e ?? target.hex);
  G.apply(s, { pid }, { type: 'place', target });
}

function game(n) {
  const s = G.newState();
  Object.keys(G.COLORS).slice(0, n).forEach((color, i) => s.players.push({ id: 'p' + i, token: 't' + i, name: 'P' + i, color, res: { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 }, dev: [], knights: 0, ready: false }));
  G.fitBoard(s);
  // Only the first player can start early or reshuffle
  assert(!tryAct(s, { pid: 'p1' }, { type: 'leaderStart' }), 'non-leader started the game');
  G.apply(s, { pid: 'p0' }, { type: 'leaderNewBoard' });
  // Everyone readies up → game starts by itself
  s.players.forEach((p, i) => { G.apply(s, { pid: p.id }, { type: 'ready' }); if (i < n - 1) assert.strictEqual(s.phase, 'lobby'); });
  assert.strictEqual(s.phase, 'setup', 'game did not auto-start when all were ready');

  // Setup: each player places their own pieces; nobody else can
  while (s.phase === 'setup') {
    const cur = s.players[s.turn.idx].id, other = s.players.find((p) => p.id !== cur).id;
    assert(!tryAct(s, { pid: other }, { type: 'place', target: { v: legal(s).vertices[0] } }), 'placed for someone else');
    placeFor(s, cur);
  }
  let turns = 0;
  while (!s.winner && turns++ < 1500) {
    const me = { pid: s.players[s.turn.idx].id };
    G.apply(s, me, { type: 'roll' });
    for (const [pid, need] of Object.entries(s.turn.discards || {})) {
      const p = s.players.find((x) => x.id === pid), cards = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
      let k = need; while (k > 0) { const r = pick(G.RES.filter((x) => p.res[x] > cards[x])); cards[r]++; k--; }
      G.apply(s, { pid }, { type: 'discard', cards });
    }
    if (s.turn.step === 'robber') placeFor(s, me.pid); // the roller moves the bandit from their phone
    if (s.turn.step === 'steal') G.apply(s, me, { type: 'steal', victim: pick(s.turn.victims) });
    for (let i = 0; i < 5 && !s.winner; i++) {
      const kind = pick(['city', 'settlement', 'road', 'road']);
      if (tryAct(s, me, { type: 'requestBuild', kind })) placeFor(s, me.pid);
      tryAct(s, me, { type: 'buyDev' });
      tryAct(s, me, { type: 'bankTrade', give: pick(G.RES), get: pick(G.RES) });
    }
    if (s.winner) break;
    G.apply(s, me, { type: 'endTurn' });
    while (s.turn.sbp) G.apply(s, { pid: s.turn.sbp.queue[s.turn.sbp.at] }, { type: 'sbpDone' });
  }
  return !!s.winner;
}

let wins = 0;
for (let g = 0; g < 24; g++) if (game([3, 4, 5, 6][g % 4])) wins++;
console.log(`OK — 24 self-hosted games (no host actions), ${wins} reached 10 VP.`);
