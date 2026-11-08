"""Check the light opening transition on an isolated demo server (no real data)."""
import argparse
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='http://127.0.0.1:18017')
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--engine', choices=['chrome', 'webkit'], default='chrome')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

INSTRUMENT = """(() => {
  window.__canvasCalls = 0; window.__storageCalls = 0;
  const context = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(...args) { window.__canvasCalls++; return context.apply(this, args); };
  const storage = window.indexedDB;
  Object.defineProperty(window, 'indexedDB', { configurable: true, get() { window.__storageCalls++; return storage; } });
})()"""


async def session(browser, viewport=None, reduced=False, frozen=True):
    context = await browser.new_context(viewport=viewport or {'width': 1280, 'height': 900}, reduced_motion='reduce' if reduced else 'no-preference')
    await context.add_init_script(INSTRUMENT)
    # Any accidental reintroduction of restored-figure downloads must fail the check.
    unexpected = []
    context.on('request', lambda request: unexpected.append(request.url) if '/spirits/' in request.url else None)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto(args.base_url)
    await page.get_by_role('textbox', name='用户名', exact=True).fill('演示账号')
    await page.locator('input[type=password]').fill('demo-pass-123')
    await page.get_by_role('button', name='登录', exact=True).click()
    await page.locator('.mode-manage').wait_for()
    await page.get_by_role('button', name='去纯享版', exact=True).first.click()
    await expect(page.locator('.hand-card.is-centered .clow-art')).to_be_enabled()
    await expect(page.locator('.hand-card.is-centered .clow-details-seal')).to_have_css('position', 'absolute')
    await expect(page.locator('.hand-card.is-centered .clow-details-seal')).to_have_css('height', '44px')
    assert await page.locator('#summon-preload-status').count() == 0
    # Decode the already visible face before freezing time; lazy loading otherwise
    # makes screenshot timing test the harness rather than the opening animation.
    await page.locator('.hand-card.is-centered .clow-face-image').evaluate('image => image.decode()')
    if frozen:
        await page.clock.install()
        await page.clock.pause_at(await page.evaluate('new Date(Date.now() + 100).toISOString()'))
    return context, page, unexpected, errors


async def mocked_open(page):
    await page.evaluate('() => { window.__opens = 0; window.open = () => { window.__opens++; return null; }; }')


async def paused_open(page):
    await page.locator('.hand-card.is-centered .clow-art').evaluate('button => button.click()')
    await page.locator('.card-open[open]').wait_for()
    frame = await page.locator('.card-open-face').evaluate('''card => {
      const animations = card.getAnimations({subtree:true});
      for (const animation of animations) { animation.pause(); animation.currentTime = 300; }
      const travel = card.getAnimations()[0];
      const spin = card.querySelector('.card-open-flipper').getAnimations()[0];
      const frames = spin.effect.getKeyframes();
      return { duration: spin.effect.getTiming().duration, spin_end: frames.at(-1).transform,
        travel_end: travel.effect.getKeyframes().at(-1).transform,
        front_backfaces: getComputedStyle(card.querySelector('.card-open-front')).backfaceVisibility,
        back_backfaces: getComputedStyle(card.querySelector('.card-open-back')).backfaceVisibility,
        back_turn: getComputedStyle(card.querySelector('.card-open-back')).transform,
        first_half_turn_ms: frames.find(frame => parseFloat(frame.transform.split('rotateY(')[1]) >= 180).offset * spin.effect.getTiming().duration,
        images: card.querySelectorAll('img').length, canvases: card.querySelectorAll('canvas').length };
    }''')
    await page.clock.run_for(32)
    await page.locator('.card-open-front img').evaluate('image => image.decode()')
    return frame


