// Original illustrated, gently animated terrain art. Drawn as SVG in hex-local pixels
// (hex radius 60, centred on 0,0). Two timing variants per terrain (-0 / -1) so neighbouring
// tiles don't move in lockstep. Animations use SVG <animate>, which keeps its rhythm even
// when the board is redrawn, and are left out entirely for "reduce motion" users.
'use strict';

const TerrainArt = (() => {
  const MOTION = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const A = (s) => (MOTION ? s : '');
  const rep = 'repeatCount="indefinite"';
  // Rotate back and forth around the local origin (added on top of the element's own transform).
  const sway = (deg, dur, begin) => A(`<animateTransform attributeName="transform" type="rotate" additive="sum" values="0;${deg};0;${-deg};0" dur="${dur}s" begin="${begin}s" ${rep} calcMode="spline" keyTimes="0;.25;.5;.75;1" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>`);
  const drift = (values, dur, begin, extra = '') => A(`<animateTransform attributeName="transform" type="translate" additive="sum" values="${values}" dur="${dur}s" begin="${begin}s" ${rep} ${extra}/>`);
  const fade = (values, dur, begin) => A(`<animate attributeName="opacity" values="${values}" dur="${dur}s" begin="${begin}s" ${rep}/>`);

  const lin = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  const base = (grad) => `<rect x="-70" y="-75" width="140" height="150" fill="url(#${grad})"/>`;
  const shadow = (rx = 8) => `<ellipse cx="2" cy="1" rx="${rx}" ry="2.4" fill="rgba(0,0,0,.18)"/>`;

  // ---------- Forest ----------
  const pine = (x, y, s, tone, b) => {
    const c = [['#2f7a47', '#215c35'], ['#3a8a52', '#28673d'], ['#2a6f41', '#1b4f2e']][tone];
    return `<g transform="translate(${x},${y}) scale(${s})">${shadow(9)}<g>
      <rect x="-1.6" y="-5" width="3.2" height="6" rx="1" fill="#6e4a2a"/>
      <path d="M0 -30 L8 -19 L4.5 -19 L10 -11 L6 -11 L12 -3 L-12 -3 L-6 -11 L-10 -11 L-4.5 -19 L-8 -19 Z" fill="${c[0]}"/>
      <path d="M0 -30 L8 -19 L4.5 -19 L10 -11 L6 -11 L12 -3 L0 -3 Z" fill="${c[1]}"/>
      <path d="M-2 -24 L-5 -20 M-4 -15 L-7 -11 M-5 -8 L-8 -5" stroke="rgba(255,255,255,.18)" stroke-width="1.2" stroke-linecap="round"/>
      ${sway(2.2, 4 + tone * 0.6, b)}</g></g>`;
  };
  const oak = (x, y, s, b) => `<g transform="translate(${x},${y}) scale(${s})">${shadow(9)}<g>
      <rect x="-1.8" y="-9" width="3.6" height="10" rx="1" fill="#6e4a2a"/>
      <circle cx="-5" cy="-13" r="7" fill="#4a9a5c"/><circle cx="5" cy="-13" r="7" fill="#3c8550"/>
      <circle cx="0" cy="-19" r="7.5" fill="#57a868"/><circle cx="-2" cy="-21" r="2.5" fill="rgba(255,255,255,.2)"/>
      ${sway(1.6, 5, b)}</g></g>`;
  const bird = (path, dur, begin, s = 1) => A(`<g opacity="0"><g transform="scale(${s})"><g>
      <path d="M-4 0 Q -2 -2.6 0 0 Q 2 -2.6 4 0" stroke="#22322a" stroke-width="1.1" fill="none" stroke-linecap="round"/>
      <animateTransform attributeName="transform" type="scale" values="1 1;1 .35;1 1" dur=".5s" ${rep}/></g></g>
      <animateMotion path="${path}" dur="${dur}s" begin="${begin}s" ${rep}/>
      <animate attributeName="opacity" values="0;.85;.85;0" keyTimes="0;.1;.85;1" dur="${dur}s" begin="${begin}s" ${rep}/></g>`);
  const leaf = (x, y, dur, begin) => A(`<ellipse cx="0" cy="0" rx="1.8" ry="1" fill="#c9a33a" opacity="0">
      <animateMotion path="M${x} ${y} q 6 8 0 16 q -6 8 2 18" dur="${dur}s" begin="${begin}s" ${rep} rotate="auto"/>
      <animate attributeName="opacity" values="0;.9;.9;0" keyTimes="0;.1;.8;1" dur="${dur}s" begin="${begin}s" ${rep}/></ellipse>`);
  const forest = (v) => `${base('gw')}
    ${[[-40, -40], [30, 40], [-10, 10], [42, -12], [-48, 20]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="14" fill="rgba(20,60,30,.18)"/>`).join('')}
    ${pine(-22, -26, 0.95, 1, -v * 1.7)}${pine(0, -33, 1.05, 0, -1.1 - v)}${pine(21, -24, 0.9, 2, -2.3)}${oak(-40, -2, 0.85, -0.7 - v)}
    ${pine(38, -2, 0.95, 0, -3 + v)}${pine(-33, 26, 1, 2, -1.8)}${oak(36, 28, 0.9, -2.6 - v)}${pine(-13, 48, 0.85, 1, -0.4)}${pine(14, 50, 0.9, 0, -2 - v)}
    ${pine(-6, -46, 0.6, 2, -1.3)}${pine(-46, 12, 0.6, 1, -3.1)}${pine(48, 12, 0.6, 1, -0.9 - v)}
    ${leaf(-40, -14, 6, -v * 3)}${leaf(36, 14, 7, -2 - v * 2)}
    ${bird('M-75 -44 Q -20 -58 40 -40 T 80 -48', 11, -v * 5.5)}${bird('M-80 -36 Q -10 -50 50 -34 T 85 -40', 11, -1 - v * 5.5, 0.8)}`;

  // ---------- Pasture ----------
  const sheep = (x, y, s, flip, b) => `<g transform="translate(${x},${y}) scale(${flip ? -s : s},${s})"><g>${shadow(8)}
      <path d="M-3 4 L-3 8 M3 4 L3 8" stroke="#3b3530" stroke-width="1.6" stroke-linecap="round"/>
      <g fill="#f8f6ef" stroke="#d9d4c6" stroke-width=".7">
        <circle cx="-4" cy="-2" r="4.5"/><circle cx="3" cy="-3" r="4.5"/><circle cx="-5" cy="2" r="4"/><circle cx="4" cy="2" r="4"/><circle cx="0" cy="0" r="5"/>
      </g>
      <g><ellipse cx="8.5" cy="-1" rx="3" ry="2.6" fill="#3b3530"/><circle cx="9.5" cy="-1.6" r=".6" fill="#fff"/>
        ${A(`<animateTransform attributeName="transform" type="rotate" values="0 6 0;0 6 0;28 6 0;24 6 0;28 6 0;0 6 0" keyTimes="0;.45;.55;.7;.85;1" dur="5s" begin="${b}s" ${rep}/>`)}</g>
      </g></g>`;
  const tuft = (x, y, b) => `<g transform="translate(${x},${y})"><path d="M-2 0 l1 -4 M0 0 l0 -5 M2 0 l-1 -4" stroke="#6ea546" stroke-width="1.2" stroke-linecap="round"/>${sway(9, 3, b)}</g>`;
  const flower = (x, y, c) => `<circle cx="${x}" cy="${y}" r="1.5" fill="${c}"/>`;
  const butterfly = (dur, begin, c) => A(`<g><g>
      <ellipse cx="-1.6" cy="0" rx="1.8" ry="1.2" fill="${c}"/><ellipse cx="1.6" cy="0" rx="1.8" ry="1.2" fill="${c}"/>
      <animateTransform attributeName="transform" type="scale" values="1 1;.25 1;1 1" dur=".35s" ${rep}/></g>
      <animateMotion path="M-40 10 C -20 -30, 10 30, 30 -10 S 10 -40, -40 10" dur="${dur}s" begin="${begin}s" ${rep}/></g>`);
  const pasture = (v) => `${base('gp')}
    <ellipse cx="-18" cy="-28" rx="44" ry="15" fill="#b9df8b" opacity=".75"/>
    <ellipse cx="24" cy="34" rx="40" ry="14" fill="#b9df8b" opacity=".6"/>
    <ellipse cx="-30" cy="40" rx="28" ry="10" fill="#8dc163" opacity=".5"/>
    <g stroke="#8a6a44" stroke-width="1.8" stroke-linecap="round">
      <path d="M-50 -4 L-22 -16"/><path d="M-50 1 L-22 -11"/>
      <path d="M-48 -8 L-48 4 M-39 -12 L-39 0 M-30 -15 L-30 -3 M-22 -19 L-22 -7"/>
    </g>
    ${tuft(-10, -44, -v)}${tuft(30, -14, -1.2)}${tuft(-44, 22, -0.6 - v)}${tuft(10, 54, -2)}${tuft(44, 10, -1.6)}${tuft(-20, 20, -0.3)}
    ${flower(-30, -40, '#fff')}${flower(16, -46, '#ffe36e')}${flower(42, 0, '#fff')}${flower(-40, 30, '#ffe36e')}${flower(22, 52, '#fff')}${flower(-8, 50, '#f7a1c4')}
    ${sheep(-20, -34, 1, false, -v * 2)}${sheep(20, -32, 1.05, true, -1.3 - v)}${sheep(-36, 18, 0.95, true, -3.1)}${sheep(32, 26, 1, false, -0.6 - v * 1.5)}${sheep(-2, 46, 0.95, false, -2.2)}
    ${butterfly(9, -v * 4.5, '#ffd84a')}`;

  // ---------- Fields ----------
  const sheaf = (x, y, s, b) => `<g transform="translate(${x},${y}) scale(${s})">${shadow(7)}<g>
      <g stroke="#b07e1e" stroke-width="1.3" stroke-linecap="round"><path d="M0 0 L-5 -16 M0 0 L-2 -18 M0 0 L1 -18 M0 0 L4 -17 M0 0 L6 -14"/></g>
      <g fill="#f7d36a" stroke="#c99a2e" stroke-width=".6">
        <ellipse cx="-5.5" cy="-18" rx="1.8" ry="3.5" transform="rotate(-18 -5.5 -18)"/><ellipse cx="-2" cy="-20" rx="1.8" ry="3.5"/>
        <ellipse cx="1.5" cy="-20" rx="1.8" ry="3.5"/><ellipse cx="4.5" cy="-19" rx="1.8" ry="3.5" transform="rotate(14 4.5 -19)"/>
        <ellipse cx="7" cy="-16" rx="1.8" ry="3.3" transform="rotate(28 7 -16)"/></g>
      <rect x="-3" y="-8" width="6" height="2.4" rx="1" fill="#8a5a1a"/>${sway(3.5, 3.4, b)}</g></g>`;
  const windmill = (x, y, v) => `<g transform="translate(${x},${y})">${shadow(9)}
      <path d="M-6 0 L-4 -20 L4 -20 L6 0 Z" fill="#f3ebd8" stroke="#c9b892" stroke-width=".8"/>
      <path d="M-5.5 -20 L0 -27 L5.5 -20 Z" fill="#b5523a"/>
      <rect x="-1.8" y="-6" width="3.6" height="6" fill="#7a5a3a"/>
      <g transform="translate(0,-21) rotate(${20 + v * 45})"><g fill="#fff8e8" stroke="#8a7350" stroke-width=".7">
        <rect x="-1.2" y="-15" width="2.4" height="30"/><rect x="-15" y="-1.2" width="30" height="2.4"/>
        <rect x="1.2" y="-15" width="4" height="10"/><rect x="-5.2" y="5" width="4" height="10"/>
        <rect x="5" y="1.2" width="10" height="4"/><rect x="-15" y="-5.2" width="10" height="4"/>
        ${A(`<animateTransform attributeName="transform" type="rotate" values="0;360" dur="${8 + v * 2}s" ${rep}/>`)}</g></g>
      <circle cx="0" cy="-21" r="1.6" fill="#5a4630"/></g>`;
  const fields = (v) => `${base('gf')}
    <g transform="rotate(-24)">${Array.from({ length: 18 }, (_, i) => `<rect x="-90" y="${-90 + i * 10}" width="180" height="5" fill="${i % 2 ? 'rgba(255,240,180,.22)' : 'rgba(150,100,10,.16)'}"/>`).join('')}</g>
    <path d="M-60 -6 Q -10 -14 60 6" stroke="#c99a3e" stroke-width="3" fill="none" opacity=".5"/>
    ${windmill(-28, -24, v)}${sheaf(24, -26, 1, -v)}${sheaf(38, 24, 0.95, -1.4)}${sheaf(-34, 30, 1, -0.7 - v)}${sheaf(4, 50, 0.9, -2.1)}${sheaf(-44, 6, 0.8, -2.8)}`;

  // ---------- Hills (clay & brick) ----------
  const bricks = (x, y, rows = 3) => {
    let r = `<g transform="translate(${x},${y})">${shadow(12)}`;
    for (let i = 0; i < rows; i++) {
      const n = 3 - (i > 1 ? 1 : 0), off = i % 2 ? 4 : 0, w = 8;
      for (let j = 0; j < n; j++) r += `<rect x="${-12 + off + j * w}" y="${-4 - i * 4.5}" width="${w - 0.8}" height="4" rx=".6" fill="${(i + j) % 2 ? '#b04a2c' : '#c0583a'}" stroke="#7d2f1d" stroke-width=".5"/>`;
    }
    return r + '</g>';
  };
  const puff = (b) => (MOTION
    ? `<circle cx="9" cy="-26" r="2.5" fill="rgba(245,240,235,.7)" opacity="0">
        <animate attributeName="cy" values="-26;-50" dur="3.6s" begin="${b}s" ${rep}/>
        <animate attributeName="cx" values="9;17" dur="3.6s" begin="${b}s" ${rep}/>
        <animate attributeName="r" values="2.5;7" dur="3.6s" begin="${b}s" ${rep}/>
        <animate attributeName="opacity" values="0;.7;0" dur="3.6s" begin="${b}s" ${rep}/></circle>`
    : '');
  const kiln = (x, y, v) => `<g transform="translate(${x},${y})">${shadow(12)}
      ${MOTION ? puff(-v) + puff(-1.2 - v) + puff(-2.4 - v) : '<circle cx="10" cy="-30" r="3" fill="rgba(240,235,230,.55)"/><circle cx="14" cy="-37" r="4.5" fill="rgba(240,235,230,.35)"/>'}
      <rect x="6" y="-26" width="5" height="14" fill="#7a3220"/>
      <path d="M-12 0 Q -12 -20 0 -20 Q 12 -20 12 0 Z" fill="#94432a" stroke="#6a2a18" stroke-width=".8"/>
      <path d="M-4 0 Q -4 -8 0 -8 Q 4 -8 4 0 Z" fill="#3a1a10"/>
      <path d="M-3 0 Q -3 -5 0 -5 Q 3 -5 3 0 Z" fill="#f2a24a" opacity=".85">${fade('.95;.55;.85;.5;.95', 1.3, -v * 0.6)}</path></g>`;
  const hills = (v) => `${base('gb')}
    <path d="M-70 -14 Q -40 -40 -10 -18 Q 20 -44 70 -16 L70 -75 L-70 -75 Z" fill="#dd8c58" opacity=".55"/>
    <path d="M-70 30 Q -36 6 0 26 Q 30 8 70 30 L70 75 L-70 75 Z" fill="#a24e26" opacity=".35"/>
    <ellipse cx="22" cy="-30" rx="17" ry="7" fill="#8e3f1f"/><ellipse cx="22" cy="-31" rx="13" ry="4.5" fill="#6d2e15"/>
    <ellipse cx="18" cy="-32" rx="5" ry="1.2" fill="rgba(255,200,160,.35)">${fade('.2;.6;.2', 4, -v * 2)}</ellipse>
    <path d="M12 -36 l-3 -5 M30 -37 l3 -4" stroke="#6e4a2a" stroke-width="1.3"/>
    ${bricks(-28, -24, 3)}${bricks(-36, 34, 2)}${kiln(30, 34, v)}
    ${[[-6, -48], [44, 0], [-48, 6], [8, 52], [-14, 34]].map(([a, b]) => `<ellipse cx="${a}" cy="${b}" rx="3" ry="1.8" fill="#9c4524"/>`).join('')}`;

  // ---------- Mountains (quarry) ----------
  const peak = (x, y, w, h, snow = true) => `<g transform="translate(${x},${y})">
      <path d="M${-w} 0 L0 ${-h} L${w} 0 Z" fill="#8994a2"/><path d="M0 ${-h} L${w} 0 L${w * 0.15} 0 Z" fill="#6c7785"/>
      ${snow ? `<path d="M0 ${-h} L${w * 0.32} ${-h * 0.66} L${w * 0.12} ${-h * 0.72} L0 ${-h * 0.6} L${-w * 0.14} ${-h * 0.7} L${-w * 0.32} ${-h * 0.66} Z" fill="#f4f7fb"/>` : ''}
      <path d="M${-w * 0.4} ${-h * 0.4} l6 4 M${w * 0.35} ${-h * 0.3} l-5 5" stroke="rgba(40,48,58,.35)" stroke-width="1.2"/></g>`;
  const rock = (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M-6 0 L-4 -5 L2 -6 L6 -2 L5 0 Z" fill="#7d8896"/><path d="M2 -6 L6 -2 L5 0 L1 0 Z" fill="#5f6a77"/></g>`;
  const sparkle = (x, y, b) => A(`<g transform="translate(${x},${y})"><g opacity="0">
      <path d="M0 -3 L.7 -.7 L3 0 L.7 .7 L0 3 L-.7 .7 L-3 0 L-.7 -.7 Z" fill="#fff"/>
      <animate attributeName="opacity" values="0;0;1;0" keyTimes="0;.7;.8;1" dur="3.2s" begin="${b}s" ${rep}/>
      <animateTransform attributeName="transform" type="rotate" values="0;90" dur="3.2s" begin="${b}s" ${rep}/></g></g>`);
  const cloud = (y, dur, b, s = 1) => A(`<g opacity=".8"><g transform="scale(${s})">
      <ellipse cx="0" cy="0" rx="12" ry="4.5" fill="#fff"/><ellipse cx="-6" cy="-3" rx="6" ry="4" fill="#fff"/><ellipse cx="4" cy="-4" rx="7" ry="5" fill="#fff"/></g>
      <animateTransform attributeName="transform" type="translate" values="-85 ${y};85 ${y}" dur="${dur}s" begin="${b}s" ${rep}/></g>`);
  // A cluster of blue ore crystals set into the rock, shimmering and catching the light.
  const vein = (x, y, s, b) => `<g transform="translate(${x},${y}) scale(${s})">
      <ellipse cx="0" cy="-3" rx="7" ry="6" fill="url(#oreglow)" opacity=".4">${fade('.1;.75;.1', 2.6, b)}</ellipse>
      ${[[-3, 0, 5, 1.6, -22], [0.5, 0, 7, 2, 4], [3.8, 0.5, 4.2, 1.5, 30]].map(([cx, cy, len, w, ang], i) => `<g transform="translate(${cx},${cy}) rotate(${ang})">
        <path d="M${-w} 0 L${-w} ${-len} L0 ${-len - w * 1.3} L${w} ${-len} L${w} 0 Z" fill="#4f86c6" stroke="#25456e" stroke-width=".5"/>
        <path d="M${-w} 0 L${-w} ${-len} L0 ${-len - w * 1.3} L0 0 Z" fill="#8ec5ff">${A(`<animate attributeName="fill" values="#8ec5ff;#e6f4ff;#8ec5ff" dur="2.6s" begin="${b - i * 0.5}s" ${rep}/>`)}</path></g>`).join('')}
      <path d="M-6 1 Q 0 -1.5 6 1 L5 2.5 L-5 2.5 Z" fill="#6c7785"/></g>`;
  const pebble = (path, dur, b) => A(`<g opacity="0"><path d="M-1.6 0 L-1 -1.4 L.8 -1.6 L1.6 -.2 L1 1 L-1 1 Z" fill="#6c7785">
        <animateTransform attributeName="transform" type="rotate" values="0;720" dur="${dur}s" begin="${b}s" ${rep}/></path>
      <animateMotion path="${path}" dur="${dur}s" begin="${b}s" ${rep} keyPoints="0;0;1;1" keyTimes="0;.6;.85;1" calcMode="linear"/>
      <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.6;.62;.84;.85" dur="${dur}s" begin="${b}s" ${rep}/></g>`);
  const mine = (x, y, v) => `<g transform="translate(${x},${y})">${shadow(12)}
      <path d="M-10 0 L-10 -10 Q 0 -20 10 -10 L10 0 Z" fill="#6b5a46"/><path d="M-7 0 L-7 -9 Q 0 -16 7 -9 L7 0 Z" fill="#1f1c1a"/>
      <ellipse cx="0" cy="-3" rx="5" ry="4" fill="#ffb347" opacity=".25">${fade('.12;.4;.2;.35;.12', 1.7, -v)}</ellipse>
      <path d="M-14 6 L14 6 M-12 9 L16 9" stroke="#8a6a44" stroke-width="1.2"/>
      <g transform="translate(-12,-11)">
        <circle r="6" fill="url(#lampglow)" opacity=".7">${A(`<animate attributeName="r" values="5;6.8;5.5;6.4;5" dur="1.6s" begin="${-v * 0.7}s" ${rep}/>`)}${fade('.55;.95;.6;.85;.55', 1.6, -v * 0.7)}</circle>
        <path d="M0 -4 L0 -2" stroke="#3a2a16" stroke-width=".8"/>
        <rect x="-1.6" y="-2" width="3.2" height="4" rx=".8" fill="#ffd27a" stroke="#5a3a12" stroke-width=".6"/></g>
      <g><rect x="10" y="-3" width="9" height="6" rx="1" fill="#55606c"/><circle cx="12" cy="4" r="1.5" fill="#333"/><circle cx="17" cy="4" r="1.5" fill="#333"/>
        <path d="M10.6 -3 l1.6 -2.6 l2.4 .6 l-.8 2 Z" fill="#9aa4b0"/>
        <path d="M13.6 -3 l1.4 -4.6 l1.4 4.6 Z" fill="#6aa3e6" stroke="#25456e" stroke-width=".4"/><path d="M13.6 -3 l1.4 -4.6 l0 4.6 Z" fill="#cfe6ff"/>
        <path d="M16.2 -3 l1.2 -3 l1.2 3 Z" fill="#4f86c6" stroke="#25456e" stroke-width=".4"/>
        ${MOTION ? `<g transform="translate(15,-8)"><g><path d="M0 -2 l.5 1.5 l1.5 .5 l-1.5 .5 l-.5 1.5 l-.5 -1.5 l-1.5 -.5 l1.5 -.5 Z" fill="#fff"/>
          <animateTransform attributeName="transform" type="scale" values="0;0;1.2;0" keyTimes="0;.5;.7;1" dur="1.9s" begin="${-v}s" ${rep}/></g></g>` : ''}
        ${drift('0 0;0 0;-14 0;-14 0;0 0', 9, -v * 4, 'keyTimes="0;.35;.5;.85;1"')}</g></g>`;
  const mountains = (v) => `${base('go')}
    ${peak(-18, -6, 30, 42)}${peak(22, -10, 26, 36)}
    ${vein(-26, -10, 1, -v * 1.3)}${vein(30, -13, 0.85, -1.4 - v)}${vein(-4, -4, 0.7, -0.6)}
    ${pebble('M-18 -40 Q -26 -26 -34 -8 L -38 -4', 6.5, -v * 3)}${pebble('M22 -40 Q 30 -28 38 -14 L 42 -10', 7.5, -2 - v * 2)}
    ${sparkle(-20, -40, -v * 1.5)}${sparkle(-14, -36, -1.6)}${sparkle(22, -38, -2.4 - v)}${sparkle(-24, -16, -0.7)}${sparkle(30, -20, -2 - v)}
    ${cloud(-30, 22, -v * 11, 0.9)}${cloud(-12, 30, -9 - v * 7, 0.7)}
    ${peak(-36, 50, 20, 22, false)}${peak(4, 56, 18, 18, false)}
    ${rock(-44, 18)}${rock(44, 12, 1.2)}${rock(-10, 36, .9)}${rock(-28, 34, .7)}
    ${mine(30, 38, v)}`;

  // ---------- Desert ----------
  const cactus = (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})">${shadow(7)}
      <rect x="-3" y="-22" width="6" height="22" rx="3" fill="#5f9a59"/>
      <path d="M-3 -10 L-8 -10 Q -10 -10 -10 -13 L-10 -17" stroke="#5f9a59" stroke-width="4.5" fill="none" stroke-linecap="round"/>
      <path d="M3 -14 L8 -14 Q 10 -14 10 -17 L10 -20" stroke="#4f8a4a" stroke-width="4.5" fill="none" stroke-linecap="round"/>
      <path d="M0 -20 L0 -2" stroke="rgba(255,255,255,.25)" stroke-width="1"/></g>`;
  const shimmer = (y, b) => A(`<path d="M-30 ${y} q 5 -2 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0" stroke="rgba(255,255,255,.55)" stroke-width="1" fill="none" opacity="0">
      <animate attributeName="opacity" values="0;.7;0" dur="3s" begin="${b}s" ${rep}/>
      <animateTransform attributeName="transform" type="translate" values="0 0;4 -3" dur="3s" begin="${b}s" ${rep}/></path>`);
  const tumbleweed = (b) => (MOTION
    ? `<g><g><circle r="4.5" fill="none" stroke="#a88a52" stroke-width="1" stroke-dasharray="2 1.6"/><path d="M-3 -2 L3 2 M-2 3 L2 -3" stroke="#a88a52" stroke-width=".8"/>
        <animateTransform attributeName="transform" type="rotate" values="0;360" dur="1.6s" ${rep}/></g>
        <animateTransform attributeName="transform" type="translate" values="-80 46;-30 42;20 46;80 43" dur="12s" begin="${b}s" ${rep}/></g>`
    : '<circle cx="-10" cy="44" r="5" fill="none" stroke="#a88a52" stroke-width="1" stroke-dasharray="2 2"/>');
  const desert = (v) => `${base('gd')}
    <path d="M-70 -20 Q -30 -36 0 -22 Q 30 -8 70 -26" stroke="#f6e7bd" stroke-width="5" fill="none" opacity=".8"/>
    <path d="M-70 -14 Q -30 -30 0 -16 Q 30 -2 70 -20 L70 -75 L-70 -75 Z" fill="#f3e2b4" opacity=".55"/>
    <path d="M-70 34 Q -20 16 20 32 Q 46 42 70 30" stroke="#c9ad6e" stroke-width="3" fill="none" opacity=".6"/>
    <path d="M-60 46 Q -30 38 -4 48" stroke="#c9ad6e" stroke-width="2" fill="none" opacity=".5"/>
    ${shimmer(-36, -v * 1.5)}${shimmer(16, -1.5 - v)}
    ${cactus(-28, -26, 1)}${cactus(34, 30, 0.8)}${rock(30, -30, .8)}${rock(-38, 30, .9)}
    ${tumbleweed(-v * 6)}`;

  // ---------- Simple resource icons (harbour badges), drawn in a ~ -13..13 box ----------
  const ICONS = {
    wood: `<g stroke="#5a3a1c" stroke-width=".9">
        <rect x="-12" y="-1" width="13" height="7" rx="3.5" fill="#9a6534"/><rect x="0" y="-1" width="13" height="7" rx="3.5" fill="#8a5a2e"/>
        <rect x="-6" y="-8" width="13" height="7" rx="3.5" fill="#a56d3a"/>
        <circle cx="1" cy="2.5" r="3.5" fill="#e2b77a"/><circle cx="13" cy="2.5" r="3.5" fill="#e2b77a"/><circle cx="7" cy="-4.5" r="3.5" fill="#e8c088"/></g>
      <g fill="none" stroke="#a87442" stroke-width=".7"><circle cx="1" cy="2.5" r="1.6"/><circle cx="13" cy="2.5" r="1.6"/><circle cx="7" cy="-4.5" r="1.6"/></g>
      <path d="M-9 1.5 h6 M-3 4 h4 M-3 -5.5 h5" stroke="#6b431f" stroke-width=".7" stroke-linecap="round"/>`,
    brick: `<g stroke="#6e2616" stroke-width=".8">
        <rect x="-12" y="1" width="11.5" height="6" rx="1" fill="#c0583a"/><rect x=".5" y="1" width="11.5" height="6" rx="1" fill="#b04a2c"/>
        <rect x="-6" y="-6" width="11.5" height="6" rx="1" fill="#cc6a48"/></g>
      <path d="M-10 2.5 h8 M2.5 2.5 h8 M-4 -4.5 h8" stroke="rgba(255,220,190,.45)" stroke-width="1" stroke-linecap="round"/>`,
    // A boulder with blue ore crystals growing out of it
    ore: (() => {
      const C = [[-4, -1, 6, 2, -24], [1.5, -2, 9.5, 2.6, 6], [6.5, -0.5, 5.5, 2, 34]];
      const outline = ([x, y, len, w, ang]) => `<path transform="translate(${x},${y}) rotate(${ang})" d="M${-w} 0 L${-w} ${-len} L0 ${-len - w * 1.3} L${w} ${-len} L${w} 0 Z"/>`;
      const crystal = ([x, y, len, w, ang], i) => `<g transform="translate(${x},${y}) rotate(${ang})">
          <path d="M${-w} 0 L${-w} ${-len} L0 ${-len - w * 1.3} L${w} ${-len} L${w} 0 Z" fill="#4f86c6" stroke="#25456e" stroke-width=".7" stroke-linejoin="round">
            ${A(`<animate attributeName="fill" values="#4f86c6;#6aa3e6;#4f86c6" dur="2.4s" begin="${-i * 0.8}s" ${rep}/>`)}</path>
          <path d="M${-w} 0 L${-w} ${-len} L0 ${-len - w * 1.3} L0 0 Z" fill="#8ec5ff">
            ${A(`<animate attributeName="fill" values="#8ec5ff;#e2f2ff;#8ec5ff" dur="2.4s" begin="${-i * 0.8}s" ${rep}/>`)}</path>
          <path d="M${-w * 0.45} ${-1} L${-w * 0.45} ${-len + 0.5}" stroke="rgba(255,255,255,.75)" stroke-width=".7" stroke-linecap="round"/></g>`;
      const star = (x, y, s, b, dur = 2.2) => `<g transform="translate(${x},${y}) scale(${s})"><g>
          <path d="M0 -2.6 l.6 2 l2 .6 l-2 .6 l-.6 2 l-.6 -2 l-2 -.6 l2 -.6 Z" fill="#fff"/>
          ${A(`<animateTransform attributeName="transform" type="scale" values="0;0;1.3;0" keyTimes="0;.55;.72;1" dur="${dur}s" begin="${b}s" ${rep}/>
            <animateTransform attributeName="transform" type="rotate" additive="sum" values="0;120" dur="${dur}s" begin="${b}s" ${rep}/>`)}</g></g>`;
      const glint = (x, b) => A(`<circle cx="${x}" cy="-8" r=".7" fill="#d8eeff" opacity="0">
          <animate attributeName="cy" values="-8;-20" dur="2.6s" begin="${b}s" ${rep}/>
          <animate attributeName="opacity" values="0;1;0" dur="2.6s" begin="${b}s" ${rep}/></circle>`);
      return `<ellipse cx="0" cy="9.5" rx="12.5" ry="1.8" fill="rgba(0,0,0,.2)"/>
        <ellipse cx="1.5" cy="-7" rx="11" ry="10" fill="url(#oreglow)" opacity=".45">${A(`<animate attributeName="opacity" values=".15;.8;.15" dur="2.4s" ${rep}/>`)}</ellipse>
        ${C.map(crystal).join('')}
        ${A(`<clipPath id="oreclip">${C.map(outline).join('')}</clipPath>
          <g clip-path="url(#oreclip)"><rect x="-2" y="-24" width="3.2" height="34" fill="rgba(255,255,255,.9)" transform="rotate(28)">
            <animateTransform attributeName="transform" type="translate" additive="sum" values="-16 0;14 0;14 0" keyTimes="0;.35;1" dur="2.8s" ${rep}/></rect></g>`)}
        ${glint(-3, 0)}${glint(3, -0.9)}${glint(7, -1.7)}
        <path d="M-12.5 8.5 L-11.5 0.5 L-6.5 -4 L0 -3 L7.5 -2.5 L12.5 3 L11.5 8.5 Z" fill="#7b8592" stroke="#3d434c" stroke-width=".9" stroke-linejoin="round"/>
        <path d="M-11.5 0.5 L-6.5 -4 L0 -3 L-2.5 2.5 Z" fill="#a1abb7"/>
        <path d="M-2.5 2.5 L0 -3 L7.5 -2.5 L4 3 Z" fill="#8c96a3"/>
        <path d="M4 3 L7.5 -2.5 L12.5 3 L11.5 8.5 L5 8.5 Z" fill="#626b77"/>
        <circle cx="-7" cy="4.5" r=".9" fill="#e8c45a">${A(`<animate attributeName="opacity" values="1;.3;1" dur="1.8s" ${rep}/>`)}</circle>
        <circle cx="1.5" cy="6" r=".7" fill="#e8c45a">${A(`<animate attributeName="opacity" values=".3;1;.3" dur="1.8s" ${rep}/>`)}</circle>
        ${MOTION ? star(2.5, -14.5, 1, 0) + star(-6.5, -7.5, 0.7, -0.8, 2.6) + star(9.5, -6.5, 0.75, -1.5, 2.4)
          : '<path d="M2.5 -15.5 l.6 1.6 l1.6 .6 l-1.6 .6 l-.6 1.6 l-.6 -1.6 l-1.6 -.6 l1.6 -.6 Z" fill="#fff"/>'}`;
    })(),
    // A fluffy sheep, side view
    wool: (() => {
      const bumps = Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return [(-2 + Math.cos(a) * 8.6).toFixed(2), (-0.5 + Math.sin(a) * 5.6).toFixed(2)];
      });
      const fleece = (fill, r) => `<ellipse cx="-2" cy="-0.5" rx="${8.6 + r - 3.2}" ry="${5.6 + r - 3.2}" fill="${fill}"/>` + bumps.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join('');
      return `<ellipse cx="-1" cy="11" rx="11" ry="1.6" fill="rgba(0,0,0,.18)"/>
        <g fill="#2f2a27"><rect x="-8.6" y="3" width="2.3" height="8" rx="1.1"/><rect x="-4.6" y="4" width="2.3" height="7" rx="1.1" fill="#24201e"/>
          <rect x="1" y="4" width="2.3" height="7" rx="1.1" fill="#24201e"/><rect x="4.6" y="3" width="2.3" height="8" rx="1.1"/></g>
        <circle cx="-12.4" cy="-2" r="2.4" fill="#6f675c"/>
        ${fleece('#6f675c', 4.1)}
        <circle cx="-12.4" cy="-2" r="1.6" fill="#fbf8f0"/>
        ${fleece('#fbf8f0', 3.3)}
        <ellipse cx="-2" cy="3" rx="8" ry="2.6" fill="#ece6d8"/>
        <path d="M-8 -3 a1.5 1.5 0 1 1 3 0 M-2.5 -4.5 a1.5 1.5 0 1 1 3 0 M3 -3 a1.5 1.5 0 1 1 3 0 M-5.5 0.5 a1.5 1.5 0 1 1 3 0 M0 0 a1.5 1.5 0 1 1 3 0" stroke="#d6cdb9" stroke-width=".8" fill="none" stroke-linecap="round"/>
        <ellipse cx="7.6" cy="-5.6" rx="2.6" ry="1.1" transform="rotate(-30 7.6 -5.6)" fill="#2f2a27"/>
        <ellipse cx="9.4" cy="-2.4" rx="3.3" ry="4.2" transform="rotate(-28 9.4 -2.4)" fill="#3a3330" stroke="#1f1b19" stroke-width=".6"/>
        <ellipse cx="12.3" cy="-5.6" rx="2.3" ry="1" transform="rotate(28 12.3 -5.6)" fill="#3a3330"/>
        <circle cx="8.6" cy="-6.6" r="1.8" fill="#fbf8f0" stroke="#6f675c" stroke-width=".6"/><circle cx="10.3" cy="-7.1" r="1.5" fill="#fbf8f0" stroke="#6f675c" stroke-width=".6"/>
        <circle cx="10.6" cy="-3.4" r=".95" fill="#fff"/><circle cx="10.85" cy="-3.3" r=".45" fill="#111"/>
        <path d="M11.4 0.4 q.8 .5 1.6 0" stroke="#7a6f66" stroke-width=".6" fill="none" stroke-linecap="round"/>`;
    })(),
    // A single bundle of wheat, tied in the middle
    grain: (() => {
      const ear = (ang, len) => {
        let k = '';
        for (let i = 0; i < 4; i++) {
          const y = -4.6 - i * 2.1 * len;
          k += `<ellipse cx="-1.25" cy="${y}" rx="1.25" ry="1.9" transform="rotate(-24 -1.25 ${y})"/><ellipse cx="1.25" cy="${y}" rx="1.25" ry="1.9" transform="rotate(24 1.25 ${y})"/>`;
        }
        const top = -4.6 - 4 * 2.1 * len;
        return `<g transform="rotate(${ang} 0 1.5)">
            <path d="M0 1.5 L0 -3.5" stroke="#b8862a" stroke-width="1"/>
            <g fill="#f0c44c" stroke="#b8862a" stroke-width=".5">${k}<ellipse cx="0" cy="${top + 0.6}" rx="1.2" ry="1.8"/></g>
            <path d="M-1.6 ${top + 2} l-1.2 -3 M1.6 ${top + 2} l1.2 -3 M0 ${top - 1} l0 -2.6" stroke="#d6a640" stroke-width=".5" stroke-linecap="round"/></g>`;
      };
      const stalks = [-6, -4, -2, 0, 2, 4, 6].map((x, i) => `<path d="M0 2 Q ${x * 0.4} 6 ${x} 11" stroke="${i % 2 ? '#c8952f' : '#a7761c'}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`).join('');
      return `<ellipse cx="0" cy="11.5" rx="9" ry="1.6" fill="rgba(0,0,0,.2)"/>
        ${stalks}
        ${ear(-34, 0.85)}${ear(34, 0.85)}${ear(-17, 0.95)}${ear(17, 0.95)}${ear(0, 1)}
        <rect x="-3.8" y="0.3" width="7.6" height="3.2" rx="1.3" fill="#8a5a1a" stroke="#5a3a12" stroke-width=".5"/>
        <path d="M-3 1.3 h6" stroke="rgba(255,220,150,.5)" stroke-width=".6" stroke-linecap="round"/>`;
    })(),
  };

  const ART = { wood: forest, wool: pasture, grain: fields, brick: hills, ore: mountains, desert };
  const DEFS = `<defs>
    ${lin('gw', '#4f9a5f', '#2f6f42')}${lin('gp', '#a9d67a', '#82b85a')}${lin('gf', '#efcd6b', '#d5a843')}
    ${lin('gb', '#d98a58', '#b4603a')}${lin('go', '#b3bcc6', '#8590a0')}${lin('gd', '#f0dfae', '#dcc58c')}
    <radialGradient id="oreglow"><stop offset="0" stop-color="#a6d8ff" stop-opacity=".95"/><stop offset="1" stop-color="#a6d8ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="lampglow"><stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
    ${Object.entries(ART).map(([k, fn]) => `<g id="art-${k}-0">${fn(0)}</g><g id="art-${k}-1">${fn(1)}</g>`).join('')}
    ${Object.entries(ICONS).map(([k, svg]) => `<g id="icon-${k}">${svg}</g>`).join('')}
  </defs>`;

  function inject() {
    if (document.getElementById('terrain-art')) return;
    const holder = document.createElement('div');
    holder.innerHTML = `<svg id="terrain-art" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">${DEFS}</svg>`;
    document.body.prepend(holder.firstChild);
  }
  inject();
  return { inject, MOTION };
})();
