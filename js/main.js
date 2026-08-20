/* main.js —— 输入（键盘+触控）/ 缩放适配 / 界面流程 / window.__game 调试接口 */
'use strict';

// ================= 输入 =================
const Input = {
  moveX: 0, moveY: 0,
  aimX: 0, aimY: 0,
  aimOrder: [],
};

const KEYMAP = {
  KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};
const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

let moveKeys = new Set();
let aimKeys = new Set();

function setAim() {
  // 移动键也影响瞄准（原作行为：朝移动方向射）
  const all = [...aimKeys, ...moveKeys];
  const last = Input.aimOrder.filter((k) => all.includes(k)).pop();
  if (!last) { Input.aimX = 0; Input.aimY = 0; return; }
  const [x, y] = DIRV[last];
  Input.aimX = x; Input.aimY = y;
}

function updateMove() {
  let x = 0, y = 0;
  for (const k of moveKeys) { x += DIRV[k][0]; y += DIRV[k][1]; }
  const l = Math.hypot(x, y);
  if (l > 0) { x /= l; y /= l; }
  Input.moveX = x; Input.moveY = y;
}

window.addEventListener('keydown', (e) => {
  const dir = KEYMAP[e.code];
  if (!dir) return;
  e.preventDefault();
  Audio.unlock();
  if (e.code.startsWith('Arrow')) {
    if (!aimKeys.has(dir)) { aimKeys.add(dir); Input.aimOrder.push(dir); }
  } else {
    moveKeys.add(dir);
  }
  updateMove(); setAim();
});
window.addEventListener('keyup', (e) => {
  const dir = KEYMAP[e.code];
  if (!dir) return;
  e.preventDefault();
  if (e.code.startsWith('Arrow')) {
    aimKeys.delete(dir);
    Input.aimOrder = Input.aimOrder.filter((k) => k !== dir);
  } else {
    moveKeys.delete(dir);
  }
  updateMove(); setAim();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    if (Game.state === 'menu') startNewGame();
    else if (Game.state === 'dead' || Game.state === 'victory') startNewGame();
    else if (Game.state === 'paused') resumeGame();
  }
  if (e.code === 'KeyP') { togglePause(); }
  if (e.code === 'KeyM') {
    Audio.setMuted(!Audio.muted);
    showToast(Audio.muted ? '音效已关闭' : '音效已开启');
  }
});
window.addEventListener('blur', () => { moveKeys.clear(); aimKeys.clear(); Input.aimOrder = []; updateMove(); setAim(); });

// ================= 触控（虚拟摇杆 + 四向射击） =================
function initTouch() {
  const wrap = document.getElementById('touch-wrap');
  const isTouch = ('ontouchstart' in window) || new URLSearchParams(location.search).get('mobile') === '1';
  if (!isTouch) return;
  wrap.classList.remove('hidden');
  const joyZone = document.getElementById('joy-zone');
  const knob = document.getElementById('joy-knob');
  let active = null;
  const R = 42;
  function joyMove(e) {
    e.preventDefault();
    const rect = joyZone.getBoundingClientRect();
    // joy-base 位于 joy-zone 左下角 10px，120×120 → 中心距 zone 左上 (70, 90)
    const cx = rect.left + 70;
    const cy = rect.top + rect.height - 70;
    const dx = (e.touches ? e.touches[0].clientX : e.clientX) - cx;
    const dy = (e.touches ? e.touches[0].clientY : e.clientY) - cy;
    const d = Math.hypot(dx, dy);
    const k = Math.min(1, d / R);
    knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    Input.moveX = d < 6 ? 0 : dx / d * k;
    Input.moveY = d < 6 ? 0 : dy / d * k;
  }
  function joyEnd() {
    if (!active) return;
    active = null;
    knob.style.transform = 'translate(-50%, -50%)';
    Input.moveX = 0; Input.moveY = 0;
  }
  joyZone.addEventListener('touchstart', (e) => { active = true; joyMove(e); }, { passive: false });
  joyZone.addEventListener('touchmove', (e) => { if (active) joyMove(e); }, { passive: false });
  joyZone.addEventListener('touchend', joyEnd);
  joyZone.addEventListener('touchcancel', joyEnd);

  // 射击按钮
  const shootBtns = document.querySelectorAll('.shoot-btn');
  const press = new Map();
  function shootStart(e) {
    e.preventDefault();
    const btn = e.currentTarget;
    const dir = btn.dataset.dir;
    press.set(dir, btn);
    Input.aimOrder.push(dir);
    if (!aimKeys.has(dir)) aimKeys.add(dir); // 触控方向参与瞄准（供 setAim 识别）
    btn.classList.add('active');
    setAim();
  }
  function shootEnd(e) {
    e.preventDefault();
    const btn = e.currentTarget;
    const dir = btn.dataset.dir;
    press.delete(dir);
    aimKeys.delete(dir);
    Input.aimOrder = Input.aimOrder.filter((k) => k !== dir);
    btn.classList.remove('active');
    setAim();
  }
  for (const btn of shootBtns) {
    btn.addEventListener('touchstart', shootStart, { passive: false });
    btn.addEventListener('touchend', shootEnd, { passive: false });
    btn.addEventListener('touchcancel', shootEnd, { passive: false });
  }
}

