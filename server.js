// Hexhaven server: serves the TV display, the optional host screen and the phone controller, and runs the game.
// The game is self-hosting: players do everything from their phones, and an autopilot keeps the game moving
// when someone's phone drops off. The host screen (/host) is optional, for manual control and fixes.
'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const G = require('./game');

const PORT = Number(process.env.PORT) || 3700;
// Inside a GitHub Codespace the game is reached through GitHub's public address for the port.
const ON_CODESPACE = !!(process.env.CODESPACES || process.env.CODESPACE_NAME);
const CODESPACE_URL = process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  ? `https://${process.env.CODESPACE_NAME}-${PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}` : null;
const SAVE_FILE = path.join(__dirname, 'savegame.json');

// How long a player can be offline before the game acts for them (ms).
const AUTO = { discard: 45000, specialBuild: 15000, setup: 90000, turn: 90000 };

const app = express();
app.set('trust proxy', true); // behind a hosting provider's proxy, so links use https
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get(['/', '/tv'], (_q, r) => r.redirect('/screen.html?tv'));
app.get('/host', (_q, r) => r.redirect('/screen.html'));
app.get('/play', (_q, r) => r.redirect('/play.html'));

// ---------- LAN address for phones ----------
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|Loopback|Tailscale|ZeroTier/i.test(name);
      out.push({ name, address: a.address, virtual });
    }
  }
  const rank = (x) => (x.virtual ? 10 : 0) + (/^192\.168\./.test(x.address) ? 0 : /^10\./.test(x.address) ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

app.get('/api/join', async (req, res) => {
  // Opened as localhost → phones need the laptop's Wi-Fi address. Opened any other way (a LAN address, or a
  // public web address when hosted online) → phones use that same address.
  const host = req.get('host') || '';
  const viaLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const fixed = process.env.PUBLIC_URL || (CODESPACE_URL && `${CODESPACE_URL}/play`);
  const addrs = viaLocalhost && !fixed ? lanAddresses() : [];
  const chosen = req.query.ip && addrs.find((a) => a.address === req.query.ip) ? req.query.ip : (addrs[0] && addrs[0].address) || 'localhost';
  const url = fixed || (viaLocalhost ? `http://${chosen}:${PORT}/play` : `${req.protocol}://${host}/play`);
  res.json({ url, addresses: addrs, qr: await QRCode.toDataURL(url, { margin: 1, width: 360 }) });
});
app.get('/healthz', (_q, r) => r.type('text').send('ok'));

// ---------- Who may control the game ----------
// On the laptop itself everything is allowed. From anywhere else (e.g. when the game is hosted online) the host
// screen and the admin API need ADMIN_KEY, so players can't peek at hands or change the game.
const ADMIN_KEY = process.env.ADMIN_KEY && process.env.ADMIN_KEY.length >= 16 ? process.env.ADMIN_KEY : null;
const isLoopback = (addr) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);
// "On the machine itself": a loopback connection that didn't come through a proxy. In a Codespace every visitor
// arrives through GitHub's port forwarder on loopback, so nothing counts as local there.
const isLocal = (addr, headers = {}) => !ON_CODESPACE && isLoopback(addr) && !headers['x-forwarded-for'] && !headers['x-forwarded-host'];
function keyOk(k) {
  if (!ADMIN_KEY || typeof k !== 'string') return false;
  const a = crypto.createHash('sha256').update(k).digest(), b = crypto.createHash('sha256').update(ADMIN_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- Game state ----------
let state;
try {
  state = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  if (!state.board || !state.players) throw new Error('bad save');
  console.log('Loaded saved game from savegame.json');
} catch {
  state = G.newState();
}
// Undo history: snapshots taken before each action, tagged with who did it.
let history = [];
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(SAVE_FILE, JSON.stringify(state), () => {}), 400);
}
const logLine = (text) => state.log.push({ id: state.seq++, text, t: Date.now() });

