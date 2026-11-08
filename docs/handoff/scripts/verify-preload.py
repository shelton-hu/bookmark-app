"""Verify preloading through the normal page, using only an isolated demo server."""
import argparse
import asyncio
import json
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='http://127.0.0.1:18015')
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--engine', choices=['chrome', 'webkit'], default='chrome')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

INSTRUMENT = """(() => {
  window.__artwork = { decoded: [], prepared: [] };
  const decode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function(...args) {
    const url = this.dataset.summonSource || this.src;
    if (url.includes('/spirits/')) window.__artwork.decoded.push(url);
    return decode.apply(this, args);
  };
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
    const result = draw.call(this, source, ...args);
    if (source instanceof HTMLImageElement && (source.dataset.summonSource || source.src).includes('/spirits/')) this.canvas.__artwork = source.dataset.summonSource || source.src;
    if (source instanceof HTMLCanvasElement && source.__artwork && (this.filter || '').startsWith('blur')) {
      window.__artwork.prepared.push(source.__artwork);
    }
    return result;
  };
})()"""


async def context_for(browser, reduced=False):
    context = await browser.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce' if reduced else 'no-preference')
    await context.add_init_script(INSTRUMENT)
    return context


async def login(context):
    page = await context.new_page()
    await page.goto(args.base_url)
    await page.wait_for_selector('input[type=password], .mode-manage')
    if await page.locator('.mode-manage').count():
        return page
    await page.get_by_role('textbox', name='用户名', exact=True).fill('演示账号')
    await page.locator('input[type=password]').fill('demo-pass-123')
    await page.get_by_role('button', name='登录', exact=True).click()
    await page.locator('.mode-manage').wait_for()
    return page


async def enjoy(page):
    await page.get_by_role('button', name='去纯享版', exact=True).first.click()
    await page.locator('.hand-card.is-centered').wait_for()


async def ready(page):
    await expect(page.locator('#summon-preload-status')).to_have_attribute('data-state', 'ready', timeout=30000)
    await expect(page.locator('.hand-card.is-centered .clow-art')).to_be_enabled()


async def timing(page):
    return await page.evaluate("""async () => {
      const png = performance.getEntriesByType('resource').filter(r => r.name.includes('/spirits/'));
      const count = await new Promise((resolve, reject) => {
        const request = indexedDB.open('bookmark-summon-assets', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const count = db.transaction('artwork').objectStore('artwork').count();
          count.onsuccess = () => { db.close(); resolve(count.result); };
        };
      });
      return { unique: new Set(png.map(r => r.name)).size,
        network_transfers: png.filter(r => r.transferSize > 0).length,
        transferred_bytes: png.reduce((total, r) => total + r.transferSize, 0),
        locally_cached_sources: count,
        nearby_decodes: window.__artwork.decoded.length };
    }""")


