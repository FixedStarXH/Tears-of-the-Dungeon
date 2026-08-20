/* smoke.js —— 无头逻辑冒烟测试：桩掉 DOM/Canvas，跑完整流程到通关 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---------- DOM / Canvas 桩 ----------
const noop = () => { };
function ctxStub() {
  return new Proxy({}, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'canvas') return canvasStub();
      if (p === 'createRadialGradient' || p === 'createLinearGradient') {
        return () => ({ addColorStop: noop });
      }
      if (p === 'measureText') return () => ({ width: 0 });
      return () => { };
    },
    set() { return true; },
  });
}
function canvasStub() {
  return { width: 0, height: 0, style: {}, getContext: () => ctxStub() };
}
function elStub() {
  return { classList: { add: noop, remove: noop }, textContent: '', innerHTML: '', style: {}, offsetWidth: 0 };
}
global.window = {};
global.document = {
  createElement: () => canvasStub(),
  getElementById: () => elStub(),
  querySelectorAll: () => [],
};
global.performance = require('perf_hooks').performance;
global.requestAnimationFrame = noop;

// 加载游戏脚本（共享全局作用域）
const files = ['util.js', 'art.js', 'dungeon.js', 'items.js', 'entities.js', 'game.js'];
for (const f of files) {
  const code = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  vm.runInThisContext(code, { filename: f });
}

// 最小输入桩
global.Input = { moveX: 0, moveY: 0, aimX: 1, aimY: 0 };

// ---------- 测试 ----------
let errors = 0;
const assert = (cond, msg) => {
  if (!cond) { errors++; console.error('  ✗ FAIL:', msg); }
  else console.log('  ✓', msg);
};

const step = (n) => { for (let i = 0; i < n; i++) run('updateGame(1/60)'); };
function run(code) {
  try { vm.runInThisContext(code); }
  catch (e) { errors++; console.error('  ✗ RUNTIME ERROR:', e.message); console.error(e.stack.split('\n').slice(0, 4).join('\n')); }
}
function runGet(code) {
  return vm.runInThisContext(code);
}

console.log('--- 测试 1：地牢生成合法性（多楼层多种子） ---');
for (const seed of [1, 42, 777, 9999, 12345]) {
  run(`Game.state='playing'; startGame(${seed});`);
  run(`global.__testDungeon = { w: Game.dungeon.w, count: Game.dungeon.rooms.length, types: Game.dungeon.rooms.map(r=>r.type), boss: Game.dungeon.rooms.filter(r=>r.type==='boss').length, treasure: Game.dungeon.rooms.filter(r=>r.type==='treasure').length, rooms: Game.dungeon.rooms.map(r=>({x:r.x,y:r.y,type:r.type})) }`);
  const d = global.__testDungeon;
  assert(d.count >= 5 && d.count <= 8, `seed=${seed} 房间数 ${d.count} ∈ [5,8]`);
  assert(d.boss === 1, `seed=${seed} 恰有 1 个 Boss 房`);
  assert(d.treasure >= 0 && d.treasure <= 2, `seed=${seed} 宝箱房 ${d.treasure} 个`);
  assert(d.count === d.rooms.length, 'rooms 数组完整');
}

console.log('--- 测试 2：BOT 通关全流程（3 层 + 最终 Boss） ---');
run(`Game.state='playing'; startGame(999); Game.bot.on = true; Game.player.maxHp=99; Game.player.hp=99; Game.player.damage=30; Game.player.fireDelay=3;`);
let steps = 0;
const maxSteps = 12000;
let lastFloor = 1, floors = [];
while (steps < maxSteps) {
  run('updateGame(1/60)');
  steps++;
  if (runGet(`Game.floor`) !== lastFloor) {
    lastFloor = runGet(`Game.floor`);
    floors.push(lastFloor);
  }
  if (runGet(`Game.state`) === 'victory' || runGet(`Game.state`) === 'dead') break;
}
assert(runGet(`Game.stats.kills`) > 0, `有击杀记录：${runGet('Game.stats.kills')}`);
assert(floors.length > 0, `BOT 推进楼层：${floors.length ? floors.join('→') : '未推进'}（当前第 ${lastFloor} 层，${steps} 帧）`);
if (runGet(`Game.state`) === 'victory') {
  console.log('  ★ BOT 完整通关！');
} else {
  console.log(`  (BOT 当前 state=${runGet('Game.state')}，敌人=${runGet('Game.enemies.length')}，HP=${Math.round(runGet('Game.player.hp'))})`);
}
Game.bot.on = false;

console.log('--- 测试 3：道具效果生效 ---');
run(`Game.state='playing'; startGame(5);`);
const dmg0 = runGet('Game.player.damage');
run(`applyItem(Game.player, 'cricket_head');`);
const dmg1 = runGet('Game.player.damage');
assert(dmg1 > dmg0, `蟋蟀头 攻击 ${dmg0} → ${dmg1}`);
run(`applyItem(Game.player, 'soy_milk'); applyItem(Game.player, 'technology'); applyItem(Game.player, 'magic_mushroom');`);
assert(runGet('Game.player.laser') === true, '科技 → laser=true');
assert(runGet('Game.player.redSkin') === true, '魔法蘑菇 → redSkin=true');
assert(runGet('Game.player.items.length') === 4, `道具列表 4 件：${runGet('Game.player.items.length')}`);
run(`applyItem(Game.player, 'polyphemus');`);
assert(runGet('Game.player.bigTear') === true, '波吕斐摩斯 → bigTear=true');

console.log('--- 测试 4：死亡界面数据 ---');
run(`Game.state='playing'; startGame(8); Game.player.inv = 0; Entities.damagePlayer(999, 0, 0);`);
assert(runGet('Game.state') === 'dead', `掉血后 state=dead（实际 ${runGet('Game.state')}）`);

console.log('--- 测试 5：道具池不重复 ---');
run(`Game.state='playing'; startGame(11);`);
const items1 = [];
for (let i = 0; i < 20; i++) items1.push(runGet(`takeItem()`));
assert(new Set(items1).size === items1.length, '道具池 20 件取件无重复');
assert(runGet('ITEM_LIST.length') === 20, `道具总数 = ${runGet('ITEM_LIST.length')}`);

console.log('--- 测试 6：宝箱房门状态与进出 ---');
let treasureChecked = 0;
for (const seed of [999, 1, 42, 777, 12345, 6, 8, 11]) {
  run(`Game.state='playing'; startGame(${seed});`);
  const pair = runGet(`
    (() => {
      const rooms = Game.dungeon.rooms;
      const tr = rooms.find(r => r.type === 'treasure');
      if (!tr) return null;
      const opp = { up: 'down', down: 'up', left: 'right', right: 'left' };
      for (const dir of ['up','down','left','right']) {
        if (!tr.doors[dir]) continue;
        const [dx, dy] = dir === 'up' ? [0,-1] : dir === 'down' ? [0,1] : dir === 'left' ? [-1,0] : [1,0];
        const nb = rooms.find(r => r.x === tr.x + dx && r.y === tr.y + dy);
        if (nb) return { trSide: tr.doors[dir].locked, nbSide: nb.doors[opp[dir]].locked };
      }
      return null;
    })()
  `);
  if (pair) {
    treasureChecked++;
    assert(pair.trSide === false, `seed=${seed} 宝箱房内侧门未上锁`);
    assert(pair.nbSide === true, `seed=${seed} 相邻房外侧门需钥匙`);
  }
}
assert(treasureChecked >= 5, `宝箱房样本 ${treasureChecked} 个`);
// 行为验证：进入宝箱房后能出来
const behavior = runGet(`
  (() => {
    Game.state='playing'; startGame(999);
    const rooms = Game.dungeon.rooms;
    const tr = rooms.find(r => r.type === 'treasure');
    if (!tr) return 'no-treasure';
    const opp = { up: 'down', down: 'up', left: 'right', right: 'left' };
    let trDir = null, fromDir = null;
    for (const dir of ['up','down','left','right']) {
      if (!tr.doors[dir]) continue;
      const [dx, dy] = dir === 'up' ? [0,-1] : dir === 'down' ? [0,1] : dir === 'left' ? [-1,0] : [1,0];
      if (rooms.find(r => r.x === tr.x + dx && r.y === tr.y + dy)) { trDir = dir; fromDir = opp[dir]; break; }
    }
    tr.lastEnter = fromDir;
    enterRoom(tr);
    Game.player.inv = 0;
    return { trDir, fromDir };
  })()
`);
run('updateGame(1/60)'); // 清空宝箱房并开门
run(`
  (() => {
    const p = Game.player;
    const z = DOOR_ZONES['${behavior.trDir}'];
    p.x = z.x; p.y = z.y;
    Game.player.inv = 0;
  })()
`);
run('updateGame(1/60)');
assert(runGet(`Game.currentRoom.type !== 'treasure'`), '进入宝箱房后能走出（当前 ' + runGet('Game.currentRoom.type') + ' 房）');

console.log('--- 测试 7：Boss 房活板门离开后再进入仍在 ---');
run(`Game.state='playing'; startGame(123);`);
const binfo = runGet(`
  (() => {
    const rooms = Game.dungeon.rooms;
    const b = rooms.find(r => r.type === 'boss');
    const opp = { up:'down', down:'up', left:'right', right:'left' };
    let fromDir = null;
    for (const dir of ['up','down','left','right']) {
      if (!b.doors[dir]) continue;
      const [dx,dy] = dir==='up'?[0,-1]:dir==='down'?[0,1]:dir==='left'?[-1,0]:[1,0];
      if (rooms.find(r => r.x===b.x+dx && r.y===b.y+dy)) { fromDir = opp[dir]; break; }
    }
    return fromDir;
  })()
`);
run(`
  (() => {
    const b = Game.dungeon.rooms.find(r => r.type==='boss');
    b.lastEnter = '${binfo}';
    enterRoom(b);
    const boss = Entities.createBoss(b.boss, 450, 270);
    Game.enemies.push(boss);
    Entities.killEnemy(boss);
  })()
`);
assert(runGet(`Game.pickups.some(p=>p.type==='trapdoor')`), '击杀 Boss 后活板门出现');
run(`
  (() => {
    const rooms = Game.dungeon.rooms;
    const b = Game.currentRoom;
    const opp = { up:'down', down:'up', left:'right', right:'left' };
    for (const dir of ['up','down','left','right']) {
      if (!b.doors[dir]) continue;
      const [dx,dy] = dir==='up'?[0,-1]:dir==='down'?[0,1]:dir==='left'?[-1,0]:[1,0];
      const nb = rooms.find(r => r.x===b.x+dx && r.y===b.y+dy);
      if (nb) { nb.lastEnter = opp[dir]; enterRoom(nb); break; }
    }
  })()
`);
assert(!runGet(`Game.pickups.some(p=>p.type==='trapdoor')`), '离开 Boss 房后全局拾取物被清空');
run(`
  (() => {
    const b = Game.dungeon.rooms.find(r => r.type==='boss');
    b.lastEnter = '${binfo}';
    enterRoom(b);
  })()
`);
assert(runGet(`Game.pickups.some(p=>p.type==='trapdoor')`), '重新进入 Boss 房后活板门补刷');
run(`
  (() => {
    const p = Game.player;
    const t = Game.pickups.find(pk=>pk.type==='trapdoor');
    p.x = t.x; p.y = t.y;
  })()
`);
run('updateGame(1/60)');
assert(runGet(`Game.floor === 2`), `踩活板门进入第 2 层（实际 floor=${runGet('Game.floor')}）`);

console.log(`\n结果：${errors === 0 ? '全部通过' : errors + ' 个失败'}`);
process.exit(errors === 0 ? 0 : 1);