// ---------- Save slots ----------
// saves/<name>.json are named saves; saves/auto/turn-NNN.json is a checkpoint at the start of every turn.
const SAVES_DIR = path.join(__dirname, 'saves');
const AUTO_DIR = path.join(SAVES_DIR, 'auto');
fs.mkdirSync(AUTO_DIR, { recursive: true });
const cleanName = (n) => String(n || '').replace(/[^\w \-]/g, '').trim().slice(0, 40);
function savePath(name) {
  const auto = String(name || '').startsWith('auto/');
  const n = cleanName(auto ? name.slice(5) : name);
  if (!n) throw new G.GameError('Give the save a name');
  return { file: path.join(auto ? AUTO_DIR : SAVES_DIR, n + '.json'), name: (auto ? 'auto/' : '') + n };
}
function listSaves() {
  const read = (dir, auto) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    let info = '';
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const cur = s.turn && s.players[s.turn.idx];
      info = `${s.players.length} players · ${s.phase === 'play' ? `turn ${s.turn.num}${cur ? ` (${cur.name})` : ''}` : s.phase}${s.winner ? ' · finished' : ''}`;
    } catch { info = 'unreadable'; }
    return { name: (auto ? 'auto/' : '') + f.slice(0, -5), auto, savedAt: fs.statSync(path.join(dir, f)).mtimeMs, info };
  });
  return read(SAVES_DIR, false).concat(read(AUTO_DIR, true)).sort((a, b) => b.savedAt - a.savedAt);
}
function saveAs(name) {
  const { file, name: n } = savePath(name);
  if (n.startsWith('auto/')) throw new G.GameError('Pick a name that does not start with auto/');
  fs.writeFileSync(file, JSON.stringify(state));
  logLine(`💾 Game saved as “${n}”`);
  save();
  broadcast();
  return n;
}
function checkpoint() {
  const file = path.join(AUTO_DIR, `turn-${String(state.turn.num).padStart(3, '0')}.json`);
  fs.writeFile(file, JSON.stringify(state), () => {
    const all = fs.readdirSync(AUTO_DIR).filter((f) => f.endsWith('.json')).sort();
    all.slice(0, Math.max(0, all.length - 60)).forEach((f) => fs.unlink(path.join(AUTO_DIR, f), () => {}));
  });
}
const clearCheckpoints = () => fs.readdirSync(AUTO_DIR).forEach((f) => fs.unlinkSync(path.join(AUTO_DIR, f)));

// Swap in a whole new game state (loading a save, or a live edit). The old state goes on the undo stack.
function setState(next, by, note) {
  if (!next || !next.board || !Array.isArray(next.players) || !Array.isArray(next.log) || !next.phase) throw new G.GameError('That is not a Hexhaven game state');
  history.push({ snap: JSON.stringify(state), by, type: 'replace', turnNum: turnNum() });
  state = next;
  if (note) logLine(note);
  remapPlayers();
  save();
  broadcast();
}
function loadSave(name) {
  const { file, name: n } = savePath(name);
  if (!fs.existsSync(file)) throw new G.GameError(`No save called “${n}”`);
  setState(JSON.parse(fs.readFileSync(file, 'utf8')), 'host', `📂 Loaded save “${n}”`);
  return n;
}
// After the state is swapped, re-attach each phone to its player by its login token.
function remapPlayers() {
  for (const s of io.sockets.sockets.values()) {
    if (s.data.role !== 'player') continue;
    const p = s.data.token && state.players.find((x) => x.token === s.data.token);
    s.data.pid = p ? p.id : null;
    s.emit('joined', p ? { pid: p.id, token: p.token } : { pid: null });
  }
}

function connectedSet() {
  const set = new Set();
  for (const s of io.sockets.sockets.values()) if (s.data.pid) set.add(s.data.pid);
  return set;
}
function viewFor(sock, conn) {
  if (sock.data.role === 'host') return G.hostView(state, conn);
  if (sock.data.pid) {
    const v = G.playerView(state, sock.data.pid, conn);
    const top = history[history.length - 1];
    v.canUndo = !!(top && top.by === sock.data.pid && top.type === 'place' && top.turnNum === turnNum());
    return v;
  }
  const v = G.publicView(state, conn);
  v.lobbyPlayers = state.players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
  return v;
}
function broadcast() {
  const conn = connectedSet();
  for (const s of io.sockets.sockets.values()) if (s.data.role) s.emit('state', viewFor(s, conn));
}
const turnNum = () => (state.turn ? `${state.phase}:${state.turn.num}:${state.turn.setup ? state.turn.setup.i : ''}` : 'lobby');