async def main():
    results = {'viewports': [], 'lifecycle': []}
    async with async_playwright() as p:
        browser = await (p.chromium.launch(channel='chrome') if args.engine == 'chrome' else p.webkit.launch())
        for width, height in [(1280, 900), (390, 844), (320, 568), (844, 390)]:
            context, page, requests, errors = await session(browser, {'width': width, 'height': height})
            await mocked_open(page)
            frame = await paused_open(page)
            assert frame['duration'] == 600 and frame['images'] == 1 and frame['canvases'] == 0
            assert 'rotateY(720deg)' in frame['spin_end'], frame
            assert 'rotate(' not in frame['spin_end'] and 'rotate(' not in frame['travel_end']
            assert frame['first_half_turn_ms'] <= 100, frame
            assert frame['front_backfaces'] == frame['back_backfaces'] == 'hidden'
            assert frame['back_turn'].startswith('matrix3d(-1,'), frame
            assert not frame['travel_end'].endswith('scale(1)')
            await page.screenshot(path=str(args.out / f'{args.engine}-{width}x{height}-opening.png'))
            await page.locator('.card-open-face').evaluate('card => card.getAnimations({subtree:true}).forEach(animation => animation.currentTime = 50)')
            await page.screenshot(path=str(args.out / f'{args.engine}-{width}x{height}-back.png'))
            await page.keyboard.press('Escape')
            await page.clock.run_for(2000)
            await expect(page.locator('.card-open')).to_have_count(0)
            assert await page.evaluate('window.__opens') == 0
            assert await page.evaluate('window.__canvasCalls + window.__storageCalls') == 0
            assert not requests and not errors, (requests, errors)
            results['viewports'].append({'width': width, 'height': height, 'duration_ms': 600, 'vertical_spin_degrees': 720,
                                        'first_half_turn_ms': frame['first_half_turn_ms'], 'front_and_back': True, 'rotation_and_growth': True,
                                        'canvas_calls': 0, 'indexeddb_calls': 0, 'spirit_requests': 0, 'cancelled_without_opening': True})
            await context.close()

        for action in ['close', 'skip', 'resize', 'pagehide', 'watchdog', 'reduced-during-playback']:
            context, page, requests, errors = await session(browser)
            await mocked_open(page)
            await paused_open(page)
            if action == 'close':
                await page.get_by_role('button', name='取消打开网页', exact=True).click()
            elif action == 'skip':
                await page.locator('.card-open').click(position={'x': 10, 'y': 200})
            elif action == 'resize':
                await page.set_viewport_size({'width': 1100, 'height': 850})
                await expect(page.locator('.card-open')).to_have_count(0)
            elif action == 'pagehide':
                await page.evaluate("window.dispatchEvent(new Event('pagehide'))")
            elif action == 'reduced-during-playback':
                await page.emulate_media(reduced_motion='reduce')
            # A deliberately paused native animation exercises the 900ms watchdog.
            await page.clock.run_for(2000)
            await expect(page.locator('.card-open')).to_have_count(0)
            opens = await page.evaluate('window.__opens')
            assert opens == (1 if action in ['skip', 'watchdog', 'reduced-during-playback'] else 0), (action, opens)
            assert not requests and not errors, (requests, errors)
            results['lifecycle'].append({'action': action, 'opens': opens, 'no_late_or_duplicate_navigation': True})
            await context.close()

        context, page, requests, errors = await session(browser, reduced=True)
        await mocked_open(page)
        await page.locator('.hand-card.is-centered .clow-art').evaluate('button => button.click()')
        assert await page.evaluate('window.__opens') == 1
        assert await page.locator('.card-open').count() == 0
        assert not requests and not errors
        results['reduced_motion_direct_open'] = True
        await context.close()

        context, page, requests, errors = await session(browser, frozen=False)
        details = page.locator('.hand-card.is-centered .clow-details-seal')
        await details.click()
        await expect(page.locator('.clow-reader[open]')).to_have_count(1)
        await expect(page.get_by_role('link', name='打开网站', exact=True)).to_have_count(1)
        await page.get_by_role('button', name='关闭书签详情', exact=True).click()
        await expect(page.locator('.clow-reader[open]')).to_have_count(0)
        await expect(details).to_be_focused()
        assert not requests and not errors
        results['details'] = {'open_close_and_return_focus': True, 'hit_height': 44}
        await context.close()

        # Real user input and the actual native animation must open the local test URL.
        context, page, requests, errors = await session(browser, frozen=False)
        if args.engine == 'chrome':
            cdp = await context.new_cdp_session(page)
            await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        await page.evaluate('''() => {
          window.__start = performance.now(); const open = window.open;
          window.open = function(...args) { window.__openedAfter = performance.now() - window.__start; return open.apply(this, args); };
        }''')
        async with page.expect_popup() as info:
            await page.locator('.hand-card.is-centered .clow-art').click()
        popup = await info.value
        await popup.wait_for_url('**/api/health?animation-check=1')
        await popup.wait_for_load_state('domcontentloaded')
        assert '/api/health?animation-check=1' in popup.url, popup.url
        elapsed = await page.evaluate('window.__openedAfter')
        assert 500 <= elapsed < 2000, elapsed
        await expect(page.locator('.card-open')).to_have_count(0)
        assert not requests and not errors, (requests, errors)
        results['real_open'] = {'elapsed_ms': round(elapsed, 1), 'cpu_slowdown': 4 if args.engine == 'chrome' else 1,
                                'popup_url': popup.url, 'native_animation_finished': True}
        await popup.close()
        await context.close()
        await browser.close()
    (args.out / f'{args.engine}-card-open-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps({'engine': args.engine, 'results': results}, ensure_ascii=False, indent=2))


asyncio.run(main())
