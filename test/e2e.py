# -*- coding: utf-8 -*-
"""e2e.py —— Playwright 真浏览器端到端测试 + 截图
覆盖：页面加载 / 开始游戏 / 键盘核心机制 / 道具效果 / BOT 全流程通关 / 死亡界面 / 移动端触控
运行前提：本地服务器已启动（如 python -m http.server 8000）
用法：python test/e2e.py [base_url]
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/index.html"
SHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(SHOT_DIR, exist_ok=True)

results = []


def check(name, cond, extra=""):
    ok = bool(cond)
    results.append(ok)
    mark = "  \u2713" if ok else "  \u2717 FAIL:"
    print(f"{mark} {name}{('  (' + str(extra) + ')') if extra else ''}")
    return ok


def wait_for(pg, expr, timeout=20000, desc=""):
    """轮询等待页面里的 JS 表达式为真"""
    deadline = time.time() + timeout / 1000
    while time.time() < deadline:
        try:
            if pg.evaluate(f"() => ({expr})"):
                return True
        except Exception:
            pass
        time.sleep(0.05)
    print(f"  [超时] 等待条件未满足: {desc or expr}")
    return False


def shot(pg, name):
    pg.screenshot(path=os.path.join(SHOT_DIR, name))
    print(f"  [截图] {name}")


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)

        # ============ 桌面端 ============
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: print(f"  [页面错误] {e}"))

        print("--- T1 页面加载 & 开始界面 ---")
        pg.goto(BASE, wait_until="load")
        check("页面标题", "Tears" in pg.title() or "泪之地牢" in pg.title(), pg.title())
        check("开始界面可见", pg.is_visible("#screen-start"))
        shot(pg, "01-start.png")

        print("--- T2 开始游戏 & 地牢生成 ---")
        pg.click("#btn-start")
        check("进入游戏 state=playing", wait_for(pg, "window.__game.state === 'playing'"))
        n = pg.evaluate("() => window.__game.dungeon.rooms.length")
        check("地牢房间数 5-8", 5 <= n <= 8, n)
        check("第 1 层", pg.evaluate("() => window.__game.floor") == 1)
        shot(pg, "02-room.png")

        print("--- T3 核心机制（键盘操作） ---")
        # 射击：按住方向键产生眼泪
        pg.keyboard.down("ArrowRight")
        wait_for(pg, "window.__game.tearCount > 0", timeout=3000, desc="按方向键发射眼泪")
        pg.keyboard.up("ArrowRight")
        check("方向键发射眼泪", pg.evaluate("() => window.__game.tearCount > 0"))
        # 移动：WASD 改变位置
        x0 = pg.evaluate("() => window.__game.player.x")
        pg.keyboard.down("d")
        time.sleep(0.4)
        pg.keyboard.up("d")
        x1 = pg.evaluate("() => window.__game.player.x")
        check("WASD 移动改变位置", abs(x1 - x0) > 10, f"{round(x0)} -> {round(x1)}")
        # 清房：杀掉所有敌人后门打开
        pg.evaluate("() => window.__game.killAll()")
        check("清空房间后 cleared", wait_for(pg, "window.__game.room.cleared === true", timeout=5000))

        print("--- T4 道具效果 ---")
        dmg0 = pg.evaluate("() => window.__game.player.damage")
        pg.evaluate("() => window.__game.giveItem('cricket_head')")
        dmg1 = pg.evaluate("() => window.__game.player.damage")
        check("蟋蟀头提升攻击", dmg1 > dmg0, f"{dmg0} -> {dmg1}")
        pg.evaluate("() => window.__game.giveItem('technology')")
        check("科技变为激光", pg.evaluate("() => window.__game.player.laser") is True)
        pg.evaluate("() => window.__game.giveItem('magic_mushroom')")
        check("魔法蘑菇红色皮肤", pg.evaluate("() => window.__game.player.redSkin") is True)
        pg.evaluate("() => window.__game.giveItem('polyphemus')")
        check("波吕斐摩斯大眼泪", pg.evaluate("() => window.__game.player.bigTear") is True)
        items = pg.evaluate("() => window.__game.player.items")
        check("道具列表 4 件", len(items) == 4, items)
        shot(pg, "03-items.png")

        print("--- T5 BOT 全流程通关（3 层 + 最终 Boss） ---")
        pg.evaluate("() => window.__game.godMode()")
        pg.evaluate("() => window.__game.botStart()")
        # 诊断：每 5 秒打印 BOT 状态
        t0 = time.time()
        last_diag = 0
        won = False
        while time.time() - t0 < 90:
            try:
                st = pg.evaluate("() => ({ state: window.__game.state, floor: window.__game.floor, room: window.__game.room.type, enemies: window.__game.enemies.length, hp: Math.round(window.__game.player.hp), x: Math.round(window.__game.player.x), y: Math.round(window.__game.player.y), tears: window.__game.tearCount, kills: window.__game.stats.kills })")
            except Exception:
                st = {"state": "?"}
            if st.get("state") == "victory":
                won = True
                break
            if time.time() - t0 > last_diag:
                print(f"  [BOT {int(time.time()-t0)}s] {st}")
                last_diag += 5
            time.sleep(0.2)
        check("BOT 通关到达 victory", won)
        if won:
            floor = pg.evaluate("() => window.__game.floor")
            kills = pg.evaluate("() => window.__game.stats.kills")
            check("通关在第 3 层", floor >= 3, f"floor={floor}, kills={kills}")
            shot(pg, "04-victory.png")

        print("--- T6 死亡界面 ---")
        pg.evaluate("() => window.__game.start(7)")
        wait_for(pg, "window.__game.state === 'playing'")
        pg.evaluate("() => { window.__game.player.inv = 0; Entities.damagePlayer(999, 0, 0); }")
        check("死亡后 state=dead", wait_for(pg, "window.__game.state === 'dead'"))
        check("死亡界面可见", pg.is_visible("#screen-dead"))
        k = pg.inner_text("#dead-kills")
        check("死亡数据-击杀数", k.isdigit(), k)
        shot(pg, "05-dead.png")

        ctx.close()

        # ============ 移动端（触控） ============
        print("--- T7 移动端触控 ---")
        mctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        mp = mctx.new_page()
        mp.on("pageerror", lambda e: print(f"  [页面错误] {e}"))
        mp.goto(BASE, wait_until="load")
        check("移动端触控 UI 可见", mp.is_visible("#joy-zone") and mp.is_visible("#shoot-zone"))
        mp.click("#btn-start")
        wait_for(mp, "window.__game.state === 'playing'")
        # 手动派发真实 TouchEvent（Playwright 的 tap/CDP touch 在 is_mobile 模式下不可靠）
        mp.evaluate("""
          () => {
            const btn = document.querySelector('.shoot-btn[data-dir="right"]');
            const r = btn.getBoundingClientRect();
            const t = new Touch({ identifier: 1, target: btn, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
            btn.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
          }
        """)
        mp.wait_for_timeout(400)
        check("触控按住射击产生眼泪", mp.evaluate("() => window.__game.tearCount > 0"))
        # 虚拟摇杆：触摸按下并保持拖动
        x0 = mp.evaluate("() => window.__game.player.x")
        mp.evaluate("""
          () => {
            const zone = document.getElementById('joy-zone');
            const r = zone.getBoundingClientRect();
            const cx = r.left + 70, cy = r.top + r.height - 70;
            const mk = (x, y) => new Touch({ identifier: 2, target: zone, clientX: x, clientY: y });
            zone.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(cx, cy)], targetTouches: [mk(cx, cy)], changedTouches: [mk(cx, cy)], bubbles: true, cancelable: true }));
            zone.dispatchEvent(new TouchEvent('touchmove', { touches: [mk(cx + 42, cy)], targetTouches: [mk(cx + 42, cy)], changedTouches: [mk(cx + 42, cy)], bubbles: true, cancelable: true }));
          }
        """)
        mp.wait_for_timeout(500)
        x1 = mp.evaluate("() => window.__game.player.x")
        mp.evaluate("""
          () => {
            const zone = document.getElementById('joy-zone');
            zone.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [], bubbles: true, cancelable: true }));
          }
        """)
        check("虚拟摇杆控制移动", abs(x1 - x0) > 10, f"{round(x0)} -> {round(x1)}")
        shot(mp, "06-mobile.png")
        mctx.close()

        browser.close()

    ok = all(results)
    print(f"\n结果：{sum(results)}/{len(results)} 通过" + ("，全部通过" if ok else ""))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