// Runs an action atomically: on error the state is rolled back. Returns true on success.
function run(sock, actor, action) {
  const before = JSON.stringify(state);
  const beforeTurn = turnNum();
  const beforePhase = state.phase;
  try {
    if (action.type === 'host:undo') {
      if (!actor.host) throw new G.GameError('Only the host can undo');
      if (!history.length) throw new G.GameError('Nothing to undo');
      state = JSON.parse(history.pop().snap);
      logLine('↩️ Host undid the last action');
      remapPlayers();
    } else if (action.type === 'undoMine') {
      // A player may take back their own last build (or bandit move) while it's still the same turn.
      const top = history[history.length - 1];
      if (!top || top.by !== actor.pid || top.type !== 'place' || top.turnNum !== beforeTurn) throw new G.GameError('Nothing of yours to undo right now');
      state = JSON.parse(history.pop().snap);
      const p = state.players.find((x) => x.id === actor.pid);
      logLine(`↩️ ${p ? p.name : 'A player'} took back their last move`);
    } else if (action.type === 'host:newGame') {
      if (!actor.host) throw new G.GameError('Only the host can do that');
      history.push({ snap: before, by: 'host', type: action.type, turnNum: beforeTurn });
      const diceMode = state.diceMode;
      state = G.newState(state.players);
      if (diceMode) state.diceMode = diceMode;
    } else {
      G.apply(state, actor, action);
      if (action.type !== 'preview') {
        history.push({ snap: before, by: actor.host ? 'host' : actor.pid, type: action.type, turnNum: beforeTurn });
        if (history.length > 80) history.shift();
      }
    }
    if (beforePhase === 'lobby' && state.phase !== 'lobby') clearCheckpoints(); // a new game starts
    if (state.phase === 'play' && state.turn && turnNum() !== beforeTurn) checkpoint();
    if (action.type !== 'preview') save();
    broadcast();
    return true;
  } catch (e) {
    state = JSON.parse(before);
    if (!(e instanceof G.GameError)) console.error(e);
    if (sock) sock.emit('err', e instanceof G.GameError ? e.message : 'Something went wrong');
    return false;
  }
}

io.on('connection', (sock) => {
  sock.on('hello', (d = {}) => {
    let role = ['host', 'tv', 'player'].includes(d.role) ? d.role : 'tv';
    if (role === 'host' && !isLocal(sock.handshake.address, sock.handshake.headers) && !keyOk(d.key)) {
      sock.emit('needKey', { hasKey: !!ADMIN_KEY, wrong: !!d.key });
      role = 'tv';
    }
    sock.data.role = role;
    if (role === 'player' && d.token) {
      sock.data.token = d.token;
      const p = state.players.find((x) => x.token === d.token);
      if (p) sock.data.pid = p.id;
      sock.emit('joined', p ? { pid: p.id, token: p.token } : { pid: null });
    }
    broadcast();
  });

  sock.on('join', (d = {}) => {
    try {
      if (d.claim) { // re-join as an existing player (phone lost its login)
        const p = state.players.find((x) => x.id === d.claim) || (() => { throw new G.GameError('No such player'); })();
        sock.data.pid = p.id;
        sock.data.token = p.token;
        sock.emit('joined', { pid: p.id, token: p.token });
        return broadcast();
      }
      if (state.phase !== 'lobby') throw new G.GameError('The game already started — pick your name to rejoin');
      const name = String(d.name || '').trim().slice(0, 14);
      if (!name) throw new G.GameError('Enter your name');
      if (state.players.length >= G.MAX_PLAYERS) throw new G.GameError('The game is full (6 players)');
      if (!G.COLORS[d.color]) throw new G.GameError('Pick a colour');
      if (state.players.some((p) => p.color === d.color)) throw new G.GameError('That colour is taken');
      if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new G.GameError('That name is taken');
      const p = {
        id: crypto.randomBytes(4).toString('hex'), token: crypto.randomBytes(16).toString('hex'),
        name, color: d.color, res: { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 }, dev: [], knights: 0, ready: false,
      };
      state.players.push(p);
      G.fitBoard(state);
      logLine(`👋 ${name} joined`);
      sock.data.pid = p.id;
      sock.data.token = p.token;
      sock.emit('joined', { pid: p.id, token: p.token });
      save();
      broadcast();
    } catch (e) {
      sock.emit('err', e.message);
    }
  });

  sock.on('leave', () => {
    if (state.phase === 'lobby' && sock.data.pid) {
      state.players = state.players.filter((p) => p.id !== sock.data.pid);
      G.fitBoard(state);
      save();
    }
    sock.data.pid = null;
    broadcast();
  });

  sock.on('act', (a) => {
    if (!a || typeof a.type !== 'string') return;
    const actor = sock.data.role === 'host' ? { host: true, pid: null } : { pid: sock.data.pid };
    if (!actor.host && !actor.pid) return sock.emit('err', 'Join the game first');
    run(sock, actor, a);
  });

  // Save slots from the host screen
  sock.on('saves', (d = {}, reply) => {
    if (typeof reply !== 'function') return;
    if (sock.data.role !== 'host') return reply({ error: 'Only the host screen can do that' });
    try {
      if (d.op === 'save') return reply({ ok: true, name: saveAs(d.name) });
      if (d.op === 'load') return reply({ ok: true, name: loadSave(d.name) });
      return reply({ ok: true, saves: listSaves() });
    } catch (e) {
      reply({ error: e instanceof G.GameError ? e.message : 'Could not do that' });
    }
  });

  sock.on('disconnect', () => setTimeout(broadcast, 50));
});

