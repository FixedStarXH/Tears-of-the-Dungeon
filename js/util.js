/* util.js —— 常量 / 数学 / 播种随机 / 粒子 / 屏幕震动 / 程序化音效 */
'use strict';

// ---- 逻辑分辨率：15×9 格，每格 60px，墙壁占外圈，可行走区 13×7 ----
const CELL = 60;
const COLS = 15, ROWS = 9;
const W = COLS * CELL, H = ROWS * CELL;      // 900×540
const WALK_MIN_X = 1, WALK_MAX_X = COLS - 2; // 可行走列 1..13
const WALK_MIN_Y = 1, WALK_MAX_Y = ROWS - 2; // 可行走行 1..7
const TAU = Math.PI * 2;
const FPS = 60;

const cellCenter = (gx, gy) => ({ x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2 });
const cellIndex = (px, py) => ({
  gx: Math.max(0, Math.min(COLS - 1, Math.floor(px / CELL))),
  gy: Math.max(0, Math.min(ROWS - 1, Math.floor(py / CELL))),
});

// ---- 播种随机数（mulberry32） ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 全局随机数（每局用种子重置，便于复现）
let RNG = mulberry32((Math.random() * 1e9) | 0);
function setSeed(seed) { RNG = mulberry32(seed | 0); }
const rand = (a, b) => a + RNG() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(RNG() * arr.length)];
const chance = (p) => RNG() < p;
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(RNG() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---- 数学 ----
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const angleTo = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
const vecLen = (x, y) => Math.hypot(x, y);
const norm = (x, y, len) => {
  const l = vecLen(x, y) || 1;
  const k = len / l;
  return { x: x * k, y: y * k };
};

// 圆与圆碰撞
function circleHit(ax, ay, ar, bx, by, br) {
  const dx = bx - ax, dy = by - ay;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

// 圆与矩形碰撞（矩形可旋转）
function circleRectHit(cx, cy, cr, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  return dist(cx, cy, nx, ny) <= cr;
}

// ---- 粒子系统 ----
let particles = [];
function spawnParticle(p) {
  if (particles.length > 600) particles.splice(0, particles.length - 600);
  particles.push(Object.assign({
    x: 0, y: 0, vx: 0, vy: 0, life: 0.5, t: 0,
    size: 3, color: '#fff', gravity: 0, add: null,
  }, p));
}
function burst(x, y, opts) {
  const { count = 10, speed = 80, color = '#fff', size = 3, life = 0.5, gravity = 0, spread = TAU } = opts || {};
  for (let i = 0; i < count; i++) {
    const a = rand(0, spread);
    const s = rand(speed * 0.3, speed);
    spawnParticle({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, size: rand(size * 0.6, size * 1.4), life: rand(life * 0.5, life), gravity });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    if (p.t >= p.life) { particles.splice(i, 1); continue; }
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= (1 - 0.6 * dt);
    p.vy *= (1 - 0.6 * dt);
  }
}
function drawParticles(ctx) {
  for (const p of particles) {
    const a = 1 - p.t / p.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    const s = p.size * (0.5 + a * 0.5);
    ctx.beginPath();
    ctx.arc(p.x, p.y, s, 0, TAU);
    ctx.fill();
    if (p.add) p.add(ctx, p, a);
  }
  ctx.globalAlpha = 1;
}

// ---- 屏幕震动 ----
let shakeAmp = 0, shakeTime = 0;
function addShake(amp, time) { shakeAmp = Math.max(shakeAmp, amp); shakeTime = Math.max(shakeTime, time); }
function updateShake(dt) {
  if (shakeTime > 0) { shakeTime -= dt; if (shakeTime <= 0) shakeAmp = 0; }
}
function shakeOffset() {
  if (shakeTime <= 0) return { x: 0, y: 0 };
  const k = shakeAmp * (shakeTime / Math.max(0.001, shakeAmp * 0.15));
  return { x: rand(-k, k), y: rand(-k, k) };
}

// ---- 命中停顿（hit-stop） ----
let hitStop = 0;
function stopHit(frames) { hitStop = Math.max(hitStop, frames); }
function updateHitStop(dt) { if (hitStop > 0) hitStop -= dt; }
const isStopped = () => hitStop > 0;

// ---- 程序化音效（WebAudio，零素材） ----
const Audio = (function () {
  let ctx = null, master = null, muted = false;
  function ensure() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, vol, slideTo, delay) {
    if (muted) return;
    if (!ensure()) return;
    const t0 = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, filterFreq, delay) {
    if (muted) return;
    if (!ensure()) return;
    const t0 = ctx.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }
  return {
    unlock() { ensure(); },
    setMuted(m) { muted = m; },
    get muted() { return muted; },
    shoot() { tone(880, 0.07, 'square', 0.06, 420); },
    laser() { tone(200, 0.18, 'sawtooth', 0.12, 900); },
    hit() { noise(0.08, 0.14, 900); tone(160, 0.09, 'square', 0.1, 60); },
    kill() { noise(0.16, 0.2, 700); tone(300, 0.2, 'sawtooth', 0.1, 50); },
    boom() { noise(0.35, 0.3, 500); tone(120, 0.3, 'sawtooth', 0.16, 30); },
    hurt() { tone(220, 0.2, 'square', 0.16, 80); },
    pickup() { tone(660, 0.08, 'triangle', 0.14); tone(990, 0.1, 'triangle', 0.12, 0, 0.06); },
    item() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.14, 0, i * 0.07)); },
    heart() { tone(520, 0.09, 'sine', 0.16, 780); },
    coin() { tone(1318, 0.12, 'square', 0.1, 1760); },
    key() { tone(420, 0.06, 'square', 0.12, 840); },
    doorOpen() { tone(300, 0.15, 'triangle', 0.12, 520); tone(150, 0.2, 'triangle', 0.1, 90, 0.08); },
    bossRoar() { tone(90, 0.7, 'sawtooth', 0.2, 40); noise(0.6, 0.15, 400); },
    stomp() { noise(0.4, 0.35, 300); tone(70, 0.4, 'sine', 0.3, 30); },
    laserShoot() { tone(1200, 0.12, 'sawtooth', 0.08, 200); },
    walk() { noise(0.03, 0.03, 800); },
  };
})();
