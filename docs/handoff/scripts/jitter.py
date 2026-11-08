import os
BASE = os.environ.get('BOOKMARK_BASE_URL', 'http://127.0.0.1:8011').rstrip('/')
import sys, asyncio, json
from playwright.async_api import async_playwright
S = sys.argv[1]
PROBE = """() => { const q = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
 return { scrollY: scrollY, docW: document.documentElement.clientWidth, docH: document.documentElement.scrollHeight,
  h1: q('.management-heading h1'), sub: q('.management-heading p'), rail: q('.folder-rail'), search: q('.search-panel'), input: q('.search-input'),
  tag: q('.filter-row input'), list: q('.library-panel'), toolbar: q('.list-toolbar'), rows: document.querySelectorAll('.bookmark-row').length,
  skel: document.querySelectorAll('.skeleton-card').length, clear: !!document.querySelector('.filter-row .text-button:not(.filter-refresh)') } }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome')
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, locale='zh-CN')
        page = await ctx.new_page()
        await page.goto(BASE + '/'); await page.wait_for_timeout(800)
        if await page.locator('input[type=password]').count():
            await page.locator('input').nth(0).fill('演示账号'); await page.locator('input[type=password]').fill('demo-pass-123')
            await page.keyboard.press('Enter'); await page.wait_for_timeout(1500)
        if await page.get_by_role('button', name='去管理版').count():
            await page.get_by_role('button', name='去管理版').click(); await page.wait_for_timeout(1000)
        await page.evaluate("""() => { window.__shifts = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__shifts.push({t: Math.round(e.startTime), v: +e.value.toFixed(4), src: e.sources.map(s => (s.node && (s.node.className || s.node.nodeName)) + ' ' + JSON.stringify([s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height]) + '->' + JSON.stringify([s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height]))}))).observe({type: 'layout-shift', buffered: false}); }""")
        for name in ['前端开发', '人工智能', '全部收藏']:
            before = await page.evaluate(PROBE)
            t0 = await page.evaluate('performance.now()')
            await page.locator('.folder-rail').get_by_role('button', name=name).first.click()
            states = []
            for i in range(12):
                states.append(await page.evaluate(PROBE)); await page.wait_for_timeout(25)
            print('==', name, 't0', round(t0)); print('before', json.dumps(before, ensure_ascii=False))
            seen = None
            for st in states:
                k = json.dumps(st, ensure_ascii=False)
                if k != seen: print('  ', k); seen = k
            await page.wait_for_timeout(500)
        print(json.dumps(await page.evaluate('window.__shifts'), ensure_ascii=False, indent=0)[:4000])
        await b.close()
asyncio.run(main())