// ---------- Admin API (only from the laptop itself) ----------
// Lets Claude (or anyone at the laptop's terminal) inspect and fix the game live: see tools/admin.js.
// Works from the machine running the server, or from anywhere with the x-admin-key header.
const admin = express.Router();
admin.use((req, res, next) => (isLocal(req.socket.remoteAddress, req.headers) || keyOk(req.get('x-admin-key'))
  ? next() : res.status(403).json({ error: 'The admin API needs the admin key (or must be used on the server itself)' })));
admin.use(express.json({ limit: '10mb' }));
const adminTry = (res, fn) => {
  try { res.json({ ok: true, ...fn() }); } catch (e) { res.status(400).json({ error: e.message }); }
};
admin.get('/state', (_q, r) => r.json(state));
admin.put('/state', (q, r) => adminTry(r, () => { setState(q.body.state, 'admin', q.body.note ? `🛠️ ${q.body.note}` : null); return {}; }));
admin.post('/act', (q, r) => {
  const { note, ...action } = q.body || {};
  if (typeof action.type !== 'string') return r.status(400).json({ error: 'Missing action type' });
  let err = null;
  const actor = action.as ? { pid: action.as } : { host: true, pid: null };
  delete action.as;
  const ok = run({ emit: (ev, m) => { if (ev === 'err') err = m; } }, actor, action);
  if (ok && note) { logLine(`🛠️ ${note}`); save(); broadcast(); }
  return ok ? r.json({ ok: true }) : r.status(400).json({ error: err });
});
admin.post('/say', (q, r) => adminTry(r, () => {
  const text = String((q.body || {}).text || '').trim().slice(0, 200);
  if (!text) throw new Error('Nothing to say');
  logLine(`🛠️ ${text}`); save(); broadcast(); return {};
}));
admin.post('/undo', (_q, r) => {
  let err = null;
  const ok = run({ emit: (ev, m) => { if (ev === 'err') err = m; } }, { host: true }, { type: 'host:undo' });
  return ok ? r.json({ ok: true }) : r.status(400).json({ error: err });
});
admin.get('/saves', (_q, r) => r.json({ saves: listSaves() }));
admin.post('/save', (q, r) => adminTry(r, () => ({ name: saveAs((q.body || {}).name) })));
admin.post('/load', (q, r) => adminTry(r, () => ({ name: loadSave((q.body || {}).name) })));
app.use('/admin', admin);

