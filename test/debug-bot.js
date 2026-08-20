/* debug-bot.js —— 观察 BOT 行为 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

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
function canvasStub() { return { width: 0, height: 0, style: {}, getContext: () => ctxStub() }; }
function elStub() { return { classList: { add: noop, remove: noop }, textContent: '', innerHTML: '', style: {}, offsetWidth: 0 }; }
global.window = {};
global.document = { createElement: () => canvasStub(), getElementById: () => elStub(), querySelectorAll: () => [] };
global.performance = require('perf_hooks').performance;
global.requestAnimationFrame = noop;

for (const f of ['util.js', 'art.js', 'dungeon.js', 'items.js', 'entities.js', 'game.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), { filename: f });
}
global.Input = { moveX: 0, moveY: 0, aimX: 1, aimY: 0 };

vm.runInThisContext(`
Game.state='playing'; startGame(999); Game.bot.on = true; Game.player.maxHp=99; Game.player.hp=99;
`);
let lastFloor = 1;
for (let i = 0; i < 2400; i++) {
  vm.runInThisContext('updateGame(1/60)');
  if (i % 60 === 0) {
    const f = vm.runInThisContext('Game.floor');
    const line = vm.runInThisContext(`
      (() => {
        const rm = Game.currentRoom;
        const types = Game.enemies.filter(e=>!e.dead).map(e=>e.type+(e.isBoss?'[B]':'')).join(',');
        return 'floor=' + Game.floor +
          ' room=' + rm.x + ',' + rm.y + ':' + rm.type +
          ' doors=' + ['up','down','left','right'].map(d=>rm.doors[d] ? (rm.doors[d].closed?'C':rm.doors[d].locked?'L':'O') : '-').join('') +
          ' enemies=[' + types + ']' +
          ' kills=' + Game.stats.kills +
          ' hp=' + Game.player.hp +
          ' pickups=' + Game.pickups.map(p=>p.type).join(',');
      })()
    `);
    if (f !== lastFloor) {
      console.log(`>>> 楼层变化: ${lastFloor} -> ${f} @ frame ${i}`);
      lastFloor = f;
    }
    console.log('frame', i, line);
  }
}
console.log('最终 floor =', lastFloor, 'state =', vm.runInThisContext('Game.state'));
