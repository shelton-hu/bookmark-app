"""Check original-art rain restoration and the existing summoning animation."""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='http://127.0.0.1:18011')
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--engine', choices=['chrome', 'webkit'], default='chrome')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)


async def main():
    result = {'engine': args.engine, 'errors': [], 'viewports': [], 'floor_projections': []}
    async with async_playwright() as p:
        browser = await (p.chromium.launch(channel='chrome') if args.engine == 'chrome' else p.webkit.launch())
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 900})
        page = await ctx.new_page()
        page.on('pageerror', lambda error: result['errors'].append(str(error)))
        await page.goto(args.base_url + '/?summon-preview=rain-3d')
        await expect(page).to_have_title('雨之牌 · 原画补齐预览')
        assert not await page.locator('.rain-3d-canvas').count()
        await page.evaluate("""async () => {const i=new Image();i.src='/spirits/rain-restored-v3.png';await i.decode();}""")
        for width, height in [(1280, 900), (390, 844), (320, 568), (844, 390)]:
            await page.set_viewport_size({'width': width, 'height': height})
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            await page.screenshot(path=str(args.out / f'{args.engine}-compare-{width}.png'), full_page=True)
            result['viewports'].append([width, height])
        await page.set_viewport_size({'width': 1280, 'height': 900})
        await page.get_by_role('button', name='原牌叠加对照').click()
        await page.screenshot(path=str(args.out / f'{args.engine}-overlay.png'))
        await page.get_by_role('button', name='退出叠加对照').click()
        await page.clock.install()
        await page.clock.pause_at(await page.evaluate('Date.now()') + 100)
        await page.get_by_role('button', name='播放召唤').click()
        await expect(page.locator('.clow-summon')).to_have_attribute('data-artwork', 'restored')
        circle = page.locator('.clow-summon-circle')
        await expect(circle).to_have_attribute('src', '/clow-scene/clow-circle.svg')
        await expect(circle).to_have_js_property('naturalWidth', 788)
        await expect(circle).to_have_js_property('naturalHeight', 788)
        await page.clock.run_for(1150)
        async def check_floor(width, height):
            plane = await page.locator('.clow-summon-ground').bounding_box()
            assert plane, 'The floor circle must have a rendered projection'
            assert abs(plane['height'] / plane['width'] - .36) < .001, plane
            assert plane['y'] + plane['height'] / 2 > height / 2, plane
            assert plane['x'] >= 15 and plane['x'] + plane['width'] <= width - 15, plane
            assert plane['y'] + plane['height'] < height - 30, plane
            card = await page.locator('.clow-summon-flight').bounding_box()
            assert card
            centre_x = plane['x'] + plane['width'] / 2
            centre_y = plane['y'] + plane['height'] / 2
            assert abs(card['x'] + card['width'] / 2 - centre_x) < 1, (card, plane)
            assert abs(card['y'] + card['height'] - centre_y) < 1, (card, plane)
            result['floor_projections'].append({'viewport': [width, height], 'card_foot_at_centre': True, **plane})
        await check_floor(1280, 900)
        await page.screenshot(path=str(args.out / f'{args.engine}-summon.png'))
        await page.clock.run_for(900)
        await expect(page.locator('.clow-summon')).to_have_count(0)
        await expect(page.get_by_role('status', exact=False)).to_contain_text('播放完成')
        await page.get_by_role('button', name='播放召唤').click()
        await page.keyboard.press('Escape')
        await page.clock.run_for(2200)
        await expect(page.locator('.clow-summon')).to_have_count(0)
        assert len(ctx.pages) == 1
        for width, height in [(390, 844), (320, 568), (844, 390)]:
            await page.set_viewport_size({'width': width, 'height': height})
            await page.get_by_role('button', name='播放召唤').click()
            await page.clock.run_for(1150)
            await check_floor(width, height)
            await page.screenshot(path=str(args.out / f'{args.engine}-summon-{width}.png'))
            await page.keyboard.press('Escape')
            await expect(page.locator('.clow-summon')).to_have_count(0)
        await ctx.close()

        # If a restored asset fails, preserve the original identity and retry next time.
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 900})
        await ctx.route('**/spirits/rain-restored-v3.png', lambda route: route.abort())
        page = await ctx.new_page()
        await page.goto(args.base_url + '/?summon-preview=rain')
        await page.get_by_role('button', name='播放召唤').click()
        await expect(page.locator('.clow-summon')).to_have_attribute('data-artwork', 'extracted')
        await page.get_by_role('button', name='取消打开网页').click()
        await ctx.unroute('**/spirits/rain-restored-v3.png')
        await page.get_by_role('button', name='播放召唤').click()
        await expect(page.locator('.clow-summon')).to_have_attribute('data-artwork', 'restored')
        await page.get_by_role('button', name='取消打开网页').click()
        await ctx.close()
        await browser.close()
    assert not result['errors'], result['errors']
    result.update({'restored_art_used': True, 'shared_clow_circle_loaded': True, 'complete_and_cancel': 'pass', 'asset_failure_retries': 'pass', 'legacy_3d_url_uses_original_art': True})
    (args.out / f'{args.engine}-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))


asyncio.run(main())
