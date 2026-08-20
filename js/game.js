/* game.js —— 游戏状态机 / 房间生命周期 / 碰撞 / 掉落 / 渲染 */
'use strict';

const Game = {
  state: 'menu',        // menu | playing | paused | dead | victory
  floor: 1,
  dungeon: null,
  currentRoom: null,
  player: null,
  enemies: [],
  tears: [],
  enemyTears: [],
  pickups: [],
  familiar: null,
  stats: { kills: 0, itemsTaken: 0, coins: 0, keys: 0, startTime: 0 },
  time: 0,
  fade: 0,
  victoryTimer: 0,
  toastTimer: 0,
  bot: { on: false },
};

// ================= 生命周期 =================
function startGame(seed) {
  if (seed !== undefined) setSeed(seed);
  resetItemPool();
  Game.floor = 1;
  Game.stats = { kills: 0, itemsTaken: 0, coins: 0, keys: 0, startTime: performance.now() };
  Game.time = 0;
  Game.state = 'playing';
  Game.familiar = null;
  Game.fade = 0;
  Game.player = Entities.createPlayer(0, 0);
  buildFloor(1);
  enterRoom(Game.dungeon.start);
}

function buildFloor(floor) {
  Game.dungeon = Dungeon.generate(floor);
  Game.floor = floor;
  // 记录全局房间引用（相邻门切换用）
  const byKey = {};
  for (const r of Game.dungeon.rooms) byKey[r.x + ',' + r.y] = r;
  Game.dungeon.byKey = byKey;
  for (const r of Game.dungeon.rooms) {
    r.dungeon = Game.dungeon;
    r.floor = floor;
  }
}

// 房间障碍物实例化
function setupRoomProps(room) {
  room.rocks = [];
  room.pits = [];
  room.spikes = [];
  for (let gy = 0; gy < room.propGrid.length; gy++) {
    for (let gx = 0; gx < room.propGrid[gy].length; gx++) {
      const c = room.propGrid[gy][gx];
      if (!c) continue;
      const { x, y } = cellCenter(gx + 1, gy + 1);
      if (c === 'X') room.rocks.push({ x, y, r: 18, dead: false });
      else if (c === 'O') room.pits.push({ x: x - CELL / 2 + 4, y: y - CELL / 2 + 4, w: CELL - 8, h: CELL - 8 });
      else if (c === '^') room.spikes.push({ x: x - 12, y: y - 12, w: 24, h: 24 });
    }
  }
}

function enterRoom(room) {
  Game.currentRoom = room;
  room.entered = true;
  room.explored = true;
  room.rocks = []; room.pits = []; room.spikes = [];
  setupRoomProps(room);
  Game.tears = [];
  Game.enemyTears = [];
  Game.pickups = [];
  Game.enemies = [];
  Game.familiar = null;
  // Boss 房掉落过活板门：每次进入都补刷（防止离开房间时被 pickups 清空弄丢）
  if (room.trapdoor) {
    Game.spawnPickup(7 * CELL + CELL / 2, 4 * CELL + CELL / 2, 'trapdoor');
  }
  // 玩家置于进门位置
  const p = Game.player;
  p.x = 7 * CELL + CELL / 2;
  p.y = 4 * CELL + CELL / 2;
  if (room.lastEnter === 'up') p.y = WALK_MIN_Y * CELL + 50;
  else if (room.lastEnter === 'down') p.y = WALK_MAX_Y * CELL + CELL - 50;
  else if (room.lastEnter === 'left') p.x = WALK_MIN_X * CELL + 50;
  else if (room.lastEnter === 'right') p.x = WALK_MAX_X * CELL + CELL - 50;
  p.dead = false; p.inv = 0.5;
  // 圣斗篷每房充能
  if (p.shield) p.shieldUp = true;
  // 烘焙静态层
  Art.bakeRoomStatic(room);
  // 生成敌人（已清空的房间不会重新生成）
  if (!room.cleared) {
    for (const et of room.enemies) {
      const c = Dungeon.randomFreeCell(room, null, true);
      const { x, y } = cellCenter(c.gx, c.gy);
      const e = Entities.createEnemy(et, x, y, Game.floor);
      Game.enemies.push(e);
    }
    // Boss
    if (room.boss) {
      const c = Dungeon.randomFreeCell(room, null, true);
      const { x, y } = cellCenter(c.gx, c.gy);
      const b = Entities.createBoss(room.boss, x, y);
      if (room.boss === 'mom') b.groundY = 40;
      Game.enemies.push(b);
      Audio.bossRoar();
    }
  }
  // 宝箱房：中央道具基座（只给一次）
  if (room.type === 'treasure' && !room.itemTaken) {
    Game.spawnPickup(7 * CELL + CELL / 2, 4 * CELL + CELL / 2, 'item');
  }
  // 木箱
  if (room.chest && !room.chestOpened) {
    const c = Dungeon.randomFreeCell(room, null, true);
    const { x, y } = cellCenter(c.gx, c.gy);
    room.chestObj = { x, y, gold: chance(0.25) };
  }
  Game.fade = 0.22;
}

