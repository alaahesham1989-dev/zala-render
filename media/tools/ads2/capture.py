"""Screenshots of the real partner sign-up form being filled (mobile, Arabic). Never submits."""
import json, os, sys
from playwright.sync_api import sync_playwright

WORK = os.environ['WORK']
spec = json.load(open(f'{WORK}/bundle.json', encoding='utf-8'))['spec']['form']
shots = f'{WORK}/form'
os.makedirs(shots, exist_ok=True)


def step(name, page, target=None, action=None):
    try:
        if action:
            action()
        if target is not None:
            target().evaluate("e => e.scrollIntoView({block: 'center'})")
        page.wait_for_timeout(700)
        page.screenshot(path=f'{shots}/{name}.png')
        print(name, 'ok')
    except Exception as e:
        print(name, 'FAILED', type(e).__name__)


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 390, 'height': 780}, device_scale_factor=3, locale='ar-EG', is_mobile=True, has_touch=True)
    page.goto(spec['url'], wait_until='domcontentloaded', timeout=90000)   # the site keeps a live connection open
    try:
        page.wait_for_selector('form button[aria-pressed]', timeout=60000)
    except Exception:
        sys.exit(f'no form on the page (title: {page.title()!r})')
    page.wait_for_timeout(2500)

    def service():
        for t in spec['service']:
            btn = page.locator('form button[aria-pressed]', has_text=t).first
            if btn.count() and btn.get_attribute('aria-pressed') != 'true':
                btn.click()
                return

    step('1service', page, lambda: page.locator('form button[aria-pressed]').first, service)
    city = lambda: page.locator('form select').nth(1)
    step('2city', page, city, lambda: city().select_option(value=spec['city']))
    extra = lambda: page.locator(f'form input[placeholder*="{spec["field_hint"]}"]').first
    step('3vehicle', page, extra, lambda: extra().fill(spec['field_text'], timeout=8000))
    paper = lambda: page.locator('form button[aria-pressed]', has_text=spec['paper']).first
    step('4paper', page, paper, lambda: paper().click(timeout=8000))
    b.close()

if not os.listdir(shots):
    sys.exit('no form screenshots')
