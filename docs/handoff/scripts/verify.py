"""Read-only UI checks against the isolated, seeded handoff demo server."""
import argparse
import asyncio
import json
import re
from pathlib import Path

from playwright.async_api import async_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='http://127.0.0.1:8011')
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--only', choices=['all', 'layout', 'chrome', 'webkit', 'cache'], default='all')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

INSTRUMENT = """(() => {
  window.__figureRuns = [];
  const p = CanvasRenderingContext2D.prototype, read = p.getImageData, write = p.putImageData;
  p.getImageData = function(...args) { this.__figureStart = performance.now(); return read.apply(this, args); };
  p.putImageData = function(...args) {
    const result = write.apply(this, args);
    if (this.__figureStart !== undefined) {
      window.__figureRuns.push(performance.now() - this.__figureStart);
      delete this.__figureStart;
    }
    return result;
  };
  const draw = p.drawImage;
  p.drawImage = function(source, ...args) {
    const start = performance.now(), result = draw.call(this, source, ...args);
    if (source instanceof HTMLImageElement && source.src.includes('/spirits/')) {
      window.__figureRuns.push(performance.now() - start);
    }
    return result;
  };
})()"""


async def login(page):
    await page.goto(args.base_url)
    await page.get_by_role('textbox', name='用户名', exact=True).fill('演示账号')
    await page.locator('input[type=password]').fill('demo-pass-123')
    await page.get_by_role('button', name='登录', exact=True).click()
    await page.locator('.mode-manage').wait_for()


async def enjoy(page):
    await page.get_by_role('button', name='去纯享版', exact=True).first.click()
    await page.locator('.hand-card.is-centered .clow-art').wait_for()


async def summon(page):
    await page.locator('.hand-card.is-centered .clow-art').click()
    await page.locator('.clow-summon[open]').wait_for()


async def layout(browser, results):
    page = await browser.new_page()
    await login(page)
    for width in [1920, 1440, 1280, 1100, 768, 390, 320]:
        await page.set_viewport_size({'width': width, 'height': 900 if width > 700 else 844})
        await page.mouse.move(0, 0)
        for route, label in [('library', '全部书签'), ('pending', '待整理箱'), ('folders', '目录管理')]:
            await page.goto(f'{args.base_url}/#{route}')
            await page.get_by_role('heading', name=label, exact=True).wait_for()
            mode = page.get_by_role('button', name='去纯享版', exact=True)
            assert await mode.count() == 1, (width, route, 'missing accessible mode switch')
            overflow = await page.evaluate('document.documentElement.scrollWidth > innerWidth')
            assert not overflow, (width, route, 'horizontal overflow')
            if route == 'pending':
                assert await page.locator('.page-actions .primary').inner_text() == '分类助手'
                assert not await page.locator('.action-add.primary').count()
                if width <= 1100:
                    await expect(page.locator('.topbar .action-add')).to_have_css('background-color', 'rgb(255, 255, 255)')
            if route == 'folders':
                child = page.locator('.folder-row-path', has_text='前端开发')
                assert await child.inner_text() == '前端开发'
                assert await child.get_attribute('title') == '开发与技术 / 前端开发'
            if width in [1440, 390]:
                await page.screenshot(path=str(args.out / f'{route}-{width}.png'), full_page=True)
            results.append({'width': width, 'page': route, 'overflow': False})
    await page.close()


