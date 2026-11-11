// Draws the island as SVG. Used by the host screen and the TV screen.
'use strict';

const TERRAIN = {
  wood: { fill: '#2f7d4a', dark: '#245f39', icon: '🌲', label: 'Forest' },
  brick: { fill: '#c4622d', dark: '#9c4b20', icon: '🧱', label: 'Clay pits' },
  wool: { fill: '#94c45e', dark: '#74a243', icon: '🐑', label: 'Meadow' },
  grain: { fill: '#e6b440', dark: '#c4952a', icon: '🌾', label: 'Farmland' },
  ore: { fill: '#8b97a5', dark: '#6b7684', icon: '⛰️', label: 'Quarry' },
  desert: { fill: '#e2cd96', dark: '#c9b47c', icon: '🏜️', label: 'Desert' },
};
const RES_ICON = { wood: '🌲', brick: '🧱', wool: '🐑', grain: '🌾', ore: '🪨' };

const BoardRenderer = (() => {
  const S = 60; // px per hex radius in SVG units
  const pt = (x, y) => `${(x * S).toFixed(1)},${(y * S).toFixed(1)}`;

  function hexPoints(h, r = 1) {
    const out = [];
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (60 * k - 90);
      out.push(pt(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r));
    }
    return out.join(' ');
  }

  function shorten(a, b, f) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return [{ x: a.x + dx * f, y: a.y + dy * f }, { x: b.x - dx * f, y: b.y - dy * f }];
  }

  function pips(n) { return 6 - Math.abs(7 - n); }

  const SETTLEMENT = [[-0.2, 0.17], [0.2, 0.17], [0.2, -0.05], [0, -0.25], [-0.2, -0.05]];
  const CITY = [[-0.33, 0.21], [0.33, 0.21], [0.33, -0.04], [0.13, -0.19], [-0.05, -0.04], [-0.05, -0.18], [-0.19, -0.33], [-0.33, -0.18]];
  const shape = (v, pts, k = 1) => pts.map(([dx, dy]) => pt(v.x + dx * k, v.y + dy * k)).join(' ');

  // The board's drawing area in SVG units — shared with the canvas scene so both line up exactly.
  function viewOf(board) {
    const xs = board.vertices.map((v) => v.x).concat(board.ports.map((p) => p.x));
    const ys = board.vertices.map((v) => v.y).concat(board.ports.map((p) => p.y));
    const m = 0.45; // just enough room for the harbour badges (radius 0.36) at the edges
    const minX = Math.min(...xs) - m, maxX = Math.max(...xs) + m, minY = Math.min(...ys) - m, maxY = Math.max(...ys) + m;
    return { x: minX * S, y: minY * S, w: (maxX - minX) * S, h: (maxY - minY) * S };
  }

  function render(svg, view, opts = {}) {
    const { board, buildings, roads, players, legal, mode, turn } = view;
    // Dark player colours (black) get a light outline and light glowing spots so they stay visible.
    const isDark = (hex) => { const n = parseInt(String(hex || '#fff').slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) < 70; };
    const colorOf = {}, edgeOf = {}, glowOf = {};
    players.forEach((p) => { colorOf[p.id] = p.hex; edgeOf[p.id] = isDark(p.hex) ? '#f1f5f9' : '#141414'; glowOf[p.id] = isDark(p.hex) ? '#cbd5e1' : p.hex; });
    const { hexes, vertices, edges, ports } = board;

    const vb = viewOf(board);
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);

    const hotSum = turn && turn.rolled && turn.dice ? turn.dice[0] + turn.dice[1] : null;
    const MOTION = typeof TerrainArt === 'undefined' || TerrainArt.MOTION;
    // Event animations survive redraws: an element keeps its class for the length of the
    // animation and gets a negative delay so it resumes where it was instead of restarting.
    const anim = opts.anim || {};
    const now = performance.now();
    const fx = (key, cls, dur, extraDelay = 0) => {
      const t0 = anim.fresh && anim.fresh.get(key);
      if (!MOTION || t0 == null || now - t0 > dur + extraDelay) return '';
      return ` data-anim="${cls}" style="animation-delay:${Math.round(extraDelay - (now - t0))}ms"`;
    };
    const intro = (h, extra = 0) => {
      if (!MOTION || anim.intro == null) return '';
      const delay = Math.hypot(h.x, h.y) * 70 + (h.id % 3) * 40 + extra;
      const el = now - anim.intro;
      if (el > delay + 900) return '';
      return ` data-anim="intro" style="animation-delay:${Math.round(delay - el)}ms"`;
    };
    const o = [];
    o.push(`<defs>
      <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity=".45"/></filter>
      <radialGradient id="tok" cx="40%" cy="35%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#eadbb8"/></radialGradient>
      <clipPath id="hexclip"><polygon points="${hexPoints({ x: 0, y: 0 }, 0.965)}"/></clipPath>
      <clipPath id="portclip"><circle cx="0" cy="0" r="${S * 0.27}"/></clipPath>
      <radialGradient id="vignette" cx="50%" cy="45%" r="60%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient>
    </defs>`);

    // Sea, beach and terrain are painted by the living-island canvas underneath (island.js).
    // Phones have no canvas scene, so they get a simple flat island with resource icons instead.
    if (opts.simple) {
      o.push(`<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#17639a"/>`);
      o.push(`<g fill="#e9d9a6" stroke="#e9d9a6" stroke-width="10" stroke-linejoin="round">${hexes.map((h) => `<polygon points="${hexPoints(h, 1.18)}"/>`).join('')}</g>`);
      hexes.forEach((h) => {
        const t = TERRAIN[h.res];
        o.push(`<polygon points="${hexPoints(h, 0.96)}" fill="${t.fill}" stroke="${t.dark}" stroke-width="2"/>`);
        if (h.res !== 'desert') o.push(`<use href="#icon-${h.res}" transform="translate(${h.x * S},${(h.y - 0.56) * S}) scale(${(S / 60) * 0.85})" opacity=".9"/>`);
      });
    }
    // Ports
    ports.forEach((p) => {
      const e = edges[p.edge];
      e.v.forEach((vid) => {
        const v = vertices[vid];
        o.push(`<line x1="${p.x * S}" y1="${p.y * S}" x2="${v.x * S}" y2="${v.y * S}" stroke="#7a5a32" stroke-width="5" stroke-linecap="round"/>`);
      });
    });

    // Terrain
    hexes.forEach((h) => {
      const hot = hotSum && h.num === hotSum && h.id !== board.robber;
      if (hot) o.push(`<polygon class="hot-ring"${fx('rollring', 'ringin', 600)} points="${hexPoints(h, 0.93)}" fill="none" stroke="#ffe066" stroke-width="7" stroke-linejoin="round"/>`);
      if (h.num) {
        const red = h.num === 6 || h.num === 8;
        const cx = h.x * S, cy = (h.y + 0.12) * S, n = pips(h.num);
        o.push(`<g class="tok"${intro(h, 350) || fx('tok' + h.id, 'pop', 700)}><g filter="url(#shadow)"><circle cx="${cx}" cy="${cy}" r="${S * 0.36}" fill="url(#tok)" stroke="#8b6b3e" stroke-width="2"/></g>
          <text x="${cx}" y="${cy - S * 0.04}" font-size="${S * (red ? 0.38 : 0.33)}" font-weight="800" text-anchor="middle" dominant-baseline="central" fill="${red ? '#c0262d' : '#2b2118'}" font-family="Georgia, serif">${h.num}</text>`);
        for (let i = 0; i < n; i++) {
          o.push(`<circle cx="${cx + (i - (n - 1) / 2) * S * 0.085}" cy="${cy + S * 0.2}" r="${S * 0.032}" fill="${red ? '#c0262d' : '#2b2118'}"/>`);
        }
        o.push('</g>');
      }
    });

    // Port badges
    ports.forEach((p) => {
      const generic = p.type === '3:1';
      o.push(`<g filter="url(#shadow)" transform="translate(${p.x * S},${p.y * S})">
        <circle r="${S * 0.36}" fill="#fdf6e3" stroke="#7a5a32" stroke-width="2.5"/>
        ${generic
          ? `<text y="1" font-size="${S * 0.22}" font-weight="800" text-anchor="middle" dominant-baseline="central" fill="#3a2a16" font-family="Georgia, serif">3:1</text>`
          : `<use href="#icon-${p.type}" transform="translate(0,${-S * 0.09}) scale(${(S / 60) * 1.12})"/>
             <rect x="${-S * 0.19}" y="${S * 0.13}" width="${S * 0.38}" height="${S * 0.18}" rx="${S * 0.06}" fill="#fdf6e3" stroke="#7a5a32" stroke-width="1"/>
             <text y="${S * 0.22}" font-size="${S * 0.14}" font-weight="800" text-anchor="middle" dominant-baseline="central" fill="#3a2a16">2:1</text>`}
      </g>`);
    });

    // Roads
    Object.entries(roads).forEach(([eid, owner]) => {
      const e = edges[eid];
      const [a, b] = shorten(vertices[e.v[0]], vertices[e.v[1]], 0.16);
      o.push(`<g data-edge="${eid}"${fx('e' + eid, 'grow', 600)}>
        <line x1="${a.x * S}" y1="${a.y * S}" x2="${b.x * S}" y2="${b.y * S}" stroke="${edgeOf[owner] || '#141414'}" stroke-width="${S * 0.22}" stroke-linecap="round"/>
        <line x1="${a.x * S}" y1="${a.y * S}" x2="${b.x * S}" y2="${b.y * S}" stroke="${colorOf[owner]}" stroke-width="${S * 0.14}" stroke-linecap="round"/>
      </g>`);
    });

    // Bandit
    const rb = hexes[board.robber];
    if (rb) {
      const bx = rb.x + (rb.num ? -0.5 : 0), by = rb.y + 0.12;
      o.push(`<g transform="translate(${bx * S},${by * S})"><g class="bandit" filter="url(#shadow)"${fx('robber', 'land', 800)}><g>
        <ellipse cx="0" cy="${S * 0.3}" rx="${S * 0.2}" ry="${S * 0.05}" fill="rgba(0,0,0,.25)"/>
        <path d="M ${-S * 0.2} ${S * 0.3} Q ${-S * 0.22} ${-S * 0.05} 0 ${-S * 0.1} Q ${S * 0.22} ${-S * 0.05} ${S * 0.2} ${S * 0.3} Z" fill="#26232b" stroke="#f3f0ea" stroke-width="3"/>
        <circle cx="0" cy="${-S * 0.24}" r="${S * 0.15}" fill="#26232b" stroke="#f3f0ea" stroke-width="3"/>
        <rect x="${-S * 0.11}" y="${-S * 0.28}" width="${S * 0.22}" height="${S * 0.06}" rx="${S * 0.03}" fill="#e5484d"/>
        <g fill="#fff"><circle cx="${-S * 0.05}" cy="${-S * 0.25}" r="${S * 0.017}"/><circle cx="${S * 0.05}" cy="${-S * 0.25}" r="${S * 0.017}"/>
          ${MOTION ? `<animateTransform attributeName="transform" type="translate" values="0 0;-2 0;-2 0;2 0;2 0;0 0" keyTimes="0;.1;.4;.5;.8;1" dur="5s" repeatCount="indefinite"/>` : ''}</g>
        ${MOTION ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="2.6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"/>` : ''}
      </g></g></g>`);
    }

    // Buildings
    Object.entries(buildings).forEach(([vid, b]) => {
      const v = vertices[vid];
      const wins = b.type === 'city'
        ? [[-0.24, 0.02], [-0.12, 0.02], [0.08, 0.05], [0.2, 0.05], [-0.18, -0.16]]
        : [[-0.07, 0.0], [0.07, 0.0]];
      o.push(`<g data-vertex="${vid}"${fx('v' + vid + b.type, 'drop', 700)}>
        <polygon points="${b.type === 'city' ? shape(v, CITY, 1.2) : shape(v, SETTLEMENT, 1.3)}" fill="${colorOf[b.owner]}" stroke="${edgeOf[b.owner] || '#141414'}" stroke-width="3" stroke-linejoin="round" filter="url(#shadow)"/>
        ${wins.map(([dx, dy]) => `<rect class="win" x="${((v.x + dx) * S - 2.6).toFixed(1)}" y="${((v.y + dy) * S - 2.6).toFixed(1)}" width="5.2" height="5.2" rx="1"/>`).join('')}
      </g>`);
    });

    // Legal targets (glowing spots)
    if (mode && legal) {
      const c = mode.kind === 'remove' ? '#ff5d5d' : glowOf[mode.pid] || '#fff';
      const cls = opts.interactive ? 'target clickable' : 'target';
      legal.hexes.forEach((hid) => {
        o.push(`<polygon class="${cls} hex-target" data-hex="${hid}" points="${hexPoints(hexes[hid], 0.9)}" fill="rgba(255,255,255,.12)" stroke="#fff" stroke-width="4" stroke-dasharray="10 8"/>`);
      });
      legal.edges.forEach((eid) => {
        const e = edges[eid];
        const [a, b] = shorten(vertices[e.v[0]], vertices[e.v[1]], 0.2);
        o.push(`<g class="${cls}" data-edge="${eid}">
          <line x1="${a.x * S}" y1="${a.y * S}" x2="${b.x * S}" y2="${b.y * S}" stroke="${c}" stroke-opacity=".9" stroke-width="${S * 0.12}" stroke-linecap="round" stroke-dasharray="${S * 0.08} ${S * 0.1}" class="glow"/>
          <line x1="${a.x * S}" y1="${a.y * S}" x2="${b.x * S}" y2="${b.y * S}" stroke="transparent" stroke-width="${S * 0.36}"/>
        </g>`);
      });
      legal.vertices.forEach((vid) => {
        const v = vertices[vid];
        o.push(`<g class="${cls}" data-vertex="${vid}">
          <circle cx="${v.x * S}" cy="${v.y * S}" r="${S * 0.16}" fill="${c}" fill-opacity=".85" stroke="#fff" stroke-width="3" class="glow"/>
          <circle cx="${v.x * S}" cy="${v.y * S}" r="${S * 0.3}" fill="transparent"/>
        </g>`);
      });
    }

    // The spot the active player is considering (before they confirm) — a bright pulsing marker.
    const pv = mode && mode.preview;
    if (pv) {
      const c = glowOf[mode.pid] || '#fff';
      if (pv.v != null && vertices[pv.v]) {
        const v = vertices[pv.v];
        o.push(`<g class="preview" pointer-events="none"><circle cx="${v.x * S}" cy="${v.y * S}" r="${S * 0.3}" fill="${c}" fill-opacity=".35" stroke="#fff" stroke-width="5"/>
          <circle cx="${v.x * S}" cy="${v.y * S}" r="${S * 0.12}" fill="#fff"/></g>`);
      } else if (pv.e != null && edges[pv.e]) {
        const e = edges[pv.e];
        const [a, b] = shorten(vertices[e.v[0]], vertices[e.v[1]], 0.12);
        o.push(`<g class="preview" pointer-events="none"><line x1="${a.x * S}" y1="${a.y * S}" x2="${b.x * S}" y2="${b.y * S}" stroke="#fff" stroke-width="${S * 0.3}" stroke-linecap="round"/>
          <line x1="${a.x * S}" y1="${a.y * S}" x2="${b.x * S}" y2="${b.y * S}" stroke="${c}" stroke-width="${S * 0.16}" stroke-linecap="round"/></g>`);
      } else if (pv.hex != null && hexes[pv.hex]) {
        o.push(`<polygon class="preview" pointer-events="none" points="${hexPoints(hexes[pv.hex], 0.9)}" fill="rgba(255,255,255,.25)" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>`);
      }
    }

    svg.innerHTML = o.join('');

    if (opts.interactive && !svg._wired) {
      svg._wired = true;
      svg.addEventListener('click', (ev) => {
        const t = ev.target.closest('.clickable');
        if (!t || !svg._onPick) return;
        if (t.dataset.vertex != null) svg._onPick({ v: +t.dataset.vertex });
        else if (t.dataset.edge != null) svg._onPick({ e: +t.dataset.edge });
        else if (t.dataset.hex != null) svg._onPick({ hex: +t.dataset.hex });
      });
    }
    svg._onPick = opts.onPick;
  }

  return { render, viewOf };
})();