function spawnEnemy(type, x, y) {
  const e = Entities.createEnemy(type, x, y, Game.floor);
  Game.enemies.push(e);
  return e;
}

function spawnPickup(x, y, type) {
  Game.pickups.push({ type, x, y, seed: Math.random() * 10, itemId: type === 'item' ? takeItem() : null });
}

// 供 entities.js 内部引用
Game.spawnPickup = spawnPickup;
Game.spawnEnemy = spawnEnemy;

// ================= 更新 =================
function updateGame(dt) {
  if (Game.state === 'playing') {
    Game.time += dt;
    if (!isStopped()) {
      Entities.updatePlayer(Game.player, dt);
      Entities.updateTears(dt);
      Entities.updateEnemies(dt);
      Entities.updateBosses(dt);
      updatePickups(dt);
      updateChests(dt);
      updateRoomLogic(dt);
      updateBot(dt);
    }
    updateParticles(dt);
    updateShake(dt);
    updateHitStop(dt);
    Game.fade = Math.max(0, Game.fade - dt);
    if (Game.toastTimer > 0) {
      Game.toastTimer -= dt;
      if (Game.toastTimer <= 0) hideToast();
    }
    if (Game.victoryTimer > 0) {
      Game.victoryTimer -= dt;
      if (Game.victoryTimer <= 0) showVictory();
    }
    checkDoors(dt);
  } else if (Game.state === 'dead' || Game.state === 'victory') {
    updateParticles(dt);
  }
}

function updatePickups(dt) {
  const p = Game.player;
  for (let i = Game.pickups.length - 1; i >= 0; i--) {
    const pk = Game.pickups[i];
    if (!pk) continue; // 收集过程中可能重置了 pickups（如踩活板门进入下一层）
    if (dist(pk.x, pk.y, p.x, p.y) < 28) {
      Game.pickups.splice(i, 1);
      collectPickup(pk);
    }
  }
}

function collectPickup(pk) {
  const p = Game.player;
  if (pk.type === 'heart') {
    p.hp = Math.min(p.maxHp, p.hp + 2);
    Audio.heart();
    burst(pk.x, pk.y, { count: 8, speed: 60, color: '#e04040', size: 2.5, life: 0.4 });
  } else if (pk.type === 'halfheart') {
    p.hp = Math.min(p.maxHp, p.hp + 1);
    Audio.heart();
  } else if (pk.type === 'coin') {
    Game.stats.coins++;
    Audio.coin();
  } else if (pk.type === 'key') {
    Game.stats.keys++;
    Audio.key();
  } else if (pk.type === 'item') {
    const it = applyItem(p, pk.itemId);
    Game.stats.itemsTaken++;
    Audio.item();
    if (Game.currentRoom && Game.currentRoom.type === 'treasure') Game.currentRoom.itemTaken = true;
    if (it) showToast(`获得道具：${it.name}（${it.desc}）`);
  } else if (pk.type === 'trapdoor') {
    Audio.doorOpen();
    if (Game.currentRoom) Game.currentRoom.trapdoor = false;
    nextFloor();
  }
}

function updateChests(dt) {
  const rm = Game.currentRoom;
  if (!rm || !rm.chestObj) return;
  const c = rm.chestObj;
  if (dist(c.x, c.y, Game.player.x, Game.player.y) < 30) {
    rm.chestObj = null;
    rm.chestOpened = true;
    Audio.item();
    burst(c.x, c.y, { count: 10, speed: 90, color: '#e8b93a', size: 2.5, life: 0.4 });
    const r = RNG();
    if (r < 0.42) spawnPickup(c.x, c.y, 'item');
    else if (r < 0.70) spawnPickup(c.x, c.y, chance(0.5) ? 'heart' : 'coin');
    else { spawnPickup(c.x - 10, c.y, 'coin'); spawnPickup(c.x + 10, c.y, 'key'); }
  }
}

