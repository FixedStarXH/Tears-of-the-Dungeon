/* items.js —— 道具定义（效果 + 程序化图标 + 道具池） */
'use strict';

const ITEMS = {
  sad_onion:    { name: '悲伤洋葱',   icon: 'onion',    color: '#c8b48a', stat: '射速 ↑',   desc: '哭得更快了', effect(p) { p.fireDelay *= 0.85; p.damage += 0.3; } },
  number_one:   { name: '第一号',     icon: 'number',   color: '#e8e0d0', stat: '射速 ↑↑',  desc: '射速暴涨但射程变短', effect(p) { p.fireDelay *= 0.7; p.tearRange *= 0.78; } },
  cricket_head: { name: '蟋蟀的头',   icon: 'cricket',  color: '#b04030', stat: '攻击 ↑↑',  desc: '大幅提升伤害', effect(p) { p.damage += 1.2; p.size = Math.max(p.size, 1.12); } },
  blood_martyr: { name: '殉道者之血', icon: 'martyr',   color: '#a02020', stat: '攻击 ↑',    desc: '提升伤害', effect(p) { p.damage += 1.0; } },
  steven:       { name: '史蒂文',     icon: 'steven',   color: '#b89a6a', stat: '攻击 ↑',    desc: '提升伤害', effect(p) { p.damage += 0.8; } },
  speed_ball:   { name: '急速球',     icon: 'speed',    color: '#58a8d0', stat: '移速 ↑↑',  desc: '大幅提升移动与弹速', effect(p) { p.speed *= 1.18; p.tearSpeed *= 1.1; } },
  the_belt:     { name: '皮带',       icon: 'belt',     color: '#8a6a30', stat: '移速 ↑',    desc: '提升移动速度', effect(p) { p.speed *= 1.15; } },
  breakfast:    { name: '早餐',       icon: 'breakfast',color: '#e8c860', stat: '生命 +1',  desc: '生命上限 +1 心并回满', effect(p) { p.maxHp += 2; p.hp = p.maxHp; } },
  magic_mushroom:{ name: '魔法蘑菇',  icon: 'mushroom', color: '#c83030', stat: '全能 +',   desc: '攻击↑ 体型变大 生命+1 变红', effect(p) { p.damage += 1; p.size = 1.3; p.redSkin = true; p.maxHp += 2; p.hp = p.maxHp; } },
  lord_pit:     { name: '深渊领主',   icon: 'pit',      color: '#6a6a82', stat: '飞行',     desc: '长出恶魔翅膀获得飞行', effect(p) { p.flight = true; } },
  holy_mantle:  { name: '圣斗篷',     icon: 'mantle',   color: '#e8e4d8', stat: '护盾',     desc: '每个房间抵挡第一次伤害', effect(p) { p.shield = true; p.shieldUp = true; } },
  the_wafer:    { name: '薄饼',       icon: 'wafer',    color: '#c8a86a', stat: '减伤',     desc: '受到的伤害降为半心', effect(p) { p.wafer = true; } },
  technology:   { name: '科技',       icon: 'laser',    color: '#e03530', stat: '激光',     desc: '眼泪变成贯穿激光', effect(p) { p.laser = true; p.damage += 0.5; } },
  inner_eye:    { name: '内眼',       icon: 'triple',   color: '#b03838', stat: '三重射击', desc: '一次射出三颗眼泪', effect(p) { p.triple = true; } },
  spoon_bender: { name: '弯勺',       icon: 'spoon',    color: '#b0b8e0', stat: '追踪',     desc: '眼泪会追踪敌人', effect(p) { p.homing = true; } },
  cupid_arrow:  { name: '丘比特之箭', icon: 'arrow',    color: '#e8a0b8', stat: '穿透',     desc: '眼泪贯穿所有敌人', effect(p) { p.pierce = true; } },
  polyphemus:   { name: '波吕斐摩斯', icon: 'bigtear',  color: '#8a8ab8', stat: '巨型眼泪', desc: '超大伤害眼泪，射速下降', effect(p) { p.damage += 2.2; p.bigTear = true; p.fireDelay *= 1.55; } },
  ipecac:       { name: '吐根',       icon: 'bomb',     color: '#c8e060', stat: '爆炸',     desc: '眼泪落地爆炸（小心误伤自己）', effect(p) { p.explosive = true; p.damage += 2; p.fireDelay *= 1.4; } },
  soy_milk:     { name: '豆奶',       icon: 'milk',     color: '#e8e4da', stat: '射速 ↑↑↑', desc: '射速暴涨但单发伤害暴跌', effect(p) { p.fireDelay *= 0.24; p.damage = Math.max(0.4, p.damage * 0.4); } },
  brother_bobby:{ name: '鲍比兄弟',   icon: 'bobby',    color: '#d8ccb8', stat: '跟班',     desc: '灵魂跟班自动向敌人开火', effect(p) { p.familiar = true; } },
};

const ITEM_LIST = Object.keys(ITEMS);

// 每局道具池（洗牌，取后移除，一局内不重复）
let itemPool = [];
function resetItemPool() { itemPool = shuffle(ITEM_LIST); }
function takeItem() {
  if (!itemPool.length) resetItemPool();
  return itemPool.pop();
}

// 给玩家施加道具效果（拾取与调试通用）
function applyItem(p, id, silent) {
  const it = ITEMS[id];
  if (!it) return null;
  if (!p.items.includes(id)) p.items.push(id);
  it.effect(p);
  p.damage = Math.max(0.3, p.damage);
  p.fireDelay = Math.max(3, p.fireDelay);
  return it;
}

// 描述玩家属性面板
function describeStats(p) {
  return [
    `攻击 ${p.damage.toFixed(2)}`,
    `射速 ${(60 / (p.fireDelay / 60)).toFixed(1)} 发/秒`,
    `移速 ${Math.round(p.speed)}`,
    `生命 ${Math.floor(p.hp / 2)} 心${p.hp % 2 ? ' + 半' : ''}`,
    `眼泪射程 ${Math.round(p.tearRange)}`,
  ].join(' ｜ ');
}