// ================= 缩放适配 =================
function fitStage() {
  const stage = document.getElementById('stage');
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / 900, vh / 540);
  stage.style.transform = `scale(${scale})`;
  stage.style.left = ((vw - 900 * scale) / 2) + 'px';
  stage.style.top = ((vh - 540 * scale) / 2) + 'px';
}
window.addEventListener('resize', fitStage);

// ================= 界面流程 =================
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function startNewGame() {
  for (const id of ['screen-start', 'screen-dead', 'screen-victory', 'screen-pause']) {
    document.getElementById(id).classList.add('hidden');
  }
  Audio.unlock();
  hideToast();
  const params = new URLSearchParams(location.search);
  const seed = params.get('seed') !== null ? Number(params.get('seed')) : ((Math.random() * 1e9) | 0);
  if (params.get('mute') !== null) Audio.setMuted(true);
  startGame(seed);
  Game.bot.on = false;
  Input.aimX = 0; Input.aimY = 0; Input.moveX = 0; Input.moveY = 0;
}

function togglePause() {
  if (Game.state === 'playing') {
    Game.state = 'paused';
    const el = document.getElementById('pause-stats');
    el.innerHTML = `<p>${describeStats(Game.player)}</p>`;
    const il = document.getElementById('pause-items');
    il.textContent = '道具：' + (Game.player.items.map((id) => ITEMS[id] ? ITEMS[id].name : id).join('、') || '无');
    document.getElementById('screen-pause').classList.remove('hidden');
  } else if (Game.state === 'paused') {
    resumeGame();
  }
}
function resumeGame() {
  Game.state = 'playing';
  document.getElementById('screen-pause').classList.add('hidden');
}

document.getElementById('btn-start').addEventListener('click', startNewGame);
document.getElementById('btn-restart').addEventListener('click', startNewGame);
document.getElementById('btn-victory').addEventListener('click', startNewGame);
document.getElementById('btn-resume').addEventListener('click', resumeGame);

// ================= 主循环 =================
let lastT = performance.now();
function loop(t) {
  const dt = Math.min(0.033, (t - lastT) / 1000);
  lastT = t;
  updateGame(dt);
  renderGame(ctx);
  requestAnimationFrame(loop);
}

// ================= 调试接口 window.__game =================
window.__game = {
  get state() { return Game.state; },
  get player() { return Game.player; },
  get enemies() {
    return Game.enemies.map((e) => ({ type: e.type, hp: e.hp, maxHp: e.maxHp, x: Math.round(e.x), y: Math.round(e.y), isBoss: e.isBoss }));
  },
  get tearCount() { return Game.tears.length; },
  get enemyTearCount() { return Game.enemyTears.length; },
  get pickups() { return Game.pickups.map((p) => ({ type: p.type, itemId: p.itemId, x: p.x, y: p.y })); },
  get room() {
    const r = Game.currentRoom;
    return r ? {
      x: r.x, y: r.y, type: r.type, cleared: r.cleared, boss: r.boss,
      doors: Object.keys(r.doors).filter((k) => r.doors[k]).map((k) => ({ dir: k, type: r.doors[k].type, closed: r.doors[k].closed, locked: r.doors[k].locked })),
      enemyPlan: r.enemies
    } : null;
  },
  get floor() { return Game.floor; },
  get stats() { return Game.stats; },
  get dungeon() {
    return Game.dungeon ? {
      w: Game.dungeon.w, h: Game.dungeon.h,
      rooms: Game.dungeon.rooms.map((r) => ({ x: r.x, y: r.y, type: r.type, cleared: r.cleared, explored: r.explored })),
    } : null;
  },
  start(seed) { startNewGame(); if (seed !== undefined) startGame(seed); },
  giveItem(id) { const it = applyItem(Game.player, id); if (it) showToast(`调试获得：${it.name}`); return !!it; },
  godMode() {
    const p = Game.player;
    p.maxHp = 99; p.hp = 99; p.damage = 30; p.fireDelay = 3; p.speed = 210;
  },
  killAll() {
    const list = Game.enemies.slice();
    for (const e of list) Entities.killEnemy(e);
  },
  setHp(v) { Game.player.hp = v; },
  botStart() { Game.bot.on = true; },
  botStop() { Game.bot.on = false; Input.moveX = 0; Input.moveY = 0; Input.aimX = 0; Input.aimY = 0; },
  toast(msg) { showToast(msg); },
};

// ================= 启动 =================
initTouch();
fitStage();
requestAnimationFrame(loop);