// 房间清空判定
function updateRoomLogic(dt) {
  const rm = Game.currentRoom;
  if (!rm || rm.cleared) return;
  const hasBoss = rm.boss && Game.enemies.some((e) => e.isBoss && !e.dead);
  if (!hasBoss && Game.enemies.length === 0) {
    rm.cleared = true;
    openDoors(rm);
    Audio.doorOpen();
    showToast('房间已清空！');
    if (Game.player.shield) Game.player.shieldUp = true;
  }
}

function openDoors(rm) {
  for (const k in rm.doors) {
    const d = rm.doors[k];
    if (d) d.closed = false;
  }
}

function onBossKilled(e) {
  const rm = Game.currentRoom;
  if (rm) {
    rm.cleared = true;
    openDoors(rm);
    if (Game.player.shield) Game.player.shieldUp = true;
    if (Game.floor >= 3) {
      Game.victoryTimer = 1.8;
    } else {
      // 掉落活板门通往下一层（标记房间，离开后再进入也会补刷）
      rm.trapdoor = true;
      Game.spawnPickup(7 * CELL + CELL / 2, 4 * CELL + CELL / 2, 'trapdoor');
      showToast('Boss 已击败！踩上活板门前往下一层');
    }
  }
}

function nextFloor() {
  Game.stats.coins = Math.min(Game.stats.coins, 99);
  buildFloor(Game.floor + 1);
  enterRoom(Game.dungeon.start);
  showToast(`进入第 ${Game.floor} 层`);
}

// ================= 门切换 =================
// 门触发区：门在墙中心，玩家只能到可行走区边缘（r=12），故在边缘处判定
const DOOR_ZONES = {
  up: { x: 450, y: WALK_MIN_Y * CELL + 16, w: 64, h: 24 },
  down: { x: 450, y: WALK_MAX_Y * CELL + CELL - 16, w: 64, h: 24 },
  left: { x: WALK_MIN_X * CELL + 16, y: 270, w: 24, h: 64 },
  right: { x: WALK_MAX_X * CELL + CELL - 16, y: 270, w: 24, h: 64 },
};
function inDoorZone(p, z) {
  return p.x > z.x - z.w / 2 && p.x < z.x + z.w / 2 && p.y > z.y - z.h / 2 && p.y < z.y + z.h / 2;
}
// 将玩家从门中推回室内
function pushBackFromDoor(p, dir) {
  const z = DOOR_ZONES[dir];
  if (!z) return;
  if (dir === 'up') p.y = z.y + z.h / 2 + 6;
  else if (dir === 'down') p.y = z.y - z.h / 2 - 6;
  else if (dir === 'left') p.x = z.x + z.w / 2 + 6;
  else if (dir === 'right') p.x = z.x - z.w / 2 - 6;
}

function checkDoors(dt) {
  const rm = Game.currentRoom;
  if (!rm) return;
  const p = Game.player;
  const opp = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  for (const dir of ['up', 'down', 'left', 'right']) {
    const d = rm.doors[dir];
    if (!d) continue;
    const z = DOOR_ZONES[dir];
    if (!inDoorZone(p, z)) continue;
    if (d.locked) { // 宝箱房需要钥匙
      if (Game.stats.keys > 0) {
        Game.stats.keys--;
        d.locked = false;
        Audio.key();
        showToast('使用钥匙打开宝箱房');
      } else {
        pushBackFromDoor(p, dir);
        showToast('需要钥匙才能打开！');
      }
      return;
    }
    if (d.closed) { // 未清房
      pushBackFromDoor(p, dir);
      return;
    }
    // 进入相邻房间
    const nb = rm.dungeon.byKey;
    const [dx, dy] = delta[dir];
    const target = nb[(rm.x + dx) + ',' + (rm.y + dy)];
    if (!target) return;
    target.lastEnter = opp[dir];
    enterRoom(target);
    return;
  }
}

// ================= 游戏结束 / 胜利 =================
function gameOver() {
  Game.state = 'dead';
  const secs = Math.floor((performance.now() - Game.stats.startTime) / 1000);
  document.getElementById('dead-kills').textContent = Game.stats.kills;
  document.getElementById('dead-items').textContent = Game.stats.itemsTaken;
  document.getElementById('dead-time').textContent = fmtTime(secs);
  document.getElementById('dead-floor').textContent = Game.floor;
  document.getElementById('screen-dead').classList.remove('hidden');
}