async def main():
    results = {}
    async with async_playwright() as p:
        browser = await (p.chromium.launch(channel='chrome') if args.engine == 'chrome' else p.webkit.launch())
        # Hold all restored images before the page opens, proving startup does not block login or management.
        context = await context_for(browser)
        release = asyncio.Event()
        requests = []
        async def hold(route):
            requests.append(route.request.url)
            await release.wait()
            await route.continue_()
        await context.route('**/spirits/*-restored-v*.png', hold)
        page = await login(context)
        assert requests, 'startup must begin downloads before entering enjoy mode'
        await enjoy(page)
        await expect(page.locator('#summon-preload-status')).to_have_attribute('data-state', 'loading')
        await expect(page.locator('.hand-card.is-centered .clow-art')).to_be_disabled()
        await expect(page.locator('.hand-card.is-centered .clow-details-seal')).to_be_enabled()
        await page.screenshot(path=str(args.out / f'{args.engine}-startup-progress.png'))
        await page.set_viewport_size({'width': 390, 'height': 844})
        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
        await page.screenshot(path=str(args.out / f'{args.engine}-startup-mobile.png'))
        await page.set_viewport_size({'width': 1280, 'height': 900})
        release.set()
        await ready(page)
        assert (await page.locator('#summon-preload-status').inner_text()) == '召唤已就绪'
        before = await page.evaluate('structuredClone(window.__artwork)')
        assert len(before['decoded']) == 5
        await page.evaluate('() => { window.__opens = 0; window.open = () => { window.__opens++; return null; }; }')
        if args.engine == 'chrome':
            cdp = await context.new_cdp_session(page)
            await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        await page.clock.install()
        await page.clock.pause_at(await page.evaluate('new Date(Date.now() + 100).toISOString()'))
        await page.locator('.hand-card.is-centered .clow-art').evaluate('button => button.click()')
        await expect(page.locator('.clow-summon')).to_have_attribute('data-artwork', 'restored')
        await page.clock.run_for(1000)
        await expect(page.locator('.clow-summon')).to_have_attribute('data-phase', 'summoning')
        await page.screenshot(path=str(args.out / f'{args.engine}-preloaded-summon.png'))
        await page.clock.run_for(1200)
        await expect(page.locator('.clow-summon')).to_have_count(0)
        assert await page.evaluate('window.__opens') == 1
        assert before == await page.evaluate('window.__artwork')
        await page.locator('.clow-popup-notice').wait_for()
        await page.keyboard.press('Escape')
        await page.clock.run_for(1000)
        await expect(page.locator('.clow-reader[open]')).to_have_count(0)
        await page.clock.resume()
        if args.engine == 'chrome':
            await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        await page.locator('.hand-rail').focus()
        await page.keyboard.press('End')
        await ready(page)
        results['startup'] = {'downloads_started_on_login_page': True, 'progress_and_disabled_summon_before_ready': True,
            'details_remain_available': True, 'mobile_overflow': False, 'nearby_decoded_before_click': 5,
            'warm_click_extra_decode_or_texture_work': False, 'opens': 1, 'browsing_reprioritizes': True}
        await context.close()

        # Private test contexts evict most of this 79 MiB deck. Use an ordinary persistent
        # browser profile, without routing (routing also disables HTTP caching).
        profile = tempfile.TemporaryDirectory(prefix='bookmark-animation-cache-')
        async def cached_context():
            engine = p.chromium if args.engine == 'chrome' else p.webkit
            options = {'channel': 'chrome'} if args.engine == 'chrome' else {}
            context = await engine.launch_persistent_context(profile.name, headless=True, viewport={'width': 1280, 'height': 900}, **options)
            await context.add_init_script(INSTRUMENT)
            return context
        context = await cached_context()
        page = await login(context)
        await enjoy(page)
        await ready(page)
        first = await timing(page)
        assert first['unique'] == 52 and first['network_transfers'] > 0, first
        await page.reload()
        await page.locator('.mode-manage').wait_for()
        await enjoy(page)
        await ready(page)
        refreshed = await timing(page)
        assert refreshed['locally_cached_sources'] == 52 and refreshed['transferred_bytes'] == 0, refreshed
        second = await context.new_page()
        await second.goto(args.base_url)
        await second.locator('.mode-manage').wait_for()
        await enjoy(second)
        await ready(second)
        new_tab = await timing(second)
        assert new_tab['locally_cached_sources'] == 52 and new_tab['transferred_bytes'] == 0, new_tab
        await context.close()
        context = await cached_context()
        page = await login(context)
        await enjoy(page)
        await ready(page)
        restarted = await timing(page)
        assert restarted['locally_cached_sources'] == 52 and restarted['transferred_bytes'] == 0, restarted
        results['browser_cache'] = {'first_visit': first, 'normal_refresh': refreshed, 'new_tab': new_tab, 'browser_restart': restarted}
        await context.close()
        profile.cleanup()

        context = await context_for(browser)
        fail = True
        async def fail_one(route):
            if fail:
                await route.abort()
            else:
                await route.continue_()
        await context.route('**/spirits/thunder-restored-v1.png', fail_one)
        page = await login(context)
        await enjoy(page)
        await expect(page.locator('#summon-preload-status')).to_have_attribute('data-state', 'error', timeout=30000)
        await expect(page.locator('.hand-card.is-centered .clow-art')).to_be_disabled()
        await expect(page.locator('.hand-card.is-centered .clow-details-seal')).to_be_enabled()
        fail = False
        await page.get_by_role('button', name='重试', exact=True).click()
        await ready(page)
        results['retry'] = {'failure_keeps_details_available': True, 'retry_unlocks_summoning': True}
        await context.close()

        context = await context_for(browser)
        await context.add_init_script("Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Storage denied', 'SecurityError'); } })")
        page = await login(context)
        await enjoy(page)
        await ready(page)
        results['storage_unavailable'] = {'http_cache_fallback_keeps_summoning_usable': True}
        await context.close()

        context = await context_for(browser, reduced=True)
        page = await login(context)
        await enjoy(page)
        await expect(page.locator('#summon-preload-status')).to_have_attribute('data-state', 'skipped')
        await expect(page.locator('.hand-card.is-centered .clow-art')).to_be_enabled()
        assert not await page.evaluate("performance.getEntriesByType('resource').some(r => r.name.includes('/spirits/'))")
        results['reduced_motion'] = {'skips_resource_downloads_and_keeps_direct_open_enabled': True}
        await context.close()
        await browser.close()
    (args.out / f'{args.engine}-preload-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps({'engine': args.engine, 'results': results}, ensure_ascii=False, indent=2))


asyncio.run(main())
