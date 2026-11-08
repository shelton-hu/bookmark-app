import os
BASE = os.environ.get('BOOKMARK_BASE_URL', 'http://127.0.0.1:8011').rstrip('/')
import sys, asyncio, os, subprocess, shutil
from playwright.async_api import async_playwright
S, tag = sys.argv[1], sys.argv[2]
STEP = int(sys.argv[3]) if len(sys.argv) > 3 else 60
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome')
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, locale='zh-CN')
        page = await ctx.new_page()
        await page.goto(BASE + '/'); await page.wait_for_timeout(800)
        if await page.locator('input[type=password]').count():
            await page.locator('input').nth(0).fill('演示账号'); await page.locator('input[type=password]').fill('demo-pass-123')
            await page.keyboard.press('Enter'); await page.wait_for_timeout(1500)
        if await page.get_by_role('button', name='去纯享版').count():
            await page.get_by_role('button', name='去纯享版').click()
        await page.wait_for_timeout(2500)
        await page.clock.install()
        await page.clock.pause_at(await page.evaluate('Date.now()') + 1000)
        card = page.locator('.hand-card.is-centered .clow-art').first
        if not await card.count(): card = page.locator('.clow-art').first
        await card.click()
        d = f'{S}/frames-{tag}'; shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
        for i in range(24):
            await page.screenshot(path=f'{d}/{i:02d}.png')
            await page.clock.run_for(STEP)
        await ctx.close(); await b.close()
        out = f'{S}/{tag}-strip.png'
        subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate','1','-i',f'{d}/%02d.png','-vf',
            "crop=800:800:240:0,scale=240:-1,tile=8x3",
            '-frames:v','1',out], check=True)
        print(out)
asyncio.run(main())