// ---------- Autopilot: keep the game moving when a phone drops off ----------
const lastSeen = {};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function autopilot() {
  const now = Date.now();
  const conn = connectedSet();
  state.players.forEach((p) => { if (conn.has(p.id) || !lastSeen[p.id]) lastSeen[p.id] = now; });
  const away = (pid) => (conn.has(pid) ? 0 : now - (lastSeen[pid] || now));
  if (state.winner || !state.turn || (state.phase !== 'play' && state.phase !== 'setup')) return;
  const t = state.turn;
  const name = (pid) => (state.players.find((p) => p.id === pid) || {}).name;
  const auto = (actor, action, note) => { if (run(null, actor, action) && note) { logLine(note); broadcast(); } return true; };

  // 1. Discards on a 7: drop random cards for anyone who's been away too long.
  if (t.step === 'discard') {
    for (const [pid, need] of Object.entries(t.discards)) {
      if (away(pid) < AUTO.discard) continue;
      const p = state.players.find((x) => x.id === pid);
      const pool = [];
      G.RES.forEach((r) => { for (let i = 0; i < p.res[r]; i++) pool.push(r); });
      const cards = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
      for (let i = 0; i < need && pool.length; i++) cards[pool.splice(Math.floor(Math.random() * pool.length), 1)[0]]++;
      return auto({ pid }, { type: 'discard', cards }, `⏱️ ${p.name} is offline — the game discarded for them`);
    }
  }
  // 2. Special building phase: skip absent builders quickly.
  if (t.sbp) {
    const pid = t.sbp.queue[t.sbp.at];
    if (away(pid) >= AUTO.specialBuild) return auto({ host: true }, { type: 'host:sbpSkip' }, null);
    return;
  }
  const cur = state.players[t.idx];
  const limit = state.phase === 'setup' ? AUTO.setup : AUTO.turn;
  if (away(cur.id) < limit) return;
  const view = G.publicView(state, conn);
  const L = view.legal;
  const me = { pid: cur.id };
  // 3. Setup: place on the best open spot.
  if (state.phase === 'setup' && state.mode) {
    if (state.mode.kind === 'settlement') {
      const score = (v) => state.board.vertices[v].hexes.reduce((n, h) => { const x = state.board.hexes[h]; return n + (x.num ? 6 - Math.abs(7 - x.num) : 0); }, 0);
      return auto(me, { type: 'place', target: { v: L.vertices.sort((a, b) => score(b) - score(a))[0] } }, `⏱️ ${cur.name} is offline — the game placed their settlement`);
    }
    return auto(me, { type: 'place', target: { e: pick(L.edges) } }, null);
  }
  // 4. Main game: finish whatever their turn is waiting on, then pass it on.
  if (t.step === 'robber' && state.mode && state.mode.pid === cur.id) {
    const others = L.hexes.filter((h) => state.board.hexes[h].corners.some((v) => state.buildings[v] && state.buildings[v].owner !== cur.id));
    return auto(me, { type: 'place', target: { hex: pick(others.length ? others : L.hexes) } }, `⏱️ The game moved the bandit for ${cur.name}`);
  }
  if (t.step === 'steal') return auto(me, { type: 'steal', victim: pick(t.victims) }, null);
  if (t.step) return;
  if (state.mode && state.mode.pid === cur.id && t.freeRoads) return auto(me, { type: 'place', target: { e: pick(L.edges) } }, null);
  if (state.mode && state.mode.pid === cur.id) run(null, me, { type: 'cancelBuild' });
  if (!t.rolled) return auto({ host: true }, { type: 'host:roll' }, `⏱️ ${cur.name} is offline — the game rolled for them`);
  return auto({ host: true }, { type: 'host:endTurn' }, `⏱️ ${name(cur.id)} is still offline — their turn was ended`);
}
setInterval(autopilot, 3000);

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log('\n  Hexhaven is running!\n');
  if (CODESPACE_URL) {
    console.log(`  TV / laptop display:        ${CODESPACE_URL}/`);
    console.log(`  Optional host controls:     ${CODESPACE_URL}/host   (needs the admin key)`);
    console.log(`  Phones join at:             ${CODESPACE_URL}/play   (or scan the QR code on the TV)`);
    console.log(`\n  Port ${PORT} must be Public (PORTS tab) for phones to get in.`);
    console.log(ADMIN_KEY ? '  Admin key: set — live fixes and host controls are on.' : '  Admin key: not set — live fixes and host controls are off (the game itself works fine).');
  } else {
    console.log(`  TV / laptop display:        http://localhost:${PORT}/`);
    console.log(`  Optional host controls:     http://localhost:${PORT}/host`);
    addrs.forEach((a) => console.log(`  Phones join at:             http://${a.address}:${PORT}/play   (${a.name})`));
  }
  console.log('');
});