async def animation(browser, name, results):
    ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    # Exercise real popups without contacting the bookmarked sites.
    await ctx.route('https://**/*', lambda route: route.fulfill(status=200, content_type='text/html', body='<title>书签测试目标</title>'))
    await ctx.add_init_script(INSTRUMENT)
    page = await ctx.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await login(page)
    await enjoy(page)
    if name == 'chrome':
        cdp = await ctx.new_cdp_session(page)
        await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
    await summon(page)
    await page.wait_for_function('window.__figureRuns.length === 1')
    first = await page.evaluate('window.__figureRuns[0]')
    await page.get_by_role('button', name='取消打开网页').click()
    await summon(page)
    await page.wait_for_timeout(200)
    assert await page.evaluate('window.__figureRuns.length') == 1, 'cached card was extracted twice'
    await page.keyboard.press('Escape')
    await page.wait_for_timeout(2100)
    assert len(ctx.pages) == 1 and await page.locator('.clow-summon').count() == 0

    await page.clock.install()
    await page.clock.pause_at(await page.evaluate('Date.now()') + 100)
    await summon(page)
    for elapsed in [800, 1100, 1450]:
        await page.clock.run_for(elapsed - (0 if elapsed == 800 else (800 if elapsed == 1100 else 1100)))
        await page.screenshot(path=str(args.out / f'{name}-summon-{elapsed}.png'))
    async with page.expect_popup() as popup_info:
        await page.clock.run_for(600)
    popup = await popup_info.value
    await popup.wait_for_url(re.compile(r'^https://'))
    await popup.wait_for_load_state()
    assert await popup.evaluate('window.opener === null')
    await popup.close()

    await summon(page)
    async with page.expect_popup() as popup_info:
        await page.locator('.clow-summon').click(position={'x': 10, 'y': 200})
    await (await popup_info.value).close()
    await page.clock.run_for(2500)
    assert len(ctx.pages) == 1, 'skipping opened a second tab later'

    await page.evaluate('window.__realOpen = window.open; window.open = () => null')
    await summon(page)
    await page.clock.run_for(2100)
    await page.locator('.clow-popup-notice').wait_for()
    assert await page.get_by_role('link', name='打开网站').count() == 1
    await page.screenshot(path=str(args.out / f'{name}-blocked.png'))
    await page.keyboard.press('Escape')
    await page.clock.run_for(1000)
    await page.evaluate('window.open = window.__realOpen')
    await page.emulate_media(reduced_motion='reduce')
    async with page.expect_popup() as popup_info:
        await page.locator('.hand-card.is-centered .clow-art').click()
    await (await popup_info.value).close()
    assert not await page.locator('.clow-summon').count()
    assert not errors, errors
    results.append({'engine': name, 'first_extraction_ms': round(first, 1), 'cpu_slowdown': 4 if name == 'chrome' else 1,
                    'cache_reused': True, 'cancel_escape_skip_complete_blocked_reduced': 'pass', 'page_errors': errors})
    await ctx.close()


async def retry_artwork(browser, results):
    ctx = await browser.new_context(viewport={'width': 1280, 'height': 800})
    await ctx.add_init_script(INSTRUMENT)
    await ctx.route('**/clow-deck/*.webp', lambda route: route.abort())
    await ctx.route('**/spirits/*-restored-v*.png', lambda route: route.abort())
    page = await ctx.new_page()
    await login(page)
    await enjoy(page)
    first_card = await page.locator('.hand-card.is-centered .clow-art').get_attribute('aria-label')
    await summon(page)
    await page.wait_for_timeout(300)
    assert await page.evaluate('window.__figureRuns.length') == 0
    await page.keyboard.press('Escape')
    await ctx.unroute('**/clow-deck/*.webp')
    await ctx.unroute('**/spirits/*-restored-v*.png')
    await summon(page)
    await page.wait_for_function('window.__figureRuns.length === 1')
    await page.keyboard.press('Escape')
    # Nine distinct cards must evict the first from the eight-card cache.
    for index in range(1, 9):
        await page.locator('.hand-card .clow-art').nth(index).evaluate('button => button.click()')
        await page.wait_for_function('count => window.__figureRuns.length === count', arg=index + 1)
        await page.keyboard.press('Escape')
    await page.get_by_role('button', name=first_card, exact=True).evaluate('button => button.click()')
    await page.wait_for_function('window.__figureRuns.length === 10')
    await page.keyboard.press('Escape')
    results.append({'artwork_failure_retries_next_summon': 'pass', 'cache_evicts_after_eight_cards': 'pass'})
    await ctx.close()


async def main():
    results = []
    async with async_playwright() as p:
        chrome = await p.chromium.launch(channel='chrome')
        if args.only in ['all', 'layout']:
            await layout(chrome, results)
            print('Management layout: 21 checks passed', flush=True)
        if args.only in ['all', 'chrome']:
            await animation(chrome, 'chrome', results)
            print('Chrome animation and cache reuse passed', flush=True)
        if args.only in ['all', 'cache']:
            await retry_artwork(chrome, results)
            print('Artwork retry and cache eviction passed', flush=True)
        await chrome.close()
        if args.only in ['all', 'webkit']:
            webkit = await p.webkit.launch()
            await animation(webkit, 'webkit', results)
            await webkit.close()
    report = 'results.json' if args.only == 'all' else f'results-{args.only}.json'
    (args.out / report).write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False, indent=2))


asyncio.run(main())
