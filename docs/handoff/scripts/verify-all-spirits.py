"""Verify every deck entry uses its own restored artwork in the actual overlay."""
import argparse
import asyncio
import json
import re
from pathlib import Path

from playwright.async_api import async_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='http://127.0.0.1:18011')
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--engine', choices=['chrome', 'webkit'], default='chrome')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[3]
keys = re.findall(r'\["([a-z]+)",', (root / 'web/src/clowDeck.ts').read_text())


async def main():
    report = {'engine': args.engine, 'cards': [], 'errors': []}
    async with async_playwright() as p:
        browser = await (p.chromium.launch(channel='chrome') if args.engine == 'chrome' else p.webkit.launch())
        context = await browser.new_context(viewport={'width': 1280, 'height': 900})
        page = await context.new_page()
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        await page.goto(args.base_url + '/?summon-preview=all')
        select = page.get_by_role('combobox', name='选择卡牌')
        assert await select.locator('option').count() == 52
        await page.clock.install()
        await page.clock.pause_at(await page.evaluate('Date.now()') + 100)
        for key in keys:
            await select.select_option(key)
            await expect(page.locator('.rain-art-original img')).to_have_attribute('src', f'/clow-deck/{key}.webp')
            source = await page.locator('.rain-art-character image').get_attribute('href')
            assert source and source.startswith('/spirits/' + key + '-restored-v'), (key, source)
            await page.evaluate('''async source => {
                const img = new Image(); img.src = source; await img.decode();
                if (!img.naturalWidth || !img.naturalHeight) throw Error('empty restored image');
            }''', source)
            await page.get_by_role('button', name='播放召唤').click()
            await expect(page.locator('.clow-summon')).to_have_attribute('data-artwork', 'restored')
            await page.clock.run_for(1150)
            circle = await page.locator('.clow-summon-ground').bounding_box()
            card = await page.locator('.clow-summon-flight').bounding_box()
            assert circle and card
            assert abs(circle['y'] + circle['height'] / 2 - card['y'] - card['height']) < 1, key
            assert await page.locator('.clow-summon-circle').get_attribute('src') == '/clow-scene/clow-circle.svg'
            if args.engine == 'chrome':
                await page.screenshot(path=str(args.out / f'{key}-summon.png'))
            await page.clock.run_for(900)
            await expect(page.locator('.clow-summon')).to_have_count(0)
            report['cards'].append({'key': key, 'artwork': source, 'restored': True, 'card_at_circle_centre': True, 'completed': True})
        await select.select_option('earthy')
        await page.get_by_role('button', name='下一张牌').click()
        await expect(select).to_have_value('windy')
        await page.get_by_role('button', name='上一张牌').click()
        await expect(select).to_have_value('earthy')
        await page.get_by_role('button', name='原牌叠加对照').click()
        await expect(page.locator('.rain-art-comparison')).to_have_class(re.compile('is-overlaid'))
        for width, height in [(390, 844), (320, 568), (844, 390)]:
            await page.set_viewport_size({'width': width, 'height': height})
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            await page.get_by_role('button', name='播放召唤').click()
            await page.clock.run_for(1150)
            if args.engine == 'chrome':
                await page.screenshot(path=str(args.out / f'earthy-{width}.png'))
            await page.keyboard.press('Escape')
            await page.clock.run_for(2200)
            await expect(page.locator('.clow-summon')).to_have_count(0)
        assert len(context.pages) == 1, 'Preview must not open any real bookmark URLs'
        await browser.close()
    assert not report['errors'], report['errors']
    assert len(report['cards']) == 52
    (args.out / f'{args.engine}-all-spirits.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f'{args.engine}: all 52 restored subjects loaded, summoned at circle centre and completed; picker, mobile and cancellation passed.')


asyncio.run(main())
