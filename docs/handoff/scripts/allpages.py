import os
BASE = os.environ.get('BOOKMARK_BASE_URL', 'http://127.0.0.1:8011').rstrip('/')
import sys, asyncio, subprocess
from playwright.async_api import async_playwright
S, tag = sys.argv[1], sys.argv[2]
names = ['全部书签', '待整理箱', '目录管理', '任务中心', '导入导出', '书签回收', '应用设置']
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
        files = []
        for i, n in enumerate(names):
            await page.locator('.sidebar').get_by_role('button', name=n).first.click(); await page.wait_for_timeout(900)
            f = f'{S}/{tag}-p{i}.png'; await page.screenshot(path=f); files.append(f)
        await b.close()
    args = ['ffmpeg','-y','-loglevel','error']
    for f in files: args += ['-i', f]
    n = len(files)
    args += ['-filter_complex', ''.join(f'[{i}:v]scale=720:-1[v{i}];' for i in range(n)) + ''.join(f'[v{i}]' for i in range(n)) + f'xstack=inputs={n}:layout=' + '|'.join(f'{(i%4)*720}_{(i//4)*450}' for i in range(n)) + ':fill=black', f'{S}/{tag}-pages.png']
    subprocess.run(args, check=True); print(f'{S}/{tag}-pages.png')
asyncio.run(main())
