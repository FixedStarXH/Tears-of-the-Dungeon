/* art.js —— 全部程序化绘图：地板/墙壁/门/道具/角色/敌人/Boss/眼泪/图标/HUD */
'use strict';

const Art = (function () {

  // ---------- 基础工具 ----------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 有机形体：正弦噪声扰动圆轮廓 + 二次贝塞尔平滑（参考原作）
  function blob(ctx, x, y, r, seedR, points, amp) {
    points = points || 9; amp = amp || 0.32;
    const pts = [];
    for (let i = 0; i < points; i++) {
      const a = (i / points) * TAU;
      const rr = r * (1 - amp * 0.5 + amp * ((Math.sin(a * 3 + seedR) + Math.sin(a * 5 - seedR * 2)) * 0.5 + 0.5));
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let m = mid(pts[points - 1], pts[0]);
    ctx.beginPath();
    ctx.moveTo(m[0], m[1]);
    for (let i = 0; i < points; i++) {
      const next = mid(pts[i], pts[(i + 1) % points]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], next[0], next[1]);
    }
    ctx.closePath();
  }

  // 顶光高光：径向渐变从左上白到右下暗，一键立体感（参考原作）
  function sheen(ctx, x, y, rx, ry, strength) {
    strength = strength || 0.35;
    const g = ctx.createRadialGradient(x - rx * 0.3, y - ry * 0.45, rx * 0.1, x, y, rx * 1.15);
    g.addColorStop(0, `rgba(255,255,255,${strength})`);
    g.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
  }

  // ---------- 地板主题（每层独立配色） ----------
  const FLOOR_THEMES = {
    1: { // BASEMENT 棕石地砖
      base: '#4f3d24', tileA: '#67512f', tileB: '#5b4729', grout: '#3f311c',
      wall: '#32261b', wallHi: '#584531', wallEdge: '#1c150d',
      ambient: 'rgba(78, 44, 18, 0.14)', fog: 'rgba(16, 10, 7, 0.16)', accent: 'rgba(255, 210, 150, 0.08)',
    },
    2: { // CELLAR 木地板
      base: '#443017', tileA: '#7a5b31', tileB: '#6a4f2a', grout: '#3e2c17',
      wall: '#31261b', wallHi: '#5b4530', wallEdge: '#1a140c',
      ambient: 'rgba(88, 52, 24, 0.16)', fog: 'rgba(18, 12, 8, 0.15)', accent: 'rgba(255, 224, 170, 0.06)',
    },
    3: { // DEPTHS 紫黑石
      base: '#2b2635', tileA: '#423a54', tileB: '#363047', grout: '#211c2d',
      wall: '#211b2a', wallHi: '#3d3550', wallEdge: '#120f18',
      ambient: 'rgba(68, 52, 92, 0.15)', fog: 'rgba(10, 7, 16, 0.18)', accent: 'rgba(220, 190, 255, 0.06)',
    },
  };
  const theme = (floor) => FLOOR_THEMES[clamp(floor, 1, 3)] || FLOOR_THEMES[1];

  // 烘焙房间静态层（地板 + 墙壁 + 障碍物），血渍也画在这层
  function bakeRoomStatic(room) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const th = theme(room.floor);
    ctx.fillStyle = th.base;
    ctx.fillRect(0, 0, W, H);
    drawFloorTiles(ctx, room, th);
    drawWalls(ctx, room, th);
    drawProps(ctx, room);
    drawRoomAtmosphere(ctx, room, th);
    room.static = c;
  }

  function drawFloorTiles(ctx, room, th) {
    const seedStr = 'F' + room.floor + ':' + room.x + ',' + room.y;
    let s = 0;
    for (let i = 0; i < seedStr.length; i++) s = (s * 31 + seedStr.charCodeAt(i)) | 0;
    const rng = mulberry32(s);
    for (let gx = 1; gx <= WALK_MAX_X; gx++) {
      for (let gy = 1; gy <= WALK_MAX_Y; gy++) {
        const x = gx * CELL, y = gy * CELL;
        ctx.fillStyle = rng() < 0.5 ? th.tileA : th.tileB;
        ctx.fillRect(x, y, CELL, CELL);
        ctx.strokeStyle = th.grout;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
        if (rng() < 0.18) { // 地砖裂纹
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 1.5;
          const cx = x + CELL / 2, cy = y + CELL / 2;
          ctx.beginPath();
          ctx.moveTo(cx - 8, cy - 6);
          ctx.lineTo(cx + 2, cy + 1);
          ctx.lineTo(cx + 9, cy - 3);
          ctx.stroke();
        }
        if (room.floor === 2 && rng() < 0.12) { // 蛛网
          ctx.strokeStyle = 'rgba(220,220,220,0.16)';
          ctx.lineWidth = 1;
          const cx = x + rng() * 40 + 10, cy = y + rng() * 40 + 10;
          for (let a = 0; a < TAU; a += TAU / 8) {
            ctx.beginPath(); ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14);
            ctx.stroke();
          }
        }
        if (room.floor === 3 && rng() < 0.08) { // 骷髅
          const cx = x + CELL / 2 + rng() * 10 - 5, cy = y + CELL / 2 + rng() * 10 - 5;
          ctx.fillStyle = 'rgba(200,200,210,0.12)';
          ctx.beginPath(); ctx.arc(cx, cy, 5, 0, TAU); ctx.fill();
          ctx.fillRect(cx - 2, cy, 2, 4); ctx.fillRect(cx + 1, cy, 2, 4);
        }
      }
    }
  }

  function drawWalls(ctx, room, th) {
    for (let gx = 0; gx < COLS; gx++) {
      for (let gy = 0; gy < ROWS; gy++) {
        const isBorder = gx === 0 || gy === 0 || gx === COLS - 1 || gy === ROWS - 1;
        if (!isBorder) continue;
        const isDoor = room.doorAt(gx, gy);
        const x = gx * CELL, y = gy * CELL;
        if (isDoor) { ctx.fillStyle = '#0a0705'; ctx.fillRect(x, y, CELL, CELL); continue; }
        ctx.fillStyle = th.wall;
        ctx.fillRect(x, y, CELL, CELL);
        const s = (gx * 13 + gy * 7 + room.floor * 31) % 3;
        ctx.fillStyle = th.wallHi;
        ctx.fillRect(x + 4, y + 4, CELL - 8, CELL * 0.42);
        ctx.strokeStyle = th.wallEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
        if (s === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.07)';
          ctx.fillRect(x + 4, y + 4, CELL - 8, 5);
        }
        if (s === 2) {
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + CELL * 0.4, y);
          ctx.lineTo(x + CELL * 0.55, y + CELL * 0.5);
          ctx.lineTo(x + CELL * 0.35, y + CELL);
          ctx.stroke();
        }
      }
    }
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, CELL, W, 6);
    ctx.fillRect(0, H - CELL - 6, W, 6);
    ctx.fillRect(CELL, 0, 6, H);
    ctx.fillRect(W - CELL - 6, 0, 6, H);
    ctx.fillStyle = th.accent;
    ctx.fillRect(CELL + 8, CELL + 8, W - CELL * 2 - 16, H - CELL * 2 - 16);
    ctx.restore();
  }

  // 障碍物：石头 X / 坑 O / 尖刺 ^
  function drawProps(ctx, room) {
    for (let gy = 0; gy < room.propGrid.length; gy++) {
      for (let gx = 0; gx < room.propGrid[gy].length; gx++) {
        const c = room.propGrid[gy][gx];
        if (!c) continue;
        const { x, y } = cellCenter(gx + 1, gy + 1);
        if (c === 'X') drawRock(ctx, x, y, 19, room.floor);
        else if (c === 'O') drawPit(ctx, gx + 1, gy + 1);
        else if (c === '^') drawSpikes(ctx, x, y);
      }
    }
  }

  function drawRock(ctx, x, y, r, floor) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x + 3, y + 4, r * 1.1, r * 0.9, 0, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    const c1 = floor === 3 ? '#6a5c84' : '#8a7a5e';
    const c2 = floor === 3 ? '#3c334f' : '#52432e';
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(20,14,6,0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,14,6,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.5, y - r * 0.2); ctx.lineTo(x + r * 0.2, y + r * 0.1); ctx.lineTo(x - r * 0.1, y + r * 0.5);
    ctx.moveTo(x + r * 0.3, y - r * 0.55); ctx.lineTo(x + r * 0.55, y - r * 0.3);
    ctx.stroke();
  }

  function drawPit(ctx, gx, gy) {
    const { x, y } = cellCenter(gx, gy);
    ctx.fillStyle = '#0d0906';
    ctx.fillRect(x - CELL / 2 + 3, y - CELL / 2 + 3, CELL - 6, CELL - 6);
    ctx.strokeStyle = '#3a2c1c';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - CELL / 2 + 3, y - CELL / 2 + 3, CELL - 6, CELL - 6);
    ctx.fillStyle = '#2a1f14';
    for (let i = 0; i < 5; i++) {
      const px = x + (i * 11 - 22) + ((gy * 7 + i) % 5), py = y + ((i * 7) % 9) - 4;
      ctx.beginPath(); ctx.arc(px, py, 2.5, 0, TAU); ctx.fill();
    }
  }

  function drawSpikes(ctx, x, y) {
    for (let i = -1; i <= 1; i++) {
      const sx = x + i * 9;
      ctx.fillStyle = '#8d9396';
      ctx.beginPath();
      ctx.moveTo(sx - 6, y + 6);
      ctx.lineTo(sx, y - 7);
      ctx.lineTo(sx + 6, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3c4042';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#b7bcc0';
      ctx.beginPath(); ctx.arc(sx - 2, y + 2, 2, 0, TAU); ctx.fill();
    }
  }

  // 血渍（永久留在房间地板上）
  function addStain(room, x, y, big) {
    if (!room.stains) room.stains = [];
    room.stains.push({ x, y, r: rand(big ? 12 : 4, big ? 22 : 10), a: rand(0.25, 0.5) });
    if (room.stains.length > 60) room.stains.shift();
  }
  function drawStains(ctx, room) {
    if (!room.stains) return;
    for (const s of room.stains) {
      ctx.fillStyle = `rgba(120,20,12,${s.a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(60,8,6,${s.a * 0.6})`;
      ctx.beginPath(); ctx.arc(s.x + 2, s.y + 1, s.r * 0.6, 0, TAU); ctx.fill();
    }
  }

  function drawRoomAtmosphere(ctx, room, th) {
    ctx.save();
    ctx.fillStyle = th.ambient;
    ctx.fillRect(0, 0, W, H);
    const edge = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 430);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, th.fog);
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
    if (room.type === 'boss') {
      const glow = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 300);
      glow.addColorStop(0, 'rgba(220,40,40,0.06)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
    if (room.type === 'treasure') {
      const glow = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, 240);
      glow.addColorStop(0, 'rgba(255,220,120,0.08)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // ---------- 门 ----------
  function doorCenter(room, dir) {
    switch (dir) {
      case 'up': return { x: 7 * CELL + CELL / 2, y: 0 * CELL + CELL / 2 };
      case 'down': return { x: 7 * CELL + CELL / 2, y: 8 * CELL + CELL / 2 };
      case 'left': return { x: 0 * CELL + CELL / 2, y: 4 * CELL + CELL / 2 };
      case 'right': return { x: 14 * CELL + CELL / 2, y: 4 * CELL + CELL / 2 };
    }
  }

  function drawDoor(ctx, room, dir) {
    const d = room.doors[dir];
    if (!d) return;
    const { x: cx, y: cy } = doorCenter(room, dir);
    const x = cx - CELL / 2, y = cy - CELL / 2, w = CELL, h = CELL;
    const frame = d.type === 'boss' ? '#6a2020' : d.type === 'treasure' ? '#8a6a20' : '#4a3a26';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 2, y + 6, w - 4, h - 4);
    ctx.fillStyle = frame;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#120d08';
    ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
    ctx.font = '20px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (d.type === 'boss') {
      ctx.fillStyle = '#e8e2d0';
      ctx.fillText('☠', cx, cy + 2);
    } else if (d.type === 'treasure') {
      ctx.fillStyle = '#ffd76a';
      ctx.fillText('★', cx, cy + 1);
    }
    if (d.locked) {
      ctx.fillStyle = 'rgba(10,6,2,0.55)';
      ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
      ctx.fillStyle = '#c8b890';
      ctx.fillText('🔒', cx, cy + 2);
    } else if (d.closed) {
      ctx.fillStyle = '#4a3826';
      for (let i = 0; i < 4; i++) {
        const px = x + 8, pw = w - 16;
        ctx.fillRect(px, y + 6 + i * ((h - 12) / 4), pw, (h - 12) / 4 - 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(px + 4, y + 8 + i * ((h - 12) / 4), pw - 8, 2);
        ctx.fillStyle = '#4a3826';
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,200,0.10)';
      ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
      ctx.fillStyle = 'rgba(255,255,200,0.05)';
      ctx.fillRect(x + 10, y + 10, w - 20, 8);
    }
    if (dir === 'up' || dir === 'down') {
      ctx.fillStyle = '#120d08';
      ctx.beginPath(); ctx.ellipse(cx, y, 14, 7, 0, 0, Math.PI); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- 阴影 ----------
  function shadow(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(x, y + h * 0.32, w * 0.5, h * 0.2, 0, 0, TAU); ctx.fill();
  }

  // ---------- 玩家（大脑袋哭泣裸娃 — 更强轮廓与层次） ----------
  function drawPlayer(ctx, p) {
    if (p.dead) return;
    if (p.inv > 0 && Math.floor(p.inv * 20) % 2 === 0) return;
    const sc = p.size || 1;
    const x = p.x, y = p.y;
    const faceX = p.faceX || 0, faceY = p.faceY || 0;
    const moving = Math.abs(p.vx) > 5 || Math.abs(p.vy) > 5;
    const t = Game.time || 0;
    const bob = moving ? Math.sin(t * 13) * 2.7 : Math.sin(t * 4) * 0.7;
    const sq = moving ? 1 + Math.sin(t * 13) * 0.05 : 1;
    shadow(ctx, x, y + bob, 28 * sc, 11);
    if (p.flight) {
      const flap = Math.sin(t * 14) * 0.4;
      ctx.fillStyle = '#e8e4da';
      ctx.strokeStyle = '#4a4438';
      ctx.lineWidth = 2;
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(x + s * 9, y - 4 + bob);
        ctx.rotate(s * (0.28 + flap * 0.45));
        ctx.beginPath(); ctx.ellipse(0, -6, 11, 15, s * 0.5, 0, TAU);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
    const skin = p.redSkin ? '#e8a08a' : '#f2cf9f';
    const out = '#20170f';
    ctx.save();
    ctx.translate(x, y + 6 * sc + bob);
    ctx.scale(sq, 1 / sq);
    blob(ctx, 0, 0, 11.5 * sc, t * 0.3, 8, 0.18);
    ctx.fillStyle = skin; ctx.fill();
    ctx.strokeStyle = out; ctx.lineWidth = 3.5; ctx.stroke();
    sheen(ctx, 0, 0, 8.5 * sc, 8.5 * sc, 0.22);
    ctx.restore();
    ctx.save();
    ctx.translate(x, y - 5 * sc + bob);
    ctx.scale(1 / sq, sq);
    blob(ctx, 0, 0, 14.5 * sc, t * 0.7, 8, 0.15);
    ctx.fillStyle = skin; ctx.fill();
    ctx.strokeStyle = out; ctx.lineWidth = 3.5; ctx.stroke();
    sheen(ctx, 0, 0, 10 * sc, 10 * sc, 0.3);
    ctx.restore();
    const ey2 = y - 8 * sc + bob + faceY * 2;
    const ex2 = x + faceX * 4;
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.beginPath(); ctx.ellipse(ex2 - 5.5 * sc, ey2 + 0.5, 5.8 * sc, 5.2 * sc, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ex2 + 5.5 * sc, ey2 + 0.5, 5.8 * sc, 5.2 * sc, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(ex2 - 5.5 * sc, ey2, 4.5 * sc, 5.2 * sc, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ex2 + 5.5 * sc, ey2, 4.5 * sc, 5.2 * sc, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = out; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(ex2 - 5.5 * sc, ey2, 4.5 * sc, 5.2 * sc, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(ex2 + 5.5 * sc, ey2, 4.5 * sc, 5.2 * sc, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(ex2 - 5.5 * sc + faceX * 1.8, ey2 + faceY * 1.2, 2.2 * sc, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(ex2 + 5.5 * sc + faceX * 1.8, ey2 + faceY * 1.2, 2.2 * sc, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(ex2 - 4.4 * sc + faceX * 0.8, ey2 - 1.5 * sc, 1 * sc, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(ex2 + 6.1 * sc + faceX * 0.8, ey2 - 1.5 * sc, 1 * sc, 0, TAU); ctx.fill();
    ctx.strokeStyle = out; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(ex2 - 5.5 * sc, ey2 - 6 * sc, 4 * sc, 0.45, Math.PI - 0.45); ctx.stroke();
    ctx.beginPath(); ctx.arc(ex2 + 5.5 * sc, ey2 - 6 * sc, 4 * sc, 0.45, Math.PI - 0.45); ctx.stroke();
    ctx.strokeStyle = out; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(x + faceX * 2, y + 6 * sc + bob, 4.2 * sc, 0.2, Math.PI - 0.2); ctx.stroke();
    if (Math.sin(t * 6) > 0.2) {
      ctx.fillStyle = 'rgba(140,190,230,0.55)';
      ctx.beginPath(); ctx.ellipse(x + faceX * 8 + rand(-1.5, 1.5), y - 12 * sc + bob + Math.sin(t * 9) * 2, 2.5 * sc, 3.5 * sc, 0.1, 0, TAU); ctx.fill();
    }
    if (Math.sin(t * 6 + 1.5) > 0.3) {
      ctx.fillStyle = 'rgba(140,190,230,0.4)';
      ctx.beginPath(); ctx.ellipse(x + faceX * 10 + rand(-1, 1), y - 8 * sc + bob + Math.sin(t * 8) * 1.5, 1.8 * sc, 2.8 * sc, 0.15, 0, TAU); ctx.fill();
    }
    if (p.shield) {
      ctx.strokeStyle = 'rgba(160,220,255,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - 4 * sc, 28 * sc, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(160,220,255,0.10)';
      ctx.fill();
    }
    if (p.brimstone && p.brimCharge > 0) {
      const k = Math.min(1, p.brimCharge / 0.62);
      const gx = x + faceX * 10, gy = y - 2 * sc;
      ctx.strokeStyle = 'rgba(220,40,20,' + (0.4 + k * 0.5) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx, gy, 6 + k * 8, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(220,40,20,' + (0.25 + k * 0.5) + ')';
      ctx.beginPath(); ctx.arc(gx, gy, 4 + k * 6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff6040';
      ctx.beginPath(); ctx.arc(gx, gy, 2 + k * 3, 0, TAU); ctx.fill();
    }
    if (p.orbital > 0) {
      const orbA = p.orbitA || 0;
      for (let i = 0; i < p.orbital; i++) {
        const oa = orbA + (i / p.orbital) * TAU;
        const ox = x + Math.cos(oa) * 42, oy = y + Math.sin(oa) * 42;
        ctx.fillStyle = '#c84a38';
        ctx.strokeStyle = '#4a1410';
        ctx.lineWidth = 2;
        ctx.fillRect(ox - 8, oy - 8, 16, 16); ctx.strokeRect(ox - 8, oy - 8, 16, 16);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ox - 5, oy - 5); ctx.lineTo(ox - 2, oy - 2); ctx.stroke();
      }
    }
    if (p.aura === 'dark') {
      ctx.strokeStyle = 'rgba(160,20,20,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - 4 * sc, 24 * sc, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(160,20,20,0.08)';
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(20,10,8,0.18)';
    ctx.beginPath(); ctx.arc(x, y + 15, 12 * sc, 0, TAU); ctx.fill();
  }

  // 敌人外壳：阴影 + 受击白闪（lighter 混合模式 + 红光描边） + 具现化光环（参考原作）
  function drawEnemyShell(ctx, e) {
    shadow(ctx, e.x, e.y, e.r * 2, e.r);
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y + e.r * 0.22, e.r * 1.06, e.r * 0.8, 0, 0, TAU); ctx.fill();
    ctx.restore();
    if (e.hitFlash > 0) {
      ctx.save();
      e.__flashPhase = 'main';
    }
    if (e.spawnT > 0 && e.spawnT < e.spawnMax) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, e.spawnT * 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 8 + (1 - e.spawnT / e.spawnMax) * 14, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,180,0.08)';
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 3, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  function drawEnemyPostFlash(ctx, e) {
    if (e.hitFlash > 0) {
      ctx.restore();
      const a = Math.min(1, e.hitFlash * 5);
      // lighter 混合模式：整体发白 + 红光描边发光
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.4;
      ctx.fillStyle = '#ffd8d8';
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.02, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff0f0'; ctx.lineWidth = 3;
      ctx.shadowColor = '#ff6060'; ctx.shadowBlur = 12 * a;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.95, 0, TAU); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }
  function drawEnvelope(ctx, e) {
    drawEnemyPostFlash(ctx, e);
    ctx.globalAlpha = 1;
  }

  function drawGaper(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 14;
    // 身体（blob 有机形体）
    blob(ctx, x, y, 14 * s, e.seed, 8, 0.16);
    ctx.fillStyle = '#e6dcc8'; ctx.fill();
    ctx.strokeStyle = '#241c12'; ctx.lineWidth = 3; ctx.stroke();
    sheen(ctx, x, y, 10 * s, 10 * s, 0.3);
    // 头顶凹陷
    ctx.fillStyle = '#4a3420';
    ctx.beginPath(); ctx.arc(x - 3 * s, y - 10 * s, 5 * s, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
    // 眼窝阴影 + 杏仁眼
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(x - 5 * s, y - 3 * s, 5 * s, 4.5 * s, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 5 * s, y - 3 * s, 5 * s, 4.5 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(x - 5 * s, y - 3 * s, 4.5 * s, 5 * s, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 5 * s, y - 3 * s, 4.5 * s, 5 * s, 0, 0, TAU); ctx.fill();
    // 瞳孔追踪玩家
    const ang = Math.atan2(Game.player.y - y, Game.player.x - x);
    const px = Math.cos(ang) * 1.5 * s, py = Math.sin(ang) * 1.5 * s;
    ctx.fillStyle = '#1a1208';
    ctx.beginPath(); ctx.arc(x - 5 * s + px, y - 3 * s + py, 2.2 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 5 * s + px, y - 3 * s + py, 2.2 * s, 0, TAU); ctx.fill();
    // 嘴
    ctx.fillStyle = '#3a1210';
    ctx.beginPath(); ctx.ellipse(x, y + 7 * s, 7 * s, 6 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2efe6';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * 2.6 * s - 1.3 * s, y + 3 * s);
      ctx.lineTo(x + i * 2.6 * s, y + 8.5 * s);
      ctx.lineTo(x + i * 2.6 * s + 1.3 * s, y + 3 * s);
      ctx.closePath(); ctx.fill();
    }
    drawEnvelope(ctx, e);
  }

  function drawPooter(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 13;
    const bob = Math.sin(Game.time * 8 + e.seed) * 2;
    ctx.fillStyle = 'rgba(200,210,190,0.7)';
    ctx.strokeStyle = '#3a4230';
    ctx.lineWidth = 2;
    const flap = Math.sin(Game.time * 30 + e.seed) * 0.6;
    for (const sd of [-1, 1]) {
      ctx.save();
      ctx.translate(x + sd * 9 * s, y - 3 * s);
      ctx.rotate(sd * (0.5 + flap));
      ctx.beginPath(); ctx.ellipse(0, 0, 8 * s, 12 * s, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#5a6b4a';
    ctx.strokeStyle = '#22301c';
    ctx.lineWidth = 3;
    blob(ctx, x, y + bob, 11 * s, e.seed + Game.time * 0.4, 9, 0.2); ctx.fill(); ctx.stroke();
    sheen(ctx, x, y + bob, 8 * s, 7 * s, 0.28);
    ctx.fillStyle = '#b03028';
    ctx.beginPath(); ctx.arc(x, y + 8 * s + bob, 4 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 4 * s, y - 2 * s + bob, 2.6 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4 * s, y - 2 * s + bob, 2.6 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(x - 4 * s, y - 2 * s + bob, 1.2 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4 * s, y - 2 * s + bob, 1.2 * s, 0, TAU); ctx.fill();
    drawEnvelope(ctx, e);
  }

  function drawHorf(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 16;
    blob(ctx, x, y, 16 * s, e.seed + Game.time * 0.3, 9, 0.14);
    ctx.fillStyle = '#7a5a38'; ctx.fill();
    ctx.strokeStyle = '#33240f'; ctx.lineWidth = 3; ctx.stroke();
    sheen(ctx, x, y, 11 * s, 11 * s, 0.3);
    ctx.fillStyle = '#e8e0cc';
    ctx.beginPath(); ctx.arc(x - 5 * s, y - 6 * s, 3 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 5 * s, y - 6 * s, 3 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1208';
    ctx.beginPath(); ctx.arc(x - 5 * s, y - 6 * s, 1.4 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 5 * s, y - 6 * s, 1.4 * s, 0, TAU); ctx.fill();
    const maw = 0.5 + (e.attackAnim || 0) * 0.5;
    ctx.fillStyle = '#3d0f0a';
    ctx.beginPath(); ctx.ellipse(x, y + 4 * s, 11 * s * maw, 7 * s * maw, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2efe6';
    ctx.strokeStyle = '#33240f';
    ctx.lineWidth = 2;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * 3 * s - 1.5 * s, y + 2 * s);
      ctx.lineTo(x + i * 3 * s, y + 10 * s);
      ctx.lineTo(x + i * 3 * s + 1.5 * s, y + 2 * s);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    drawEnvelope(ctx, e);
  }

  function drawAttackFly(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 12;
    const flap = Math.sin(Game.time * 26 + e.seed) * 0.7;
    ctx.fillStyle = 'rgba(190,200,180,0.6)';
    ctx.strokeStyle = '#3a4230';
    ctx.lineWidth = 2;
    for (const sd of [-1, 1]) {
      ctx.save();
      ctx.translate(x + sd * 8 * s, y - 4 * s);
      ctx.rotate(sd * (0.6 + flap * 0.5));
      ctx.beginPath(); ctx.ellipse(0, 0, 7 * s, 11 * s, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    blob(ctx, x, y, 10 * s, e.seed + Game.time * 0.6, 9, 0.3);
    ctx.fillStyle = '#2e2a24'; ctx.fill();
    ctx.strokeStyle = '#0e0c08'; ctx.lineWidth = 3; ctx.stroke();
    sheen(ctx, x, y, 7 * s, 6 * s, 0.2);
    ctx.fillStyle = '#ff5040';
    ctx.beginPath(); ctx.arc(x - 4 * s, y - 2 * s, 3 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4 * s, y - 2 * s, 3 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3d0f08';
    ctx.beginPath(); ctx.arc(x - 4 * s, y - 2 * s, 1.4 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4 * s, y - 2 * s, 1.4 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8e2cc';
    ctx.beginPath(); ctx.moveTo(x - 4 * s, y + 4 * s); ctx.lineTo(x - 2 * s, y + 8 * s); ctx.lineTo(x, y + 4 * s); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 4 * s, y + 4 * s); ctx.lineTo(x + 2 * s, y + 8 * s); ctx.lineTo(x, y + 4 * s); ctx.closePath(); ctx.fill();
    drawEnvelope(ctx, e);
  }

  function drawBoomFly(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 13;
    const pulse = 0.5 + Math.sin(Game.time * 10 + e.seed) * 0.5;
    ctx.fillStyle = 'rgba(200,190,160,0.5)';
    ctx.lineWidth = 2;
    for (const sd of [-1, 1]) {
      ctx.save();
      ctx.translate(x + sd * 9 * s, y - 5 * s);
      ctx.beginPath(); ctx.ellipse(0, 0, 6 * s, 10 * s, 0.4, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    blob(ctx, x, y, 12 * s, e.seed + Game.time * 0.5, 9, 0.2);
    ctx.fillStyle = '#4a3a28'; ctx.fill();
    ctx.strokeStyle = '#1e1408'; ctx.lineWidth = 3; ctx.stroke();
    sheen(ctx, x, y, 8 * s, 8 * s, 0.22);
    const g = ctx.createRadialGradient(x, y, 1, x, y, 9 * s);
    g.addColorStop(0, `rgba(255,120,40,${0.5 + pulse * 0.4})`);
    g.addColorStop(1, 'rgba(120,30,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 9 * s, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#c8b890';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 12 * s); ctx.quadraticCurveTo(x + 5 * s, y - 18 * s, x - 2 * s, y - 20 * s); ctx.stroke();
    drawEnvelope(ctx, e);
  }

  function drawKnight(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 15;
    const fx = e.facing || 1;
    ctx.fillStyle = '#7c8288';
    ctx.strokeStyle = '#23262a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 14 * s, 0, TAU); ctx.fill(); ctx.stroke();
    sheen(ctx, x, y, 10 * s, 10 * s, 0.3);
    const sx = x + fx * 3 * s;
    ctx.fillStyle = '#4c5156';
    ctx.fillRect(sx - 8 * s, y - 9 * s, 16 * s, 14 * s);
    ctx.fillStyle = '#191c20';
    ctx.fillRect(sx + fx * 2 * s, y - 6 * s, 8 * s, 9 * s);
    ctx.strokeStyle = '#23262a';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 8 * s, y - 9 * s, 16 * s, 14 * s);
    ctx.fillStyle = '#a03030';
    ctx.beginPath(); ctx.moveTo(x, y - 9 * s); ctx.lineTo(x - 4 * s, y - 18 * s); ctx.lineTo(x + 4 * s, y - 14 * s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a3a28';
    ctx.strokeStyle = '#23262a';
    ctx.lineWidth = 2.5;
    const shx = x - fx * 14 * s;
    rr(ctx, shx - 5 * s, y - 4 * s, 11 * s, 16 * s, 4);
    ctx.fill(); ctx.stroke();
    drawEnvelope(ctx, e);
  }

  // 血块：暗红肉块 + 四向散射口
  function drawClotty(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 14;
    blob(ctx, x, y, 13 * s, e.seed + Game.time * 0.5, 8, 0.22);
    ctx.fillStyle = '#a8322c'; ctx.fill();
    ctx.strokeStyle = '#3a0f0c'; ctx.lineWidth = 3; ctx.stroke();
    sheen(ctx, x, y, 9 * s, 9 * s, 0.3);
    blob(ctx, x - 8 * s, y + 2 * s, 6 * s, e.seed + 2, 7, 0.3); ctx.fill(); ctx.stroke();
    blob(ctx, x + 8 * s, y + 1 * s, 5.5 * s, e.seed + 4, 7, 0.3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 4 * s, y - 5 * s, 3.6 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4 * s, y - 5 * s, 3.6 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1208';
    ctx.beginPath(); ctx.arc(x - 4 * s, y - 5 * s, 1.7 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4 * s, y - 5 * s, 1.7 * s, 0, TAU); ctx.fill();
    const maw = 0.5 + (e.attackAnim || 0) * 0.5;
    ctx.fillStyle = '#5a0f0c';
    ctx.beginPath(); ctx.ellipse(x, y + 6 * s, 8 * s * maw, 5 * s * maw, 0, 0, TAU); ctx.fill();
    drawEnvelope(ctx, e);
  }

  // 跳虫：绿色幼虫，压缩蓄力时横向压扁
  function drawHopper(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 13;
    const sq = e.squash || 0;
    const sy = 1 - sq * 0.45, sx = 1 + sq * 0.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    blob(ctx, 0, 0, 11.5 * s, e.seed + Game.time * 0.5, 9, 0.24);
    ctx.fillStyle = '#7fae5a'; ctx.fill();
    ctx.strokeStyle = '#2a4018'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = '#3f6126';
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(i * 4 * s, -9 * s); ctx.lineTo(i * 4 * s, 9 * s); ctx.stroke();
    }
    ctx.restore();
    sheen(ctx, x, y, 9 * s, 8 * s, 0.26);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 4 * s, y - 5 * s, 3.4 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4 * s, y - 5 * s, 3.4 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1208';
    ctx.beginPath(); ctx.arc(x - 4 * s, y - 5 * s, 1.6 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4 * s, y - 5 * s, 1.6 * s, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2a4018';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 5 * s, y - 10 * s); ctx.lineTo(x - 8 * s, y - 14 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 5 * s, y - 10 * s); ctx.lineTo(x + 8 * s, y - 14 * s); ctx.stroke();
    drawEnvelope(ctx, e);
  }

  // 血口：深紫巨口 + 环状利齿
  function drawMaw(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 16;
    blob(ctx, x, y, 16 * s, e.seed + Game.time * 0.4, 8, 0.18);
    ctx.fillStyle = '#6b3550'; ctx.fill();
    ctx.strokeStyle = '#24101c'; ctx.lineWidth = 3; ctx.stroke();
    sheen(ctx, x, y, 11 * s, 11 * s, 0.32);
    const maw = 0.35 + (e.maw || 0.6) * 0.65;
    ctx.fillStyle = '#17060f';
    ctx.beginPath(); ctx.ellipse(x, y + 2 * s, 11 * s * maw, 9 * s * maw, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8e0cc';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.save();
      ctx.translate(x + Math.cos(a) * 10 * s * maw, y + 2 * s + Math.sin(a) * 8 * s * maw);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, -2.4 * s); ctx.lineTo(1.4 * s, 2.2 * s); ctx.lineTo(-1.4 * s, 2.2 * s); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    drawEnvelope(ctx, e);
  }

  // 泥人：绿色黏怪，复活后颜色更深
  function drawGlobin(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 13;
    ctx.save();
    ctx.translate(x, y + 2 * s); ctx.scale(1.08, 0.9);
    blob(ctx, 0, 0, 11 * s, e.seed + Game.time * 0.45, 9, 0.24);
    ctx.fillStyle = e.revived ? '#6aa43a' : '#8fc45a'; ctx.fill();
    ctx.strokeStyle = e.revived ? '#2f4a14' : '#3c5c1e'; ctx.lineWidth = 3; ctx.stroke();
    blob(ctx, -7 * s, 1 * s, 4.5 * s, e.seed + 1, 7, 0.3); ctx.fill(); ctx.stroke();
    blob(ctx, 7 * s, 0, 4 * s, e.seed + 2, 7, 0.3); ctx.fill(); ctx.stroke();
    ctx.restore();
    sheen(ctx, x, y - 1 * s, 8 * s, 7 * s, 0.3);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 4 * s, y - 4 * s, 3.4 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4 * s, y - 4 * s, 3.4 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a1a08';
    ctx.beginPath(); ctx.arc(x - 4 * s, y - 4 * s, 1.7 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4 * s, y - 4 * s, 1.7 * s, 0, TAU); ctx.fill();
    drawEnvelope(ctx, e);
  }

  // ---------- Boss ----------
  function drawMonstro(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 30;
    const squash = e.squash || 0;
    const bw = 30 * s * (1 + squash * 0.4), bh = 30 * s * (1 - squash * 0.35);
    shadow(ctx, x, y + bh * 0.2, bw, bh);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + squash * 0.4, 1 - squash * 0.35);
    blob(ctx, 0, 0, 15 * s, e.seed + Game.time * 0.35, 10, 0.16);
    ctx.fillStyle = '#8a5a3a'; ctx.fill();
    ctx.strokeStyle = '#3a2410'; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
    sheen(ctx, x, y, 20 * s, 20 * s, 0.3);
    ctx.fillStyle = '#e8e0cc';
    ctx.beginPath(); ctx.arc(x - 9 * s, y - 12 * s, 5 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 9 * s, y - 12 * s, 5 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1208';
    ctx.beginPath(); ctx.arc(x - 9 * s, y - 12 * s, 2.4 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 9 * s, y - 12 * s, 2.4 * s, 0, TAU); ctx.fill();
    const maw = e.maw || 0.6;
    ctx.fillStyle = '#4a0f08';
    ctx.beginPath(); ctx.ellipse(x, y + 6 * s, 20 * s * maw, 13 * s * maw, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2efe6';
    ctx.strokeStyle = '#3a2410';
    ctx.lineWidth = 2;
    for (let i = -7; i <= 7; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * 2.7 * s - 1.3 * s, y + (2 - 13 * maw) * s);
      ctx.lineTo(x + i * 2.7 * s, y + (8 - 6 * maw) * s);
      ctx.lineTo(x + i * 2.7 * s + 1.3 * s, y + (2 - 13 * maw) * s);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    drawEnvelope(ctx, e);
  }

  function drawDuke(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 26;
    const bob = Math.sin(Game.time * 6 + e.seed) * 3;
    const flap = Math.sin(Game.time * 12 + e.seed) * 0.5;
    ctx.fillStyle = 'rgba(170,180,150,0.65)';
    ctx.strokeStyle = '#2e3826';
    ctx.lineWidth = 3;
    for (const sd of [-1, 1]) {
      ctx.save();
      ctx.translate(x + sd * 16 * s, y - 6 * s + bob);
      ctx.rotate(sd * (0.5 + flap));
      ctx.beginPath(); ctx.ellipse(0, 0, 12 * s, 20 * s, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(x, y + bob); ctx.scale(1.2, 1);
    blob(ctx, 0, 0, 20 * s, e.seed + Game.time * 0.4, 10, 0.15);
    ctx.fillStyle = '#4a4638'; ctx.fill();
    ctx.strokeStyle = '#141208'; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
    sheen(ctx, x, y + bob, 17 * s, 15 * s, 0.3);
    ctx.fillStyle = '#6a5a30';
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * 14 * s, y + bob + Math.sin(a) * 10 * s, 4 * s, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#c02018';
    ctx.beginPath(); ctx.arc(x - 7 * s, y - 6 * s + bob, 4 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 7 * s, y - 6 * s + bob, 4 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a0806';
    ctx.beginPath(); ctx.arc(x - 7 * s, y - 6 * s + bob, 1.8 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 7 * s, y - 6 * s + bob, 1.8 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c8a040';
    ctx.strokeStyle = '#5a4210';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 12 * s, y - 18 * s + bob);
    ctx.lineTo(x - 12 * s, y - 30 * s + bob);
    ctx.lineTo(x - 6 * s, y - 22 * s + bob);
    ctx.lineTo(x, y - 32 * s + bob);
    ctx.lineTo(x + 6 * s, y - 22 * s + bob);
    ctx.lineTo(x + 12 * s, y - 30 * s + bob);
    ctx.lineTo(x + 12 * s, y - 18 * s + bob);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    drawEnvelope(ctx, e);
  }

  // Mom：巨足（从屏幕顶踩下）+ 门缝里的眼睛
  function drawMomFoot(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y;
    const stretch = e.stretch || 0;
    shadow(ctx, x, y + 40, 90, 20);
    ctx.fillStyle = '#e8b48c';
    ctx.strokeStyle = '#4a2a18';
    ctx.lineWidth = 4;
    const legH = 130 * stretch;
    rr(ctx, x - 16, y - 40 - legH, 32, legH + 40, 8);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8e4da';
    rr(ctx, x - 15, y - 34 - legH * 0.6, 30, legH * 0.6, 6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8a1c14';
    ctx.strokeStyle = '#3a0a06';
    ctx.lineWidth = 3;
    rr(ctx, x - 42, y - 14, 84, 26, 10);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6a120c';
    rr(ctx, x - 42, y + 4, 84, 8, 4);
    ctx.fill();
    ctx.fillStyle = '#7a1812';
    rr(ctx, x + 24, y + 12, 18, 14, 3);
    ctx.fill(); ctx.stroke();
    drawEnvelope(ctx, e);
  }

  function drawMomEye(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 16;
    blob(ctx, x, y, 18 * s, e.seed + Game.time * 0.3, 10, 0.12);
    ctx.fillStyle = '#8a5a3a'; ctx.fill();
    ctx.strokeStyle = '#3a2410'; ctx.lineWidth = 4; ctx.stroke();
    sheen(ctx, x, y, 13 * s, 13 * s, 0.3);
    ctx.fillStyle = '#e8e0cc';
    ctx.beginPath(); ctx.arc(x, y, 13 * s, 0, TAU); ctx.fill();
    const ex = x + clamp((Game.player.x - x) * 0.06, -7 * s, 7 * s);
    const ey = y + clamp((Game.player.y - y) * 0.06, -7 * s, 7 * s);
    ctx.fillStyle = '#a02018';
    ctx.beginPath(); ctx.arc(ex, ey, 8 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a0a06';
    ctx.beginPath(); ctx.arc(ex, ey, 4 * s, 0, TAU); ctx.fill();
    drawEnvelope(ctx, e);
  }

  // Larry Jr 蠕虫：分段身体 + 蛇形游走
  function drawLarry(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y;
    const segs = e.segs || [];
    const colors = ['#8fae3c', '#7a9c30', '#668a26', '#548026'];
    for (let i = segs.length - 1; i >= 1; i--) { // 0 段与头部位置重合，跳过
      const sg = segs[i];
      const r = 13 - i * 1.5;
      blob(ctx, sg.x, sg.y, r, e.seed + i * 3 + Game.time * 0.3, 8, 0.2);
      ctx.fillStyle = colors[i % colors.length]; ctx.fill();
      ctx.strokeStyle = '#2a3a10'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#3c5418';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(sg.x, sg.y, r * 0.6, r * 0.35, 0, 0, TAU); ctx.stroke();
    }
    // 头部
    blob(ctx, x, y, 18, e.seed + Game.time * 0.4, 9, 0.14);
    ctx.fillStyle = '#a8c848'; ctx.fill();
    ctx.strokeStyle = '#2a3a10'; ctx.lineWidth = 3; ctx.stroke();
    sheen(ctx, x, y, 13, 13, 0.32);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 6, y - 4, 4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 6, y - 4, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1208';
    ctx.beginPath(); ctx.arc(x - 6, y - 4, 2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 6, y - 4, 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2a3a10';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x - 7, y - 16); ctx.lineTo(x - 11, y - 24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 7, y - 16); ctx.lineTo(x + 11, y - 24); ctx.stroke();
    drawEnvelope(ctx, e);
  }

  // Gurdy 肉瘤墙：巨大血肉墙 + 环状利齿大口
  function drawGurdy(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 42;
    shadow(ctx, x + 4, y + 6, e.r * 1.2, e.r * 0.5);
    blob(ctx, x, y, 40 * s, e.seed, 11, 0.1);
    ctx.fillStyle = '#c0544a'; ctx.fill();
    ctx.strokeStyle = '#3a1010'; ctx.lineWidth = 4; ctx.stroke();
    sheen(ctx, x, y, 28 * s, 28 * s, 0.28);
    ctx.fillStyle = '#a8453c';
    for (const [ox, oy, or] of [[-24, -14, 9], [20, -20, 8], [26, 12, 10], [-18, 22, 7], [6, 26, 6]]) {
      ctx.beginPath(); ctx.arc(x + ox * s, y + oy * s, or * s, 0, TAU); ctx.fill(); ctx.stroke();
    }
    const maw = 0.3 + (e.maw || 0.6) * 0.5;
    ctx.fillStyle = '#2a0808';
    ctx.beginPath(); ctx.ellipse(x, y, 26 * s * maw, 22 * s * maw, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2e8d0';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ctx.save();
      ctx.translate(x + Math.cos(a) * 24 * s * maw, y + Math.sin(a) * 20 * s * maw);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, -3 * s); ctx.lineTo(1.8 * s, 3 * s); ctx.lineTo(-1.8 * s, 3 * s); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 18 * s, y - 20 * s, 5 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 18 * s, y - 20 * s, 5 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1208';
    ctx.beginPath(); ctx.arc(x - 18 * s, y - 20 * s, 2.4 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 18 * s, y - 20 * s, 2.4 * s, 0, TAU); ctx.fill();
    drawEnvelope(ctx, e);
  }

  // Vis 巨眼怪：单颗巨眼，锁定蓄力时瞳孔充血发亮（发射血激光前兆）
  function drawVis(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 16;
    const charge = e.maw || 0;
    const ang = Math.atan2(Game.player.y - y, Game.player.x - x);
    shadow(ctx, x + 3, y + 5, e.r * 1.9, e.r * 0.8);
    blob(ctx, x, y, 17 * s, e.seed + Game.time * 0.2, 10, 0.13);
    ctx.fillStyle = '#7a6a4a'; ctx.fill();
    ctx.strokeStyle = '#2e2412'; ctx.lineWidth = 4; ctx.stroke();
    sheen(ctx, x, y, 12 * s, 12 * s, 0.22);
    // 眼皮褶皱
    ctx.strokeStyle = '#3a2e18';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 13 * s, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 13 * s, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke();
    // 眼球（蓄力时充血变红、瞳孔放大）
    const bleed = Math.min(1, charge * 1.4);
    ctx.fillStyle = bleed > 0.5 ? '#e8d8c0' : '#f2ecdc';
    ctx.beginPath(); ctx.arc(x, y, 12 * s, 0, TAU); ctx.fill();
    const ex = x + Math.cos(ang) * 3.5 * s;
    const ey = y + Math.sin(ang) * 3.5 * s;
    ctx.fillStyle = `rgb(${150 + bleed * 100},${40 - bleed * 20},${30 - bleed * 10})`;
    ctx.beginPath(); ctx.arc(ex, ey, (7 + charge * 2.5) * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#20080a';
    ctx.beginPath(); ctx.arc(ex, ey, (3.4 + charge * 1.8) * s, 0, TAU); ctx.fill();
    // 蓄力时瞳孔高光 + 红色能量环
    if (bleed > 0.3) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(ex - 2 * s, ey - 2 * s, 1.6 * s, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255,50,30,${bleed * 0.8})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, (15 + charge * 6) * s, 0, TAU); ctx.stroke();
    }
    drawEnvelope(ctx, e);
  }

  // Chub 冲锋虫：虫头 + 3 段带刺身体，蓄力压缩、直冲甩头
  function drawChub(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y;
    const segs = e.segs || [];
    const squash = e.squash || 0;
    // 身体段（尾部→前部）
    const colors = ['#a85038', '#8e3e2c', '#74301f'];
    for (let i = segs.length - 1; i >= 1; i--) {
      const sg = segs[i];
      const r = 15 - i * 2.2;
      blob(ctx, sg.x, sg.y, r, e.seed + i * 2.6, 8, 0.2);
      ctx.fillStyle = colors[(i - 1) % colors.length]; ctx.fill();
      ctx.strokeStyle = '#2a1008'; ctx.lineWidth = 3; ctx.stroke();
      // 背刺
      ctx.fillStyle = '#f2e0c0';
      for (const [ox, oy, rot] of [[-5, -r, -0.5], [5, -r, 0.5]]) {
        ctx.save();
        ctx.translate(sg.x + ox, sg.y + oy);
        ctx.rotate(rot);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(3, -7); ctx.lineTo(-3, -7); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    // 头部（蓄力压缩变扁、冲刺时拉长）
    const headW = (1 + Math.max(0, squash) * 0.35) * 22;
    const headH = (1 - Math.max(0, squash) * 0.25) * 22;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(headW / 22, headH / 22);
    blob(ctx, 0, 0, 11, e.seed + Game.time * 0.3, 9, 0.16);
    ctx.fillStyle = '#c05a40'; ctx.fill();
    ctx.strokeStyle = '#2a1008'; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
    sheen(ctx, x, y, 15, 15, 0.3);
    // 血盆大口（朝向玩家）
    const fa = Math.atan2(Game.player.y - y, Game.player.x - x);
    const mx = x + Math.cos(fa) * 13, my = y + Math.sin(fa) * 13;
    const maw = e.squash < 0 ? 1 : 0.35 + Math.max(0, squash) * 0.6;
    ctx.fillStyle = '#3a0804';
    ctx.beginPath(); ctx.ellipse(mx, my, 12 * maw, 9 * maw, fa, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2efe6';
    ctx.strokeStyle = '#2a1008';
    ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) {
      ctx.save();
      ctx.translate(mx + Math.cos(fa + Math.PI / 2) * i * 4, my + Math.sin(fa + Math.PI / 2) * i * 4);
      ctx.rotate(fa);
      ctx.beginPath(); ctx.moveTo(-3, -2); ctx.lineTo(0, 5); ctx.lineTo(3, -2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // 小眼睛
    const ex0 = x + Math.cos(fa - 0.7) * 12, ey0 = y + Math.sin(fa - 0.7) * 12;
    const ex1 = x + Math.cos(fa + 0.7) * 12, ey1 = y + Math.sin(fa + 0.7) * 12;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex0, ey0, 3.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(ex1, ey1, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a0a06';
    ctx.beginPath(); ctx.arc(ex0, ey0, 1.7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(ex1, ey1, 1.7, 0, TAU); ctx.fill();
    drawEnvelope(ctx, e);
  }

  // Monstro II：巨型肉山，血盆大口 + 满口獠牙，跳压/扫射时神态狰狞
  function drawMonstro2(ctx, e) {
    drawEnemyShell(ctx, e);
    const x = e.x, y = e.y, s = e.r / 30;
    const squash = e.squash || 0;
    const bw = 32 * s * (1 + squash * 0.4), bh = 32 * s * (1 - squash * 0.35);
    shadow(ctx, x, y + bh * 0.2, bw, bh);
    const enrage = e.hp < e.maxHp * 0.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + squash * 0.4, 1 - squash * 0.35);
    blob(ctx, 0, 0, 16 * s, e.seed, 11, 0.12);
    ctx.fillStyle = enrage ? '#9a2c1e' : '#8a4232'; ctx.fill();
    ctx.strokeStyle = '#2a0f06'; ctx.lineWidth = 5; ctx.stroke();
    ctx.restore();
    sheen(ctx, x, y, 22 * s, 22 * s, 0.28);
    // 背刺/角
    ctx.fillStyle = '#f2dcc0';
    for (const [ox, oy, rot] of [[-20, -22, -0.7], [0, -26, 0], [20, -22, 0.7]]) {
      ctx.save();
      ctx.translate(x + ox * s, y + oy * s);
      ctx.rotate(rot);
      ctx.beginPath(); ctx.moveTo(-4, 6); ctx.lineTo(0, -12); ctx.lineTo(4, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // 眼睛（怒视）
    const gx = clamp((Game.player.x - x) * 0.08, -4, 4) * s;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 10 * s + gx, y - 12 * s, 5.5 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 10 * s + gx, y - 12 * s, 5.5 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = enrage ? '#c02010' : '#1a0a06';
    ctx.beginPath(); ctx.arc(x - 10 * s + gx * 1.6, y - 12 * s, 2.8 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 10 * s + gx * 1.6, y - 12 * s, 2.8 * s, 0, TAU); ctx.fill();
    // 血盆大口（扫射激光时完全张开）
    const maw = e.maw || 0.6;
    ctx.fillStyle = '#3a0604';
    ctx.beginPath(); ctx.ellipse(x, y + 8 * s, 22 * s * maw, 16 * s * maw, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2efe6';
    ctx.strokeStyle = '#2a0f06';
    ctx.lineWidth = 2;
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * 2.6 * s - 1.2 * s, y + (4 - 15 * maw) * s);
      ctx.lineTo(x + i * 2.6 * s, y + (10 - 7 * maw) * s);
      ctx.lineTo(x + i * 2.6 * s + 1.2 * s, y + (4 - 15 * maw) * s);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // 扫射蓄力红光
    if (maw > 0.85) {
      ctx.strokeStyle = `rgba(255,60,30,${0.35 + Math.sin(Game.time * 18) * 0.2})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, (e.r + 8) * (1 + (maw - 0.85) * 0.5), 0, TAU); ctx.stroke();
    }
    drawEnvelope(ctx, e);
  }

  // ---------- 眼泪 ----------
  function drawTear(ctx, t) {
    if (t.owner === 'enemy') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,120,145,0.55)';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 1.2, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#e05570';
      ctx.strokeStyle = '#5a0a18';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.3, 0, TAU); ctx.fill();
      return;
    }
    if (t.laser) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = t.brim ? 'rgba(230,40,20,0.95)' : 'rgba(255,60,40,0.9)';
      ctx.lineWidth = t.brim ? 8 : 5;
      ctx.beginPath();
      ctx.moveTo(t.x - t.vx * 0.02, t.y - t.vy * 0.02);
      ctx.lineTo(t.x - t.vx * 0.2, t.y - t.vy * 0.2);
      ctx.stroke();
      ctx.strokeStyle = t.brim ? 'rgba(255,170,90,0.9)' : 'rgba(255,220,190,0.82)';
      ctx.lineWidth = t.brim ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(t.x - t.vx * 0.02, t.y - t.vy * 0.02);
      ctx.lineTo(t.x - t.vx * 0.2, t.y - t.vy * 0.2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const h = Math.sin(t.h * Math.PI) * 6;
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath(); ctx.ellipse(t.x, t.y + 4, t.r * 0.9, 2, 0, 0, TAU); ctx.fill();
    if (t.tooth) {
      ctx.fillStyle = '#f2efe6';
      ctx.strokeStyle = '#5a5a52';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y - h - t.r * 0.7);
      ctx.lineTo(t.x - t.r * 0.6, t.y - h + t.r * 0.4);
      ctx.lineTo(t.x + t.r * 0.6, t.y - h + t.r * 0.4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = t.explosive ? 'rgba(210,230,110,0.55)' : 'rgba(210,235,250,0.5)';
    ctx.beginPath(); ctx.arc(t.x, t.y - h, t.r * 1.1, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = t.explosive ? '#c8e060' : '#d8eef8';
    ctx.strokeStyle = t.explosive ? '#5a6a10' : '#5a7a8a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(t.x, t.y - h, t.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - h - t.r * 0.3, t.r * 0.32, 0, TAU); ctx.fill();
    if (t.explosive) {
      ctx.strokeStyle = '#5a6a10';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(t.x, t.y - h - t.r); ctx.quadraticCurveTo(t.x + 5, t.y - h - t.r - 5, t.x + 8, t.y - h - t.r - 2); ctx.stroke();
    }
  }

  // ---------- 拾取物 ----------
  function drawHeart(ctx, x, y, filled, size) {
    const s = size || 8;
    ctx.save();
    ctx.shadowColor = filled ? 'rgba(255,80,80,0.35)' : 'transparent';
    ctx.shadowBlur = filled ? 6 : 0;
    ctx.fillStyle = filled ? (s > 10 ? '#c83232' : '#e04040') : '#1a1410';
    ctx.strokeStyle = filled ? '#5a0e0a' : '#0a0706';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.2, y + s * 0.1, x - s * 0.7, y - s * 0.9, x, y - s * 0.25);
    ctx.bezierCurveTo(x + s * 0.7, y - s * 0.9, x + s * 1.2, y + s * 0.1, x, y + s * 0.9);
    ctx.fill(); ctx.stroke();
    if (filled) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(x - s * 0.35, y - s * 0.35, s * 0.18, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawPickup(ctx, p) {
    const bob = Math.sin(Game.time * 4 + p.seed) * 3;
    const x = p.x, y = p.y + bob;
    if (p.type === 'heart') {
      drawHeart(ctx, x, y, true, 9);
    } else if (p.type === 'halfheart') {
      ctx.fillStyle = '#e04040';
      ctx.strokeStyle = '#5a0e0a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y + 8);
      ctx.bezierCurveTo(x - 11, y + 1, x - 6, y - 8, x, y - 2);
      ctx.lineTo(x, y + 8);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (p.type === 'coin') {
      const spin = Math.sin(Game.time * 6 + p.seed);
      ctx.save();
      ctx.shadowColor = 'rgba(255,210,80,0.35)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#e8b93a';
      ctx.strokeStyle = '#7a5410';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(x, y, 8, 8 * Math.max(0.25, Math.abs(spin)), 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (Math.abs(spin) > 0.5) {
        ctx.fillStyle = '#7a5410';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('¢', x, y + 1);
      }
    } else if (p.type === 'key') {
      ctx.fillStyle = '#e8b93a';
      ctx.strokeStyle = '#7a5410';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x - 6, y, 5, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x - 6, y, 2, 0, TAU); ctx.fill();
      ctx.fillRect(x - 2, y - 2, 12, 4);
      ctx.beginPath();
      ctx.moveTo(x + 10, y - 2); ctx.lineTo(x + 14, y - 7); ctx.lineTo(x + 14, y - 2); ctx.closePath();
      ctx.moveTo(x + 10, y + 2); ctx.lineTo(x + 14, y + 7); ctx.lineTo(x + 14, y + 2); ctx.closePath();
      ctx.fill();
    } else if (p.type === 'item') {
      drawPedestal(ctx, x, y);
      const it = ITEMS[p.itemId];
      if (it) drawItemIcon(ctx, it, x, y - 8, 14);
    } else if (p.type === 'trapdoor') {
      const pulse = 0.6 + Math.sin(Game.time * 6 + p.seed) * 0.4;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.ellipse(x, y + 8, 22, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a2418';
      ctx.strokeStyle = '#1a0e06';
      ctx.lineWidth = 2.5;
      rr(ctx, x - 20, y - 16, 40, 30, 4);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#1a0e06';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 20, y - 1); ctx.lineTo(x + 20, y - 1);
      ctx.moveTo(x - 8, y - 16); ctx.lineTo(x - 8, y - 1);
      ctx.moveTo(x + 8, y - 16); ctx.lineTo(x + 8, y - 1);
      ctx.stroke();
      ctx.fillStyle = '#6a4a2c';
      ctx.fillRect(x - 12, y + 2, 24, 8);
      ctx.strokeStyle = `rgba(255,220,120,${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y - 6, 24, 14, 0, 0, TAU); ctx.stroke();
    }
  }

  function drawPedestal(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + 12, 16, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a3a42';
    ctx.strokeStyle = '#14141a';
    ctx.lineWidth = 2;
    rr(ctx, x - 13, y - 4, 26, 12, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#56565e';
    rr(ctx, x - 17, y - 9, 34, 8, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x - 15, y - 7, 30, 3);
    ctx.restore();
  }

  function drawChest(ctx, x, y, gold) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + 12, 20, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = gold ? '#c8a040' : '#7a5230';
    ctx.strokeStyle = '#241606';
    ctx.lineWidth = 2.5;
    rr(ctx, x - 20, y - 8, 40, 20, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = gold ? '#e0b858' : '#96683c';
    ctx.beginPath();
    ctx.moveTo(x - 20, y - 8);
    ctx.quadraticCurveTo(x, y - 20, x + 20, y - 8);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8c860';
    ctx.fillRect(x - 4, y - 4, 8, 9);
    ctx.fillStyle = '#5a4210';
    ctx.fillRect(x - 1.5, y - 4, 3, 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 12); ctx.stroke();
    if (gold) {
      ctx.strokeStyle = 'rgba(255,220,120,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - 2, 26, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- 道具图标（程序化） ----------
  function drawItemIcon(ctx, it, x, y, s) {
    const c = it.color || '#fff';
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(10,8,6,0.9)';
    ctx.strokeStyle = '#3a2c1c';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c;
    ctx.strokeStyle = 'rgba(20,10,0,0.9)';
    ctx.lineWidth = 1.6;
    switch (it.icon) {
      case 'onion':
        ctx.beginPath(); ctx.arc(0, 1, s * 0.6, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-2, -s * 0.6); ctx.lineTo(0, -s * 0.95); ctx.lineTo(2, -s * 0.55); ctx.stroke();
        break;
      case 'number':
        ctx.font = `bold ${s * 1.3}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('1', 0, 0); break;
      case 'cricket':
        ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s * 0.55, -s * 0.3); ctx.lineTo(-s * 0.95, -s * 0.6); ctx.lineTo(-s * 0.5, -s * 0.62); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.55, -s * 0.3); ctx.lineTo(s * 0.95, -s * 0.6); ctx.lineTo(s * 0.5, -s * 0.62); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'martyr':
        ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, s * 0.9); ctx.lineTo(-s * 0.25, s * 0.4); ctx.lineTo(0, s * 0.55); ctx.lineTo(s * 0.25, s * 0.4); ctx.closePath(); ctx.fill();
        break;
      case 'steven':
        ctx.fillRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2); ctx.strokeRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
        ctx.beginPath(); ctx.arc(0, 0, s * 0.3, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      case 'speed':
        ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.8, -0.6, 0.6); ctx.stroke();
        break;
      case 'belt':
        ctx.fillRect(-s * 0.7, -s * 0.3, s * 1.4, s * 0.6); ctx.strokeRect(-s * 0.7, -s * 0.3, s * 1.4, s * 0.6);
        ctx.fillRect(-s * 0.18, -s * 0.45, s * 0.36, s * 0.9);
        break;
      case 'breakfast':
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.8, s * 0.6, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffd76a'; ctx.beginPath(); ctx.arc(0, -1, s * 0.35, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      case 'mushroom':
        ctx.beginPath(); ctx.arc(0, -s * 0.1, s * 0.7, Math.PI, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e8dcc8'; ctx.fillRect(-s * 0.2, -s * 0.1, s * 0.4, s * 0.7);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(-s * 0.3, -s * 0.3, s * 0.12, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.2, -s * 0.42, s * 0.1, 0, TAU); ctx.fill();
        break;
      case 'pit':
        ctx.beginPath();
        ctx.moveTo(-s * 0.15, 0); ctx.lineTo(-s * 0.95, -s * 0.5); ctx.lineTo(-s * 0.6, s * 0.1); ctx.lineTo(-s * 0.95, s * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s * 0.15, 0); ctx.lineTo(s * 0.95, -s * 0.5); ctx.lineTo(s * 0.6, s * 0.1); ctx.lineTo(s * 0.95, s * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'mantle':
        ctx.beginPath(); ctx.arc(0, 0, s * 0.8, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -s * 0.6); ctx.lineTo(-s * 0.5, s * 0.4); ctx.lineTo(s * 0.5, s * 0.4); ctx.closePath(); ctx.fill();
        break;
      case 'wafer':
        ctx.beginPath(); ctx.arc(0, 0, s * 0.7, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -s * 0.7); ctx.lineTo(-s * 0.55, 0); ctx.lineTo(0, s * 0.7); ctx.lineTo(s * 0.55, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'laser':
        ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-s * 0.85, 0); ctx.lineTo(s * 0.85, 0); ctx.stroke();
        break;
      case 'triple':
        ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-s * 0.2, -s * 0.55); ctx.lineTo(-s * 0.75, -s * 0.75);
        ctx.moveTo(0, -s * 0.7); ctx.lineTo(0, -s * 0.95);
        ctx.moveTo(s * 0.2, -s * 0.55); ctx.lineTo(s * 0.75, -s * 0.75);
        ctx.stroke();
        break;
      case 'spoon':
        ctx.strokeStyle = c; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-s * 0.7, s * 0.7); ctx.lineTo(s * 0.3, -s * 0.3); ctx.stroke();
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(s * 0.45, -s * 0.45, s * 0.35, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      case 'arrow':
        ctx.beginPath(); ctx.moveTo(-s * 0.7, s * 0.7); ctx.lineTo(s * 0.7, -s * 0.7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.3, -s * 0.7); ctx.lineTo(s * 0.7, -s * 0.7); ctx.lineTo(s * 0.7, -s * 0.3); ctx.stroke();
        break;
      case 'bigtear':
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, s * 0.75, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath(); ctx.arc(-s * 0.25, -s * 0.3, s * 0.2, 0, TAU); ctx.fill();
        break;
      case 'bomb':
        ctx.beginPath(); ctx.arc(0, 0, s * 0.65, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = c; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -s * 0.6); ctx.quadraticCurveTo(s * 0.3, -s * 0.85, s * 0.1, -s * 0.95); ctx.stroke();
        break;
      case 'milk':
        ctx.fillStyle = '#e8e4da'; rr(ctx, -s * 0.5, -s * 0.55, s * 1.0, s * 1.1, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8a5a30'; ctx.fillRect(-s * 0.3, -s * 0.75, s * 0.6, s * 0.25);
        break;
      case 'bobby':
        ctx.fillStyle = '#d8ccb8'; ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-s * 0.22, -s * 0.1, s * 0.13, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.22, -s * 0.1, s * 0.13, 0, TAU); ctx.fill();
        ctx.fillStyle = '#b04038'; ctx.beginPath(); ctx.arc(0, s * 0.28, s * 0.2, 0, TAU); ctx.fill();
        break;
      case 'max_hp':
        ctx.fillStyle = '#e04040'; ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -s * 0.45); ctx.lineTo(0, s * 0.45); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s * 0.45, 0); ctx.lineTo(s * 0.45, 0); ctx.stroke();
        break;
      case 'brim': // 硫磺火：血红激光
        ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff6040'; ctx.beginPath(); ctx.arc(-s * 0.15, -s * 0.15, s * 0.3, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#5a0a00'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-s * 0.85, s * 0.5); ctx.lineTo(s * 0.85, s * 0.5); ctx.stroke();
        break;
      case 'reflect': // 我的反射：回旋箭头
        ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.42, -1.9, -0.7); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(s * 0.44, -s * 0.22); ctx.lineTo(s * 0.66, -s * 0.36); ctx.lineTo(s * 0.52, -s * 0.06); ctx.closePath(); ctx.fill();
        break;
      case 'rubber': // 橡胶水泥：弹球
        ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff8878'; ctx.beginPath(); ctx.arc(-s * 0.12, 0, s * 0.34, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath(); ctx.arc(-s * 0.25, -s * 0.15, s * 0.12, 0, TAU); ctx.fill();
        break;
      case 'cold': // 感冒：雪花 + 毒滴
        ctx.fillStyle = '#d8f0f8'; ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8ed060';
        ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(-s * 0.32, s * 0.1); ctx.lineTo(0, s * 0.8); ctx.lineTo(s * 0.32, s * 0.1); ctx.closePath(); ctx.fill();
        break;
      case 'parasite': // 寄生虫：虫体
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.68, s * 0.42, 0.4, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff8090'; ctx.beginPath(); ctx.arc(s * 0.4, -s * 0.28, s * 0.24, 0, TAU); ctx.fill();
        break;
      case 'oneup': // 1UP
        ctx.font = `bold ${s * 0.85}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e8f0e8';
        ctx.strokeStyle = 'rgba(20,60,20,0.9)'; ctx.lineWidth = 2.5;
        ctx.strokeText('1UP', 0, 0); ctx.fillText('1UP', 0, 0);
        break;
      case 'deadcat': // 死猫：猫脸
        ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(-s * 0.2, -s * 0.14, s * 0.16, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.2, -s * 0.14, s * 0.16, 0, TAU); ctx.fill();
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.arc(-s * 0.22, -s * 0.12, s * 0.07, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.18, -s * 0.12, s * 0.07, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c83228'; ctx.beginPath(); ctx.arc(0, s * 0.22, s * 0.2, 0, TAU); ctx.fill();
        break;
      case 'cube': // 肉块
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s); ctx.strokeRect(-s * 0.5, -s * 0.5, s, s);
        ctx.strokeStyle = '#5a1a10'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.5); ctx.lineTo(-s * 0.18, -s * 0.18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.5, -s * 0.5); ctx.lineTo(s * 0.18, -s * 0.18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.5, s * 0.5); ctx.lineTo(s * 0.18, s * 0.18); ctx.stroke();
        break;
      case 'penta': // 五芒星
        ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          const a1 = a0 + (4 * Math.PI) / 5;
          ctx.lineTo(Math.cos(a0) * s * 0.5, Math.sin(a0) * s * 0.5);
          ctx.lineTo(Math.cos(a1) * s * 0.5, Math.sin(a1) * s * 0.5);
        }
        ctx.closePath(); ctx.stroke();
        break;
      case 'iron': // 铁棒
        ctx.strokeStyle = c; ctx.lineWidth = s * 0.3;
        ctx.beginPath(); ctx.moveTo(-s * 0.7, s * 0.6); ctx.lineTo(s * 0.5, -s * 0.6); ctx.stroke();
        ctx.fillStyle = c; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s * 0.5, -s * 0.6, s * 0.26, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      case 'mark': // 恶魔印记
        ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff4030';
        ctx.beginPath(); ctx.moveTo(0, -s * 0.55); ctx.lineTo(-s * 0.35, s * 0.3); ctx.lineTo(s * 0.35, s * 0.3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -s * 0.1, s * 0.13, 0, TAU); ctx.fill();
        break;
      case 'maxhead': // 马克斯之头
        ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(0, s * 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s * 0.5, 0); ctx.lineTo(s * 0.5, 0); ctx.stroke();
        break;
      case 'clot': // 血凝块
        ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#5a0a0a'; ctx.beginPath(); ctx.arc(-s * 0.16, 0, s * 0.28, 0, TAU); ctx.fill();
        break;
      case 'tooth': // 严厉的爱：牙齿
        ctx.fillStyle = '#f2efe6'; ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -s * 0.6); ctx.lineTo(-s * 0.32, s * 0.1); ctx.lineTo(0, s * 0.58); ctx.lineTo(s * 0.32, s * 0.1); ctx.closePath(); ctx.fill();
        break;
      case 'coal': // 煤块
        ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#9a9aa4';
        ctx.beginPath(); ctx.arc(-s * 0.16, -s * 0.12, s * 0.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.14, s * 0.2, s * 0.15, 0, TAU); ctx.fill();
        break;
      case 'twenty': // 20/20：两颗并排眼泪
        ctx.beginPath(); ctx.arc(-s * 0.28, 0, s * 0.3, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(s * 0.28, 0, s * 0.3, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      case 'spider': // 突变蜘蛛：小蜘蛛 + 多腿
        ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = c; ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const a0 = (i / 4) * TAU + Math.PI / 8;
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a0) * s * 0.85, Math.sin(a0) * s * 0.85); ctx.stroke();
        }
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-s * 0.12, -s * 0.1, s * 0.09, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.12, -s * 0.1, s * 0.09, 0, TAU); ctx.fill();
        break;
      case 'loki': // 洛基之角：向四角的角
        ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, TAU); ctx.fill(); ctx.stroke();
        for (const d of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(d) * s * 0.85, Math.sin(d) * s * 0.85);
          ctx.quadraticCurveTo(Math.cos(d + 0.5) * s * 0.95, Math.sin(d + 0.5) * s * 0.95, Math.cos(d) * s * 0.6, Math.sin(d) * s * 0.6);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        break;
      case 'moms': // 妈妈的爱抚：手掌
        ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8a5a3a';
        for (let i = -1; i <= 1; i++) {
          ctx.save();
          ctx.translate(i * s * 0.22, s * 0.2);
          ctx.rotate(i * 0.25);
          ctx.beginPath(); ctx.ellipse(0, -s * 0.32, s * 0.09, s * 0.22, 0, 0, TAU); ctx.fill();
          ctx.restore();
        }
        break;
      case 'magnet': // 磁铁：U 形磁铁
        ctx.strokeStyle = c; ctx.lineWidth = s * 0.22; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(0, s * 0.1, s * 0.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
        ctx.fillStyle = '#d04038'; ctx.fillRect(-s * 0.55, s * 0.12, s * 0.3, s * 0.2);
        ctx.fillStyle = '#38a0d0'; ctx.fillRect(s * 0.25, s * 0.12, s * 0.3, s * 0.2);
        ctx.lineCap = 'butt';
        break;
      case 'ouija': // 通灵板：幽灵 + 板
        ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath(); ctx.arc(0, 0, s * 0.34, 0, TAU); ctx.fill();
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.arc(-s * 0.11, -s * 0.06, s * 0.06, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.11, -s * 0.06, s * 0.06, 0, TAU); ctx.fill();
        break;
      case 'proptosis': // 下垂症：由大到小渐弱眼泪
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-s * 0.3, 0, s * 0.34, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(s * 0.15, 0, s * 0.22, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(s * 0.45, 0, s * 0.13, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      default:
        ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- 小地图 ----------
  function drawMinimap(ctx, dungeon, cur, floor) {
    const gw = dungeon.w, gh = dungeon.h;
    const cs = floor >= 3 ? 11 : 13;
    const mx = W - gw * cs - 10, my = 10;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    rr(ctx, mx - 7, my - 7, gw * cs + 14, gh * cs + 16, 6);
    ctx.fill(); ctx.stroke();
    for (const r of dungeon.rooms) {
      const x = mx + r.x * cs, y = my + r.y * cs;
      if (!r.explored) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2); continue; }
      const th = theme(r.floor);
      ctx.fillStyle = th.tileA;
      ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
      if (r.type === 'boss') {
        ctx.fillStyle = '#c84038'; ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
        ctx.fillStyle = '#fff'; ctx.font = '9px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('☠', x + cs / 2, y + cs / 2);
      } else if (r.type === 'treasure') {
        ctx.fillStyle = '#c8a030'; ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
        ctx.fillStyle = '#fff'; ctx.font = '8px serif';
        ctx.fillText('★', x + cs / 2, y + cs / 2);
      } else if (r.type === 'shop') {
        ctx.fillStyle = '#58a8d0'; ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
        ctx.fillStyle = '#fff'; ctx.font = '9px sans-serif';
        ctx.fillText('¢', x + cs / 2, y + cs / 2);
      }
      if (r.cleared) { ctx.fillStyle = 'rgba(80,200,80,0.35)'; ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2); }
      else if (r.entered && r.type === 'normal') { ctx.fillStyle = 'rgba(255,60,40,0.7)'; ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2); }
    }
    const px = mx + cur.x * cs + cs / 2, py = my + cur.y * cs + cs / 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px, py, 3, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('第 ' + floor + ' 层', mx + gw * cs / 2, my - 22);
    ctx.restore();
  }

  // ---------- HUD ----------
  function drawHUD(ctx, p, stats) {
    const maxHp = p.maxHp, hp = p.hp;
    let x = 12, y = 10;
    ctx.save();
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText('HP', x, y + 4);
    x += 30;
    for (let i = 0; i < maxHp / 2; i++) {
      drawHeart(ctx, x + 12, y + 12, true, 11);
      if (hp >= (i + 1) * 2) {
      } else if (hp > i * 2) {
        ctx.fillStyle = 'rgba(20,10,8,0.85)';
        ctx.beginPath();
        ctx.moveTo(x + 12, y + 22);
        ctx.bezierCurveTo(x + 23, y + 14, x + 18, y + 3, x + 12, y + 9);
        ctx.closePath(); ctx.fill();
      } else {
        drawHeart(ctx, x + 12, y + 12, false, 11);
      }
      x += 26;
      if (x > W - 120) { x = 30; y += 26; }
    }
    x = W - 124; y = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    rr(ctx, x - 8, y - 4, 116, 60, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#e8b93a';
    ctx.fillText('¢ ' + stats.coins, x, y + 4);
    ctx.fillStyle = '#c8b890';
    ctx.fillText('🔑 ' + stats.keys, x, y + 20);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('☠ ' + stats.kills, x, y + 36);
    let ix = W / 2 - (p.items.length * 26) / 2;
    for (const id of p.items) {
      const it = ITEMS[id];
      if (!it) continue;
      drawItemIcon(ctx, it, ix + 13, 14, 12);
      ix += 26;
    }
    ctx.restore();
  }

  // 商店货架：底座 + 货物（道具/心）+ 价格牌；售罄打叉
  function drawShopStall(ctx, st) {
    const bob = Math.sin(Game.time * 4 + st.x * 0.1) * 3;
    const x = st.x, y = st.y + bob;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + 14, 22, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6a4a28';
    ctx.strokeStyle = '#2e1c0c';
    ctx.lineWidth = 2.5;
    rr(ctx, x - 22, y - 4, 44, 16, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8a6440';
    ctx.fillRect(x - 16, y - 10, 32, 7);
    if (st.sold) {
      ctx.fillStyle = 'rgba(20,12,6,0.8)';
      ctx.beginPath(); ctx.arc(x, y - 8, 14, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#c83228'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 7, y - 15); ctx.lineTo(x + 7, y - 1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 7, y - 15); ctx.lineTo(x - 7, y - 1); ctx.stroke();
      return;
    }
    if (st.offer === 'item') {
      const it = ITEMS[st.itemId];
      if (it) drawItemIcon(ctx, it, x, y - 14, 13);
    } else {
      drawHeart(ctx, x, y - 12, true, 10);
    }
    ctx.fillStyle = 'rgba(10,8,6,0.85)';
    ctx.strokeStyle = '#3a2c1c';
    ctx.lineWidth = 1.5;
    rr(ctx, x - 14, y + 2, 28, 13, 3); ctx.fill(); ctx.stroke();
    // 买不起时价格变红
    const canAfford = (Game.stats.coins || 0) >= st.price;
    ctx.fillStyle = canAfford ? '#ffd76a' : '#e05050';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('¢ ' + st.price, x, y + 9);
  }

  return {
    bakeRoomStatic, addStain, drawStains,
    drawDoor, drawDoorCenter: doorCenter,
    drawPlayer, drawTear, drawPickup, drawChest, drawShopStall,
    drawGaper, drawPooter, drawHorf, drawAttackFly, drawBoomFly, drawKnight,
    drawClotty, drawHopper, drawMaw, drawGlobin,
    drawMonstro, drawDuke, drawMomFoot, drawMomEye, drawLarry, drawGurdy,
    drawVis, drawChub, drawMonstro2,
    drawItemIcon, drawHeart, drawMinimap, drawHUD,
  };
})();

