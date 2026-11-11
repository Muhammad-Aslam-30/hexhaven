// 3D dice throw: two CSS-3D cubes tumble in, bounce, settle on the rolled faces, then the total pops up.
// Dice3D.roll(container, d1, d2, { size }) → Promise that resolves when the dice have landed.
'use strict';

const Dice3D = (() => {
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const LAND_MS = 1700, HOLD_MS = 1300, FADE_MS = 450;
  const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  // Cube faces: front 1, back 6, right 3, left 4, top 2, bottom 5 → cube rotation that brings each to the front.
  const FACES = [['front', 1], ['back', 6], ['right', 3], ['left', 4], ['top', 2], ['bottom', 5]];
  const FINAL = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };

  const css = `
  .d3-layer { position: absolute; inset: 0; pointer-events: none; perspective: 900px; z-index: 40; overflow: hidden; }
  .d3-layer.fixed { position: fixed; z-index: 80; background: radial-gradient(circle at 50% 50%, rgba(5,12,24,.35), rgba(5,12,24,.6)); }
  .d3-die, .d3-shadow { position: absolute; left: 50%; top: 50%; width: var(--s); height: var(--s); margin: calc(var(--s) / -2) 0 0 calc(var(--s) / -2); }
  .d3-die { transform-style: preserve-3d; will-change: transform; }
  .d3-shadow { border-radius: 50%; background: radial-gradient(closest-side, rgba(0,0,0,.45), rgba(0,0,0,0)); transform-origin: center; }
  .d3-cube { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; will-change: transform; }
  .d3-face { position: absolute; inset: 0; border-radius: 16%; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); padding: 13%;
    background: radial-gradient(circle at 30% 25%, #ffffff, #e8e4d8 75%); box-shadow: inset 0 0 0 1.5px rgba(0,0,0,.08), inset 0 -5px 10px rgba(0,0,0,.08); backface-visibility: hidden; }
  .d3-die.red .d3-face { background: radial-gradient(circle at 30% 25%, #ff6b6f, #c8343a 75%); box-shadow: inset 0 0 0 1.5px rgba(0,0,0,.15), inset 0 -5px 10px rgba(0,0,0,.18); }
  .d3-face i { width: 72%; height: 72%; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #4a4a4a, #111); place-self: center; }
  .d3-die.red .d3-face i { background: radial-gradient(circle at 35% 35%, #fff, #e9e6e0); }
  .d3-face.front { transform: translateZ(calc(var(--s) / 2)); }
  .d3-face.back { transform: rotateY(180deg) translateZ(calc(var(--s) / 2)); }
  .d3-face.right { transform: rotateY(90deg) translateZ(calc(var(--s) / 2)); }
  .d3-face.left { transform: rotateY(-90deg) translateZ(calc(var(--s) / 2)); }
  .d3-face.top { transform: rotateX(90deg) translateZ(calc(var(--s) / 2)); }
  .d3-face.bottom { transform: rotateX(-90deg) translateZ(calc(var(--s) / 2)); }
  .d3-core { position: absolute; inset: 6%; background: #d9d4c6; transform-style: preserve-3d; }
  .d3-die.red .d3-core { background: #a82a2f; }
  .d3-sum { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; color: #fff; font-family: Georgia, 'Times New Roman', serif;
    font-weight: 800; font-size: calc(var(--s) * 1.15); line-height: 1; text-shadow: 0 4px 18px rgba(0,0,0,.6), 0 0 2px rgba(0,0,0,.6); opacity: 0; }
  .d3-sum small { display: block; font-family: system-ui, 'Segoe UI', sans-serif; font-size: calc(var(--s) * .26); font-weight: 800; letter-spacing: 1px; text-transform: uppercase; margin-top: 6px; color: #ffd166; }
  .d3-sum.seven small { color: #ff8a8d; }
  `;
  function injectCss() {
    if (document.getElementById('d3-css')) return;
    const s = document.createElement('style'); s.id = 'd3-css'; s.textContent = css; document.head.appendChild(s);
  }
  const face = (n) => Array.from({ length: 9 }, (_, i) => (PIPS[n].includes(i + 1) ? '<i></i>' : '<b></b>')).join('');
  const dieHtml = (red) => `<div class="d3-die${red ? ' red' : ''}"><div class="d3-cube">${FACES.map(([f, n]) => `<div class="d3-face ${f}">${face(n)}</div>`).join('')}</div></div>`;
  const rand = (a, b) => a + Math.random() * (b - a);

  let active = null;
  function roll(container, d1, d2, { size = 80, fixed = false, label = '' } = {}) {
    if (REDUCED || !container || !Element.prototype.animate) return Promise.resolve();
    injectCss();
    if (active) active.remove();
    const layer = document.createElement('div');
    layer.className = 'd3-layer' + (fixed ? ' fixed' : '');
    layer.style.setProperty('--s', size + 'px');
    const sum = d1 + d2;
    layer.innerHTML = `<div class="d3-shadow"></div><div class="d3-shadow"></div>${dieHtml(true)}${dieHtml(false)}
      <div class="d3-sum${sum === 7 ? ' seven' : ''}">${sum}<small>${sum === 7 ? 'Bandit!' : label}</small></div>`;
    (fixed ? document.body : container).appendChild(layer);
    active = layer;
    const W = layer.clientWidth, H = layer.clientHeight;
    const dice = layer.querySelectorAll('.d3-die'), shadows = layer.querySelectorAll('.d3-shadow'), cubes = layer.querySelectorAll('.d3-cube');
    const from = Math.random() < 0.5 ? -1 : 1; // thrown in from the left or right
    [d1, d2].forEach((val, i) => {
      const lx = (i ? 1 : -1) * size * 0.78 + rand(-8, 8), ly = (i ? 6 : -6) + rand(-6, 6);
      const sx = from * (W * 0.5 + size), sy = H * 0.32 + i * size * 0.4;
      const at = (f) => lx * 1 + (sx - lx) * (1 - f);
      const bounce = Math.min(90, H * 0.14);
      const pos = [
        { x: sx, y: sy, lift: bounce * 1.4, s: 1.35, o: 0 },
        { x: at(0.55), y: ly, lift: 0, s: 1, o: 0.35, e: 'ease-out' },
        { x: at(0.78), y: ly, lift: bounce, s: 1.08, o: 0.5, e: 'ease-in' },
        { x: at(0.93), y: ly, lift: 0, s: 1, o: 0.68, e: 'ease-out' },
        { x: at(0.98), y: ly, lift: bounce * 0.28, s: 1.02, o: 0.79, e: 'ease-in' },
        { x: lx, y: ly, lift: 0, s: 1, o: 0.9, e: 'ease-out' },
        { x: lx, y: ly, lift: 0, s: 1, o: 1 },
      ];
      const delay = i * 90;
      dice[i].animate(pos.map((p) => ({ transform: `translate(${p.x}px, ${p.y - p.lift}px) scale(${p.s})`, offset: p.o, easing: p.e || 'linear' })), { duration: LAND_MS, delay, fill: 'both' });
      shadows[i].animate(pos.map((p) => ({ transform: `translate(${p.x}px, ${p.y + size * 0.42}px) scale(${1 - p.lift / (bounce * 2.2)}, ${0.35 * (1 - p.lift / (bounce * 2.2))})`, opacity: 1 - p.lift / (bounce * 1.8), offset: p.o })), { duration: LAND_MS, delay, fill: 'both' });
      const [fx, fy] = FINAL[val];
      const tilt = rand(-14, 14);
      cubes[i].animate([
        { transform: `rotateZ(${rand(-180, 180)}deg) rotateX(${rand(0, 360)}deg) rotateY(${rand(0, 360)}deg)` },
        { transform: `rotateZ(${tilt}deg) rotateX(${fx + 360 * (2 + i)}deg) rotateY(${fy + 360 * 3}deg)` },
      ], { duration: LAND_MS * 0.92, delay, fill: 'both', easing: 'cubic-bezier(.12,.62,.25,1)' });
    });
    const sumEl = layer.querySelector('.d3-sum');
    sumEl.animate([
      { opacity: 0, transform: 'translate(-50%, -20%) scale(.4)' },
      { opacity: 1, transform: `translate(-50%, ${-size * 1.55 - 12}px) scale(1.15)`, offset: 0.6 },
      { opacity: 1, transform: `translate(-50%, ${-size * 1.55}px) scale(1)` },
    ], { duration: 480, delay: LAND_MS - 60, fill: 'both', easing: 'cubic-bezier(.2,1.4,.4,1)' });
    layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, delay: LAND_MS + HOLD_MS, fill: 'forwards' })
      .onfinish = () => { layer.remove(); if (active === layer) active = null; };
    return new Promise((res) => setTimeout(res, LAND_MS));
  }

  return { roll, LAND_MS, REDUCED };
})();
