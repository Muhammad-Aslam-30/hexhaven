// Headless smoke test: 6 random bots play full games through the rules engine.
'use strict';
const G = require('../game');
const assert = require('assert');

const RES = G.RES;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function addPlayers(s, n) {
  Object.keys(G.COLORS).slice(0, n).forEach((color, i) => {
    s.players.push({ id: 'p' + i, token: 't' + i, name: 'P' + i, color, res: { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 }, dev: [], knights: 0 });
  });
}

function tryAct(s, actor, a) {
  const before = JSON.stringify(s);
  try { G.apply(s, actor, a); return true; } catch (e) {
    if (!(e instanceof G.GameError)) throw e;
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, JSON.parse(before));
    return false;
  }
}

function invariants(s) {
  const bank = G.publicView(s, new Set()).bank;
  RES.forEach((r) => {
    assert(bank[r] >= 0 && bank[r] <= 24, `bank ${r}=${bank[r]}`);
    s.players.forEach((p) => assert(p.res[r] >= 0, `${p.name} negative ${r}`));
  });
  // Distance rule
  Object.keys(s.buildings).forEach((v) => {
    s.board.vertices[v].adj.forEach((a) => assert(!s.buildings[a], 'distance rule broken'));
  });
}

function playGame(n) {
  const s = G.newState();
  addPlayers(s, n);
  const host = { host: true };
  G.fitBoard(s);
  assert.strictEqual(s.board.hexes.length, n >= 5 ? 30 : 19);
  assert.strictEqual(s.board.ports.length, n >= 5 ? 11 : 9);
  assert.strictEqual(s.board.hexes.filter((h) => h.res === 'desert').length, n >= 5 ? 2 : 1);
  G.apply(s, host, { type: 'host:start', shuffle: true });

  // Setup: host clicks legal spots
  while (s.phase === 'setup') {
    const L = G.publicView(s, new Set()).legal;
    if (s.mode.kind === 'settlement') G.apply(s, host, { type: 'host:place', target: { v: pick(L.vertices) } });
    else G.apply(s, host, { type: 'host:place', target: { e: pick(L.edges) } });
  }
  assert.strictEqual(Object.keys(s.buildings).length, 2 * n);
  assert.strictEqual(Object.keys(s.roads).length, 2 * n);

  let turns = 0;
  while (!s.winner && turns < 1500) {
    turns++;
    const cur = s.players[s.turn.idx];
    const me = { pid: cur.id };
    if (Math.random() < 0.1) tryAct(s, me, { type: 'playDev', card: 'knight' });
    if (s.winner) break;
    if (s.turn.step === 'robber') G.apply(s, host, { type: 'host:place', target: pick(G.publicView(s, new Set()).legal.hexes) });
    if (s.turn.step === 'steal') G.apply(s, me, { type: 'steal', victim: pick(s.turn.victims) });
    if (s.winner) break;
    G.apply(s, me, { type: 'roll' });
    // Discards
    for (const [pid, need] of Object.entries(s.turn.discards || {})) {
      const p = s.players.find((x) => x.id === pid);
      const cards = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
      let k = need;
      while (k > 0) { const r = pick(RES.filter((x) => p.res[x] > cards[x])); cards[r]++; k--; }
      G.apply(s, { pid }, { type: 'discard', cards });
    }
    if (s.turn.step === 'robber') G.apply(s, host, { type: 'host:place', target: pick(G.publicView(s, new Set()).legal.hexes) });
    if (s.turn.step === 'steal') G.apply(s, me, { type: 'steal', victim: pick(s.turn.victims) });
    invariants(s);

    // Random actions
    for (let i = 0; i < 6 && !s.winner; i++) {
      const roll = Math.random();
      if (roll < 0.35) {
        const kind = pick(['city', 'settlement', 'road', 'road']);
        if (tryAct(s, me, { type: 'requestBuild', kind })) {
          const L = G.publicView(s, new Set()).legal;
          const target = kind === 'road' ? { e: pick(L.edges) } : { v: pick(L.vertices) };
          tryAct(s, host, { type: 'host:place', target });
          if (s.mode && s.mode.kind !== 'road') s.mode = null;
        }
      } else if (roll < 0.5) tryAct(s, me, { type: 'buyDev' });
      else if (roll < 0.6) tryAct(s, me, { type: 'bankTrade', give: pick(RES), get: pick(RES) });
      else if (roll < 0.7) {
        const card = pick(['roadBuilding', 'yearOfPlenty', 'monopoly']);
        tryAct(s, me, { type: 'playDev', card, res: card === 'monopoly' ? pick(RES) : [pick(RES), pick(RES)] });
        while (s.turn.freeRoads > 0) {
          const L = G.publicView(s, new Set()).legal;
          if (!L.edges.length) { s.turn.freeRoads = 0; s.mode = null; break; }
          G.apply(s, host, { type: 'host:place', target: { e: pick(L.edges) } });
        }
      } else if (roll < 0.8) {
        const other = pick(s.players.filter((p) => p !== cur));
        const give = { [pick(RES)]: 1 }, want = { [pick(RES)]: 1 };
        if (tryAct(s, me, { type: 'offer', to: other.id, give, want })) {
          tryAct(s, { pid: other.id }, { type: Math.random() < 0.5 ? 'acceptOffer' : 'declineOffer', id: s.offers[0].id });
        }
      }
      invariants(s);
    }
    if (s.mode && s.mode.kind === 'road' && s.turn.freeRoads) { s.turn.freeRoads = 0; s.mode = null; }
    if (!s.winner) G.apply(s, me, { type: 'endTurn' });
    // Special building phase (5–6 players): each builder may build/buy, never trade or play cards.
    let guard = 0;
    while (s.turn.sbp && !s.winner && guard++ < 20) {
      sbpRounds++;
      const pid = s.turn.sbp.queue[s.turn.sbp.at];
      const b = { pid };
      assert(!tryAct(s, b, { type: 'bankTrade', give: 'wood', get: 'ore' }), 'trade allowed during special build');
      assert(!tryAct(s, b, { type: 'playDev', card: 'knight' }), 'dev card played during special build');
      assert(!tryAct(s, { pid: s.players[s.turn.idx].id }, { type: 'roll' }), 'next turn started during special build');
      const kind = pick(['road', 'settlement', 'city']);
      if (tryAct(s, b, { type: 'requestBuild', kind })) {
        const L = G.publicView(s, new Set()).legal;
        tryAct(s, host, { type: 'host:place', target: kind === 'road' ? { e: pick(L.edges) } : { v: pick(L.vertices) } });
        s.mode = null;
      }
      tryAct(s, b, { type: 'buyDev' });
      invariants(s);
      if (s.turn.sbp) G.apply(s, b, { type: 'sbpDone' });
    }
    assert(!s.turn.sbp || s.winner, 'special build phase never finished');
  }
  return { turns, winner: s.winner && s.players.find((p) => p.id === s.winner).name, lr: s.longestRoad, la: s.largestArmy };
}

let wins = 0;
let sbpRounds = 0;
const GAMES = 40;
for (let g = 0; g < GAMES; g++) {
  const r = playGame([3, 4, 5, 6][g % 4]);
  if (r.winner) wins++;
}
assert(sbpRounds > 0, 'special build phase never happened');
console.log(`OK — ${GAMES} games (3–6 players) played, ${wins} reached 10 VP, ${sbpRounds} special builds, no rule violations.`);
