"""Isolated headless Edge checks; does not use the desktop app's browser profile."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'.qa/vendor'))
from playwright.sync_api import sync_playwright

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass


def main():
    folder=ROOT/'.qa';folder.mkdir(exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}/viewer/'
    results=[];errors=[];requests=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='msedge',headless=True,args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
        try:
            page.goto(url,wait_until='domcontentloaded')
            page.wait_for_selector('body[data-ready=true]',timeout=60000)
            page.wait_for_selector('body[data-map-ready=true]',timeout=60000)
            page.screenshot(path=str(folder/'desktop-overview.png'))
            results.append('App boots with real Cesium and cached assets')
            page.locator('#route').select_option('ironclads-lateral')
            assert 'Access conflict' in page.locator('#routeCard').inner_text()
            assert 'motor_vehicle=no' in page.locator('#routeCard').inner_text()
            results.append('Lateral access conflict and caveat visible')
            page.locator('#mode').select_option('follow')
            page.locator('#mode').select_option('top')
            with page.expect_request(lambda r:'/terrain/' in r.url and r.url.endswith('.bin'),timeout=30000):
                page.locator('#range').evaluate('(e)=>{e.value=100;e.dispatchEvent(new Event("input",{bubbles:true}));}')
            results.append('Close inspection loads detailed terrain on demand')
            page.locator('#scrub').evaluate('(e)=>{e.value=450;e.dispatchEvent(new Event("input",{bubbles:true}));}')
            before=page.locator('#hudMile').inner_text()
            page.locator('#route').select_option('main');page.locator('#route').select_option('ironclads-lateral')
            assert page.locator('#hudMile').inner_text()==before
            results.append('Per-route scrub position restored')
            page.locator('#direction').select_option('-1')
            page.locator('#next').click();assert page.locator('#hudMile').inner_text()!=before
            results.append('Reverse next-point navigation advances')
            page.locator('#profile').focus();before=page.locator('#scrub').input_value();page.keyboard.press('ArrowRight')
            assert page.locator('#scrub').input_value()!=before
            results.append('Keyboard profile navigation works')
            page.locator('#mode').select_option('global');assert page.locator('#range').is_disabled()
            page.locator('#share').click();share=page.url
            assert 'route=ironclads-lateral' in share and 'camera=' in share
            from urllib.parse import urlparse,parse_qs
            camera_before=json.loads(parse_qs(urlparse(share).query)['camera'][0])
            page.locator('#scrub').evaluate('(e)=>{e.value=500;e.dispatchEvent(new Event("input",{bubbles:true}));}')
            page.locator('#exagg').evaluate('(e)=>{e.value=15;e.dispatchEvent(new Event("input",{bubbles:true}));}')
            page.locator('#share').click()
            camera_after=json.loads(parse_qs(urlparse(page.url).query)['camera'][0])
            for k in camera_before:assert abs(camera_before[k]-camera_after[k])<.01,(k,camera_before,camera_after)
            results.append('Global camera stays fixed when scrubbing or changing exaggeration')
            results.append('View URL captures route and camera')
            page.locator('[data-tab=field]').click();page.locator('[data-notes]').first.fill('QA observation: wet & rocky\nPhotos 001–020')
            page.locator('[data-status]').first.select_option('captured')
            with page.expect_download() as d:page.locator('#exportNotes').click()
            download=d.value;download.save_as(str(folder/'notes.json'));assert 'wet & rocky' in (folder/'notes.json').read_text()
            with page.expect_download() as d:page.locator('#exportGpx').click()
            d.value.save_as(str(folder/'field-plan.gpx'))
            from xml.etree import ElementTree as ET
            ET.parse(folder/'field-plan.gpx')
            page.reload(wait_until='domcontentloaded');page.wait_for_selector('body[data-ready=true]',timeout=60000)
            page.locator('[data-tab=field]').click();assert page.locator('[data-notes]').first.input_value().startswith('QA observation')
            results.append('Field status/notes survive reload; JSON and GPX downloads valid')
            page.locator('[data-tab=conditions]').click();assert page.locator('#weatherCards .card').count()>=2
            assert page.locator('#snowCards .card').count()==3
            page.locator('#tripDate').fill('2030-01-01');assert 'No forecast available' in page.locator('#weatherCards').inner_text()
            results.append('Dated weather and snow render; future dates show no forecast')
            from datetime import date
            page.locator('#tripDate').fill(date.today().isoformat())
            page.locator('#overview').click()
            page.wait_for_selector('body[data-map-ready=true]',timeout=60000)
            page.screenshot(path=str(folder/'desktop-conditions.png'))
            page.locator('[data-tab=summary]').click();page.locator('#route').select_option('main')
            page.locator('#waypointList button').first.click();assert page.locator('#mediaContent iframe').count()==3
            page.locator('#pinMedia').click();title=page.locator('#mediaContent h3').inner_text()
            page.locator('#scrub').evaluate('(e)=>{e.value=900;e.dispatchEvent(new Event("input",{bubbles:true}));}')
            assert page.locator('#mediaContent h3').inner_text()==title
            results.append('Timestamp-ready embeds render and media pin survives scrubbing')
            page.locator('#togglePanel').click();assert page.locator('#sidebar').is_hidden();page.locator('#togglePanel').click()
            page.set_viewport_size({'width':390,'height':844});page.locator('[data-tab=summary]').click();page.screenshot(path=str(folder/'mobile-overview.png'),full_page=True)
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            results.append('390px mobile layout has no horizontal overflow')
            page.set_viewport_size({'width':1440,'height':1000});page.locator('#overview').click();page.screenshot(path=str(folder/'desktop-final.png'))
            broken=context.new_page();broken.route('**/current.json',lambda route:route.fulfill(status=404,body='missing'))
            broken.goto(url,wait_until='domcontentloaded');broken.wait_for_selector('#retry:not([hidden])');assert '404' in broken.locator('#loadMessage').inner_text();broken.close()
            results.append('Missing asset gives actionable retry state')
            artifact=ROOT/'dist/astra-enhance'
            if artifact.exists():
                deployed=context.new_page();deployed.on('pageerror',lambda e:errors.append(str(e)))
                deployed.goto(f'http://127.0.0.1:{server.server_port}/dist/astra-enhance/',wait_until='domcontentloaded')
                deployed.wait_for_selector('body[data-ready=true]',timeout=60000)
                assert '/dist/astra-enhance/viewer/' in deployed.url
                deployed.locator('#share').click();assert '/dist/astra-enhance/viewer/' in deployed.url and 'camera=' in deployed.url
                deployed.close();results.append('Packaged static site and share links work in a project subdirectory')
            assert not errors,errors
            print(json.dumps({'passed':results,'app_errors':errors,'terrain_detail_requests':len([r for r in requests if '/terrain/' in r and r.endswith('.bin')])},indent=2))
        except Exception:
            page.screenshot(path=str(folder/'failure.png'),full_page=True)
            print(json.dumps({'passed':results,'app_errors':errors,'load_message':page.locator('#loadMessage').inner_text()},indent=2))
            raise
        finally:
            browser.close();server.shutdown()

if __name__=='__main__':main()
