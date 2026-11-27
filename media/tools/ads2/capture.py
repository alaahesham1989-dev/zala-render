"""Screenshots of the real partner sign-up form being filled (mobile, Arabic). Never submits."""
import json, os, sys
from playwright.sync_api import sync_playwright

WORK = os.environ['WORK']
HERE = os.path.dirname(os.path.abspath(__file__))
name = json.load(open(f'{WORK}/bundle.json', encoding='utf-8'))['spec']['name']
spec = json.load(open(os.path.join(HERE, name.replace('_ad', '') + '.json'), encoding='utf-8'))['form']
shots = f'{WORK}/form'
os.makedirs(shots, exist_ok=True)


def act(page, s):
    """Do one step on the form and return the element to centre."""
    if 'press' in s:
        for t in s['press']:
            btn = page.locator('form button[aria-pressed]', has_text=t).first
            if btn.count():
                if btn.get_attribute('aria-pressed') != 'true':
                    btn.click(timeout=8000)
                return btn
        raise LookupError('no such button')
    if 'city' in s:
        el = page.locator('form select').nth(1)
        el.select_option(value=s['city'], timeout=8000)
        return el
    if s.get('where') == 'textarea':
        el = page.locator('form textarea').first
    elif 'placeholder' in s:
        el = page.locator(f'form input[placeholder*="{s["placeholder"]}"]').first
    else:
        el = page.get_by_label(s['label']).first
    el.fill(s['fill'], timeout=8000)
    return el


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 390, 'height': 780}, device_scale_factor=3, locale='ar-EG', is_mobile=True, has_touch=True)
    page.goto(spec['url'], wait_until='domcontentloaded', timeout=90000)    # the site keeps a live connection open
    try:
        page.wait_for_selector('form button[aria-pressed]', timeout=60000)
    except Exception:
        sys.exit(f'no form on the page (title: {page.title()!r})')
    page.wait_for_timeout(2500)
    for i, s in enumerate(spec['steps'], 1):
        try:
            act(page, s).evaluate("e => e.scrollIntoView({block: 'center'})")
            print(i, 'ok')
        except Exception as e:
            print(i, 'FAILED', type(e).__name__)
        page.wait_for_timeout(700)
        page.screenshot(path=f'{shots}/{i}.png')
    b.close()
