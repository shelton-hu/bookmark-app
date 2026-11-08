"""Exercise cold artwork loading through the normal bookmark page, without preloading."""
import argparse
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='http://127.0.0.1:18012')
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--engine', choices=['chrome', 'webkit'], default='chrome')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)


async def session(browser, failure=False):
    context = await browser.new_context(viewport={'width': 1280, 'height': 900})
    ready = asyncio.Event()
    async def artwork(route):
        if failure:
            await route.abort()
        else:
            await ready.wait()
            await route.continue_()
    await context.route('**/spirits/*-restored-v*.png', artwork)
    if failure:
        await context.route('**/clow-deck/*.webp', lambda route: route.abort())
    page = await context.new_page()
    await page.goto(args.base_url)
    await page.get_by_role('textbox', name='用户名', exact=True).fill('演示账号')
    await page.locator('input[type=password]').fill('demo-pass-123')
    await page.get_by_role('button', name='登录', exact=True).click()
    await page.locator('.mode-manage').wait_for()
    await page.get_by_role('button', name='去纯享版', exact=True).first.click()
    await page.locator('.hand-card.is-centered .clow-art').wait_for()
    await page.evaluate('() => { window.__opens = 0; window.open = () => { window.__opens++; return null; }; }')
    await page.clock.install()
    await page.clock.pause_at(await page.evaluate('new Date(Date.now() + 100).toISOString()'))
    return context, page, ready


async def click_card(page):
    await page.locator('.hand-card.is-centered .clow-art').click()


async def assert_waiting(page):
    await expect(page.locator('.clow-summon')).to_have_attribute('data-phase', 'preparing')
    await expect(page.locator('.clow-summon')).to_have_attribute('data-artwork', 'loading')
    await expect(page.locator('.clow-summon-flight')).to_have_css('opacity', '1')
    await expect(page.locator('.clow-summon-hollow')).to_have_css('opacity', '0')
    assert await page.evaluate('window.__opens') == 0


async def finish_late_image(page):
    # Only used AFTER cancellation, so the late-load callback is exercised too.
    await page.evaluate('''async () => {
        const key = document.querySelector('.hand-card.is-centered .clow-face-image').getAttribute('src').split('/').at(-1).split('.')[0];
        const version = key === 'rain' ? 3 : key === 'lock' ? 2 : 1;
        const image = new Image(); image.src = `/spirits/${key}-restored-v${version}.png`; await image.decode();
    }''')


async def main():
    results = []
    async with async_playwright() as p:
        browser = await (p.chromium.launch(channel='chrome') if args.engine == 'chrome' else p.webkit.launch())
        context, page, ready = await session(browser)
        await click_card(page)
        await page.clock.run_for(3000)
        await assert_waiting(page)
        await page.screenshot(path=str(args.out / f'{args.engine}-waiting.png'))
        ready.set()
        await expect(page.locator('.clow-summon')).to_have_attribute('data-artwork', 'restored')
        await page.clock.run_for(500)
        await expect(page.locator('.clow-summon')).to_have_attribute('data-phase', 'summoning')
        await page.screenshot(path=str(args.out / f'{args.engine}-original-spirit.png'))
        assert await page.evaluate('window.__opens') == 0
        await page.clock.run_for(900)
        assert await page.evaluate('window.__opens') == 1
        await expect(page.locator('.clow-summon')).to_have_count(0)
        results.append('cold first click holds intact card, resumes original artwork, opens once')
        await context.close()

        for action in ['escape', 'close', 'resize', 'skip']:
            context, page, ready = await session(browser)
            await click_card(page)
            await page.clock.run_for(1200)
            await assert_waiting(page)
            if action == 'escape':
                await page.keyboard.press('Escape')
            elif action == 'close':
                await page.get_by_role('button', name='取消打开网页').click()
            elif action == 'resize':
                await page.set_viewport_size({'width': 1100, 'height': 850})
            else:
                await page.locator('.clow-summon').click(position={'x': 10, 'y': 200})
            ready.set()
            await finish_late_image(page)
            await page.clock.run_for(12000)
            assert await page.evaluate('window.__opens') == (1 if action == 'skip' else 0), action
            await expect(page.locator('.clow-summon')).to_have_count(0)
            results.append(f'{action} while loading: no late or duplicate navigation')
            await context.close()

        context, page, ready = await session(browser)
        await click_card(page)
        await page.clock.run_for(8200)
        await expect(page.locator('.clow-summon')).to_have_count(0)
        assert await page.evaluate('window.__opens') == 1
        ready.set()
        await finish_late_image(page)
        await page.clock.run_for(3000)
        assert await page.evaluate('window.__opens') == 1
        results.append('unresponsive artwork times out to normal opening once')
        await context.close()

        context, page, ready = await session(browser, failure=True)
        await click_card(page)
        await expect(page.locator('.clow-summon')).to_have_count(0)
        assert await page.evaluate('window.__opens') == 1
        await page.clock.run_for(10000)
        assert await page.evaluate('window.__opens') == 1
        results.append('both images failing uses normal opening without a substitute creature')
        await context.close()
        await browser.close()
    (args.out / f'{args.engine}-loading-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps({'engine': args.engine, 'results': results}, ensure_ascii=False, indent=2))


asyncio.run(main())
