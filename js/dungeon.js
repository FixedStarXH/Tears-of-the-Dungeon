/* dungeon.js —— 楼层平面生成（BFS 扩张）+ 房间模板 + Boss/宝箱房分配 */
'use strict';

// 房间模板：13×7 字符网格（可行走区），'.' 地板 X 岩石 O 坑 ^ 尖刺
const LAYOUTS = [
  // 1 空房
  [
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
  ],
  // 2 四角岩石
  [
    '..X.......X..',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '..X.......X..',
  ],
  // 3 中央石阵
  [
    '.............',
    '.............',
    '.....XXX.....',
    '.....XXX.....',
    '.....XXX.....',
    '.............',
    '.............',
  ],
  // 4 立柱
  [
    '.............',
    '..X.......X..',
    '.............',
    '.....X.X.....',
    '.............',
    '..X.......X..',
    '.............',
  ],
  // 5 双坑群
  [
    '.............',
    '....O..O.....',
    '....O..O.....',
    '.............',
    '....O..O.....',
    '....O..O.....',
    '.............',
  ],
  // 6 尖刺环
  [
    '.............',
    '....^^^^^....',
    '...^.....^...',
    '.............',
    '...^.....^...',
    '....^^^^^....',
    '.............',
  ],
  // 7 镜像散布
  [
    '.............',
    '.X.....X.....',
    '.............',
    '.....X.......',
    '.............',
    '.X.....X.....',
    '.............',
  ],
  // 8 尖刺走廊
  [
    '.............',
    '.....^^......',
    '.....^^......',
    '.....^^......',
    '.....^^......',
    '.....^^......',
    '.............',
  ],
  // 9 竞技场角石
  [
    '.............',
    '.X.........X.',
    '.............',
    '.....XXX.....',
    '.............',
    '.X.........X.',
    '.............',
  ],
  // 10 断行岩石
  [
    '.............',
    '.....XXX.....',
    '.............',
    '..XXX...XXX..',
    '.............',
    '.....XXX.....',
    '.............',
  ],
];

const BOSS_LAYOUT = [
  '.............',
  '..X.......X..',
  '.............',
  '.............',
  '.............',
  '..X.......X..',
  '.............',
];
const EMPTY_LAYOUT = LAYOUTS[0];

