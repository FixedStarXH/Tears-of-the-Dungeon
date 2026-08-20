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
  banner: null,
};

// ================= 生命周期 =================
function startGame(seed) {
  if (seed !== undefined) setSeed(seed);
  Game.seed = seed !== undefined ? seed : ((Math.random() * 1e9) | 0);
  resetItemPool();
  Game.floor = 1;
  Game.stats = { kills: 0, itemsTaken: 0, coins: 0, keys: 0, startTime: performance.now() };
  Game.bossesSeen = []; // 整局 Boss 记忆（池两选一）
  Game.time = 0;
  Game.state = 'playing';
  Game.familiar = null;
  Game.fade = 0;
  Game.player = Entities.createPlayer(0, 0);
  buildFloor(1);
  enterRoom(Game.dungeon.start);
}

// 每层 Boss 池（两选一）
const BOSS_POOLS = { 1: ['monstro', 'duke'], 2: ['larry', 'chub'], 3: ['gurdy', 'monstro2'] };
function buildFloor(floor) {
  Game.dungeon = Dungeon.generate(floor);
  Game.floor = floor;
  // 记录全局房间引用（相邻门切换用）
  const byKey = {};
  for (const r of Game.dungeon.rooms) byKey[r.x + ',' + r.y] = r;
  Game.dungeon.byKey = byKey;
  // 楼层横幅（进层大标题）
  const FLOOR_NAMES = ['', '地窖 · BASEMENT', '洞穴 · CAVES', '深渊 · DEPTHS'];
  Game.banner = { text: FLOOR_NAMES[floor] || '第 ' + floor + ' 层', t: 0, dur: 2.6 };
  // Boss 池两选一：优先整局未见过的 Boss（保证层内不重复遇到）
  const pool = BOSS_POOLS[clamp(floor, 1, 3)];
  const seen = Game.bossesSeen || (Game.bossesSeen = []);
  const fresh = pool.filter((b) => !seen.includes(b));
  const boss = fresh.length ? fresh[(Math.random() * fresh.length) | 0] : pool[(Math.random() * pool.length) | 0];
  if (!seen.includes(boss)) seen.push(boss);
  for (const r of Game.dungeon.rooms) {
    r.dungeon = Game.dungeon;
    r.floor = floor;
    if (r.type === 'boss') r.boss = boss;
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
    let visCount = 0; // vis 巨眼怪每房最多 1 只（激光房太强）
    for (const et of room.enemies) {
      if (et === 'vis' && visCount >= 1) continue;
      if (et === 'vis') visCount++;
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
  // 商店货架实例化（道具预分配 itemId，价格与货物标在摊位上）
  if (room.shopStalls) {
    for (const st of room.shopStalls) {
      const { x, y } = cellCenter(st.gx, st.gy);
      st.x = x; st.y = y;
      if (st.offer === 'item' && !st.itemId) st.itemId = takeItem();
    }
  }
  Game.fade = 0.15; // 转场由推移动画主导，渐黑仅做柔和入场
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
    // 房间切换推移动画（用真实 dt 推进，不受 hit-stop 冻结）
    if (Game._trans) {
      Game._trans.k += dt / Game._trans.dur;
      if (Game._trans.k >= 1) { Game._trans = null; Game._transSnap = null; }
    }
    if (!isStopped()) {
      Entities.updatePlayer(Game.player, dt);
      Entities.updateTears(dt);
      Entities.updateEnemies(dt);
      Entities.updateBosses(dt);
      Entities.updateBeams(dt);
      updatePickups(dt);
      updateChests(dt);
      updateShop(dt);
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
    if (Game.banner) {
      Game.banner.t += dt;
      if (Game.banner.t >= Game.banner.dur) Game.banner = null;
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
  // 磁铁：金币/钥匙/炸弹/红心被磁吸向玩家（道具基座与活板门不受影响）
  if (p.magneto) {
    for (const pk of Game.pickups) {
      if (!pk || pk.type === 'item' || pk.type === 'trapdoor') continue;
      const d = dist(pk.x, pk.y, p.x, p.y);
      if (d < 150 && d > 1) {
        const a = angleTo(pk.x, pk.y, p.x, p.y);
        const pull = Math.min(340 * dt, d);
        pk.x += Math.cos(a) * pull;
        pk.y += Math.sin(a) * pull;
      }
    }
  }
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
    if (c.gold) {
      // 金箱：必出道具 + 两枚金币
      spawnPickup(c.x, c.y - 4, 'item');
      spawnPickup(c.x - 14, c.y + 10, 'coin');
      spawnPickup(c.x + 14, c.y + 10, 'coin');
      return;
    }
    const r = RNG();
    if (r < 0.42) spawnPickup(c.x, c.y, 'item');
    else if (r < 0.70) spawnPickup(c.x, c.y, chance(0.5) ? 'heart' : 'coin');
    else { spawnPickup(c.x - 10, c.y, 'coin'); spawnPickup(c.x + 10, c.y, 'key'); }
  }
}

// 商店：碰到货架即购买（金币够则成交，否则提示）
function updateShop(dt) {
  const rm = Game.currentRoom;
  if (!rm || !rm.shopStalls) return;
  const p = Game.player;
  for (const st of rm.shopStalls) {
    if (st.sold) continue;
    if (dist(p.x, p.y, st.x, st.y - 6) < 30) {
      const coins = Game.stats.coins || 0;
      if (coins >= st.price) {
        Game.stats.coins -= st.price;
        st.sold = true;
        burst(st.x, st.y - 8, { count: 18, speed: 150, color: '#e7c351', size: 3, life: 0.5 });
        if (st.offer === 'heart') {
          p.maxHp += 2; p.hp = p.maxHp;
          Audio.heart();
          showToast(`买下了一颗心（-${st.price} 金币）`);
        } else {
          const it = applyItem(p, st.itemId);
          Game.stats.itemsTaken++;
          Audio.item();
          if (it) showToast(`购买道具：${it.name}（${it.desc}）`);
        }
      } else if (!st.nagT || Game.time - st.nagT > 2) {
        st.nagT = Game.time;
        showToast(`金币不够（需要 ${st.price}，你有 ${coins}）`);
      }
    }
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
    startRoomTransition(dir); // 快照当前画面，播放推移动画
    enterRoom(target);
    return;
  }
}

// 房间切换：快照当前帧，新房间从行进方向对侧滑入
const DIR_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
function startRoomTransition(dir) {
  const cv = Game._canvas;
  if (!cv) return;
  const snap = document.createElement('canvas');
  snap.width = W; snap.height = H;
  snap.getContext('2d').drawImage(cv, 0, 0);
  Game._transSnap = snap;
  Game._trans = { dir, k: 0, dur: 0.3 };
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
  // 房间切换：旧画面沿行进方向滑出，新房间从对侧滑入（cubic ease-out）
  const tr = Game._trans;
  if (tr && Game._transSnap) {
    const k = 1 - Math.pow(1 - clamp(tr.k, 0, 1), 3);
    const dv = DIR_VEC[tr.dir];
    ctx.save();
    ctx.translate(-dv[0] * W * k, -dv[1] * H * k);
    ctx.drawImage(Game._transSnap, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(dv[0] * W * (1 - k), dv[1] * H * (1 - k));
    ctx.translate(so.x, so.y);
    drawWorld(ctx, rm);
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(so.x, so.y);
    drawWorld(ctx, rm);
    ctx.restore();
  }
  // 受击红晕
  if (Game.player && Game.player.hurtFlash > 0) {
    ctx.fillStyle = `rgba(200,30,20,${Game.player.hurtFlash * 0.8})`;
    ctx.fillRect(0, 0, W, H);
  }
  // 楼层横幅
  drawFloorBanner(ctx);
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
  // 后处理：暗角 + 胶片颗粒（预生成噪点，随机偏移平铺）
  drawVignette(ctx);
  drawGrain(ctx);
}

// 楼层横幅：进层大标题（淡入 → 保持 → 淡出）
function drawFloorBanner(ctx) {
  const b = Game.banner;
  if (!b) return;
  const k = clamp(b.t / b.dur, 0, 1);
  const alpha = Math.min(1, b.t / 0.3, (b.dur - b.t) / 0.5);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, H * 0.32, W, 64);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 30px serif';
  ctx.strokeStyle = '#1a0a06';
  ctx.lineWidth = 5;
  ctx.strokeText(b.text, W / 2, H * 0.32 + 32);
  ctx.fillStyle = '#e8d8b8';
  ctx.fillText(b.text, W / 2, H * 0.32 + 32);
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#c8a878';
  ctx.fillText('Tears of the Dungeon', W / 2, H * 0.32 + 54);
  ctx.restore();
}

let _vignette = null;
function drawVignette(ctx) {
  if (!_vignette) {
    _vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
    _vignette.addColorStop(0, 'rgba(0,0,0,0)');
    _vignette.addColorStop(1, 'rgba(0,0,0,0.42)');
  }
  ctx.fillStyle = _vignette;
  ctx.fillRect(0, 0, W, H);
}

let _grainCv = null;
function drawGrain(ctx) {
  if (!_grainCv) {
    _grainCv = document.createElement('canvas');
    _grainCv.width = 180; _grainCv.height = 180;
    const g = _grainCv.getContext('2d');
    const img = g.createImageData(180, 180);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.globalCompositeOperation = 'overlay';
  const ox = (Math.random() * 60) | 0, oy = (Math.random() * 60) | 0;
  for (let x = -ox; x < W; x += 180) {
    for (let y = -oy; y < H; y += 180) ctx.drawImage(_grainCv, x, y);
  }
  ctx.restore();
}

// 世界层（受屏幕震动影响），不含 HUD 与遮罩
function drawWorld(ctx, rm) {
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
  // 商店货架
  if (rm.shopStalls) for (const st of rm.shopStalls) Art.drawShopStall(ctx, st);
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
  // 敌方激光（血激光 / 扫射）
  if (Game.beams) {
    for (const b of Game.beams) {
      const x2 = b.x + Math.cos(b.angle) * b.len;
      const y2 = b.y + Math.sin(b.angle) * b.len;
      const fade = 1 - clamp(b.t / b.dur, 0, 1);
      ctx.globalAlpha = fade;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(120,8,8,0.55)';
      ctx.lineWidth = 26;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = `rgba(230,40,30,${0.95 * fade})`;
      ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,220,200,0.9)';
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }
  }
  // 玩家
  Art.drawPlayer(ctx, Game.player);
  // 眼泪
  for (const t of Game.tears) Art.drawTear(ctx, t);
  for (const t of Game.enemyTears) Art.drawTear(ctx, t);
  drawParticles(ctx);
  ctx.restore();
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
  // 具现化保护期：从地面升起 + 淡入 + 缩放 + 金色光环
  if (e.spawnT > 0) {
    const max = e.spawnMax || (e.isBoss ? 0.9 : 0.55);
    const k = clamp(1 - e.spawnT / max, 0, 1);
    ctx.save();
    ctx.globalAlpha = clamp(k * 1.6, 0, 1);
    ctx.translate(e.x, e.y + (1 - k) * 14);
    const sc = 0.6 + k * 0.4;
    ctx.scale(sc, sc);
    ctx.translate(-e.x, -e.y);
    drawEnemyCore(ctx, e);
    ctx.restore();
    ctx.strokeStyle = `rgba(255,220,180,${(1 - k) * 0.5})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 + (1 - k) * 0.9), 0, TAU); ctx.stroke();
    return;
  }
  drawEnemyCore(ctx, e);
}

function drawEnemyCore(ctx, e) {
  switch (e.type) {
    case 'gaper': Art.drawGaper(ctx, e); break;
    case 'pooter': Art.drawPooter(ctx, e); break;
    case 'horf': Art.drawHorf(ctx, e); break;
    case 'attackfly': Art.drawAttackFly(ctx, e); break;
    case 'boomfly': Art.drawBoomFly(ctx, e); break;
    case 'knight': Art.drawKnight(ctx, e); break;
    case 'clotty': Art.drawClotty(ctx, e); break;
    case 'hopper': Art.drawHopper(ctx, e); break;
    case 'maw': Art.drawMaw(ctx, e); break;
    case 'globin': Art.drawGlobin(ctx, e); break;
    case 'monstro': Art.drawMonstro(ctx, e); break;
    case 'duke': Art.drawDuke(ctx, e); break;
    case 'mom': Art.drawMomFoot(ctx, e); break;
    case 'larry': Art.drawLarry(ctx, e); break;
    case 'gurdy': Art.drawGurdy(ctx, e); break;
    case 'momeye': Art.drawMomEye(ctx, e); break;
    case 'vis': Art.drawVis(ctx, e); break;
    case 'chub': Art.drawChub(ctx, e); break;
    case 'monstro2': Art.drawMonstro2(ctx, e); break;
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
  ctx.fillText({ monstro: 'MONSTRO', duke: 'DUKE OF FLIES', larry: 'LARRY JR', chub: 'CHUB', gurdy: 'GURDY', monstro2: 'MONSTRO II', mom: 'MOM' }[boss.type] || 'BOSS', W / 2, y - 10);
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
