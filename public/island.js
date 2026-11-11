// Hexhaven living island — a canvas scene drawn under the SVG board (tokens, pieces, clicks stay in SVG).
// One requestAnimationFrame loop draws: sea with glints and waves, lapping surf, every terrain tile with its
// own life (wind-blown wheat and trees, wandering sheep, deer, smoke, an eagle, a camel caravan…), boats,
// gulls, leaping fish, drifting cloud shadows and a day/night cycle with lit windows and lanterns.
// All original artwork, drawn procedurally. Respects prefers-reduced-motion (renders one still frame).
'use strict';

const IslandScene = (() => {
  const S = 60, TAU = Math.PI * 2, SQ3 = Math.sqrt(3);
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- small helpers ----------
  const rngOf = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const smooth = (t) => t * t * (3 - 2 * t);
  const backOut = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const inHex = (x, y, r) => { const ax = Math.abs(x), ay = Math.abs(y); return ax <= (r * SQ3) / 2 && ay <= r - ax / SQ3; };
  const nearToken = (x, y, pad = 0) => Math.hypot(x, y - 7) < 27 + pad;
  function hexPath(ctx, x, y, r) {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (60 * k - 90);
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function addHex(path, x, y, r) {
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (60 * k - 90);
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (k) path.lineTo(px, py); else path.moveTo(px, py);
    }
    path.closePath();
  }
  function scatter(rng, n, { r = 50, minD = 12, pad = 0, avoid = [] } = {}) {
    const pts = [];
    for (let tries = 0; pts.length < n && tries < n * 80; tries++) {
      const x = (rng() * 2 - 1) * r, y = (rng() * 2 - 1) * r;
      if (!inHex(x, y, r) || nearToken(x, y, pad)) continue;
      if (avoid.some(([ax, ay, ar]) => Math.hypot(x - ax, y - ay) < ar)) continue;
      if (pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < minD)) continue;
      pts.push([x, y]);
    }
    return pts;
  }
  const ellipse = (ctx, x, y, rx, ry, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); };
  const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); };
  function star(ctx, x, y, r, a) {
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.25, y - r * 0.25); ctx.lineTo(x + r, y); ctx.lineTo(x + r * 0.25, y + r * 0.25);
    ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.25, y + r * 0.25); ctx.lineTo(x - r, y); ctx.lineTo(x - r * 0.25, y - r * 0.25);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function vgrad(ctx, a, b, y0 = -66, y1 = 66) { const g = ctx.createLinearGradient(-20, y0, 20, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
  function bird(ctx, x, y, s, flap, color = '#22322a') {
    ctx.strokeStyle = color; ctx.lineWidth = 1.2 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 4 * s, y); ctx.quadraticCurveTo(x - 2 * s, y - 2.8 * s * flap, x, y);
    ctx.quadraticCurveTo(x + 2 * s, y - 2.8 * s * flap, x + 4 * s, y); ctx.stroke();
  }

  // ======================= TERRAIN PAINTERS =======================
  // Each terrain: setup(rng) → props · still(ctx, P) draws into the tile cache · live(ctx, P, t, W, tile) per frame.
  // Local coordinates: hex centre at 0,0, radius 60. Number token sits at (0,7) r≈24 — props keep clear of it.
  const PINES = [['#3a8a52', '#28673d'], ['#2f7a47', '#215c35'], ['#2a6f41', '#1b4f2e']];
  const T = {};

  // ---------- Forest ----------
  T.wood = {
    dark: '#245f39',
    setup(rng) {
      const trees = scatter(rng, 17, { r: 53, minD: 10.5, pad: 1 }).map(([x, y]) => ({
        x, y, s: 0.72 + rng() * 0.42, oak: rng() < 0.28, tone: Math.floor(rng() * 3), ph: rng() * TAU,
      })).sort((a, b) => a.y - b.y);
      const spots = scatter(rng, 2, { r: 42, minD: 26, pad: 6 });
      return { trees, deer: rng() < 0.75 && spots.length === 2 ? { a: spots[0], b: spots[1], ph: rng() * 30 } : null, birdPh: rng() * 30 };
    },
    still(ctx, P, rng) {
      ctx.fillStyle = vgrad(ctx, '#4f9a5f', '#2f6f42'); ctx.fillRect(-64, -68, 128, 136);
      for (let i = 0; i < 9; i++) { ctx.fillStyle = 'rgba(18,58,30,.18)'; circle(ctx, (rng() * 2 - 1) * 46, (rng() * 2 - 1) * 50, 8 + rng() * 10); ctx.fill(); }
      for (let i = 0; i < 26; i++) { ctx.fillStyle = 'rgba(160,210,140,.25)'; circle(ctx, (rng() * 2 - 1) * 50, (rng() * 2 - 1) * 54, 0.9 + rng()); ctx.fill(); }
      // mushrooms & a fallen log
      ctx.fillStyle = '#6e4a2a'; ctx.save(); ctx.translate(-38, 30); ctx.rotate(-0.3); ctx.fillRect(-7, -1.6, 14, 3.2); ctx.fillStyle = '#d2a56a'; circle(ctx, 7, 0, 1.6); ctx.fill(); ctx.restore();
      [[34, 34], [36, 31]].forEach(([x, y]) => { ctx.fillStyle = '#f2ece0'; ctx.fillRect(x - 0.5, y - 1.5, 1, 2); ctx.fillStyle = '#d64545'; ellipse(ctx, x, y - 1.8, 1.8, 1); ctx.fill(); });
      P.trees.forEach((tr) => { ctx.fillStyle = 'rgba(0,0,0,.2)'; ellipse(ctx, tr.x + 2, tr.y + 1, 9 * tr.s, 2.6 * tr.s); ctx.fill(); });
    },
    live(ctx, P, t, W) {
      // deer wander between two glades, pausing to graze
      if (P.deer) {
        const d = P.deer, u = ((t + d.ph) % 28) / 28;
        let x, y, walk = false, graze = false, dir;
        if (u < 0.3) { const p = ease(u / 0.3); x = lerp(d.a[0], d.b[0], p); y = lerp(d.a[1], d.b[1], p); walk = true; dir = Math.sign(d.b[0] - d.a[0]); }
        else if (u < 0.5) { [x, y] = d.b; graze = true; dir = Math.sign(d.b[0] - d.a[0]); }
        else if (u < 0.8) { const p = ease((u - 0.5) / 0.3); x = lerp(d.b[0], d.a[0], p); y = lerp(d.b[1], d.a[1], p); walk = true; dir = Math.sign(d.a[0] - d.b[0]); }
        else { [x, y] = d.a; graze = true; dir = Math.sign(d.a[0] - d.b[0]); }
        drawDeer(ctx, x, y, dir || 1, walk, graze, t);
      }
      for (const tr of P.trees) {
        const sway = Math.sin(t * 1.5 + tr.ph) * 0.03 + W(tr.x) * 0.075;
        ctx.save(); ctx.translate(tr.x, tr.y); ctx.rotate(sway); ctx.scale(tr.s, tr.s);
        if (tr.oak) {
          ctx.fillStyle = '#6e4a2a'; ctx.fillRect(-1.8, -9, 3.6, 10);
          ctx.fillStyle = '#4a9a5c'; circle(ctx, -5, -13, 7); ctx.fill();
          ctx.fillStyle = '#3c8550'; circle(ctx, 5, -13, 7); ctx.fill();
          ctx.fillStyle = '#57a868'; circle(ctx, 0, -19, 7.5); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.18)'; circle(ctx, -2.5, -21.5, 2.6); ctx.fill();
        } else {
          const c = PINES[tr.tone];
          ctx.fillStyle = '#6e4a2a'; ctx.fillRect(-1.6, -5, 3.2, 6);
          for (let i = 0; i < 3; i++) {
            const w = 12 - i * 2.8, y0 = -3 - i * 8, y1 = y0 - 13;
            ctx.fillStyle = c[0]; ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(w, y0); ctx.lineTo(-w, y0); ctx.closePath(); ctx.fill();
            ctx.fillStyle = c[1]; ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(w, y0); ctx.lineTo(0, y0); ctx.closePath(); ctx.fill();
          }
          ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1.1; ctx.beginPath();
          ctx.moveTo(-2, -26); ctx.lineTo(-5, -21); ctx.moveTo(-4, -17); ctx.lineTo(-7, -12); ctx.stroke();
        }
        ctx.restore();
      }
      // a few birds burst out of the canopy now and then
      const u = (t + P.birdPh) % 32;
      if (u < 4.5 && P.trees.length) {
        const src = P.trees[Math.floor((t + P.birdPh) / 32) % P.trees.length], p = u / 4.5;
        ctx.globalAlpha = p > 0.75 ? (1 - p) / 0.25 : 1;
        for (let i = 0; i < 3; i++) bird(ctx, src.x + (i - 1) * 5 + p * 46 * (i - 0.6), src.y - 22 - p * 48 - i * 3, 0.9, 0.4 + 0.6 * Math.abs(Math.sin(t * 13 + i)));
        ctx.globalAlpha = 1;
      }
    },
  };
  function drawDeer(ctx, x, y, dir, walk, graze, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ellipse(ctx, 0, 6.5, 7, 1.6); ctx.fill();
    ctx.strokeStyle = '#6b4526'; ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.beginPath();
    [-4.5, -2.5, 2.5, 4.5].forEach((lx, i) => { const sw = walk ? Math.sin(t * 9 + i * 1.7) * 1.8 : 0; ctx.moveTo(lx, 1.5); ctx.lineTo(lx + sw, 6.5); });
    ctx.stroke();
    ctx.fillStyle = '#9b6a3c'; ellipse(ctx, 0, 0, 6.5, 3.1); ctx.fill();
    ctx.fillStyle = '#c99a6a'; ellipse(ctx, 0, 1.4, 4.6, 1.3); ctx.fill();
    ctx.fillStyle = '#f3eee5'; circle(ctx, -6.4, -1, 1.2); ctx.fill();
    ctx.fillStyle = '#9b6a3c';
    if (graze) { ctx.save(); ctx.translate(5, 0); ctx.rotate(0.9); ctx.fillRect(0, -1.2, 5, 2.4); ellipse(ctx, 5.5, 0.3, 2.4, 1.5); ctx.fill(); ctx.restore(); }
    else {
      const nod = walk ? Math.sin(t * 9) * 0.4 : 0;
      ctx.beginPath(); ctx.moveTo(4, -1.5); ctx.lineTo(6.8, -6 + nod); ctx.lineTo(8.3, -5.2 + nod); ctx.lineTo(6, -0.5); ctx.closePath(); ctx.fill();
      ellipse(ctx, 8.6, -6.4 + nod, 2.4, 1.5, 0.2); ctx.fill();
      ctx.strokeStyle = '#5a3a1c'; ctx.lineWidth = 0.7; ctx.beginPath();
      ctx.moveTo(7.6, -7.6 + nod); ctx.lineTo(6.8, -10.6 + nod); ctx.moveTo(7.1, -9.4 + nod); ctx.lineTo(5.6, -10.4 + nod);
      ctx.moveTo(8.6, -7.6 + nod); ctx.lineTo(9.4, -10.4 + nod); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Pasture ----------
  const FENCE = [[-50, -4], [-22, -16]];
  T.wool = {
    dark: '#74a243',
    setup(rng) {
      const homes = scatter(rng, 5, { r: 44, minD: 17, pad: 5, avoid: [[-36, -10, 12]] });
      return {
        sheep: homes.map(([x, y], i) => ({ x, y, ph: rng() * 7, seed: Math.floor(rng() * 1e6) + i })),
        tufts: scatter(rng, 16, { r: 53, minD: 7 }).map(([x, y]) => ({ x, y, ph: rng() * TAU })),
        flowers: scatter(rng, 22, { r: 54, minD: 5 }).map(([x, y]) => ({ x, y, c: ['#fff', '#ffe36e', '#f7a1c4', '#fff'][Math.floor(rng() * 4)] })),
        fly: { ph: rng() * TAU, c: ['#ffd84a', '#ffffff', '#ff9ec7'][Math.floor(rng() * 3)] },
      };
    },
    still(ctx, P) {
      ctx.fillStyle = vgrad(ctx, '#a9d67a', '#82b85a'); ctx.fillRect(-64, -68, 128, 136);
      ctx.fillStyle = 'rgba(190,226,140,.7)'; ellipse(ctx, -18, -28, 44, 15); ctx.fill();
      ctx.fillStyle = 'rgba(190,226,140,.55)'; ellipse(ctx, 24, 34, 40, 14); ctx.fill();
      ctx.fillStyle = 'rgba(130,186,90,.5)'; ellipse(ctx, -30, 40, 28, 10); ctx.fill();
      P.flowers.forEach((f) => { ctx.fillStyle = f.c; circle(ctx, f.x, f.y, 1.4); ctx.fill(); });
      ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.beginPath();
      ctx.moveTo(FENCE[0][0], FENCE[0][1]); ctx.lineTo(FENCE[1][0], FENCE[1][1]); ctx.moveTo(-50, 1); ctx.lineTo(-22, -11);
      [[-48, -8], [-39, -12], [-30, -15], [-22, -19]].forEach(([x, y]) => { ctx.moveTo(x, y); ctx.lineTo(x, y + 12); });
      ctx.stroke();
    },
    live(ctx, P, t, W) {
      ctx.strokeStyle = '#6ea546'; ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.beginPath();
      for (const g of P.tufts) {
        const b = W(g.x) * 2.6 + Math.sin(t * 2 + g.ph) * 0.6;
        ctx.moveTo(g.x - 2, g.y); ctx.lineTo(g.x - 1 + b, g.y - 4);
        ctx.moveTo(g.x, g.y); ctx.lineTo(g.x + b * 1.2, g.y - 5);
        ctx.moveTo(g.x + 2, g.y); ctx.lineTo(g.x + 1 + b, g.y - 4);
      }
      ctx.stroke();
      const pts = P.sheep.map((sh) => sheepState(sh, t)).sort((a, b) => a.y - b.y);
      pts.forEach((s) => drawSheep(ctx, s, t));
      // butterfly
      const f = P.fly, bx = Math.sin(t * 0.37 + f.ph) * 34, by = -14 + Math.sin(t * 0.61 + f.ph * 2) * 26 + Math.sin(t * 3) * 2;
      const flap = Math.abs(Math.sin(t * 16));
      ctx.fillStyle = f.c; ellipse(ctx, bx - 1.6 * flap, by, 1.9 * flap + 0.3, 1.3); ctx.fill(); ellipse(ctx, bx + 1.6 * flap, by, 1.9 * flap + 0.3, 1.3); ctx.fill();
    },
  };
  // Sheep stand still and graze: the head eases down to the grass, nibbles, then lifts to look around.
  function sheepState(sh, t) {
    const period = 6 + (sh.seed % 4), u = ((t + sh.ph) % period) / period;
    let g;
    if (u < 0.18) g = smooth(u / 0.18);
    else if (u < 0.62) g = 1;
    else if (u < 0.8) g = 1 - smooth((u - 0.62) / 0.18);
    else g = 0;
    return { x: sh.x, y: sh.y, g, dir: sh.seed % 2 ? 1 : -1 };
  }
  function drawSheep(ctx, s, t) {
    ctx.save(); ctx.translate(s.x, s.y); ctx.scale(s.dir, 1);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ellipse(ctx, 1, 7.5, 8, 1.8); ctx.fill();
    ctx.strokeStyle = '#3b3530'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.beginPath();
    [-4, -1.5, 2, 4.5].forEach((lx) => { ctx.moveTo(lx, 3); ctx.lineTo(lx, 7.5); });
    ctx.stroke();
    ctx.fillStyle = '#d9d4c6';
    [[-4, -2, 5], [3, -3, 5], [-5, 2, 4.4], [4, 2, 4.4], [0, 0, 5.5]].forEach(([x, y, r]) => { circle(ctx, x, y, r + 0.7); ctx.fill(); });
    ctx.fillStyle = '#f8f6ef';
    [[-4, -2, 5], [3, -3, 5], [-5, 2, 4.4], [4, 2, 4.4], [0, 0, 5.5]].forEach(([x, y, r]) => { circle(ctx, x, y, r); ctx.fill(); });
    // head: up (looking around) → down (grazing), with a gentle nibble while it's down
    const nibble = s.g > 0.95 ? Math.sin(t * 5) * 0.35 : 0;
    const hx = lerp(8.6, 8.4, s.g), hy = lerp(-1.5, 3.4, s.g) + nibble, rot = lerp(0, 0.75, s.g);
    ctx.fillStyle = '#3b3530';
    ellipse(ctx, hx, hy, 3.1, 2.6, rot); ctx.fill();
    ellipse(ctx, hx - 1.8, hy - 2.2 + s.g * 0.6, 1.6, 0.9, -0.5 + rot * 0.5); ctx.fill();
    ctx.fillStyle = '#fff'; circle(ctx, hx + 1, hy - 0.6, 0.6); ctx.fill();
    ctx.restore();
  }

  // ---------- Fields ----------
  const MILL = [-26, -26], SCARECROW = [33, 25];
  T.grain = {
    dark: '#c4952a',
    setup(rng) {
      const stalks = [];
      for (let y = -56; y <= 58; y += 5.2) {
        for (let x = -54 + ((Math.round(y) / 5) % 2) * 2.6; x <= 54; x += 5.4) {
          const jx = x + (rng() - 0.5) * 2.4, jy = y + (rng() - 0.5) * 2;
          if (!inHex(jx, jy, 56) || nearToken(jx, jy, 1)) continue;
          if (Math.hypot(jx - MILL[0], jy - MILL[1]) < 15 || Math.hypot(jx - SCARECROW[0], jy - SCARECROW[1]) < 8) continue;
          if (Math.abs((jx + 60) * 0.35 - (jy + 60) + 18) < 3.5) continue; // farm track
          stalks.push({ x: jx, y: jy, h: 8 + rng() * 4, ph: rng() * TAU });
        }
      }
      stalks.sort((a, b) => a.y - b.y);
      return { stalks, crowPh: rng() * TAU };
    },
    still(ctx) {
      ctx.fillStyle = vgrad(ctx, '#e7c25f', '#cf9f3b'); ctx.fillRect(-64, -68, 128, 136);
      ctx.save(); ctx.rotate(-0.42);
      for (let i = 0; i < 18; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,240,180,.16)' : 'rgba(140,90,10,.13)'; ctx.fillRect(-90, -90 + i * 10, 180, 5); }
      ctx.restore();
      ctx.strokeStyle = '#c99a3e'; ctx.lineWidth = 3.4; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(-60, -39); ctx.lineTo(60, 3); ctx.stroke(); ctx.globalAlpha = 1;
      // windmill tower
      ctx.save(); ctx.translate(MILL[0], MILL[1] + 13);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ellipse(ctx, 2, 1, 10, 2.6); ctx.fill();
      ctx.fillStyle = '#f3ebd8'; ctx.beginPath(); ctx.moveTo(-6.5, 0); ctx.lineTo(-4.5, -21); ctx.lineTo(4.5, -21); ctx.lineTo(6.5, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e2d6bb'; ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(1, -21); ctx.lineTo(4.5, -21); ctx.lineTo(6.5, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b5523a'; ctx.beginPath(); ctx.moveTo(-6, -21); ctx.lineTo(0, -28); ctx.lineTo(6, -21); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7a5a3a'; ctx.fillRect(-1.8, -6, 3.6, 6); ctx.fillStyle = '#7a5a3a'; ctx.fillRect(-1.2, -15, 2.4, 3);
      ctx.restore();
      // scarecrow
      ctx.save(); ctx.translate(SCARECROW[0], SCARECROW[1]);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ellipse(ctx, 1, 0.5, 5, 1.4); ctx.fill();
      ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -15); ctx.moveTo(-6, -10); ctx.lineTo(6, -10); ctx.stroke();
      ctx.fillStyle = '#5b7fb5'; ctx.fillRect(-3, -12, 6, 6); ctx.fillStyle = '#f1d9a6'; circle(ctx, 0, -15, 2.4); ctx.fill();
      ctx.fillStyle = '#8a5a1a'; ctx.fillRect(-3.6, -17.6, 7.2, 1.2); ctx.fillRect(-2, -19.6, 4, 2.2);
      ctx.restore();
    },
    live(ctx, P, t, W) {
      // wheat bends with the wind gusts (no highlight band — every stalk keeps the same colour)
      const stalks = new Path2D(), heads = new Path2D();
      for (const s of P.stalks) {
        const w = W(s.x), bend = w * 0.95 + Math.sin(t * 2.2 + s.ph) * 0.12;
        const tx = s.x + bend * s.h * 0.62, ty = s.y - s.h + Math.abs(bend) * 2;
        stalks.moveTo(s.x, s.y); stalks.quadraticCurveTo(s.x, s.y - s.h * 0.5, tx, ty);
        heads.moveTo(tx + 1.3, ty); heads.ellipse(tx, ty, 1.3, 2.4, bend * 0.9, 0, TAU);
      }
      ctx.lineWidth = 1.05; ctx.lineCap = 'round';
      ctx.strokeStyle = '#b8862a'; ctx.stroke(stalks);
      ctx.fillStyle = '#e5b744'; ctx.fill(heads);
      // windmill sails turn faster in a gust
      const ang = t * 1.1 + W(MILL[0]) * 0.6;
      ctx.save(); ctx.translate(MILL[0], MILL[1] - 7); ctx.rotate(ang);
      for (let i = 0; i < 4; i++) {
        ctx.rotate(TAU / 4);
        ctx.fillStyle = '#7a5a3a'; ctx.fillRect(-0.9, 0, 1.8, 16);
        ctx.fillStyle = '#fff8e8'; ctx.fillRect(0.9, 4, 4.5, 11.5);
        ctx.strokeStyle = 'rgba(138,115,80,.6)'; ctx.lineWidth = 0.5; ctx.strokeRect(0.9, 4, 4.5, 11.5);
      }
      ctx.fillStyle = '#5a4630'; circle(ctx, 0, 0, 1.8); ctx.fill();
      ctx.restore();
      // a pair of crows circling the scarecrow
      for (let i = 0; i < 2; i++) {
        const a = t * 0.9 + P.crowPh + i * 2.6, x = 18 + Math.cos(a) * 16, y = -34 + Math.sin(a) * 7;
        bird(ctx, x, y, 0.85, 0.3 + 0.7 * Math.abs(Math.sin(t * 9 + i)), '#1d1a1a');
      }
    },
  };

  // ---------- Hills (clay & brick) ----------
  const KILN = [28, 32], PIT = [20, -30];
  T.brick = {
    dark: '#9c4b20',
    setup(rng) { return { ph: rng() * 20, ripple: rng() * 3 }; },
    still(ctx) {
      ctx.fillStyle = vgrad(ctx, '#d98a58', '#b4603a'); ctx.fillRect(-64, -68, 128, 136);
      ctx.fillStyle = 'rgba(232,150,100,.5)'; ctx.beginPath(); ctx.moveTo(-70, -14); ctx.quadraticCurveTo(-40, -40, -10, -18); ctx.quadraticCurveTo(20, -44, 70, -16); ctx.lineTo(70, -75); ctx.lineTo(-70, -75); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(150,70,35,.35)'; ctx.beginPath(); ctx.moveTo(-70, 30); ctx.quadraticCurveTo(-36, 6, 0, 26); ctx.quadraticCurveTo(30, 8, 70, 30); ctx.lineTo(70, 75); ctx.lineTo(-70, 75); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,60,30,.4)'; ctx.lineWidth = 2.4; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(12, -37); ctx.lineTo(-20, -38); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#8e3f1f'; ellipse(ctx, PIT[0], PIT[1], 17, 7); ctx.fill();
      ctx.fillStyle = '#6d2e15'; ellipse(ctx, PIT[0], PIT[1] - 1, 13, 4.5); ctx.fill();
      const bricks = (x, y, rows) => {
        ctx.fillStyle = 'rgba(0,0,0,.2)'; ellipse(ctx, x + 2, y + 1, 12, 2.5); ctx.fill();
        for (let i = 0; i < rows; i++) {
          const n = i > 1 ? 2 : 3, off = i % 2 ? 4 : 0;
          for (let j = 0; j < n; j++) {
            ctx.fillStyle = (i + j) % 2 ? '#b04a2c' : '#c0583a'; ctx.fillRect(x - 12 + off + j * 8, y - 4 - i * 4.5, 7.2, 4);
            ctx.strokeStyle = '#7d2f1d'; ctx.lineWidth = 0.5; ctx.strokeRect(x - 12 + off + j * 8, y - 4 - i * 4.5, 7.2, 4);
          }
        }
      };
      bricks(-24, -30, 3); bricks(-36, 34, 2);
      // kiln
      ctx.save(); ctx.translate(KILN[0], KILN[1]);
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ellipse(ctx, 2, 1, 13, 2.8); ctx.fill();
      ctx.fillStyle = '#7a3220'; ctx.fillRect(6, -26, 5, 14);
      ctx.fillStyle = '#94432a'; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.quadraticCurveTo(-12, -20, 0, -20); ctx.quadraticCurveTo(12, -20, 12, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7f3822'; ctx.beginPath(); ctx.moveTo(2, -20); ctx.quadraticCurveTo(12, -20, 12, 0); ctx.lineTo(4, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a1a10'; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.quadraticCurveTo(-4, -8, 0, -8); ctx.quadraticCurveTo(4, -8, 4, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
      [[-6, -50], [44, 0], [-48, 6], [8, 52], [-14, 36]].forEach(([a, b]) => { ctx.fillStyle = '#9c4524'; ellipse(ctx, a, b, 3, 1.8); ctx.fill(); });
    },
    live(ctx, P, t, W) {
      // kiln fire flicker
      const fl = 0.65 + 0.35 * Math.sin(t * 13) * Math.sin(t * 7.3 + 1);
      ctx.fillStyle = `rgba(255,170,70,${0.55 + fl * 0.4})`;
      ctx.beginPath(); ctx.moveTo(KILN[0] - 3, KILN[1]); ctx.quadraticCurveTo(KILN[0] - 3, KILN[1] - 5.5, KILN[0], KILN[1] - 5.5); ctx.quadraticCurveTo(KILN[0] + 3, KILN[1] - 5.5, KILN[0] + 3, KILN[1]); ctx.closePath(); ctx.fill();
      // chimney smoke rides the wind
      for (let i = 0; i < 12; i++) {
        const a = (t * 0.22 + i / 12) % 1, w = W(KILN[0]);
        const x = KILN[0] + 8.5 + a * (6 + w * 26) + Math.sin(a * 7 + i) * 1.6, y = KILN[1] - 26 - a * 34;
        ctx.globalAlpha = 0.55 * (1 - a) * Math.min(1, a * 6);
        ctx.fillStyle = '#f2ece6'; circle(ctx, x, y, 2 + a * 6.5); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // ripples on the clay pit
      const r = ((t + P.ripple) % 3) / 3;
      ctx.strokeStyle = `rgba(255,200,160,${0.5 * (1 - r)})`; ctx.lineWidth = 0.8; ellipse(ctx, PIT[0] - 2, PIT[1] - 1, 2 + r * 9, 0.8 + r * 3); ctx.stroke();
      // a worker wheeling clay from the pit to the brick stack and back
      const u = ((t + P.ph) % 16) / 16, there = u < 0.5, p = ease(there ? u / 0.5 : (u - 0.5) / 0.5);
      const x = there ? lerp(10, -14, p) : lerp(-14, 10, p), y = -40, dir = there ? -1 : 1;
      ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
      const step = Math.sin(t * 10) * 1.4;
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-1 + step, 5); ctx.moveTo(0, 0); ctx.lineTo(1 - step, 5); ctx.stroke();
      ctx.fillStyle = '#4a6fa5'; ctx.fillRect(-1.6, -6, 3.2, 6.2);
      ctx.fillStyle = '#f1c9a0'; circle(ctx, 0, -8, 1.8); ctx.fill();
      ctx.fillStyle = '#8a5a1a'; ctx.fillRect(-2, -10.3, 4, 1.2);
      ctx.strokeStyle = '#5a3a1c'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(1, -3.5); ctx.lineTo(6, -1.5); ctx.stroke();
      ctx.fillStyle = '#6e4a2a'; ctx.beginPath(); ctx.moveTo(5, -3); ctx.lineTo(12, -3); ctx.lineTo(11, 1); ctx.lineTo(6, 1); ctx.closePath(); ctx.fill();
      if (!there) { ctx.fillStyle = '#b04a2c'; ellipse(ctx, 8.5, -3.4, 3.4, 1.6); ctx.fill(); }
      ctx.fillStyle = '#2b2b2b'; circle(ctx, 11, 2, 1.6); ctx.fill();
      ctx.restore();
    },
    lights: [[KILN[0], KILN[1] - 3, 16, 0.6]],
  };

  // ---------- Mountains (quarry) ----------
  const MINE = [30, 38];
  const VEINS = [[-26, -10, 1], [30, -13, 0.85], [-4, -4, 0.7]];
  T.ore = {
    dark: '#6b7684',
    setup(rng) { return { ph: rng() * 30, eagle: rng() * TAU, clouds: [rng() * 160, rng() * 160] }; },
    still(ctx) {
      ctx.fillStyle = vgrad(ctx, '#b3bcc6', '#8590a0'); ctx.fillRect(-64, -68, 128, 136);
      const peak = (x, y, w, h, snow) => {
        ctx.fillStyle = '#8994a2'; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x, y - h); ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#6c7785'; ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y); ctx.lineTo(x + w * 0.15, y); ctx.closePath(); ctx.fill();
        if (snow) {
          ctx.fillStyle = '#f4f7fb'; ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w * 0.32, y - h * 0.66); ctx.lineTo(x + w * 0.12, y - h * 0.72);
          ctx.lineTo(x, y - h * 0.6); ctx.lineTo(x - w * 0.14, y - h * 0.7); ctx.lineTo(x - w * 0.32, y - h * 0.66); ctx.closePath(); ctx.fill();
        }
      };
      peak(-18, -6, 30, 42, true); peak(22, -10, 26, 36, true); peak(-36, 50, 20, 22, false); peak(4, 56, 18, 18, false);
      VEINS.forEach(([x, y, s]) => {
        ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
        [[-3, 0, 5, 1.6, -0.38], [0.5, 0, 7, 2, 0.07], [3.8, 0.5, 4.2, 1.5, 0.52]].forEach(([cx, cy, len, w, a]) => {
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
          ctx.fillStyle = '#4f86c6'; ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(-w, -len); ctx.lineTo(0, -len - w * 1.3); ctx.lineTo(w, -len); ctx.lineTo(w, 0); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#8ec5ff'; ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(-w, -len); ctx.lineTo(0, -len - w * 1.3); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
          ctx.restore();
        });
        ctx.fillStyle = '#6c7785'; ctx.beginPath(); ctx.moveTo(-6, 1); ctx.quadraticCurveTo(0, -1.5, 6, 1); ctx.lineTo(5, 2.5); ctx.lineTo(-5, 2.5); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
      [[-44, 18, 1], [44, 12, 1.2], [-10, 36, 0.9], [-28, 34, 0.7]].forEach(([x, y, s]) => {
        ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
        ctx.fillStyle = '#7d8896'; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-4, -5); ctx.lineTo(2, -6); ctx.lineTo(6, -2); ctx.lineTo(5, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5f6a77'; ctx.beginPath(); ctx.moveTo(2, -6); ctx.lineTo(6, -2); ctx.lineTo(5, 0); ctx.lineTo(1, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
      ctx.save(); ctx.translate(MINE[0], MINE[1]);
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ellipse(ctx, 2, 1, 13, 2.8); ctx.fill();
      ctx.fillStyle = '#6b5a46'; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-10, -10); ctx.quadraticCurveTo(0, -20, 10, -10); ctx.lineTo(10, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1f1c1a'; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-7, -9); ctx.quadraticCurveTo(0, -16, 7, -9); ctx.lineTo(7, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-14, 6); ctx.lineTo(18, 6); ctx.moveTo(-12, 9); ctx.lineTo(20, 9); ctx.stroke();
      ctx.strokeStyle = '#3a2a16'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-12, -15); ctx.lineTo(-12, -13); ctx.stroke();
      ctx.restore();
    },
    live(ctx, P, t, W) {
      // ore veins shimmer, sparkles pop on the snow and crystals
      VEINS.forEach(([x, y, s], i) => {
        const g = Math.pow(Math.max(0, Math.sin(t * 1.6 + i * 2.1)), 4);
        ctx.fillStyle = `rgba(230,244,255,${0.75 * g})`; ellipse(ctx, x - s, y - 5 * s, 2.4 * s, 4 * s, -0.2); ctx.fill();
        ctx.fillStyle = '#fff'; star(ctx, x + 1 * s, y - 10 * s, 2.6 * s, Math.pow(Math.max(0, Math.sin(t * 2.3 + i * 1.7)), 10));
      });
      ctx.fillStyle = '#fff';
      [[-20, -40], [-14, -36], [22, -38], [-24, -18], [30, -22]].forEach(([x, y], i) => star(ctx, x, y, 2.4, Math.pow(Math.max(0, Math.sin(t * 1.3 + i * 2.4)), 14)));
      // drifting clouds around the peaks
      P.clouds.forEach((c0, i) => {
        const x = ((t * (5 + i * 2) + c0) % 170) - 85, y = -32 + i * 16;
        ctx.globalAlpha = 0.78 - i * 0.18; ctx.fillStyle = '#fff';
        ellipse(ctx, x, y, 12, 4.5); ctx.fill(); ellipse(ctx, x - 6, y - 3, 6, 4); ctx.fill(); ellipse(ctx, x + 4, y - 4, 7, 5); ctx.fill();
      });
      ctx.globalAlpha = 1;
      // mine cart rolls out with ore and back in
      const u = ((t + P.ph) % 10) / 10, out = u < 0.35 ? ease(u / 0.35) : u < 0.55 ? 1 : u < 0.85 ? 1 - ease((u - 0.55) / 0.3) : 0;
      ctx.save(); ctx.translate(MINE[0] + 2 + out * 14, MINE[1] + 2);
      ctx.fillStyle = '#55606c'; ctx.fillRect(-4.5, -5, 9, 6);
      ctx.fillStyle = '#333'; circle(ctx, -2.5, 2, 1.5); ctx.fill(); circle(ctx, 2.5, 2, 1.5); ctx.fill();
      ctx.fillStyle = '#9aa4b0'; ctx.beginPath(); ctx.moveTo(-4, -5); ctx.lineTo(-2.4, -7.6); ctx.lineTo(0, -7); ctx.lineTo(-0.8, -5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6aa3e6'; ctx.beginPath(); ctx.moveTo(-1, -5); ctx.lineTo(0.4, -9.6); ctx.lineTo(1.8, -5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4f86c6'; ctx.beginPath(); ctx.moveTo(1.6, -5); ctx.lineTo(2.8, -8); ctx.lineTo(4, -5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; star(ctx, 0.6, -11, 1.8, Math.pow(Math.max(0, Math.sin(t * 3.1)), 8));
      ctx.restore();
      // lantern
      const lf = 0.7 + 0.3 * Math.sin(t * 11) * Math.sin(t * 5.3);
      ctx.fillStyle = `rgba(255,210,122,${0.85 * lf})`; ctx.fillRect(MINE[0] - 13.6, MINE[1] - 13, 3.2, 4);
      // pebbles tumble down the slopes
      [[[-18, -40], [-38, -4]], [[22, -40], [42, -10]]].forEach(([a, b], i) => {
        const v = ((t + P.ph * (i + 1)) % 7.5) / 7.5;
        if (v < 0.25) return;
        const p = (v - 0.25) / 0.75, x = lerp(a[0], b[0], p), y = lerp(a[1], b[1], p * p) ;
        ctx.globalAlpha = p > 0.85 ? (1 - p) / 0.15 : 1;
        ctx.save(); ctx.translate(x, y - Math.abs(Math.sin(p * 18)) * 2); ctx.rotate(p * 14);
        ctx.fillStyle = '#6c7785'; ctx.fillRect(-1.5, -1.3, 3, 2.6); ctx.restore();
        ctx.globalAlpha = 1;
      });
      // an eagle circles high, its shadow sliding over the rock
      const ea = t * 0.45 + P.eagle, ex = Math.cos(ea) * 26, ey = -26 + Math.sin(ea) * 10;
      ctx.fillStyle = 'rgba(30,35,45,.16)'; ctx.save(); ctx.translate(ex + 8, ey + 22); ctx.scale(1.3, 0.6); bird(ctx, 0, 0, 1.4, 0.3, 'rgba(30,35,45,.2)'); ctx.restore();
      bird(ctx, ex, ey, 1.5, 0.25 + 0.15 * Math.sin(t * 2.4), '#3b2a1e');
    },
    lights: [[MINE[0] - 12, MINE[1] - 11, 14, 0.7], [MINE[0], MINE[1] - 5, 10, 0.4]],
  };

  // ---------- Desert ----------
  T.desert = {
    dark: '#c9b47c',
    setup(rng) { return { ph: rng() * 40, tw: rng() * 14, grains: Array.from({ length: 14 }, () => [rng() * 120 - 60, rng() * 100 - 50, rng()]) }; },
    still(ctx) {
      ctx.fillStyle = vgrad(ctx, '#f0dfae', '#dcc58c'); ctx.fillRect(-64, -68, 128, 136);
      ctx.fillStyle = 'rgba(246,231,189,.6)'; ctx.beginPath(); ctx.moveTo(-70, -14); ctx.quadraticCurveTo(-30, -30, 0, -16); ctx.quadraticCurveTo(30, -2, 70, -20); ctx.lineTo(70, -75); ctx.lineTo(-70, -75); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(201,173,110,.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-70, 34); ctx.quadraticCurveTo(-20, 16, 20, 32); ctx.quadraticCurveTo(46, 42, 70, 30); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-60, 46); ctx.quadraticCurveTo(-30, 38, -4, 48); ctx.stroke();
      const cactus = (x, y, s) => {
        ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ellipse(ctx, 3, 0.5, 8, 2); ctx.fill();
        ctx.strokeStyle = '#5f9a59'; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.beginPath();
        ctx.moveTo(0, -1); ctx.lineTo(0, -20); ctx.moveTo(-0.5, -10); ctx.lineTo(-8, -10); ctx.lineTo(-8, -16); ctx.stroke();
        ctx.strokeStyle = '#4f8a4a'; ctx.beginPath(); ctx.moveTo(0.5, -14); ctx.lineTo(8, -14); ctx.lineTo(8, -19); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-0.5, -19); ctx.lineTo(-0.5, -3); ctx.stroke();
        ctx.fillStyle = '#ff8fb1'; circle(ctx, 0, -21.5, 1.3); ctx.fill();
        ctx.restore();
      };
      cactus(-28, -24, 1); cactus(36, 28, 0.8);
      ctx.fillStyle = '#c4ab72'; [[30, -30], [-38, 30], [10, -46]].forEach(([x, y]) => { ellipse(ctx, x, y, 4, 2.4); ctx.fill(); });
    },
    live(ctx, P, t, W) {
      // heat shimmer
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.9;
      [-38, 14].forEach((y0, i) => {
        const a = Math.max(0, Math.sin(t * 1.4 + i * 2));
        ctx.globalAlpha = a * 0.7; ctx.beginPath();
        for (let x = -36; x <= 36; x += 3) { const y = y0 - a * 3 + Math.sin(x * 0.35 + t * 4) * 1.1; if (x === -36) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      // blowing sand
      ctx.fillStyle = 'rgba(255,248,225,.75)';
      P.grains.forEach(([x0, y0, sp]) => {
        const w = W(x0), x = ((x0 + 60 + t * (20 + sp * 30) * (0.4 + w)) % 120) - 60, y = y0 + Math.sin(t * 2 + x0) * 2;
        if (!inHex(x, y, 56)) return;
        ctx.fillRect(x, y, 2.6 + w * 3, 0.7);
      });
      // a camel caravan crosses now and then
      const u = ((t + P.ph) % 44) / 44;
      if (u < 0.62) {
        const p = u / 0.62;
        for (let i = 0; i < 3; i++) drawCamel(ctx, lerp(-80, 80, p) - i * 15, 44 - (i % 2) * 2, t + i * 0.7, i === 0);
      }
      // tumbleweed bounces through on the wind
      const v = ((t + P.tw) % 14) / 14;
      const tx = lerp(-75, 75, v), ty = -2 - Math.abs(Math.sin(v * 22)) * 4;
      ctx.save(); ctx.translate(tx, ty); ctx.rotate(t * 5);
      ctx.strokeStyle = '#a88a52'; ctx.lineWidth = 1; ctx.setLineDash([2, 1.6]); circle(ctx, 0, 0, 4.5); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(-3, -2); ctx.lineTo(3, 2); ctx.moveTo(-2, 3); ctx.lineTo(2, -3); ctx.stroke();
      ctx.restore();
    },
  };
  function drawCamel(ctx, x, y, t, rider) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.16)'; ellipse(ctx, 1, 9, 8, 1.6); ctx.fill();
    ctx.strokeStyle = '#8a6438'; ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.beginPath();
    [-4, -2, 3, 5].forEach((lx, i) => { const sw = Math.sin(t * 6 + i * 1.6) * 1.8; ctx.moveTo(lx, 2); ctx.lineTo(lx + sw, 9); });
    ctx.stroke();
    ctx.fillStyle = '#b98a52'; ellipse(ctx, 0, 0, 6.5, 3.2); ctx.fill();
    circle(ctx, -1.5, -3, 2.8); ctx.fill(); circle(ctx, 2.2, -2.6, 2.3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(5, -1); ctx.quadraticCurveTo(8, -2, 8, -6); ctx.lineTo(10, -6.5); ctx.lineTo(10.5, -5); ctx.lineTo(9, -4.5); ctx.quadraticCurveTo(8.6, -0.5, 5.5, 1.5); ctx.closePath(); ctx.fill();
    if (rider) { ctx.fillStyle = '#e8e2d4'; ctx.fillRect(-0.8, -9.5, 2.6, 4); ctx.fillStyle = '#c0583a'; circle(ctx, 0.5, -10.5, 1.5); ctx.fill(); }
    ctx.restore();
  }

  // ======================= SKY: day / night =======================
  const SKY = [ // [phase, tint rgb, darkness]
    [0, [255, 255, 255], 0], [0.5, [255, 255, 255], 0], [0.56, [255, 212, 168], 0.22], [0.62, [158, 166, 214], 0.8],
    [0.66, [132, 146, 206], 1], [0.84, [132, 146, 206], 1], [0.9, [255, 196, 178], 0.32], [0.95, [255, 255, 255], 0], [1, [255, 255, 255], 0],
  ];
  function sky(p) {
    for (let i = 1; i < SKY.length; i++) {
      if (p <= SKY[i][0]) {
        const [p0, c0, d0] = SKY[i - 1], [p1, c1, d1] = SKY[i], u = smooth((p - p0) / (p1 - p0 || 1));
        return { tint: c0.map((v, k) => Math.round(lerp(v, c1[k], u))), dark: lerp(d0, d1, u) };
      }
    }
    return { tint: [255, 255, 255], dark: 0 };
  }

  // ======================= SCENE =======================
  function create({ world, shade, glow, viewOf }) {
    const cw = world.getContext('2d'), cs = shade.getContext('2d'), cg = glow.getContext('2d');
    const st = {
      board: null, buildings: {}, robber: null, intro: null, tiles: [], view: null,
      dpr: Math.min(2, window.devicePixelRatio || 1), cssW: 0, cssH: 0, scale: 1, ox: 0, oy: 0,
      t0: performance.now(), dayNight: true, cycle: 360, timeOverride: null, windScale: 1, sig: '',
      slow: 0, frames: 0, lastNight: -1, running: false, paths: null, sea: null, boats: [], gulls: [], center: [0, 0],
    };

    function wind(gx, t) {
      const g = Math.pow(Math.max(0, Math.sin(gx * 0.0042 - t * 0.85)), 3);
      return st.windScale * (0.28 + 0.72 * g + 0.12 * Math.sin(t * 0.21));
    }

    function buildTiles() {
      const b = st.board;
      st.tiles = b.hexes.map((h) => {
        const kind = T[h.res] ? h.res : 'desert';
        const rng = rngOf(h.id * 7919 + (h.num || 0) * 131 + kind.length * 17);
        const P = T[kind].setup(rng);
        return { h, kind, P, gx: h.x * S, gy: h.y * S, cache: null, seed: h.id * 104729 + 7 };
      });
      // island outline paths (one union fill each, so overlaps don't double up)
      const sand = new Path2D();
      b.hexes.forEach((h) => addHex(sand, h.x * S, h.y * S, 1.22 * S));
      st.paths = { sand };
      const xs = b.hexes.map((h) => h.x * S), ys = b.hexes.map((h) => h.y * S);
      st.center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      const rx = (Math.max(...xs) - Math.min(...xs)) / 2 + 1.9 * S, ry = (Math.max(...ys) - Math.min(...ys)) / 2 + 1.7 * S;
      st.boats = [
        { a: 0.4, sp: 0.022, rx, ry, sail: '#fffaf0', flag: '#e5484d' },
        { a: 3.6, sp: -0.017, rx: rx * 1.08, ry: ry * 1.1, sail: '#f4e3c4', flag: '#3b82f6' },
      ];
      st.gulls = Array.from({ length: 4 }, (_, i) => ({ a: i * 1.7, r: 26 + i * 9, sp: 0.5 + i * 0.07, cx: Math.cos(i * 1.9) * rx * 0.85, cy: Math.sin(i * 1.9) * ry * 0.8 }));
      // sea sparkles & wave marks (positions away from the island)
      const rng = rngOf(b.hexes.length * 31 + b.hexes[0].num);
      const away = (x, y, d) => b.hexes.every((h) => Math.hypot(h.x * S - x, h.y * S - y) > d * S);
      const pts = (n, d) => {
        const out = [];
        for (let i = 0; out.length < n && i < n * 30; i++) {
          const x = st.center[0] + (rng() * 2 - 1) * (rx + 3 * S), y = st.center[1] + (rng() * 2 - 1) * (ry + 3 * S);
          if (away(x, y, d)) out.push({ x, y, ph: rng() * TAU, ph2: rng() * TAU, s: 0.6 + rng() * 0.8 });
        }
        return out;
      };
      st.sea = { glints: pts(110, 1.55), waves: pts(70, 1.75), stars: pts(90, 1.5), fishSeed: Math.floor(rng() * 1e6) };
    }

    function buildCaches() {
      const k = st.scale * st.dpr, size = Math.ceil(132 * k);
      st.tiles.forEach((tile) => {
        const c = tile.cache || document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        ctx.setTransform(k, 0, 0, k, size / 2, size / 2);
        ctx.clearRect(-70, -70, 140, 140);
        ctx.save(); hexPath(ctx, 0, 0, 0.97 * S); ctx.clip();
        T[tile.kind].still(ctx, tile.P, rngOf(tile.seed));
        ctx.restore();
        tile.cache = c; tile.cacheK = k;
      });
    }

    function resize() {
      const r = world.getBoundingClientRect();
      st.cssW = Math.max(1, r.width); st.cssH = Math.max(1, r.height);
      [world, shade, glow].forEach((c) => { c.width = Math.round(st.cssW * st.dpr); c.height = Math.round(st.cssH * st.dpr); });
      if (!st.view) return;
      const v = st.view;
      st.scale = Math.min(st.cssW / v.w, st.cssH / v.h);
      st.ox = (st.cssW - v.w * st.scale) / 2 - v.x * st.scale;
      st.oy = (st.cssH - v.h * st.scale) / 2 - v.y * st.scale;
      buildCaches();
      if (REDUCED || !st.running) frame(performance.now());
    }

    function setState(view, opts = {}) {
      const b = view.board;
      const sig = b.hexes.map((h) => h.res + h.num).join('|');
      if (sig !== st.sig) {
        st.sig = sig; st.board = b; st.view = viewOf(b);
        buildTiles(); resize();
      }
      st.buildings = view.buildings || {};
      st.robber = b.robber;
      if (opts.intro !== undefined) st.intro = opts.intro;
      if (REDUCED) frame(performance.now());
    }

    // ---------------- drawing ----------------
    function frame(now) {
      if (!st.board) return;
      const t = REDUCED ? 12 : (now - st.t0) / 1000;
      const k = st.dpr * st.scale;
      const W0 = (gx) => wind(gx, t);

      // 1. sea in screen space
      cw.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      const cx = st.ox + st.center[0] * st.scale, cy = st.oy + st.center[1] * st.scale;
      const g = cw.createRadialGradient(cx, cy, 10, cx, cy, Math.max(st.cssW, st.cssH) * 0.75);
      g.addColorStop(0, '#2c90cc'); g.addColorStop(0.45, '#17669f'); g.addColorStop(1, '#0a3254');
      cw.fillStyle = g; cw.fillRect(0, 0, st.cssW, st.cssH);

      cw.setTransform(k, 0, 0, k, st.dpr * st.ox, st.dpr * st.oy);
      // 2. wave marks and sun glints
      cw.strokeStyle = '#cfeaf7'; cw.lineWidth = 2; cw.lineCap = 'round';
      st.sea.waves.forEach((w) => {
        const x = w.x + Math.sin(t * 0.6 + w.ph) * 6, a = 0.08 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.8 + w.ph2));
        cw.globalAlpha = a; cw.beginPath(); cw.moveTo(x - 8, w.y); cw.quadraticCurveTo(x - 4, w.y - 4, x, w.y); cw.quadraticCurveTo(x + 4, w.y + 4, x + 8, w.y); cw.stroke();
      });
      cw.fillStyle = '#ffffff';
      st.sea.glints.forEach((p) => star(cw, p.x, p.y, 2.2 * p.s, 0.9 * Math.pow(Math.max(0, Math.sin(t * 1.4 + p.ph)), 14)));
      cw.globalAlpha = 1;
      drawFish(t);

      // 3. shallows, surf and beach
      const sand = st.paths.sand;
      cw.lineJoin = 'round';
      cw.globalAlpha = 0.33; cw.fillStyle = '#7cc6e6'; cw.strokeStyle = '#7cc6e6'; cw.lineWidth = 50; cw.stroke(sand); cw.fill(sand);
      cw.globalAlpha = 0.18 + 0.14 * Math.sin(t * 1.1 + 1.7); cw.strokeStyle = '#ffffff'; cw.lineWidth = 34 + 8 * Math.sin(t * 1.1 + 1.7); cw.stroke(sand);
      cw.globalAlpha = 0.28 + 0.2 * Math.sin(t * 1.1); cw.lineWidth = 20 + 6 * Math.sin(t * 1.1); cw.stroke(sand);
      cw.globalAlpha = 1; cw.strokeStyle = '#d6c08a'; cw.lineWidth = 15; cw.stroke(sand);
      cw.fillStyle = '#e9d9a6'; cw.strokeStyle = '#e9d9a6'; cw.lineWidth = 9; cw.stroke(sand); cw.fill(sand);

      // 4. harbour boats (moored)
      if (st.board.ports) st.board.ports.forEach((p, i) => mooredBoat(p, i, t));

      // 5. tiles
      for (const tile of st.tiles) drawTile(tile, t, now, W0);

      // 6. cloud shadows drifting over everything
      const v = st.view;
      for (let i = 0; i < 3; i++) {
        const span = v.w + 500, x = v.x - 250 + ((t * (9 + i * 3) + i * span / 3) % span), y = v.y + v.h * (0.25 + i * 0.27);
        const cg2 = cw.createRadialGradient(x, y, 10, x, y, 150 + i * 30);
        cg2.addColorStop(0, 'rgba(10,25,45,.16)'); cg2.addColorStop(1, 'rgba(10,25,45,0)');
        cw.fillStyle = cg2; cw.save(); cw.translate(x, y); cw.scale(1.6, 0.8); cw.translate(-x, -y); cw.fillRect(x - 200, y - 200, 400, 400); cw.restore();
      }

      // 7. sailing boats and gulls (above the island)
      st.boats.forEach((b) => sailingBoat(b, t));
      st.gulls.forEach((gl, i) => gull(gl, t, i));

      lighting(t);
      st.frames++;
    }

    function drawTile(tile, t, now, W0) {
      const { h } = tile;
      let a = 1, sc = 1, dy = 0, rot = 0;
      if (st.intro != null && !REDUCED) {
        const delay = Math.hypot(h.x, h.y) * 70 + (h.id % 3) * 40, p = clamp((now - st.intro - delay) / 750, 0, 1);
        if (p <= 0) return;
        const e = backOut(p);
        a = Math.min(1, p * 1.6); sc = 0.45 + 0.55 * e; dy = (1 - e) * -34; rot = (1 - e) * -0.3;
      }
      cw.save();
      cw.translate(tile.gx, tile.gy + dy); if (sc !== 1) cw.scale(sc, sc); if (rot) cw.rotate(rot);
      cw.globalAlpha = a;
      if (tile.cache) cw.drawImage(tile.cache, -66, -66, 132, 132);
      hexPath(cw, 0, 0, 0.965 * S); cw.save(); cw.clip();
      T[tile.kind].live(cw, tile.P, t + tile.h.id * 1.37, (lx) => W0(tile.gx + lx), tile);
      if (h.id === st.robber) { cw.fillStyle = 'rgba(25,20,35,.28)'; cw.fillRect(-64, -68, 128, 136); }
      const vg = cw.createRadialGradient(0, -4, 30, 0, 0, 64);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.2)');
      cw.fillStyle = vg; cw.fillRect(-64, -68, 128, 136);
      cw.restore();
      cw.strokeStyle = T[tile.kind].dark; cw.globalAlpha = a * 0.6; cw.lineWidth = 1.6; hexPath(cw, 0, 0, 0.965 * S); cw.stroke();
      cw.strokeStyle = 'rgba(255,255,255,.22)'; cw.globalAlpha = a; cw.lineWidth = 1.2; hexPath(cw, 0, 0, 0.92 * S); cw.stroke();
      cw.restore();
      cw.globalAlpha = 1;
    }

    function drawFish(t) {
      const period = 3.4, k = Math.floor(t / period), u = (t % period) / period;
      const r = rngOf(st.sea.fishSeed + k), spot = st.sea.waves[Math.floor(r() * st.sea.waves.length)];
      if (!spot) return;
      const x0 = spot.x + 14, y0 = spot.y + 10, dir = r() < 0.5 ? -1 : 1;
      if (u < 0.35) {
        const p = u / 0.35, x = x0 + dir * p * 18, y = y0 - Math.sin(p * Math.PI) * 14, ang = Math.atan2(-Math.cos(p * Math.PI) * 14 * Math.PI, dir * 18);
        cw.save(); cw.translate(x, y); cw.rotate(dir > 0 ? -ang : Math.PI + ang); cw.scale(1, dir);
        cw.fillStyle = '#c9dbe8'; ellipse(cw, 0, 0, 4.2, 1.6); cw.fill();
        cw.beginPath(); cw.moveTo(-3.6, 0); cw.lineTo(-6.4, -2); cw.lineTo(-6.4, 2); cw.closePath(); cw.fill();
        cw.restore();
      }
      [[0, x0], [0.35, x0 + dir * 18]].forEach(([start, sx]) => {
        const q = (u - start) / 0.45;
        if (q < 0 || q > 1) return;
        cw.strokeStyle = `rgba(230,246,255,${0.8 * (1 - q)})`; cw.lineWidth = 1.2;
        ellipse(cw, sx, y0, 2 + q * 10, 1 + q * 4); cw.stroke();
      });
    }

    function boatShape(ctx, sail, flag, t, s = 1) {
      ctx.scale(s, s);
      ctx.fillStyle = '#7a4a26'; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.lineTo(7, 4.5); ctx.lineTo(-7, 4.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5c3519'; ctx.fillRect(-7, 3, 14, 1.5);
      ctx.strokeStyle = '#4a2e18'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -17); ctx.stroke();
      const billow = 1 + Math.sin(t * 1.3) * 0.06;
      ctx.fillStyle = sail; ctx.beginPath(); ctx.moveTo(0.6, -16); ctx.quadraticCurveTo(9 * billow, -9, 8, -2); ctx.lineTo(0.6, -2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8dcc4'; ctx.beginPath(); ctx.moveTo(-0.6, -13); ctx.quadraticCurveTo(-6 * billow, -8, -6, -2); ctx.lineTo(-0.6, -2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = flag; ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(4 + Math.sin(t * 6) * 0.8, -16); ctx.lineTo(0, -15); ctx.closePath(); ctx.fill();
    }
    function boatPos(b, t) {
      const a = b.a + t * b.sp;
      return { x: st.center[0] + Math.cos(a) * b.rx, y: st.center[1] + Math.sin(a) * b.ry, vx: -Math.sin(a) * b.rx * b.sp, vy: Math.cos(a) * b.ry * b.sp };
    }
    function sailingBoat(b, t) {
      const p = boatPos(b, t), dir = p.vx >= 0 ? 1 : -1;
      // wake
      for (let i = 1; i <= 6; i++) {
        const q = boatPos(b, t - i * 0.55);
        cw.strokeStyle = `rgba(235,248,255,${0.4 * (1 - i / 7)})`; cw.lineWidth = 1.2;
        ellipse(cw, q.x, q.y + 4, 3 + i * 1.6, 1 + i * 0.4); cw.stroke();
      }
      cw.save(); cw.translate(p.x, p.y + Math.sin(t * 1.8 + b.a) * 1.2); cw.rotate(Math.sin(t * 1.4 + b.a) * 0.05); cw.scale(dir, 1);
      boatShape(cw, b.sail, b.flag, t + b.a, 1.15);
      cw.restore();
    }
    function mooredBoat(p, i, t) {
      const ox = p.x * S - st.center[0], oy = p.y * S - st.center[1], d = Math.hypot(ox, oy) || 1;
      const x = p.x * S + (ox / d) * 22 + (oy / d) * 10, y = p.y * S + (oy / d) * 22 - (ox / d) * 10;
      cw.save(); cw.translate(x, y + Math.sin(t * 1.6 + i) * 1); cw.rotate(Math.sin(t * 1.2 + i * 2) * 0.08);
      cw.fillStyle = 'rgba(0,30,60,.25)'; ellipse(cw, 0, 3, 8, 2); cw.fill();
      cw.fillStyle = '#8a5530'; cw.beginPath(); cw.moveTo(-7, -1); cw.quadraticCurveTo(0, 5, 7, -1); cw.closePath(); cw.fill();
      cw.fillStyle = '#6b3f20'; cw.fillRect(-5, -1.6, 10, 1.2);
      cw.strokeStyle = '#4a2e18'; cw.lineWidth = 0.8; cw.beginPath(); cw.moveTo(0, -1); cw.lineTo(0, -9); cw.stroke();
      cw.restore();
    }
    function gull(gl, t, i) {
      const a = gl.a + t * gl.sp, x = st.center[0] + gl.cx + Math.cos(a) * gl.r, y = st.center[1] + gl.cy + Math.sin(a) * gl.r * 0.55 - 10;
      const flap = 0.3 + 0.7 * Math.abs(Math.sin(t * (5 + i) + i));
      cw.save(); cw.translate(x + 14, y + 26); cw.scale(1, 0.5); bird(cw, 0, 0, 1.4, flap, 'rgba(0,20,40,.18)'); cw.restore();
      cw.lineWidth = 2;
      bird(cw, x, y, 1.5, flap, '#ffffff');
      cw.strokeStyle = '#59636e'; cw.lineWidth = 1; cw.beginPath(); cw.moveTo(x - 6, y); cw.lineTo(x - 4.5, y - 0.6); cw.moveTo(x + 6, y); cw.lineTo(x + 4.5, y - 0.6); cw.stroke();
    }

    // ---------------- day / night ----------------
    function phase(t) { return st.timeOverride != null ? st.timeOverride : ((t / st.cycle) + 0.08) % 1; }
    function lightSources() {
      const L = [];
      Object.entries(st.buildings || {}).forEach(([vid, b]) => {
        const v = st.board.vertices[vid];
        if (v) L.push([v.x * S, v.y * S, b.type === 'city' ? 36 : 26, 1]);
      });
      st.tiles.forEach((tile) => (T[tile.kind].lights || []).forEach(([x, y, r, s]) => L.push([tile.gx + x, tile.gy + y, r, s])));
      return L;
    }
    function lighting(t) {
      const k = st.dpr * st.scale;
      const { tint, dark } = st.dayNight ? sky(phase(t)) : { tint: [255, 255, 255], dark: 0 };
      if (Math.abs(dark - st.lastNight) > 0.02) {
        st.lastNight = dark;
        document.documentElement.style.setProperty('--night', dark.toFixed(2));
      }
      cs.setTransform(1, 0, 0, 1, 0, 0); cs.clearRect(0, 0, shade.width, shade.height);
      cg.setTransform(1, 0, 0, 1, 0, 0); cg.clearRect(0, 0, glow.width, glow.height);
      if (tint.every((c) => c === 255) && dark < 0.01) return;
      // multiply layer: the sky tint, with holes where lamps and windows light the ground
      cs.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`; cs.fillRect(0, 0, shade.width, shade.height);
      cs.setTransform(k, 0, 0, k, st.dpr * st.ox, st.dpr * st.oy);
      cs.globalCompositeOperation = 'destination-out';
      const L = lightSources();
      L.forEach(([x, y, r, s]) => {
        const gg = cs.createRadialGradient(x, y, 2, x, y, r);
        gg.addColorStop(0, `rgba(0,0,0,${0.85 * dark * s})`); gg.addColorStop(1, 'rgba(0,0,0,0)');
        cs.fillStyle = gg; cs.fillRect(x - r, y - r, r * 2, r * 2);
      });
      cs.globalCompositeOperation = 'source-over';
      if (dark < 0.05) return;
      // screen layer: warm lamp light, stars and moonlight on the water
      cg.setTransform(k, 0, 0, k, st.dpr * st.ox, st.dpr * st.oy);
      L.forEach(([x, y, r, s], i) => {
        const fl = 0.85 + 0.15 * Math.sin(t * 9 + i * 1.3);
        const gg = cg.createRadialGradient(x, y, 1, x, y, r * 0.8);
        gg.addColorStop(0, `rgba(255,190,90,${0.55 * dark * s * fl})`); gg.addColorStop(1, 'rgba(255,150,60,0)');
        cg.fillStyle = gg; cg.fillRect(x - r, y - r, r * 2, r * 2);
      });
      st.boats.forEach((b) => {
        const p = boatPos(b, t), gg = cg.createRadialGradient(p.x, p.y - 4, 0.5, p.x, p.y - 4, 12);
        gg.addColorStop(0, `rgba(255,200,110,${0.8 * dark})`); gg.addColorStop(1, 'rgba(255,200,110,0)');
        cg.fillStyle = gg; cg.fillRect(p.x - 12, p.y - 16, 24, 24);
      });
      cg.fillStyle = '#ffffff';
      st.sea.stars.forEach((p) => star(cg, p.x, p.y, 1.6 * p.s, dark * (0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 0.9 + p.ph), 3))));
      const v = st.view, mx = v.x + v.w * 0.86, my = v.y + v.h * 0.12;
      const mg = cg.createRadialGradient(mx, my, 2, mx, my, 40);
      mg.addColorStop(0, `rgba(255,252,235,${0.9 * dark})`); mg.addColorStop(0.25, `rgba(220,230,255,${0.35 * dark})`); mg.addColorStop(1, 'rgba(200,215,255,0)');
      cg.fillStyle = mg; cg.fillRect(mx - 40, my - 40, 80, 80);
      cg.globalAlpha = 1;
      for (let i = 0; i < 14; i++) {
        const y = my + 18 + i * 9, w = 12 - i * 0.5, x = mx + Math.sin(t * 2 + i * 1.7) * 3;
        cg.fillStyle = `rgba(255,250,225,${dark * 0.5 * (0.5 + 0.5 * Math.sin(t * 3 + i))})`;
        cg.fillRect(x - w / 2, y, w, 1.2);
      }
    }

    // ---------------- loop ----------------
    let last = performance.now(), slowFrames = 0;
    function loop(now) {
      if (!st.running) return;
      const dt = now - last; last = now;
      // adaptive quality: drop to 1× pixels if frames are consistently slow
      if (dt > 26 && dt < 200) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 90 && st.dpr > 1) { st.dpr = 1; slowFrames = 0; resize(); }
      frame(now);
      requestAnimationFrame(loop);
    }
    function start() {
      if (st.running || REDUCED) return;
      st.running = true; last = performance.now(); requestAnimationFrame(loop);
    }

    const ro = new ResizeObserver(() => resize());
    ro.observe(world);
    if (!REDUCED) start();

    return {
      update: setState,
      setDayNight(on) { st.dayNight = !!on; st.lastNight = -1; if (REDUCED) frame(performance.now()); },
      setTime(p) { st.timeOverride = p == null ? null : clamp(p, 0, 0.9999); if (REDUCED) frame(performance.now()); },
      setCycle(sec) { st.cycle = sec; },
      setWind(s) { st.windScale = s; },
      phase: () => phase((performance.now() - st.t0) / 1000),
      intro(t0) { st.intro = t0; },
    };
  }

  return { create, REDUCED };
})();
