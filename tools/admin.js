#!/usr/bin/env node
// Live game fixes from the laptop's terminal (talks to the running server's /admin API, which only answers locally).
//
//   node tools/admin.js                          summary of the game: turn, hands, dev cards, VP, pieces
//   node tools/admin.js give <player> <res> <n>  give (or take, with a negative n) resource cards
//   node tools/admin.js turn <player>            make it someone's turn
//   node tools/admin.js act '<json>' [note]      run any host action, e.g. '{"type":"host:skipRobber"}'
//                                                add "as":"<player>" to act as that player instead
//   node tools/admin.js say <text>               write a line in the game log on the TV
//   node tools/admin.js undo                     undo the last action
//   node tools/admin.js get <file>               save the full live state to a JSON file (to edit it)
//   node tools/admin.js put <file> [note]        replace the live state with an edited JSON file
//   node tools/admin.js saves                    list save slots (named saves + a checkpoint per turn)
//   node tools/admin.js save <name>              save the game under a name
//   node tools/admin.js load <name>              load a save (e.g. "friday-night" or "auto/turn-012")
//   node tools/admin.js where                    which game the commands go to
// Add --local to any command to talk to the game on this machine instead of the one in .admin.json.
'use strict';
const fs = require('fs');

// Which game to talk to: .admin.json ({ "url": "https://…", "key": "…" }) next to package.json, or env
// HEXHAVEN_URL / HEXHAVEN_ADMIN_KEY. Without either it's the game on this machine. --local forces this machine.
const path = require('path');
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.admin.json'), 'utf8')); } catch { /* none */ }
const LOCAL = process.argv.includes('--local');
if (LOCAL) process.argv.splice(process.argv.indexOf('--local'), 1);
const URL_ = (!LOCAL && (process.env.HEXHAVEN_URL || CFG.url)) || `http://127.0.0.1:${process.env.PORT || 3700}`;
const KEY = process.env.HEXHAVEN_ADMIN_KEY || CFG.key || '';
const BASE = URL_.replace(/\/+$/, '') + '/admin';
const RES = ['wood', 'brick', 'wool', 'grain', 'ore'];
const ICON = { wood: '🌲', brick: '🧱', wool: '🐑', grain: '🌾', ore: '🪨' };

