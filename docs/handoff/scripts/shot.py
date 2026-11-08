import os
BASE = os.environ.get('BOOKMARK_BASE_URL', 'http://127.0.0.1:8011').rstrip('/')
import sys, asyncio
from playwright.async_api import async_playwright
S = sys.argv[1]; tag = sys.argv[2] if len(sys.argv) > 2 else 'before'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome')
        for name, vp in [('desktop', {'width': 1440, 'height': 900}), ('mobile', {'width': 390, 'height': 844})]:
            ctx = await b.new_context(viewport=vp, device_scale_factor=2, locale='zh-CN')
            page = await ctx.new_page()
            await page.goto(BASE + '/')
            await page.wait_for_timeout(800)
            if await page.locator('input[type=password]').count():
                inputs = page.locator('input')
                await inputs.nth(0).fill('演示账号'); await page.locator('input[type=password]').fill('demo-pass-123')
                await page.keyboard.press('Enter'); await page.wait_for_timeout(1500)
            await page.screenshot(path=f'{S}/{tag}-{name}.png')
            await page.screenshot(path=f'{S}/{tag}-{name}-full.png', full_page=True)
            await ctx.close()
        await b.close()
asyncio.run(main())
