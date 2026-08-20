/* entities.js —— 玩家 / 眼泪 / 敌人 AI / Boss 状态机 / 跟班 */
'use strict';

const Entities = (function () {

  // ================= 玩家 =================
  function createPlayer(x, y) {
    return {
      x, y, vx: 0, vy: 0, r: 12, size: 1, redSkin: false, flight: false,
      hp: 6, maxHp: 6, // 半心制（3 颗心）
      damage: 1, fireDelay: 18, fireTimer: 0,
      speed: 150, tearSpeed: 420, tearRange: 360,
      items: [],
      laser: false, triple: false, homing: false, pierce: false,
      bigTear: false, explosive: false, familiar: false,
      shield: false, shieldUp: false, wafer: false,
      inv: 0, hurtFlash: 0, knockX: 0, knockY: 0,
      faceX: 1, faceY: 0, aimX: 1, aimY: 0, dead: false,
    };
  }

  function updatePlayer(p, dt) {
    if (p.dead) return;
    // 同步输入到玩家（键盘 / 摇杆 / BOT 都经 Input）
    p.aimX = Input.aimX;
    p.aimY = Input.aimY;
    // 移动输入（键盘 WASD / 摇杆 / BOT）
    let mx = Input.moveX, my = Input.moveY;
    if (p.knockX !== 0 || p.knockY !== 0) {
      const k = Math.exp(-6 * dt);
      p.knockX *= k; p.knockY *= k;
    }
    p.vx = mx * p.speed + p.knockX;
    p.vy = my * p.speed + p.knockY;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    collideWorld(p);
    // 朝向：优先瞄准方向，否则移动方向
    if (Math.abs(p.aimX) > 0.01 || Math.abs(p.aimY) > 0.01) {
      p.faceX = Math.cos(Math.atan2(p.aimY, p.aimX));
      p.faceY = Math.sin(Math.atan2(p.aimY, p.aimX));
    } else if (Math.abs(mx) > 0.01 || Math.abs(my) > 0.01) {
      p.faceX = mx; p.faceY = my;
    }
    // 射击
    p.fireTimer -= dt;
    if ((Math.abs(p.aimX) > 0.01 || Math.abs(p.aimY) > 0.01) && p.fireTimer <= 0) {
      fire(p);
      p.fireTimer = p.fireDelay / 60;
    }
    // 尖刺伤害
    const rm0 = Game.currentRoom;
    if (rm0 && rm0.spikes && p.inv <= 0) {
      for (const sp of rm0.spikes) {
        if (circleRectHit(p.x, p.y, p.r - 2, sp.x, sp.y, sp.w, sp.h)) {
          damagePlayer(1, 0, 0);
          break;
        }
      }
    }
    p.inv = Math.max(0, p.inv - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);
    // 跟班
    if (p.familiar) updateFamiliar(dt);
  }

  // 与世界碰撞（墙 / 岩石 / 坑）
  function collideWorld(ent) {
    // 墙壁
    ent.x = clamp(ent.x, WALK_MIN_X * CELL + ent.r, WALK_MAX_X * CELL + CELL - ent.r);
    ent.y = clamp(ent.y, WALK_MIN_Y * CELL + ent.r, WALK_MAX_Y * CELL + CELL - ent.r);
    const rm = Game.currentRoom;
    if (!rm) return;
    const fly = ent.fly || ent.flight;
    // 岩石（圆，忽略已碎）
    for (const rock of rm.rocks) {
      if (rock.dead) continue;
      if (circleHit(ent.x, ent.y, ent.r, rock.x, rock.y, rock.r)) {
        const a = angleTo(rock.x, rock.y, ent.x, ent.y);
        ent.x = rock.x + Math.cos(a) * (rock.r + ent.r);
        ent.y = rock.y + Math.sin(a) * (rock.r + ent.r);
      }
    }
    // 坑（矩形，非飞行不可通过）
    if (!fly) {
      for (const pit of rm.pits) {
        if (circleRectHit(ent.x, ent.y, ent.r, pit.x, pit.y, pit.w, pit.h)) {
          const cx = clamp(ent.x, pit.x, pit.x + pit.w);
          const cy = clamp(ent.y, pit.y, pit.y + pit.h);
          const a = angleTo(cx, cy, ent.x, ent.y);
          ent.x = clamp(cx + Math.cos(a) * ent.r, WALK_MIN_X * CELL + ent.r, WALK_MAX_X * CELL + CELL - ent.r);
          ent.y = clamp(cy + Math.sin(a) * ent.r, WALK_MIN_Y * CELL + ent.r, WALK_MAX_Y * CELL + CELL - ent.r);
        }
      }
    }
  }

  // 发射眼泪
  function fire(p) {
    const a = Math.atan2(p.aimY, p.aimX);
    const dmg = p.damage;
    const angles = p.triple ? [a - 0.16, a, a + 0.16] : [a];
    for (const ang of angles) {
      const t = {
        owner: 'player', x: p.x + Math.cos(ang) * (p.r + 4), y: p.y + Math.sin(ang) * (p.r + 4),
        vx: Math.cos(ang) * p.tearSpeed, vy: Math.sin(ang) * p.tearSpeed,
        r: p.bigTear ? 12 : 6, dmg,
        pierce: p.pierce || p.laser, homing: p.homing, explosive: p.explosive,
        laser: p.laser, h: 0,
        traveled: 0, range: p.tearRange * (p.laser ? 1.6 : 1),
        dead: false,
      };
      Game.tears.push(t);
    }
    if (p.laser) Audio.laser(); else Audio.shoot();
  }

  function updateTears(dt) {
    const rm = Game.currentRoom;
    for (let i = Game.tears.length - 1; i >= 0; i--) {
      const t = Game.tears[i];
      if (t.dead) { Game.tears.splice(i, 1); continue; }
      // 追踪
      if (t.homing && t.owner === 'player') {
        let best = null, bd = 260;
        for (const e of Game.enemies) {
          if (e.dead) continue;
          const d = dist(t.x, t.y, e.x, e.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          const a = angleTo(t.x, t.y, best.x, best.y);
          const sp = vecLen(t.vx, t.vy) || 1;
          const cur = Math.atan2(t.vy, t.vx);
          const na = cur + clamp((((a - cur + Math.PI * 3) % TAU) - Math.PI) * 4 * dt, -2.2 * dt, 2.2 * dt);
          t.vx = Math.cos(na) * sp; t.vy = Math.sin(na) * sp;
        }
      }
      const sp = vecLen(t.vx, t.vy);
      t.x += t.vx * dt; t.y += t.vy * dt;
      t.traveled += sp * dt;
      if (!t.laser) t.h += (sp * dt) / Math.max(1, t.range); // 弧线按射程比例推进
      if (t.traveled >= t.range || (t.h >= 1 && !t.laser)) {
        tearHitWall(t, rm);
        continue;
      }
      // 墙壁
      if (t.x < t.r || t.x > W - t.r || t.y < t.r || t.y > H - t.r) {
        tearHitWall(t, rm); continue;
      }
      // 岩石
      if (rm && rm.rocks.some((rk) => !rk.dead && circleHit(t.x, t.y, t.r, rk.x, rk.y, rk.r))) {
        tearHitWall(t, rm); continue;
      }
      // 敌人碰撞
      if (t.owner === 'player') {
        for (const e of Game.enemies) {
          if (e.dead || !circleHit(t.x, t.y, t.r, e.x, e.y, e.r)) continue;
          if (e.type === 'momeye') continue; // 眼睛免疫
          const hit = hitEnemy(e, t);
          if (hit) { if (!t.pierce) { tearHitWall(t, rm); } break; }
        }
      }
    }
    // 玩家被敌弹击中
    for (let i = Game.enemyTears.length - 1; i >= 0; i--) {
      const t = Game.enemyTears[i];
      t.x += t.vx * dt; t.y += t.vy * dt;
      if (t.x < t.r || t.x > W - t.r || t.y < t.r || t.y > H - t.r) { Game.enemyTears.splice(i, 1); continue; }
      if (rm && rm.rocks.some((rk) => circleHit(t.x, t.y, t.r, rk.x, rk.y, rk.r))) { Game.enemyTears.splice(i, 1); continue; }
      if (circleHit(t.x, t.y, t.r, Game.player.x, Game.player.y, Game.player.r)) {
        damagePlayer(t.dmg, t.vx * 0.05, t.vy * 0.05);
        Game.enemyTears.splice(i, 1);
      }
    }
  }

  function tearHitWall(t, rm) {
    if (t.dead) return;
    t.dead = true;
    if (t.explosive && t.owner === 'player') {
      explodeAt(t.x, t.y, 62, t.dmg * 1.6, true);
    } else {
      burst(t.x, t.y, { count: 4, speed: 40, color: '#bfe0f2', size: 2, life: 0.25 });
    }
  }

  function hitEnemy(e, t) {
    // 骑士正面免伤
    if (e.armor && e.facing !== 0) {
      const td = Math.cos(Math.atan2(t.vy, t.vx) - (e.facing > 0 ? 0 : Math.PI));
      if (td > 0.2) {
        e.hitFlash = 0.06;
        burst(t.x, t.y, { count: 3, speed: 60, color: '#ccc', size: 2, life: 0.2 });
        return true; // 弹开但不掉血
      }
    }
    e.hp -= t.dmg;
    e.hitFlash = 0.1;
    e.aggro = true;
    e.lastHurt = 0.3;
    // 击退
    const a = Math.atan2(t.vy, t.vx);
    e.kx += Math.cos(a) * 40;
    e.ky += Math.sin(a) * 40;
    burst(t.x, t.y, { count: 5, speed: 80, color: '#c83230', size: 2.5, life: 0.35, gravity: 200 });
    if (Game.currentRoom) Art.addStain(Game.currentRoom, t.x, t.y, false);
    stopHit(0.02);
    if (e.hp <= 0) enemyDie(e);
    return true;
  }

  function enemyDie(e) {
    if (e.dead) return;
    e.dead = true;
    Game.stats.kills++;
    Audio.kill();
    addShake(5, 0.15);
    burst(e.x, e.y, { count: 12, speed: 120, color: '#c83230', size: 3, life: 0.5, gravity: 300 });
    if (Game.currentRoom) Art.addStain(Game.currentRoom, e.x, e.y, e.isBoss);
    if (e.boom) explodeAt(e.x, e.y, 90, 3, false);
    if (e.isBoss) {
      bossDrop(e);
      if (typeof onBossKilled === 'function') onBossKilled(e);
      return;
    }
    // 掉落
    const r = RNG();
    if (r < 0.20) Game.spawnPickup(e.x + rand(-8, 8), e.y + rand(-8, 8), chance(0.5) ? 'heart' : 'halfheart');
    else if (r < 0.40) Game.spawnPickup(e.x + rand(-8, 8), e.y + rand(-8, 8), 'coin');
    else if (r < 0.53) Game.spawnPickup(e.x + rand(-8, 8), e.y + rand(-8, 8), 'key');
    else if (r < 0.57) Game.spawnPickup(e.x + rand(-8, 8), e.y + rand(-8, 8), 'item');
  }

  function bossDrop(e) {
    Game.spawnPickup(e.x, e.y, 'item'); // 必掉道具
    Game.spawnPickup(e.x - 26, e.y + 10, 'heart');
    Game.spawnPickup(e.x + 26, e.y + 10, chance(0.5) ? 'coin' : 'key');
  }

  // 爆炸（Ipecac 落地 / Boom Fly 死亡）
  function explodeAt(x, y, radius, dmg, isPlayer) {
    Audio.boom();
    addShake(10, 0.3);
    burst(x, y, { count: 26, speed: 240, color: '#e89430', size: 3.5, life: 0.5, gravity: 200 });
    burst(x, y, { count: 14, speed: 160, color: '#c8e060', size: 3, life: 0.4 });
    if (Game.currentRoom) Art.addStain(Game.currentRoom, x, y, true);
    if (isPlayer) {
      // 波及敌人
      for (const e of Game.enemies) {
        if (!e.dead && circleHit(x, y, radius, e.x, e.y, e.r)) {
          const dmgT = { dmg, pierce: true, vx: (e.x - x) || 1, vy: (e.y - y) || 1 };
          hitEnemy(e, dmgT);
        }
      }
      // 波及玩家自己
      const p = Game.player;
      if (circleHit(x, y, radius, p.x, p.y, p.r)) damagePlayer(2, (p.x - x) * 0.03, (p.y - y) * 0.03);
    } else {
      // 敌方爆炸：环形弹幕 + 范围伤害玩家
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * TAU;
        Game.enemyTears.push({ x, y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, r: 7, dmg: 1, owner: 'enemy' });
      }
      const p = Game.player;
      if (circleHit(x, y, radius, p.x, p.y, p.r)) damagePlayer(2, (p.x - x) * 0.04, (p.y - y) * 0.04);
    }
  }

  // 玩家受伤
  function damagePlayer(dmg, kx, ky) {
    const p = Game.player;
    if (p.dead || p.inv > 0) return;
    if (p.shieldUp) {
      p.shieldUp = false;
      p.inv = 0.5;
      burst(p.x, p.y, { count: 16, speed: 130, color: '#a8dcff', size: 3, life: 0.5 });
      Audio.pickup();
      return;
    }
    if (p.wafer) dmg = 1;
    p.hp -= dmg;
    p.inv = 0.8;
    p.hurtFlash = 0.15;
    p.knockX = kx * 100; p.knockY = ky * 100;
    addShake(8, 0.2);
    Audio.hurt();
    burst(p.x, p.y, { count: 10, speed: 100, color: '#c83230', size: 3, life: 0.4, gravity: 300 });
    if (Game.currentRoom) Art.addStain(Game.currentRoom, p.x, p.y, false);
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      if (typeof gameOver === 'function') gameOver();
    }
  }

  // ================= 敌人 =================
  const ENEMY_DEFS = {
    gaper: { hp: 4, r: 14, speed: 85, contact: 2, fly: false },
    pooter: { hp: 3, r: 13, speed: 62, contact: 2, fly: true, fireCd: 2.2 },
    horf: { hp: 8, r: 16, speed: 0, contact: 2, fly: false, fireCd: 1.8 },
    attackfly: { hp: 1, r: 12, speed: 130, contact: 2, fly: true },
    boomfly: { hp: 2, r: 13, speed: 95, contact: 2, fly: true, boom: true },
    knight: { hp: 10, r: 15, speed: 40, contact: 2, fly: false, armor: true },
  };

  function createEnemy(type, x, y, floor) {
    const d = ENEMY_DEFS[type] || ENEMY_DEFS.gaper;
    const hpScale = 1 + (floor - 1) * 0.25;
    return {
      type, x, y, vx: 0, vy: 0,
      r: d.r, hp: Math.round(d.hp * hpScale), maxHp: Math.round(d.hp * hpScale),
      speed: d.speed, contact: d.contact, fly: d.fly, boom: !!d.boom, armor: !!d.armor,
      fireCd: d.fireCd || 0, fireTimer: rand(0.8, 1.8),
      kx: 0, ky: 0, hitFlash: 0, spawnT: 0.55, spawnMax: 0.55,
      aggro: false, dead: false, isBoss: false, seed: Math.random() * 10,
      facing: 1, attackAnim: 0, ai: { t: 0, dir: rand(0, TAU) },
    };
  }

  function updateEnemies(dt) {
    for (let i = Game.enemies.length - 1; i >= 0; i--) {
      const e = Game.enemies[i];
      if (e.dead) { Game.enemies.splice(i, 1); continue; }
      if (e.spawnT > 0) { e.spawnT -= dt; continue; }
      // Mom 门缝之眼：独立行为
      if (e.type === 'momeye') { updateMomEye(e, dt); continue; }
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.lastHurt = Math.max(0, (e.lastHurt || 0) - dt);
      e.attackAnim = Math.max(0, e.attackAnim - dt * 2);
      // 击退衰减
      const k = Math.exp(-4 * dt);
      e.kx *= k; e.ky *= k;
      updateEnemyAI(e, dt);
      // 移动
      if (e.type !== 'horf') {
        e.x += (e.vx + e.kx) * dt;
        e.y += (e.vy + e.ky) * dt;
        collideWorld(e);
      } else {
        e.x += e.kx * dt; e.y += e.ky * dt;
      }
      // 敌人分离
      for (let j = i + 1; j < Game.enemies.length; j++) {
        const o = Game.enemies[j];
        if (o.dead) continue;
        const d = dist(e.x, e.y, o.x, o.y);
        if (d < e.r + o.r && d > 0.01) {
          const a = angleTo(o.x, o.y, e.x, e.y);
          e.x += Math.cos(a) * (e.r + o.r - d) * 0.5;
          e.y += Math.sin(a) * (e.r + o.r - d) * 0.5;
        }
      }
      // 接触伤害
      if (circleHit(e.x, e.y, e.r * 0.8, Game.player.x, Game.player.y, Game.player.r - 2)) {
        damagePlayer(e.contact, (Game.player.x - e.x) * 0.06, (Game.player.y - e.y) * 0.06);
      }
    }
  }

  function updateEnemyAI(e, dt) {
    const p = Game.player;
    if (p.dead) { e.vx = 0; e.vy = 0; return; }
    const d = dist(e.x, e.y, p.x, p.y);
    if (d < 420) e.aggro = true;
    const a = angleTo(e.x, e.y, p.x, p.y);
    switch (e.type) {
      case 'gaper': {
        if (e.aggro) {
          const sp = e.speed * (e.ai.t > 0 ? 1.35 : 1);
          e.ai.t = Math.max(0, e.ai.t - dt);
          if (d > 26) { e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; }
          else { e.vx = 0; e.vy = 0; }
          if (d < 300 && e.ai.t === 0 && e.hp < e.maxHp) e.ai.t = 1.2; // 视野内加速
        } else { e.vx = 0; e.vy = 0; }
        break;
      }
      case 'pooter': {
        // 保持中距 + 横向游走
        const want = 190;
        let mx = 0, my = 0;
        if (d > want + 30) { mx = Math.cos(a); my = Math.sin(a); }
        else if (d < want - 50) { mx = -Math.cos(a); my = -Math.sin(a); }
        const strafe = Math.sin(Game.time * 0.8 + e.seed);
        e.vx = mx * e.speed * 0.7 + -Math.sin(a) * strafe * e.speed * 0.55;
        e.vy = my * e.speed * 0.7 + Math.cos(a) * strafe * e.speed * 0.55;
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && d < 420) {
          e.fireTimer = e.fireCd;
          Game.enemyTears.push({ x: e.x, y: e.y, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, r: 6, dmg: 1, owner: 'enemy' });
          Audio.laserShoot();
        }
        break;
      }
      case 'horf': {
        e.vx = 0; e.vy = 0;
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && d < 500) {
          e.fireTimer = e.fireCd;
          e.attackAnim = 1;
          for (const da of [-0.28, 0, 0.28]) {
            Game.enemyTears.push({ x: e.x + Math.cos(a + da) * 18, y: e.y + Math.sin(a + da) * 18, vx: Math.cos(a + da) * 170, vy: Math.sin(a + da) * 170, r: 6, dmg: 1, owner: 'enemy' });
          }
          Audio.laserShoot();
        }
        break;
      }
      case 'attackfly': {
        e.ai.t -= dt;
        if (e.ai.t <= 0) {
          e.ai.t = rand(0.7, 1.4);
          const da = rand(-1, 1);
          e.ai.dir = a + da * 1.8;
          e.speed = rand(120, 230);
        }
        e.vx = Math.cos(e.ai.dir) * e.speed;
        e.vy = Math.sin(e.ai.dir) * e.speed;
        // 撞墙反弹
        if (e.x < 70 || e.x > W - 70) e.ai.dir = Math.PI - e.ai.dir;
        if (e.y < 70 || e.y > H - 70) e.ai.dir = -e.ai.dir;
        break;
      }
      case 'boomfly': {
        e.vx = Math.cos(a) * e.speed * 0.85;
        e.vy = Math.sin(a) * e.speed * 0.85;
        if (e.x < 70 || e.x > W - 70) e.vx *= -1;
        if (e.y < 70 || e.y > H - 70) e.vy *= -1;
        break;
      }
      case 'knight': {
        // 朝向玩家（转身有延迟，正面免伤）
        e.ai.t -= dt;
        if (Math.cos(a) > 0.5 && e.facing < 0) { if (e.ai.t <= 0) { e.facing = 1; e.ai.t = 1; } }
        else if (Math.cos(a) < -0.5 && e.facing > 0) { if (e.ai.t <= 0) { e.facing = -1; e.ai.t = 1; } }
        e.vx = e.facing * e.speed;
        e.vy = 0;
        break;
      }
    }
  }

  // ================= Boss =================
  const BOSS_DEFS = {
    monstro: { hp: 60, r: 30 },
    duke: { hp: 80, r: 26 },
    mom: { hp: 120, r: 26 },
  };

  function createBoss(type, x, y) {
    const d = BOSS_DEFS[type] || BOSS_DEFS.monstro;
    return {
      type, x, y, vx: 0, vy: 0,
      r: d.r, hp: d.hp, maxHp: d.hp,
      kx: 0, ky: 0, hitFlash: 0, spawnT: 0.9, spawnMax: 0.9,
      aggro: true, dead: false, isBoss: true, seed: Math.random() * 10,
      squash: 0, maw: 0.6, stretch: 0, warningX: 0, warning: false,
      groundY: y, facing: 1,
      ai: { state: 'idle', t: 0, burst: 0, g: 800 },
    };
  }

  function updateBosses(dt) {
    for (let i = Game.enemies.length - 1; i >= 0; i--) {
      const e = Game.enemies[i];
      if (!e.isBoss) continue;
      if (e.dead) { Game.enemies.splice(i, 1); continue; }
      if (e.spawnT > 0) { e.spawnT -= dt; continue; }
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      const k = Math.exp(-4 * dt);
      e.kx *= k; e.ky *= k;
      switch (e.type) {
        case 'monstro': updateMonstro(e, dt); break;
        case 'duke': updateDuke(e, dt); break;
        case 'mom': updateMom(e, dt); break;
      }
      e.x += (e.vx + e.kx) * dt;
      e.y += (e.vy + e.ky) * dt;
      // 接触伤害
      if (circleHit(e.x, e.y, e.r * 0.85, Game.player.x, Game.player.y, Game.player.r - 2)) {
        damagePlayer(2, (Game.player.x - e.x) * 0.05, (Game.player.y - e.y) * 0.05);
      }
    }
  }

  // ---- Monstro：压扁→跳跃冲撞 / 呕吐散射，半血狂暴 ----
  function updateMonstro(e, dt) {
    const p = Game.player;
    const ai = e.ai;
    const enrage = e.hp < e.maxHp * 0.5;
    ai.t -= dt;
    switch (ai.state) {
      case 'idle': {
        e.y = e.groundY + Math.sin(Game.time * 4 + e.seed) * 3;
        e.vx = 0; e.vy = 0;
        e.squash = Math.max(0, e.squash - dt * 2);
        e.maw = Math.max(0.6, e.maw - dt);
        if (ai.t <= 0) {
          if (Math.random() < 0.45) { ai.state = 'squash'; ai.t = 0.32; }
          else { ai.state = 'vomit'; ai.t = 0.7; ai.burst = 0; }
        }
        break;
      }
      case 'squash': { // 蓄力压扁
        e.vx = 0; e.vy = 0;
        e.squash = 1 - ai.t / 0.32;
        if (ai.t <= 0) {
          ai.state = 'jump';
          const a = angleTo(e.x, e.y, p.x, p.y);
          e.vx = Math.cos(a) * (enrage ? 220 : 180);
          e.vy = -(enrage ? 330 : 300);
          ai.t = 3;
          e.groundY = e.y;
          e.squash = -0.25;
        }
        break;
      }
      case 'jump': {
        e.vy += ai.g * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.x < e.r + 30) { e.x = e.r + 30; e.vx = Math.abs(e.vx); }
        if (e.x > W - e.r - 30) { e.x = W - e.r - 30; e.vx = -Math.abs(e.vx); }
        if (e.y >= e.groundY) { // 落地
          e.y = e.groundY;
          ai.state = 'land';
          ai.t = 0.4;
          e.squash = 0.55;
          Audio.stomp();
          addShake(12, 0.35);
          burst(e.x, e.y, { count: 20, speed: 200, color: '#8a7a5e', size: 3, life: 0.4, gravity: 400 });
          for (let i = 0; i < 8; i++) {
            const a = i / 8 * TAU;
            Game.enemyTears.push({ x: e.x, y: e.y, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, r: 6, dmg: 1, owner: 'enemy' });
          }
          const p2 = Game.player;
          if (circleHit(e.x, e.y, 78, p2.x, p2.y, p2.r)) damagePlayer(2, (p2.x - e.x) * 0.05, (p2.y - e.y) * 0.05);
        }
        break;
      }
      case 'land': {
        e.vx = 0; e.vy = 0;
        e.squash = Math.max(0, e.squash - dt * 2);
        if (ai.t <= 0) { ai.state = 'idle'; ai.t = enrage ? 0.7 : 1.1; }
        break;
      }
      case 'vomit': { // 吐口扇形弹
        e.vx = 0; e.vy = 0;
        e.maw = 1;
        if (ai.burst < 3 && ai.t <= 0.35) {
          ai.burst++;
          ai.t = 0.35;
          const a = angleTo(e.x, e.y, p.x, p.y);
          const spread = 0.3;
          for (const da of [-spread, 0, spread]) {
            Game.enemyTears.push({ x: e.x + Math.cos(a + da) * 30, y: e.y + Math.sin(a + da) * 30, vx: Math.cos(a + da) * 200, vy: Math.sin(a + da) * 200, r: 7, dmg: 1, owner: 'enemy' });
          }
          Audio.laserShoot();
        }
        if (ai.t <= 0 && ai.burst >= 3) {
          ai.state = 'idle'; ai.t = enrage ? 0.8 : 1.3;
          e.maw = 0.6;
        }
        break;
      }
    }
  }

  // ---- Duke of Flies：悬空漂移 + 召唤苍蝇 + 环形弹 + 冲刺 ----
  function updateDuke(e, dt) {
    const p = Game.player;
    const ai = e.ai;
    const d = dist(e.x, e.y, p.x, p.y);
    const a = angleTo(e.x, e.y, p.x, p.y);
    if (ai.state === 'dash') { // 冲刺中，只保持速度
      ai.t -= dt;
      if (ai.t <= 0) { ai.state = 'hover'; ai.dash = 6; ai.t = 0; }
      return;
    }
    // 悬停保持中距 + 横向游走
    const want = 230;
    let mx = 0, my = 0;
    if (d > want + 40) { mx = Math.cos(a); my = Math.sin(a); }
    else if (d < want - 60) { mx = -Math.cos(a); my = -Math.sin(a); }
    const strafe = Math.sin(Game.time * 0.7 + e.seed);
    e.vx = mx * 55 + -Math.sin(a) * strafe * 45;
    e.vy = my * 55 + Math.cos(a) * strafe * 45;
    // 环形弹
    ai.ring = (ai.ring || 2) - dt;
    if (ai.ring <= 0) {
      ai.ring = 2.6;
      Audio.laserShoot();
      for (let i = 0; i < 12; i++) {
        const ang = i / 12 * TAU + Game.time;
        Game.enemyTears.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 150, vy: Math.sin(ang) * 150, r: 6, dmg: 1, owner: 'enemy' });
      }
    }
    // 瞄准单发
    ai.aim = (ai.aim || 1) - dt;
    if (ai.aim <= 0) {
      ai.aim = 1.5;
      Game.enemyTears.push({ x: e.x, y: e.y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, r: 7, dmg: 1, owner: 'enemy' });
      Audio.laserShoot();
    }
    // 召唤苍蝇
    ai.summon = (ai.summon || 3) - dt;
    if (ai.summon <= 0) {
      ai.summon = 5;
      const alive = Game.enemies.filter((o) => o.type === 'attackfly' && !o.dead).length;
      if (alive < 3) {
        const sp = Game.spawnEnemy('attackfly', e.x + rand(-40, 40), e.y + rand(-40, 40));
        if (sp) { sp.spawnT = 0.3; }
      }
    }
    // 冲刺
    ai.dash = (ai.dash || 4) - dt;
    if (ai.dash <= 0) {
      ai.dash = 6;
      ai.state = 'dash';
      ai.t = 0.9;
      e.vx = Math.cos(a) * 260;
      e.vy = Math.sin(a) * 260;
    }
  }

  // ---- Mom：巨足踩击（影子预警）+ 门缝之眼 + 召唤小怪 ----
  function updateMom(e, dt) {
    const p = Game.player;
    const ai = e.ai;
    ai.t -= dt;
    // 阶段召唤
    if (!e.summoned2 && e.hp < e.maxHp * 0.66) {
      e.summoned2 = true;
      summonMinions(2);
    }
    if (!e.summoned1 && e.hp < e.maxHp * 0.33) {
      e.summoned1 = true;
      summonMinions(3);
    }
    // 门缝眼睛
    ai.eye = (ai.eye || 4) - dt;
    if (ai.eye <= 0) {
      ai.eye = 5.5;
      const doorDirs = ['up', 'down', 'left', 'right'].filter((d) => Game.currentRoom.doors[d]);
      if (doorDirs.length) {
        const dir = pick(doorDirs);
        const c = Art.drawDoorCenter(Game.currentRoom, dir);
        const inX = clamp(c.x, 50, W - 50), inY = clamp(c.y, 50, H - 50);
        const eye = {
          type: 'momeye', x: inX, y: inY, r: 16, hp: 99999, dead: false, isBoss: false,
          contact: 0, fly: true, spawnT: 0, spawnMax: 0, hitFlash: 0, aggro: true, seed: Math.random() * 10,
          timer: 2.8, fireTimer: 0.4
        };
        Game.enemies.push(eye);
        Audio.bossRoar();
      }
    }
    switch (ai.state) {
      case 'idle': {
        e.stretch = Math.max(0, e.stretch - dt * 3);
        if (ai.t <= 0) { ai.state = 'warn'; ai.t = 0.75; e.warningX = p.x; e.warning = true; }
        break;
      }
      case 'warn': { // 影子预警
        e.stretch = 0;
        if (ai.t <= 0) {
          ai.state = 'stomp';
          e.warning = false;
          Audio.bossRoar();
        }
        break;
      }
      case 'stomp': { // 踩下
        e.stretch = Math.min(1, e.stretch + dt * 3.2);
        if (e.stretch >= 1) {
          Audio.stomp();
          addShake(14, 0.4);
          burst(e.warningX, 170, { count: 26, speed: 220, color: '#8a7a5e', size: 3.5, life: 0.45, gravity: 400 });
          const p2 = Game.player;
          if (circleHit(e.warningX, 170, 75, p2.x, p2.y, p2.r)) damagePlayer(2, (p2.x - e.warningX) * 0.04, (p2.y - 170) * 0.04);
          if (Game.currentRoom) {
            for (const rk of Game.currentRoom.rocks) {
              if (circleHit(e.warningX, 170, 78, rk.x, rk.y, rk.r)) {
                burst(rk.x, rk.y, { count: 12, speed: 160, color: '#8a7a5e', size: 3, life: 0.4, gravity: 300 });
                rk.dead = true;
              }
            }
          }
          ai.state = 'retreat'; ai.t = 0.6;
        }
        break;
      }
      case 'retreat': {
        if (ai.t <= 0) { ai.state = 'idle'; ai.t = rand(1.0, 1.9); }
        break;
      }
    }
    e.x = lerp(e.x, e.warningX, Math.min(1, dt * 5));
    if (ai.state !== 'stomp') e.y = 40;
    else e.y = lerp(e.y, 170, Math.min(1, dt * 6));
    e.vx = 0; e.vy = 0;
  }

  function summonMinions(n) {
    for (let i = 0; i < n; i++) {
      const pos = randomRoomSpot();
      const e = Game.spawnEnemy('gaper', pos.x, pos.y);
      if (e) e.hp = Math.round(e.hp * 0.7);
    }
  }
  function randomRoomSpot() {
    const rm = Game.currentRoom;
    for (let i = 0; i < 20; i++) {
      const c = Dungeon.randomFreeCell(rm, null, true);
      const { x, y } = cellCenter(c.gx, c.gy);
      if (dist(x, y, Game.player.x, Game.player.y) > 140) return { x, y };
    }
    return { x: 300, y: 200 };
  }

  // ---- 门缝之眼 ----
  function updateMomEye(e, dt) {
    e.timer -= dt;
    e.fireTimer -= dt;
    const p = Game.player;
    const a = angleTo(e.x, e.y, p.x, p.y);
    if (e.fireTimer <= 0) {
      e.fireTimer = 0.55;
      Game.enemyTears.push({ x: e.x, y: e.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, r: 6, dmg: 1, owner: 'enemy' });
      Audio.laserShoot();
    }
    if (e.timer <= 0) e.dead = true;
  }

  // ================= 跟班（Brother Bobby） =================
  function updateFamiliar(dt) {
    const p = Game.player;
    if (!Game.familiar) {
      Game.familiar = { x: p.x, y: p.y, fireTimer: 0 };
    }
    const f = Game.familiar;
    // 跟随（扇形环绕点）
    const a = Game.time * 2.2;
    const tx = p.x + Math.cos(a) * 34;
    const ty = p.y + Math.sin(a) * 34 + Math.sin(Game.time * 5) * 4;
    f.x = lerp(f.x, tx, Math.min(1, dt * 8));
    f.y = lerp(f.y, ty, Math.min(1, dt * 8));
    // 自动开火
    f.fireTimer -= dt;
    if (f.fireTimer <= 0) {
      let best = null, bd = 400;
      for (const e of Game.enemies) {
        if (e.dead) continue;
        const d = dist(f.x, f.y, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        f.fireTimer = 0.9;
        const ang = angleTo(f.x, f.y, best.x, best.y);
        Game.tears.push({ owner: 'player', x: f.x, y: f.y, vx: Math.cos(ang) * 380, vy: Math.sin(ang) * 380, r: 4, dmg: 1, pierce: false, homing: false, explosive: false, laser: false, h: 0, traveled: 0, range: 380, dead: false });
        Audio.shoot();
      }
    }
  }

  return {
    createPlayer, updatePlayer, damagePlayer,
    updateTears, explodeAt,
    createEnemy, updateEnemies,
    createBoss, updateBosses, updateMomEye,
    killEnemy(e) { if (!e.dead) { e.hp = 0; enemyDie(e); } },
  };
})();

