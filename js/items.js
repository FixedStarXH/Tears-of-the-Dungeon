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
  // ---- 参考原作新增 ----
  brimstone:    { name: '硫磺火',     icon: 'brim',      color: '#c82820', stat: '激光',    desc: '按住射击键蓄力发射贯穿大激光', effect(p) { p.brimstone = true; p.damage += 1; } },
  my_reflection:{ name: '我的反射',   icon: 'reflect',   color: '#d8c8a0', stat: '回旋',    desc: '眼泪飞到中途会飞回手中', effect(p) { p.boomerang = true; } },
  rubber_cement:{ name: '橡胶水泥',   icon: 'rubber',    color: '#d86858', stat: '反弹',    desc: '眼泪撞墙后会反弹', effect(p) { p.bounce += 2; } },
  common_cold:  { name: '感冒',       icon: 'cold',      color: '#7ec850', stat: '中毒',    desc: '眼泪使敌人中毒持续掉血', effect(p) { p.poison = 2.2; } },
  parasite:     { name: '寄生虫',     icon: 'parasite',  color: '#d05878', stat: '分裂',    desc: '眼泪命中后分裂成两滴', effect(p) { p.split = true; } },
  one_up:       { name: '1UP',        icon: 'oneup',     color: '#58d058', stat: '复活',    desc: '死亡时原地复活一次', effect(p) { p.revives += 1; } },
  dead_cat:     { name: '死猫',       icon: 'deadcat',   color: '#e05848', stat: '复活 ×2', desc: '复活两次但生命上限降为 1 心', effect(p) { p.revives += 2; p.maxHp = 2; p.hp = 2; } },
  cube_of_meat: { name: '肉块',       icon: 'cube',      color: '#c84a38', stat: '跟班',    desc: '环绕身边的肉块碰伤敌人', effect(p) { p.orbital += 1; } },
  pentagram:    { name: '五芒星',     icon: 'penta',     color: '#a82020', stat: '攻击 ↑↑', desc: '大幅提升伤害，染上暗黑光环', effect(p) { p.damage += 1.5; p.aura = 'dark'; } },
  iron_bar:     { name: '铁棒',       icon: 'iron',      color: '#8a8a92', stat: '攻击 ↑',  desc: '提升伤害，击退更强', effect(p) { p.damage += 0.8; p.knockboost = true; } },
  the_mark:     { name: '恶魔印记',   icon: 'mark',      color: '#d02020', stat: '攻击+移速', desc: '提升伤害与移动速度', effect(p) { p.damage += 1.5; p.speed *= 1.1; } },
  max_head:     { name: '马克斯之头', icon: 'maxhead',   color: '#d87838', stat: '攻击 ×1.5', desc: '伤害提升 1.5 倍', effect(p) { p.damage *= 1.5; } },
  blood_clot:   { name: '血凝块',     icon: 'clot',      color: '#c03030', stat: '攻击+射程', desc: '提升伤害与射程', effect(p) { p.damage += 1; p.tearRange *= 1.15; } },
  tough_love:   { name: '严厉的爱',   icon: 'tooth',     color: '#e8e4d8', stat: '牙齿',    desc: '25% 概率射出三倍伤害的牙齿', effect(p) { p.teeth = true; } },
  lump_of_coal: { name: '煤块',       icon: 'coal',      color: '#4a4a52', stat: '渐强',    desc: '眼泪飞得越远伤害越高', effect(p) { p.coal = true; } },
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