const Dungeon = (function () {

  const GW = 9, GH = 7; // 房间网格
  const DIRS = [
    { dx: 0, dy: -1, key: 'up', opp: 'down' },
    { dx: 0, dy: 1, key: 'down', opp: 'up' },
    { dx: -1, dy: 0, key: 'left', opp: 'right' },
    { dx: 1, dy: 0, key: 'right', opp: 'left' },
  ];

  // 敌人池（每层）
  function enemyPool(floor) {
    const base = ['gaper', 'pooter', 'attackfly', 'clotty', 'hopper'];
    if (floor >= 2) base.push('boomfly', 'horf');
    if (floor >= 3) base.push('knight', 'maw', 'globin');
    if (floor >= 3) base.push('vis'); // 第 3 层起出现巨眼怪（每房上限 1 只在 enterRoom 控制）
    return base;
  }

  function bossForFloor(floor) {
    return ['monstro', 'duke', 'mom'][clamp(floor - 1, 0, 2)];
  }

  // 目标房间数
  function targetRooms(floor) {
    return floor === 1 ? randInt(5, 6) : floor === 2 ? randInt(6, 7) : randInt(7, 8);
  }

  // 从模板生成障碍网格（可行走区 13×7），自动保留门前通道与房间中心
  function gridFromLayout(tpl) {
    const grid = [];
    for (let gy = 0; gy < 7; gy++) {
      const row = [];
      for (let gx = 0; gx < 13; gx++) row.push(tpl[gy][gx]);
      grid.push(row);
    }
    return grid;
  }

  function clearPaths(grid, doors) {
    // 房间中心
    grid[3][6] = '.';
    grid[2][6] = '.'; grid[4][6] = '.'; grid[3][5] = '.'; grid[3][7] = '.';
    // 门前通道
    if (doors.up) { grid[0][6] = '.'; grid[1][6] = '.'; }
    if (doors.down) { grid[6][6] = '.'; grid[5][6] = '.'; }
    if (doors.left) { grid[3][0] = '.'; grid[3][1] = '.'; }
    if (doors.right) { grid[3][12] = '.'; grid[3][11] = '.'; }
  }

  // 房间布局生成（BFS 扩张，候选格已有超过 1 个已填充邻居则拒绝）
  function generate(floor, seed) {
    const saved = RNG;
    if (seed !== undefined) setSeed(seed);
    let attempt = 0;
    while (attempt++ < 60) {
      const res = genOnce(floor);
      if (res) { RNG = saved; return res; }
    }
    // 兜底：用空 grid 强刷一次
    const res = genOnce(floor, true);
    RNG = saved;
    return res;
  }

  function genOnce(floor, force) {
    const grid = Array.from({ length: GH }, () => new Array(GW).fill(0));
    const target = targetRooms(floor);
    const sx = 4, sy = 3;
    grid[sy][sx] = 1;
    const rooms = [];
    const roomAt = {};
    const key = (x, y) => x + ',' + y;
    rooms.push({ x: sx, y: sy, type: 'start' });
    roomAt[key(sx, sy)] = rooms[0];

    const frontier = [{ x: sx, y: sy }];
    while (rooms.length < target && frontier.length) {
      const idx = Math.floor(RNG() * frontier.length);
      const cur = frontier[idx];
      frontier.splice(idx, 1);
      const ds = shuffle(DIRS);
      for (const d of ds) {
        if (rooms.length >= target) break;
        const nx = cur.x + d.dx, ny = cur.y + d.dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        if (grid[ny][nx]) continue;
        // 候选格：已填充邻居 <= 1（不含当前格）
        let filled = 0;
        for (const dd of DIRS) {
          const ax = nx + dd.dx, ay = ny + dd.dy;
          if (ax >= 0 && ay >= 0 && ax < GW && ay < GH && grid[ay][ax]) filled++;
        }
        if (filled > 1) continue;
        grid[ny][nx] = 1;
        const r = { x: nx, y: ny, type: 'normal' };
        rooms.push(r);
        roomAt[key(nx, ny)] = r;
        frontier.push({ x: nx, y: ny });
      }
    }

    // 死胡同（只有 1 个邻居的房间）
    const deadEnds = rooms.filter((r) => {
      let n = 0;
      for (const d of DIRS) {
        const ax = r.x + d.dx, ay = r.y + d.dy;
        if (ax >= 0 && ay >= 0 && ax < GW && ay < GH && grid[ay][ax]) n++;
      }
      return n === 1;
    });
    if (!deadEnds.length && !force) return null;

    // Boss 房：离起点最远的死胡同
    const distTo = (r) => Math.abs(r.x - sx) + Math.abs(r.y - sy);
    deadEnds.sort((a, b) => distTo(b) - distTo(a));
    const bossR = deadEnds[0];
    if (!force && Math.abs(bossR.x - sx) + Math.abs(bossR.y - sy) <= 1) return null; // Boss 不能贴着起点
    bossR.type = 'boss';
    // 宝箱房：其余死胡同
    const treasures = deadEnds.filter((r) => r !== bossR && r.type === 'normal').slice(0, 1);
    for (const tr of treasures) tr.type = 'treasure';
    // 商店房：2 层起，死胡同富余（boss+宝箱+商店）时才出现
    const shopR = floor >= 2 && deadEnds.length >= 3 ? deadEnds[2] : null;
    if (shopR) shopR.type = 'shop';

    // 生成房间细节
    const enemyPoolArr = enemyPool(floor);
    for (const r of rooms) {
      r.floor = floor;
      r.cleared = r.type === 'start' || r.type === 'shop';
      r.entered = false;
      r.explored = r.type === 'start';
      r.doors = { up: null, down: null, left: null, right: null };
      r.boss = null;
      r.chest = null;
      // 与相邻房间建立门
      for (const d of DIRS) {
        const ax = r.x + d.dx, ay = r.y + d.dy;
        const nb = roomAt[key(ax, ay)];
        if (!nb) continue;
        const dType = (r.type === 'boss' || nb.type === 'boss') ? 'boss'
          : (r.type === 'treasure' || nb.type === 'treasure') ? 'treasure' : 'normal';
        // 锁只挂在非宝箱房一侧：从外面看锁着（需钥匙），进入宝箱房后从里面看是开的
        r.doors[d.key] = { dir: d.key, type: dType, closed: r.type !== 'start', locked: dType === 'treasure' && r.type !== 'treasure' };
      }
      // 门格判定（供绘图）
      r.doorAt = (gx, gy) => (
        (gx === 7 && gy === 0 && r.doors.up) ||
        (gx === 7 && gy === 8 && r.doors.down) ||
        (gx === 0 && gy === 4 && r.doors.left) ||
        (gx === 14 && gy === 4 && r.doors.right)
      );
      // 布局
      let tpl;
      if (r.type === 'boss') tpl = BOSS_LAYOUT;
      else if (r.type === 'start' || r.type === 'treasure' || r.type === 'shop') tpl = EMPTY_LAYOUT;
      else tpl = pick(LAYOUTS);
      r.propGrid = gridFromLayout(tpl);
      clearPaths(r.propGrid, r.doors);
      r.layoutIndex = LAYOUTS.indexOf(tpl);
      // 敌人阵容（普通房）
      r.enemies = [];
      if (r.type === 'normal') {
        const n = randInt(1, 2 + Math.floor(floor / 2));
        for (let i = 0; i < n; i++) r.enemies.push(pick(enemyPoolArr));
      }
      if (r.type === 'boss') r.boss = bossForFloor(floor);
      // 商店：一行三个货架（中间可能是心，其余是道具），价格随层数上涨
      if (r.type === 'shop') {
        r.shopStalls = [];
        const base = 5 + Math.floor(floor * 1.5);
        const slots = [[3, 3], [7, 3], [11, 3]];
        slots.forEach(([gx, gy], i) => {
          if (i === 1 && chance(0.45)) {
            r.shopStalls.push({ gx, gy, offer: 'heart', price: Math.max(3, base - 2), sold: false });
          } else {
            r.shopStalls.push({ gx, gy, offer: 'item', price: base + randInt(0, 3), sold: false });
          }
        });
      }
      // 木箱
      if (r.type === 'normal' && chance(0.22)) r.chest = 'wood';
      // 宝箱房附赠一口免费木箱
      if (r.type === 'treasure' && chance(0.55)) r.chest = 'wood';
    }
    if (!force && !rooms.length) return null;
    return { w: GW, h: GH, rooms, start: rooms[0], grid, floor };
  }

  // 在房间可行走区域内随机找空位（避开障碍与门前/中心）
  function randomFreeCell(room, rng, avoidDoors) {
    const cells = [];
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 13; gx++) {
        if (room.propGrid[gy][gx] !== '.') continue;
        if (avoidDoors) {
          if (gx === 6 && (gy === 0 || gy === 1 || gy === 6 || gy === 5)) continue;
          if (gy === 3 && (gx === 0 || gx === 1 || gx === 12 || gx === 11)) continue;
          if (gx === 6 && gy === 3) continue; // 中心
        }
        cells.push({ gx: gx + 1, gy: gy + 1 });
      }
    }
    if (!cells.length) return { gx: 7, gy: 4 };
    return rng ? cells[Math.floor(rng() * cells.length)] : pick(cells);
  }

  // 门是否位于某个墙格（供 art 绘制）
  return {
    generate, randomFreeCell, enemyPool, bossForFloor, GW, GH, DIRS,
  };
})();
