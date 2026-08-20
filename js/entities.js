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
      // 参考原作新增效果位
      brimstone: false, boomerang: false, bounce: 0, poison: 0,
      revives: 0, orbital: 0, split: false, brimCharge: 0, orbitA: 0,
      inv: 0, hurtFlash: 0, knockX: 0, knockY: 0, hitStun: 0,
      faceX: 1, faceY: 0, aimX: 1, aimY: 0, dead: false,
    };
  }

  function updatePlayer(p, dt) {
    if (p.dead) return;
    // 同步输入到玩家（键盘 / 摇杆 / BOT 都经 Input）
    p.aimX = Input.aimX;
    p.aimY = Input.aimY;
    // 移动输入（键盘 WASD / 摇杆 / BOT）
    const mx = Input.moveX, my = Input.moveY;
    // 受击硬直：期间不读移动输入，让击退冲量真正生效（否则下一帧输入会把冲量抹平）
    p.hitStun = Math.max(0, (p.hitStun || 0) - dt);
    const stunned = p.hitStun > 0;
    if (p.knockX !== 0 || p.knockY !== 0) {
      const k = Math.exp(-6 * dt);
      p.knockX *= k; p.knockY *= k;
    }
    if (stunned) {
      p.vx = p.knockX; p.vy = p.knockY;
    } else {
      p.vx = mx * p.speed + p.knockX;
      p.vy = my * p.speed + p.knockY;
    }
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
    const aiming = Math.abs(p.aimX) > 0.01 || Math.abs(p.aimY) > 0.01;
    if (p.brimstone) {
      // 硫磺火：按住射击键蓄力，蓄满 0.62s 发射大激光
      if (aiming) {
        p.brimCharge = (p.brimCharge || 0) + dt;
        if (p.brimCharge >= 0.62) {
          p.brimCharge = 0;
          fireBrimstone(p);
          p.fireTimer = p.fireDelay / 60;
        }
      } else {
        p.brimCharge = Math.max(0, (p.brimCharge || 0) - dt * 1.5);
      }
    } else if (aiming && p.fireTimer <= 0) {
      fire(p);
      p.fireTimer = p.fireDelay / 60;
    }
    // 环绕肉块：公转 + 接触伤害（可叠多个）
    if (p.orbital > 0) {
      p.orbitA = (p.orbitA || 0) + dt * 3.1;
      for (let i = 0; i < p.orbital; i++) {
        const oa = p.orbitA + (i / p.orbital) * TAU;
        const ox = p.x + Math.cos(oa) * 42;
        const oy = p.y + Math.sin(oa) * 42;
        for (const e of Game.enemies) {
          if (e.dead || e.spawnT > 0) continue;
          if (circleHit(ox, oy, 10, e.x, e.y, e.r * 0.8)) {
            hitEnemy(e, { dmg: p.damage * 0.7, pierce: true, vx: ox - e.x || 1, vy: oy - e.y || 1 });
          }
        }
      }
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
    // 弹幕分配：洛基之角 25% 四向 / 突变蜘蛛四重 0.6x / 20/20 双发 0.9x / 三重射击
    let shots = [];
    if (p.loki && RNG() < 0.25) {
      for (const d of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) shots.push({ ang: a + d, mul: 1 });
    } else {
      const base = p.triple ? [a - 0.16, a, a + 0.16] : [a];
      for (const b of base) {
        if (p.quadShot) {
          shots.push({ ang: b - 0.17, mul: 0.6 }, { ang: b + 0.17, mul: 0.6 }, { ang: b - 0.5, mul: 0.6 }, { ang: b + 0.5, mul: 0.6 });
        } else if (p.doubleShot) {
          shots.push({ ang: b - 0.07, mul: 0.9 }, { ang: b + 0.07, mul: 0.9 });
        } else {
          shots.push({ ang: b, mul: 1 });
        }
      }
    }
    for (const s of shots) {
      const ang = s.ang;
      // 严厉的爱：25% 概率射出三倍伤害的牙齿
      const tooth = p.teeth && RNG() < 0.25;
      const t = {
        owner: 'player', x: p.x + Math.cos(ang) * (p.r + 4), y: p.y + Math.sin(ang) * (p.r + 4),
        vx: Math.cos(ang) * p.tearSpeed, vy: Math.sin(ang) * p.tearSpeed,
        r: tooth ? 7 : (p.bigTear ? 12 : 6), dmg: (tooth ? dmg * 3 : dmg) * s.mul,
        pierce: p.pierce || p.laser, homing: p.homing, explosive: p.explosive,
        laser: p.laser, h: 0,
        boomerang: p.boomerang, bounce: p.bounce || 0, poison: p.poison || 0,
        split: p.split, splitDone: false, returning: false, hit: new Set(),
        coal: p.coal, kb: p.knockboost, tooth,
        slow: p.momsContact || 0, proptosis: p.proptosis, spectral: p.ouija,
        traveled: 0, range: p.tearRange * (p.laser ? 1.6 : 1),
        dead: false,
      };
      Game.tears.push(t);
    }
    if (p.laser) Audio.laser(); else Audio.shoot();
  }

  // 硫磺火：蓄满后的大激光（贯穿 + 高伤）
  function fireBrimstone(p) {
    const a = Math.atan2(p.aimY, p.aimX);
    const t = {
      owner: 'player', x: p.x + Math.cos(a) * (p.r + 6), y: p.y + Math.sin(a) * (p.r + 6),
      vx: Math.cos(a) * 640, vy: Math.sin(a) * 640,
      r: 9, dmg: p.damage * 3, pierce: true, homing: false, explosive: false,
      laser: true, brim: true, h: 0, boomerang: false, bounce: 0, poison: 0,
      split: false, splitDone: false, returning: false, hit: new Set(),
      traveled: 0, range: p.tearRange * 1.8,
      dead: false,
    };
    Game.tears.push(t);
    Audio.laser();
    addShake(4, 0.12);
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
      // 回旋（我的反射）：飞到 45% 距离后掉头朝玩家飞回
      if (t.boomerang && !t.returning && t.traveled >= t.range * 0.45) {
        t.returning = true;
        t.range *= 1.6;
        t.hit = new Set();
      }
      if (t.returning) {
        const p0 = Game.player;
        const a2 = angleTo(t.x, t.y, p0.x, p0.y);
        const sp2 = Math.max(180, sp);
        t.vx = lerp(t.vx, Math.cos(a2) * sp2, Math.min(1, 5 * dt));
        t.vy = lerp(t.vy, Math.sin(a2) * sp2, Math.min(1, 5 * dt));
        if (dist(t.x, t.y, p0.x, p0.y) < 22) { t.dead = true; continue; }
      }
      // 反弹（橡胶水泥）：撞墙反弹，清命中集并续命
      if (t.bounce > 0) {
        let bd = false;
        if ((t.x < t.r && t.vx < 0) || (t.x > W - t.r && t.vx > 0)) { t.vx *= -1; bd = true; }
        if ((t.y < t.r && t.vy < 0) || (t.y > H - t.r && t.vy > 0)) { t.vy *= -1; bd = true; }
        if (bd) {
          t.bounce--;
          t.hit = new Set();
          t.traveled -= t.range * 0.15;
          burst(t.x, t.y, { count: 4, speed: 60, color: '#cfe8c8', size: 2, life: 0.25 });
        }
      }
      if (t.traveled >= t.range || (t.h >= 1 && !t.laser)) {
        tearHitWall(t, rm);
        continue;
      }
      // 墙壁
      if (t.x < t.r || t.x > W - t.r || t.y < t.r || t.y > H - t.r) {
        tearHitWall(t, rm); continue;
      }
      // 岩石（通灵板幽灵泪可穿过）
      if (!t.spectral && rm && rm.rocks.some((rk) => !rk.dead && circleHit(t.x, t.y, t.r, rk.x, rk.y, rk.r))) {
        tearHitWall(t, rm); continue;
      }
      // 敌人碰撞
      if (t.owner === 'player') {
        for (const e of Game.enemies) {
          if (e.dead || !circleHit(t.x, t.y, t.r, e.x, e.y, e.r)) continue;
          if (e.type === 'momeye') continue; // 眼睛免疫
          if (t.hit && t.hit.has(e)) continue; // 已命中过的敌人不再重复伤害（贯穿/回旋）
          const hit = hitEnemy(e, t);
          if (hit) {
            if (t.hit) t.hit.add(e);
            // 寄生虫：命中后分裂成两个小眼泪（垂直方向弹开）
            if (t.split && !t.splitDone && !t.dead) {
              t.splitDone = true;
              const a0 = Math.atan2(t.vy, t.vx) + Math.PI / 2;
              const sp0 = Math.max(60, vecLen(t.vx, t.vy) * 0.7);
              for (const sd of [-1, 1]) {
                Game.tears.push({
                  owner: 'player', x: t.x, y: t.y,
                  vx: Math.cos(a0 + sd * 0.5) * sp0, vy: Math.sin(a0 + sd * 0.5) * sp0,
                  r: Math.max(3, t.r * 0.6), dmg: t.dmg * 0.8,
                  pierce: false, homing: false, explosive: false, laser: false, h: t.h,
                  boomerang: false, bounce: 0, poison: 0, split: false, splitDone: true,
                  returning: false, hit: null, traveled: 0, range: t.range * 0.8,
                  slow: t.slow || 0, proptosis: t.proptosis, spectral: t.spectral,
                  dead: false,
                });
              }
            }
            if (!t.pierce) { tearHitWall(t, rm); }
            break;
          }
        }
      }
    }
    // 玩家被敌弹击中
    for (let i = Game.enemyTears.length - 1; i >= 0; i--) {
      const t = Game.enemyTears[i];
      // 制导（hush 系）：前 1.1 秒转向玩家，之后直线
      if (t.homing && (t.age = (t.age || 0) + dt) < 1.1) {
        const p0 = Game.player;
        const a2 = angleTo(t.x, t.y, p0.x, p0.y);
        const cur = Math.atan2(t.vy, t.vx);
        const sp = vecLen(t.vx, t.vy) || 1;
        const na = cur + clamp((((a2 - cur + Math.PI * 3) % TAU) - Math.PI) * t.homing * dt, -2.5 * dt, 2.5 * dt);
        t.vx = Math.cos(na) * sp; t.vy = Math.sin(na) * sp;
      }
      // 弯弹（恒定角速度，形成弧线回流）
      if (t.curve) {
        const cur = Math.atan2(t.vy, t.vx) + t.curve * dt;
        const sp = vecLen(t.vx, t.vy) || 1;
        t.vx = Math.cos(cur) * sp; t.vy = Math.sin(cur) * sp;
      }
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
    let dmg = t.dmg;
    // 煤块：眼泪飞得越远伤害越高（最高 +120%）
    if (t.coal && t.range > 0) dmg *= 1 + (Math.min(t.traveled, t.range) / t.range) * 1.2;
    // 下垂症：眼泪近处伤害高（起手 ×3），越飞越弱（最低 ×0.6）
    if (t.proptosis && t.range > 0) dmg *= Math.max(0.6, 3 - (Math.min(t.traveled, t.range) / t.range) * 2.4);
    e.hp -= dmg;
    e.hitFlash = 0.1;
    e.aggro = true;
    e.lastHurt = 0.3;
    // 中毒（感冒）：按 DPS 持续掉血
    if (t.poison && t.poison > 0) {
      e.poison = Math.max(e.poison || 0, 3);
      e.poisonDps = Math.max(e.poisonDps || 0, t.poison);
      burst(t.x, t.y, { count: 6, speed: 70, color: '#8ed060', size: 2, life: 0.5, gravity: 100 });
    }
    // 减速（妈妈的爱抚）
    if (t.slow) {
      e.slow = Math.max(e.slow || 0, 2.2);
      burst(t.x, t.y, { count: 5, speed: 50, color: '#b0c8e0', size: 2, life: 0.45 });
    }
    // 击退（铁棒：击退加强）
    const a = Math.atan2(t.vy, t.vx);
    const kb = t.kb ? 2.2 : 1;
    e.kx += Math.cos(a) * 40 * kb;
    e.ky += Math.sin(a) * 40 * kb;
    burst(t.x, t.y, { count: 5, speed: 80, color: '#c83230', size: 2.5, life: 0.35, gravity: 200 });
    if (Game.currentRoom) Art.addStain(Game.currentRoom, t.x, t.y, false);
    stopHit(0.02);
    if (e.hp <= 0) enemyDie(e);
    return true;
  }

  function enemyDie(e) {
    if (e.dead) return;
    // 泥人：死而复活一次（变绿），第二次才真正死亡
    if (e.type === 'globin' && !e.revived) {
      e.revived = true;
      e.hp = 1;
      e.maxHp = 1;
      e.invuln = 0.6;
      e.hitFlash = 0;
      e.spawnT = 0.4;
      e.spawnMax = 0.4;
      burst(e.x, e.y, { count: 16, speed: 140, color: '#8ed060', size: 3, life: 0.5, gravity: 250 });
      Audio.kill();
      return;
    }
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
    // 击退冲量（归一化方向）+ 受击硬直，硬直期间输入被旁路 → 击退真正把人撞飞
    const m = Math.hypot(kx, ky);
    if (m > 0.001) { p.knockX = (kx / m) * 380; p.knockY = (ky / m) * 380; }
    else { p.knockX = 0; p.knockY = 0; }
    p.hitStun = 0.2;
    addShake(8, 0.2);
    Audio.hurt();
    burst(p.x, p.y, { count: 10, speed: 100, color: '#c83230', size: 3, life: 0.4, gravity: 300 });
    if (Game.currentRoom) Art.addStain(Game.currentRoom, p.x, p.y, false);
    // 复活（1UP / 死猫）：1 心 + 长无敌 + 金色粒子
    if (p.hp <= 0 && p.revives > 0) {
      p.revives--;
      p.hp = 2;
      p.inv = 2.4;
      burst(p.x, p.y, { count: 26, speed: 170, color: '#ffe8a0', size: 4, life: 0.8 });
      Audio.item();
      return;
    }
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
    // 参考原作新增：血块(四向散射)/跳虫(蓄力突进)/血口(蓄力巨弹)/泥人(死而复活)
    clotty: { hp: 5, r: 14, speed: 55, contact: 2, fly: false, fireCd: 2.6 },
    hopper: { hp: 6, r: 13, speed: 95, contact: 2, fly: false },
    maw: { hp: 12, r: 16, speed: 0, contact: 2, fly: false, fireCd: 3.2 },
    globin: { hp: 4, r: 13, speed: 70, contact: 2, fly: false },
    // 参考原作新增：巨眼怪（蓄力锁定向血激光，每房最多 1 只）
    vis: { hp: 14, r: 16, speed: 45, contact: 2, fly: false, fireCd: 2.6 },
  };

  function createEnemy(type, x, y, floor) {
    const d = ENEMY_DEFS[type] || ENEMY_DEFS.gaper;
    const hpScale = 1 + (floor - 1) * 0.25;
    return {
      type, x, y, vx: 0, vy: 0,
      r: d.r, hp: Math.round(d.hp * hpScale), maxHp: Math.round(d.hp * hpScale),
      speed: d.speed, baseSpeed: d.speed, contact: d.contact, fly: d.fly, boom: !!d.boom, armor: !!d.armor,
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
      // 减速（妈妈的爱抚）：统一按 baseSpeed 折算，AI 读 e.speed 即生效
      e.slow = Math.max(0, (e.slow || 0) - dt);
      e.speed = e.baseSpeed * (e.slow > 0 ? 0.45 : 1);
      // 中毒持续伤害
      if (e.poison > 0) {
        e.poison -= dt;
        e.hp -= (e.poisonDps || 1) * dt;
        if (Math.random() < dt * 8) burst(e.x, e.y, { count: 2, speed: 40, color: '#8ed060', size: 2, life: 0.4 });
        if (e.hp <= 0) { enemyDie(e); continue; }
      }
      // 击退衰减
      const k = Math.exp(-4 * dt);
      e.kx *= k; e.ky *= k;
      updateEnemyAI(e, dt);
      // 移动（静止型敌人只受击退影响）
      if (e.type !== 'horf' && e.type !== 'maw') {
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
      case 'clotty': {
        // 缓慢追踪 + 周期性四向齐射（对角交叉弹幕）
        e.vx = Math.cos(a) * e.speed;
        e.vy = Math.sin(a) * e.speed;
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && d < 460) {
          e.fireTimer = e.fireCd;
          e.attackAnim = 1;
          const base = a;
          for (const da of [0.785, 2.356, 3.927, 5.498]) {
            const ang = base + da;
            Game.enemyTears.push({
              x: e.x + Math.cos(ang) * 16, y: e.y + Math.sin(ang) * 16,
              vx: Math.cos(ang) * 170, vy: Math.sin(ang) * 170, r: 5, dmg: 1, owner: 'enemy'
            });
          }
          Audio.laserShoot();
        }
        break;
      }
      case 'hopper': {
        // 状态机：游走 → 压缩蓄力 → 突进扑击
        const st = e.ai.state || 'wander';
        if (st === 'wander') {
          e.ai.t -= dt;
          e.squash = Math.max(0, (e.squash || 0) - dt * 2);
          if (e.ai.t <= 0) {
            e.ai.t = 0.32;
            e.ai.state = 'crouch';
          } else {
            e.vx = Math.cos(e.ai.dir) * e.speed;
            e.vy = Math.sin(e.ai.dir) * e.speed * 0.4;
            if (e.x < 80 || e.x > W - 80) e.ai.dir = Math.PI - e.ai.dir;
            if (e.y < 70 || e.y > H - 70) e.ai.dir = -e.ai.dir;
          }
        } else if (st === 'crouch') {
          e.vx = 0; e.vy = 0;
          e.squash = Math.min(1, (e.squash || 0) + dt * 3.4);
          if (e.squash >= 1) {
            e.ai.state = 'leap';
            e.ai.t = 0.5;
            e.vx = Math.cos(a) * 330;
            e.vy = Math.sin(a) * 330;
          }
        } else { // leap：直线突进，撞墙/超时结束
          e.ai.t -= dt;
          e.squash = Math.max(0, (e.squash || 0) - dt * 4);
          if (e.ai.t <= 0 || e.x < 70 || e.x > W - 70 || e.y < 60 || e.y > H - 60) {
            e.ai.state = 'wander';
            e.ai.t = rand(1.1, 2.1);
            e.ai.dir = rand(0, TAU);
            e.vx = 0; e.vy = 0;
          }
        }
        break;
      }
      case 'maw': {
        // 静止血口：长时间蓄力（张合动画）→ 巨型慢速血球
        e.vx = 0; e.vy = 0;
        e.fireTimer -= dt;
        if (e.fireTimer <= -0.7) { // 蓄力完成发射
          e.fireTimer = e.fireCd;
          e.maw = 0.2;
          e.attackAnim = 1;
          const ang = a;
          Game.enemyTears.push({
            x: e.x + Math.cos(ang) * 18, y: e.y + Math.sin(ang) * 18,
            vx: Math.cos(ang) * 115, vy: Math.sin(ang) * 115, r: 10, dmg: 2, owner: 'enemy'
          });
          Audio.bossRoar();
        } else if (e.fireTimer > -0.7 && e.fireTimer <= 0 && d < 520) {
          e.maw = Math.min(1, (e.maw || 0.2) + dt * 1.6); // 蓄力张合
        }
        break;
      }
      case 'globin': {
        // 泥人：追踪玩家，死后原地复活一次（变绿）
        e.vx = Math.cos(a) * e.speed;
        e.vy = Math.sin(a) * e.speed;
        break;
      }
      case 'vis': {
        // 巨眼怪：逼近 → 锁定蓄力 → 发射一道血激光（可侧闪）
        const st = e.ai.state || 'chase';
        if (st === 'chase') {
          e.vx = Math.cos(a) * e.speed;
          e.vy = Math.sin(a) * e.speed;
          e.maw = Math.max(0, (e.maw || 0) - dt);
          if (d < 330 && (e.ai.t || 0) <= 0) {
            e.ai.state = 'charge';
            e.ai.t = 0.85;
            e.ai.lock = a;
            e.vx = 0; e.vy = 0;
          }
        } else if (st === 'charge') {
          e.vx = 0; e.vy = 0;
          e.ai.t -= dt;
          e.maw = Math.min(1, 1 - e.ai.t / 0.85); // 瞳孔发光蓄力
          if (e.ai.t <= 0) {
            spawnEnemyBeam(e.x, e.y, e.ai.lock, 980, 0.55);
            Audio.bossRoar();
            addShake(4, 0.15);
            e.ai.state = 'recover';
            e.ai.t = 2.2;
            e.maw = 0;
          }
        } else { // recover：发射后短暂停歇
          e.vx = 0; e.vy = 0;
          e.ai.t -= dt;
          if (e.ai.t <= 0) { e.ai.state = 'chase'; e.ai.t = rand(0.5, 1.2); }
        }
        break;
      }
    }
  }

  // ================= Boss =================
  const BOSS_DEFS = {
    monstro: { hp: 60, r: 30, contact: 2 },
    duke: { hp: 80, r: 26, contact: 2 },
    mom: { hp: 120, r: 26, contact: 2 },
    larry: { hp: 70, r: 20, contact: 2 },
    gurdy: { hp: 110, r: 42, contact: 1 },
    // 参考原作新增
    chub: { hp: 90, r: 22, contact: 2 },
    monstro2: { hp: 110, r: 30, contact: 2 },
  };

  function createBoss(type, x, y) {
    const d = BOSS_DEFS[type] || BOSS_DEFS.monstro;
    const b = {
      type, x, y, vx: 0, vy: 0,
      r: d.r, hp: d.hp, maxHp: d.hp, contact: d.contact || 2,
      kx: 0, ky: 0, hitFlash: 0, spawnT: 0.9, spawnMax: 0.9,
      aggro: true, dead: false, isBoss: true, seed: Math.random() * 10,
      squash: 0, maw: 0.6, stretch: 0, warningX: 0, warning: false,
      groundY: y, facing: 1, segs: [], revived: false,
      ai: { state: 'idle', t: 0, burst: 0, g: 800, dir: rand(0, TAU) },
    };
    // Boss 专属初始布局
    if (type === 'gurdy') { b.groundY = H / 2; b.x = W - 56; }
    if (type === 'chub') b.segs = [];
    return b;
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
        case 'larry': updateLarry(e, dt); break;
        case 'gurdy': updateGurdy(e, dt); break;
        case 'chub': updateChub(e, dt); break;
        case 'monstro2': updateMonstro2(e, dt); break;
      }
      e.x += (e.vx + e.kx) * dt;
      e.y += (e.vy + e.ky) * dt;
      // 接触伤害：仅攻击动作期生效（前摇/蓄力不伤人），Mom 靠踩击落地主动扣血
      if (bossAggro(e) && circleHit(e.x, e.y, e.r * 0.85, Game.player.x, Game.player.y, Game.player.r - 2)) {
        damagePlayer(e.contact, Game.player.x - e.x, Game.player.y - e.y);
      }
    }
  }

  // Boss 是否处于攻击动作期（接触才有伤害）
  function bossAggro(e) {
    switch (e.type) {
      case 'monstro': // 跳跃中仅接近地面时伤人（空中掠过无害）
        return e.ai.state === 'jump' && e.y >= e.groundY - 8;
      case 'duke':    // 仅冲刺阶段
        return e.ai.state === 'dash';
      case 'mom':     // 本体踩击由 stomp 落地主动结算，常驻无接触伤害
        return false;
      case 'larry':   // 蠕虫整身始终是危险物
        return true;
      case 'gurdy':   // 站桩 Boss：本体缓慢，靠弹幕，接触小伤
        return true;
      case 'chub':    // 仅冲刺阶段（蓄力前摇安全）
        return e.ai.state === 'charge';
      case 'monstro2': // 仅跳压落地瞬间
        return e.ai.state === 'leapDown' && e.y >= e.groundY - 8;
      default:
        return true;
    }
  }

  // ---- Larry Jr：分段蠕虫，随机游走 + 身体段接触伤害 ----
  function updateLarry(e, dt) {
    const p = Game.player;
    const ai = e.ai;
    ai.t -= dt;
    if (ai.t <= 0) {
      ai.t = rand(0.5, 1.1);
      ai.dir = angleTo(e.x, e.y, p.x, p.y) + rand(-1, 1) * 1.7;
    }
    e.vx = Math.cos(ai.dir) * 135;
    e.vy = Math.sin(ai.dir) * 135;
    // 身体段跟随头部（蛇形）
    const segs = e.segs;
    if (!segs.length) for (let i = 0; i < 4; i++) segs.push({ x: e.x, y: e.y });
    segs.unshift({ x: e.x, y: e.y });
    segs.pop();
    const gap = 20;
    for (let i = 1; i < segs.length; i++) {
      const pr = segs[i - 1], sg = segs[i];
      const d = dist(sg.x, sg.y, pr.x, pr.y);
      if (d > gap && d > 0.01) {
        const a2 = angleTo(pr.x, pr.y, sg.x, sg.y);
        sg.x = pr.x + Math.cos(a2) * gap;
        sg.y = pr.y + Math.sin(a2) * gap;
      }
      // 身体段接触伤害
      if (circleHit(sg.x, sg.y, 13, p.x, p.y, p.r - 2)) {
        damagePlayer(1, p.x - sg.x, p.y - sg.y);
      }
    }
  }

  // ---- Gurdy：贴墙肉瘤墙，纵向摆动 + 周期性放射弹幕 ----
  function updateGurdy(e, dt) {
    const ai = e.ai;
    ai.t -= dt;
    e.vx = 0; e.vy = 0;
    e.x = lerp(e.x, W - 56, Math.min(1, dt * 2.5));
    e.y = e.groundY + Math.sin(Game.time * 0.9 + e.seed) * 46;
    e.maw = Math.min(1, e.maw + dt * 0.4);
    if (ai.t <= 0) {
      ai.t = 2.6;
      e.maw = 0.15;
      e.attackAnim = 1;
      Audio.bossRoar();
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * TAU + Game.time * 0.6;
        Game.enemyTears.push({
          x: e.x + Math.cos(ang) * 26, y: e.y + Math.sin(ang) * 26,
          vx: Math.cos(ang) * 125, vy: Math.sin(ang) * 125, r: 5, dmg: 1, owner: 'enemy'
        });
      }
    }
  }

  // ---- Chub：冲锋大虫，横/纵对齐后蓄力冲刺 + 身体段接触 ----
  function updateChub(e, dt) {
    const p = Game.player;
    const ai = e.ai;
    const d = dist(e.x, e.y, p.x, p.y);
    const a = angleTo(e.x, e.y, p.x, p.y);
    switch (ai.state) {
      case 'idle': { // 缓慢游走，横/纵对齐则蓄力
        e.vx = Math.cos(a) * 95;
        e.vy = Math.sin(a) * 95;
        if ((Math.abs(p.x - e.x) < 46 || Math.abs(p.y - e.y) < 46) && d > 90) {
          ai.state = 'chargeUp'; ai.t = 0.5; ai.lock = a;
          e.vx = 0; e.vy = 0; e.warning = true;
          Audio.bossRoar();
        }
        break;
      }
      case 'chargeUp': { // 前摇：压缩蓄力
        e.vx = 0; e.vy = 0;
        e.squash = Math.min(1, (e.squash || 0) + dt * 2.6);
        ai.t -= dt;
        if (ai.t <= 0) {
          ai.state = 'charge'; ai.t = 1.1;
          e.squash = -0.3; e.warning = false;
          e.vx = Math.cos(ai.lock) * 430;
          e.vy = Math.sin(ai.lock) * 430;
          Audio.bossRoar();
        }
        break;
      }
      case 'charge': { // 高速直冲，撞墙/超时结束
        ai.t -= dt;
        e.x += e.vx * dt; e.y += e.vy * dt;
        if (ai.t <= 0 || e.x < 85 || e.x > W - 85 || e.y < 75 || e.y > H - 75) {
          Audio.stomp(); addShake(10, 0.3);
          for (let i = 0; i < 6; i++) {
            const an = i / 6 * TAU + e.seed;
            Game.enemyTears.push({ x: e.x, y: e.y, vx: Math.cos(an) * 180, vy: Math.sin(an) * 180, r: 5, dmg: 1, owner: 'enemy' });
          }
          const alive = Game.enemies.filter((o) => o.type === 'attackfly' && !o.dead).length;
          if (alive < 3) {
            const sp = Game.spawnEnemy('attackfly', e.x + rand(-30, 30), e.y + rand(-30, 30));
            if (sp) sp.spawnT = 0.3;
          }
          ai.state = 'idle'; ai.t = rand(0.6, 1.3);
          e.squash = Math.max(0, (e.squash || 0) - dt * 4);
        }
        break;
      }
    }
    // 身体段跟随（3 段，全身接触威胁）
    const segs = e.segs;
    if (!segs.length) for (let i = 0; i < 3; i++) segs.push({ x: e.x, y: e.y });
    segs.unshift({ x: e.x, y: e.y });
    segs.pop();
    const gap = 24;
    for (let i = 1; i < segs.length; i++) {
      const pr = segs[i - 1], sg = segs[i];
      const dd = dist(sg.x, sg.y, pr.x, pr.y);
      if (dd > gap && dd > 0.01) {
        const a2 = angleTo(pr.x, pr.y, sg.x, sg.y);
        sg.x = pr.x + Math.cos(a2) * gap;
        sg.y = pr.y + Math.sin(a2) * gap;
      }
      if (circleHit(sg.x, sg.y, 14, p.x, p.y, p.r - 2)) damagePlayer(1, p.x - sg.x, p.y - sg.y);
    }
  }

  // ---- Monstro II：跳压 + 扫射血激光 + 召唤血口，半血狂暴 ----
  function updateMonstro2(e, dt) {
    const p = Game.player;
    const ai = e.ai;
    const enrage = e.hp < e.maxHp * 0.5;
    const a = angleTo(e.x, e.y, p.x, p.y);
    ai.t -= dt;
    switch (ai.state) {
      case 'idle': {
        e.y = e.groundY + Math.sin(Game.time * 4 + e.seed) * 3;
        e.vx = 0; e.vy = 0;
        e.squash = Math.max(0, e.squash - dt * 2);
        e.maw = Math.max(0.6, e.maw - dt);
        if (ai.t <= 0) {
          if (Math.random() < 0.55) { ai.state = 'squash'; ai.t = 0.34; }
          else { ai.state = 'brimCharge'; ai.t = 0.62; ai.lock = a; ai.beamDir = 1; ai.beamT = 0; ai.beamA = a; }
        }
        break;
      }
      case 'squash': {
        e.vx = 0; e.vy = 0;
        e.squash = 1 - ai.t / 0.34;
        if (ai.t <= 0) {
          ai.state = 'leapUp'; ai.t = 0.5;
          e.vx = Math.cos(a) * (enrage ? 200 : 160);
          e.vy = -(enrage ? 360 : 320);
          e.groundY = e.y;
          e.squash = -0.25;
        }
        break;
      }
      case 'leapUp': { // 上升段
        e.vy += ai.g * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.x < e.r + 30) { e.x = e.r + 30; e.vx = Math.abs(e.vx); }
        if (e.x > W - e.r - 30) { e.x = W - e.r - 30; e.vx = -Math.abs(e.vx); }
        if (e.vy > 0) { ai.state = 'leapDown'; ai.t = 0.45; }
        break;
      }
      case 'leapDown': { // 落地：8 向弹 + 召唤血口 + 范围伤害
        e.vy += ai.g * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.y >= e.groundY) {
          e.y = e.groundY;
          ai.state = 'idle'; ai.t = enrage ? 0.8 : 1.2;
          e.squash = 0.55;
          Audio.stomp(); addShake(12, 0.35);
          burst(e.x, e.y, { count: 20, speed: 200, color: '#8a7a5e', size: 3, life: 0.4, gravity: 400 });
          for (let i = 0; i < 8; i++) {
            const an = i / 8 * TAU;
            Game.enemyTears.push({ x: e.x, y: e.y, vx: Math.cos(an) * 210, vy: Math.sin(an) * 210, r: 6, dmg: 1, owner: 'enemy' });
          }
          const p2 = Game.player;
          if (circleHit(e.x, e.y, 80, p2.x, p2.y, p2.r)) damagePlayer(2, (p2.x - e.x) * 0.05, (p2.y - e.y) * 0.05);
          if (Math.random() < 0.6) {
            const c = Game.currentRoom && Dungeon.randomFreeCell(Game.currentRoom, null, true);
            const { x, y } = cellCenter(c ? c.gx : 7, c ? c.gy : 4);
            const m = Game.spawnEnemy('maw', x, y);
            if (m) { m.hp = Math.round(m.hp * 0.8); m.spawnT = 0.3; }
          }
        }
        break;
      }
      case 'brimCharge': { // 蓄力（红光）
        e.vx = 0; e.vy = 0;
        e.maw = Math.min(1, 1 - ai.t / 0.62);
        if (ai.t <= 0) {
          ai.state = 'brim'; ai.t = enrage ? 2.2 : 1.7; ai.beamT = 0; ai.beamA = ai.lock;
        }
        break;
      }
      case 'brim': { // 扫射激光：锁定起始角 ±0.65 弧度往复
        e.vx = 0; e.vy = 0;
        e.maw = 1;
        const sweep = enrage ? 1.5 : 1.1; // 弧度/秒
        ai.beamA += ai.beamDir * sweep * dt;
        if (Math.abs(ai.beamA - ai.lock) > 0.65) { ai.beamDir *= -1; ai.beamA = ai.lock + ai.beamDir * 0.65; }
        // 每 0.09s 刷一帧短命光束
        ai.beamT -= dt;
        if (ai.beamT <= 0) {
          ai.beamT = 0.09;
          spawnEnemyBeam(e.x, e.y, ai.beamA, 940, 0.22);
          Audio.laserShoot();
        }
        if (ai.t <= 0) { ai.state = 'idle'; ai.t = enrage ? 0.9 : 1.4; e.maw = 0.6; }
        break;
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

  // ================= 敌方激光实体（vis / Monstro II 扫射） =================
  function spawnEnemyBeam(x, y, angle, len, dur) {
    if (!Game.beams) Game.beams = [];
    const b = { x, y, angle, len: len || 900, t: 0, dur: dur || 0.5 };
    Game.beams.push(b);
    return b;
  }

  // 点到线段距离（光束命中判定）
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function updateBeams(dt) {
    const arr = Game.beams;
    if (!arr) return;
    const p = Game.player;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      b.t += dt;
      if (b.t >= b.dur) { arr.splice(i, 1); continue; }
      const x2 = b.x + Math.cos(b.angle) * b.len;
      const y2 = b.y + Math.sin(b.angle) * b.len;
      if (distToSeg(p.x, p.y, b.x, b.y, x2, y2) < 13) {
        damagePlayer(2, Math.cos(b.angle) * 50, Math.sin(b.angle) * 50);
      }
    }
  }

  return {
    createPlayer, updatePlayer, damagePlayer,
    updateTears, explodeAt, updateBeams, spawnEnemyBeam,
    createEnemy, updateEnemies,
    createBoss, updateBosses, updateMomEye,
    killEnemy(e) { if (!e.dead) { e.hp = 0; enemyDie(e); } },
  };
})();