function showVictory() {
  Game.state = 'victory';
  const secs = Math.floor((performance.now() - Game.stats.startTime) / 1000);
  document.getElementById('vic-kills').textContent = Game.stats.kills;
  document.getElementById('vic-items').textContent = Game.stats.itemsTaken;
  document.getElementById('vic-time').textContent = fmtTime(secs);
  document.getElementById('screen-victory').classList.remove('hidden');
}

function fmtTime(s) {
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// ================= 渲染 =================
function renderGame(ctx) {
  const rm = Game.currentRoom;
  if (!rm) return;
  const so = shakeOffset();
  ctx.save();
  ctx.translate(so.x, so.y);
  if (rm.static) ctx.drawImage(rm.static, 0, 0);
  Art.drawStains(ctx, rm);
  // 门
  for (const dir of ['up', 'down', 'left', 'right']) {
    if (rm.doors[dir]) Art.drawDoor(ctx, rm, dir);
  }
  // Mom 踩击预警阴影
  for (const e of Game.enemies) {
    if (e.type === 'mom' && e.warning) {
      const pulse = 0.4 + Math.sin(Game.time * 16) * 0.25;
      ctx.fillStyle = `rgba(0,0,0,${pulse})`;
      ctx.beginPath(); ctx.ellipse(e.warningX, 170, 60, 16, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,60,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  // 岩石（未碎）
  for (const rk of rm.rocks) {
    if (!rk.dead) drawRock2(ctx, rk, rm.floor);
  }
  // 宝箱
  if (rm.chestObj) Art.drawChest(ctx, rm.chestObj.x, rm.chestObj.y, rm.chestObj.gold);
  // 拾取物
  for (const pk of Game.pickups) Art.drawPickup(ctx, pk);
  // 跟班
  if (Game.familiar) {
    const f = Game.familiar;
    const bob = Math.sin(Game.time * 6) * 2;
    ctx.fillStyle = 'rgba(216,204,184,0.9)';
    ctx.strokeStyle = '#4a3a28';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.x, f.y + bob, 9, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(f.x - 3.5, f.y + bob - 1, 1.8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(f.x + 3.5, f.y + bob - 1, 1.8, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#4a3a28';
    ctx.beginPath(); ctx.moveTo(f.x - 3, f.y + bob + 3); ctx.quadraticCurveTo(f.x, f.y + bob + 7, f.x + 3, f.y + bob + 3); ctx.stroke();
  }
  // 敌人
  for (const e of Game.enemies) {
    drawEnemy(ctx, e);
  }
  // Boss 血条
  drawBossBar(ctx);
  // 玩家
  Art.drawPlayer(ctx, Game.player);
  // 眼泪
  for (const t of Game.tears) Art.drawTear(ctx, t);
  for (const t of Game.enemyTears) Art.drawTear(ctx, t);
  drawParticles(ctx);
  ctx.restore();
  // 受击红晕
  if (Game.player && Game.player.hurtFlash > 0) {
    ctx.fillStyle = `rgba(200,30,20,${Game.player.hurtFlash * 0.8})`;
    ctx.fillRect(0, 0, W, H);
  }
  // HUD
  if (Game.state === 'playing' || Game.state === 'paused') {
    Art.drawHUD(ctx, Game.player, Game.stats);
    if (Game.dungeon) Art.drawMinimap(ctx, Game.dungeon, rm, Game.floor);
  }
  // 房间切换渐黑
  if (Game.fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, Game.fade / 0.22)})`;
    ctx.fillRect(0, 0, W, H);
  }
  // 暂停/死亡暗角
  if (Game.state === 'dead' || Game.state === 'victory') {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, W, H);
  }
}

function drawRock2(ctx, rk, floor) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(rk.x + 3, rk.y + 4, rk.r * 1.1, rk.r * 0.9, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(rk.x - rk.r * 0.35, rk.y - rk.r * 0.4, rk.r * 0.1, rk.x, rk.y, rk.r);
  const c1 = floor === 3 ? '#6a5c84' : '#8a7a5e';
  const c2 = floor === 3 ? '#3c334f' : '#52432e';
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(rk.x, rk.y, rk.r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,6,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawEnemy(ctx, e) {
  switch (e.type) {
    case 'gaper': Art.drawGaper(ctx, e); break;
    case 'pooter': Art.drawPooter(ctx, e); break;
    case 'horf': Art.drawHorf(ctx, e); break;
    case 'attackfly': Art.drawAttackFly(ctx, e); break;
    case 'boomfly': Art.drawBoomFly(ctx, e); break;
    case 'knight': Art.drawKnight(ctx, e); break;
    case 'monstro': Art.drawMonstro(ctx, e); break;
    case 'duke': Art.drawDuke(ctx, e); break;
    case 'mom': Art.drawMomFoot(ctx, e); break;
    case 'momeye': Art.drawMomEye(ctx, e); break;
  }
}

function drawBossBar(ctx) {
  const boss = Game.enemies.find((e) => e.isBoss && !e.dead);
  if (!boss) return;
  const w = 320, h = 14;
  const x = (W - w) / 2, y = 44;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  rr2(ctx, x - 2, y - 2, w + 4, h + 4, 6);
  ctx.fill();
  ctx.fillStyle = '#4a1010';
  rr2(ctx, x, y, w, h, 5);
  ctx.fill();
  const pct = Math.max(0, boss.hp / boss.maxHp);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#e04030'); g.addColorStop(1, '#c02020');
  ctx.fillStyle = g;
  rr2(ctx, x, y, w * pct, h, 5);
  ctx.fill();
  ctx.strokeStyle = '#1a0806';
  ctx.lineWidth = 1.5;
  rr2(ctx, x, y, w, h, 5);
  ctx.stroke();
  ctx.fillStyle = '#ffd9c2';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText({ monstro: 'MONSTRO', duke: 'DUKE OF FLIES', mom: 'MOM' }[boss.type] || 'BOSS', W / 2, y - 10);
}

function rr2(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ================= Toast =================
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('show');
  t.classList.remove('hidden');
  void t.offsetWidth;
  t.classList.add('show');
  Game.toastTimer = 2;
}
function hideToast() {
  document.getElementById('toast').classList.add('hidden');
}

// ================= 调试 BOT（自动化测试用） =================
function updateBot(dt) {
  const bot = Game.bot;
  if (!bot.on || Game.state !== 'playing') return;
  const p = Game.player;
  // 找最近敌人
  let best = null, bd = 1e9;
  for (const e of Game.enemies) {
    if (e.dead) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  if (best) {
    const a = angleTo(p.x, p.y, best.x, best.y);
    // 环绕走位射击
    Input.aimX = Math.cos(a);
    Input.aimY = Math.sin(a);
    const strafe = Math.cos(Game.time * 1.6);
    let mx = -Math.sin(a) * strafe * 0.9 + Math.cos(a) * (bd > 240 ? 1 : -0.3);
    let my = Math.cos(a) * strafe * 0.9 + Math.sin(a) * (bd > 240 ? 1 : -0.3);
    // 近身时远离
    if (bd < 80) { mx = -Math.cos(a); my = -Math.sin(a); }
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    Input.moveX = mx; Input.moveY = my;
  } else {
    Input.moveX = 0; Input.moveY = 0; Input.aimX = 0; Input.aimY = 0;
    // 优先踩活板门（前往下一层）
    const trap = Game.pickups.find((pk) => pk.type === 'trapdoor');
    if (trap) {
      const a = angleTo(p.x, p.y, trap.x, trap.y);
      Input.moveX = Math.cos(a); Input.moveY = Math.sin(a);
      return;
    }
    // 走向最近的未探索门（优先通往未清空的房间）
    const rm = Game.currentRoom;
    const deltaDir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    let bestDoor = null, bestD = 1e9, fallbackDoor = null, fallbackD = 1e9;
    for (const dir of ['up', 'down', 'left', 'right']) {
      const d = rm.doors[dir];
      if (!d || d.locked || d.closed) continue;
      const c = Art.drawDoorCenter(rm, dir);
      const dd = dist(p.x, p.y, c.x, c.y);
      const [dx, dy] = deltaDir[dir];
      const nb = rm.dungeon.byKey[(rm.x + dx) + ',' + (rm.y + dy)];
      if (nb && !nb.cleared) {
        if (dd < bestD) { bestD = dd; bestDoor = c; }
      } else if (dd < fallbackD) { fallbackD = dd; fallbackDoor = c; }
    }
    const target = bestDoor || fallbackDoor;
    if (target) {
      const a = angleTo(p.x, p.y, target.x, target.y);
      Input.moveX = Math.cos(a); Input.moveY = Math.sin(a);
    }
    // 有道具基座就捡（走上去自动拾取）
  }
}