async function call(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (KEY) headers['x-admin-key'] = KEY;
  const r = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const getState = () => call('GET', '/state');

function findPlayer(s, who) {
  const w = String(who || '').toLowerCase();
  const p = s.players.find((x) => x.id === who) || s.players.find((x) => x.name.toLowerCase() === w)
    || s.players.find((x) => x.name.toLowerCase().startsWith(w)) || s.players.find((x) => x.color === w);
  if (!p) throw new Error(`No player "${who}". Players: ${s.players.map((x) => x.name).join(', ')}`);
  return p;
}

function summary(s) {
  const out = [];
  const t = s.turn;
  const cur = t && s.players[t.idx];
  out.push(`Phase: ${s.phase}${s.board.size ? ` · ${s.board.size} island` : ''} · dice: ${s.diceMode || 'digital'}${s.winner ? ` · WINNER: ${findPlayer(s, s.winner).name}` : ''}`);
  if (t) {
    out.push(`Turn ${t.num}: ${cur ? cur.name : '?'}${t.rolled && t.dice ? ` rolled ${t.dice[0]}+${t.dice[1]}=${t.dice[0] + t.dice[1]}` : ' (not rolled yet)'}${t.step ? ` · waiting on: ${t.step}` : ''}`);
    if (t.step === 'discard') out.push(`  Discards owed: ${Object.entries(t.discards).map(([pid, n]) => `${findPlayer(s, pid).name} ${n}`).join(', ')}`);
    if (t.sbp) out.push(`  Special building: ${findPlayer(s, t.sbp.queue[t.sbp.at]).name}`);
  }
  if (s.mode) out.push(`Placing: ${s.mode.kind} for ${findPlayer(s, s.mode.pid).name}`);
  const rb = s.board.hexes[s.board.robber];
  if (rb) out.push(`Bandit on: ${rb.res}${rb.num ? ' ' + rb.num : ''} (hex ${rb.id})`);
  out.push('');
  for (const p of s.players) {
    const pieces = { settlement: 0, city: 0, road: 0 };
    Object.values(s.buildings).forEach((b) => { if (b.owner === p.id) pieces[b.type]++; });
    Object.values(s.roads).forEach((o) => { if (o === p.id) pieces.road++; });
    const vp = pieces.settlement + 2 * pieces.city + p.dev.filter((d) => d.type === 'victoryPoint').length
      + (s.longestRoad === p.id ? 2 : 0) + (s.largestArmy === p.id ? 2 : 0);
    const extras = [s.longestRoad === p.id && 'longest road', s.largestArmy === p.id && 'largest army'].filter(Boolean);
    out.push(`${p === cur ? '▶' : ' '} ${p.name} (${p.color})  ${vp} VP incl. hidden${extras.length ? ' · ' + extras.join(', ') : ''}`);
    out.push(`    cards: ${RES.map((r) => `${ICON[r]}${r} ${p.res[r]}`).join('  ')}`);
    out.push(`    dev: ${p.dev.length ? p.dev.map((d) => d.type).join(', ') : '—'} · knights played ${p.knights}`);
    out.push(`    built: ${pieces.settlement} settlements, ${pieces.city} cities, ${pieces.road} roads`);
  }
  return out.join('\n');
}

(async () => {
  const [cmd = 'summary', ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'where': console.log(`Game: ${URL_}${KEY ? ' (with admin key)' : ''}`); break;
    case 'summary': console.log(summary(await getState())); break;
    case 'give': {
      const s = await getState();
      const p = findPlayer(s, args[0]);
      const res = RES.find((r) => r.startsWith(String(args[1]).toLowerCase()));
      const n = Math.trunc(Number(args[2] ?? 1));
      if (!res || !n) throw new Error('Usage: give <player> <wood|brick|wool|grain|ore> <n>');
      for (let i = 0; i < Math.abs(n); i++) await call('POST', '/act', { type: 'host:adjust', pid: p.id, res, delta: Math.sign(n) });
      console.log(`${n > 0 ? 'Gave' : 'Took'} ${Math.abs(n)} ${res} ${n > 0 ? 'to' : 'from'} ${p.name}`);
      break;
    }
    case 'turn': {
      const s = await getState();
      const p = findPlayer(s, args[0]);
      await call('POST', '/act', { type: 'host:setTurn', idx: s.players.indexOf(p) });
      console.log(`It's now ${p.name}'s turn`);
      break;
    }
    case 'act': {
      const a = JSON.parse(args[0]);
      if (a.pid || a.as || a.victim) {
        const s = await getState();
        for (const k of ['pid', 'as', 'victim']) if (a[k]) a[k] = findPlayer(s, a[k]).id;
      }
      if (args[1]) a.note = args.slice(1).join(' ');
      await call('POST', '/act', a);
      console.log('Done');
      break;
    }
    case 'say': await call('POST', '/say', { text: args.join(' ') }); console.log('Posted to the log'); break;
    case 'undo': await call('POST', '/undo'); console.log('Undone'); break;
    case 'get': {
      if (!args[0]) throw new Error('Usage: get <file>');
      fs.writeFileSync(args[0], JSON.stringify(await getState(), null, 1));
      console.log(`Wrote ${args[0]}`);
      break;
    }
    case 'put': {
      if (!args[0]) throw new Error('Usage: put <file> [note]');
      await call('PUT', '/state', { state: JSON.parse(fs.readFileSync(args[0], 'utf8')), note: args.slice(1).join(' ') || null });
      console.log('Live state replaced');
      break;
    }
    case 'saves': {
      const { saves } = await call('GET', '/saves');
      if (!saves.length) console.log('No saves yet');
      saves.forEach((x) => console.log(`${new Date(x.savedAt).toLocaleString()}  ${x.name.padEnd(24)} ${x.info}`));
      break;
    }
    case 'save': console.log(`Saved as ${(await call('POST', '/save', { name: args.join(' ') })).name}`); break;
    case 'load': console.log(`Loaded ${(await call('POST', '/load', { name: args.join(' ') })).name}`); break;
    default: throw new Error(`Unknown command "${cmd}". See the top of tools/admin.js for the list.`);
  }
})().catch((e) => {
  console.error(e.cause && e.cause.code === 'ECONNREFUSED' ? 'The game server is not running (npm start)' : `Error: ${e.message}`);
  process.exitCode = 1; // (process.exit() right after fetch can crash Node on Windows)
});
