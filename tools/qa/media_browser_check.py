"""Exercise media attachment in isolated headless Edge with generated test media."""
import base64
from functools import partial
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import struct
import sys
import threading
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".qa/vendor"))
from playwright.sync_api import sync_playwright, expect
from browser_check import QuietHandler


def jpeg_gps(jpeg):
    tiff = bytearray(128)
    struct.pack_into("<2sHI", tiff, 0, b"II", 42, 8)
    struct.pack_into("<H", tiff, 8, 1)
    struct.pack_into("<HHII", tiff, 10, 0x8825, 4, 1, 26)
    struct.pack_into("<H", tiff, 26, 4)
    for index in range(4):
        offset = 28 + index * 12
        struct.pack_into("<HHI", tiff, offset, index + 1, 2 if index % 2 == 0 else 5, 2 if index % 2 == 0 else 3)
        if index % 2 == 0:
            tiff[offset + 8] = ord("N" if index == 0 else "W")
        else:
            struct.pack_into("<I", tiff, offset + 8, 80 if index == 1 else 104)
    for offset, degrees in ((80, 40), (104, 105)):
        for part in range(3):
            struct.pack_into("<II", tiff, offset + part * 8, degrees if part == 0 else 0, 1)
    payload = b"Exif\x00\x00" + tiff
    return jpeg[:2] + b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload + jpeg[2:]


def main():
    folder = ROOT / ".qa"
    folder.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results, errors, uploads = [], [], []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: uploads.append(request.url) if request.method in ("POST", "PUT") else None)
        page.on("dialog", lambda dialog: dialog.accept())
        try:
            page.goto(f"http://127.0.0.1:{server.server_port}/viewer/", wait_until="domcontentloaded")
            page.wait_for_selector("body[data-ready=true]", timeout=60000)
            media = page.evaluate("""() => {
                const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
                const context = canvas.getContext('2d'); context.fillStyle = '#39735d'; context.fillRect(0,0,80,60);
                context.fillStyle = '#ddd'; context.fillRect(20,15,30,25);
                return {png: canvas.toDataURL('image/png').split(',')[1], jpeg: canvas.toDataURL('image/jpeg').split(',')[1]};
            }""")
            page.locator("#addMedia").click()
            page.locator("#mediaFiles").set_input_files({"name": "no-gps.png", "mimeType": "image/png", "buffer": base64.b64decode(media["png"])})
            expect(page.locator("#mediaEditor")).to_be_visible()
            expect(page.locator("#mediaMetadata")).to_contain_text("No supported location")
            expect(page.locator("#mediaGPS")).to_be_disabled()
            page.locator("#mediaTitle").fill("Approach view")
            page.locator("#mediaLat").fill("40.15")
            page.locator("#mediaLon").fill("-105.49")
            page.locator("#mediaTitle").click()
            page.locator("#mediaAssociation").select_option("0")
            page.locator("#mediaForm button[type=submit]").click()
            expect(page.locator("#libraryStatus")).to_contain_text("Location saved")
            expect(page.locator("#mediaList")).to_contain_text("40.15000, -105.49000")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("body[data-ready=true]", timeout=60000)
            page.locator("#addMedia").click()
            page.locator("[data-media-open]").first.click()
            expect(page.locator("#mediaTitle")).to_have_value("Approach view")
            expect(page.locator("#mediaLat")).to_have_value("40.15")
            results.append("No-GPS photo manually pinned with optional route; bytes/title/pin survive reload")
            page.locator("#mediaClose").click()
            page.locator("#mediaFiles").set_input_files([
                {"name": "geotagged.jpg", "mimeType": "image/jpeg", "buffer": jpeg_gps(base64.b64decode(media["jpeg"]))},
                {"name": "bad.heic", "mimeType": "image/heic", "buffer": b"unsupported"},
            ])
            expect(page.locator("#mediaEditor")).to_be_visible()
            expect(page.locator("#libraryStatus")).to_contain_text("Unsupported format")
            expect(page.locator("#mediaGPS")).to_be_enabled()
            expect(page.locator("#mediaLat")).to_have_value("40")
            page.locator("#mediaLat").fill("40.151")
            page.locator("#mediaLon").fill("-105.491")
            page.locator("#mediaForm button[type=submit]").click()
            expect(page.locator("#libraryStatus")).to_contain_text("Location saved")
            page.locator("#mediaGPS").click()
            expect(page.locator("#mediaLat")).to_have_value("40")
            page.locator("#mediaScrub").click()
            page.locator("#mediaForm button[type=submit]").click()
            expect(page.locator("#libraryStatus")).to_contain_text("Location saved")
            results.append("GPS suggestion can be manually overridden and reset; invalid batch file does not lose successful imports")
            page.wait_for_selector("body[data-map-ready=true]", timeout=60000)
            page.locator("#overview").click()
            page.locator("#mediaPick").click()
            bounds = page.locator("#cesium canvas").first.bounding_box()
            page.mouse.click(bounds["x"] + bounds["width"] * 0.52, bounds["y"] + bounds["height"] * 0.52)
            expect(page.locator("#libraryStatus")).to_contain_text("Pin placed")
            page.locator("#mediaForm button[type=submit]").click()
            expect(page.locator("#libraryStatus")).to_contain_text("Location saved")
            expect(page.locator("#mediaList")).to_contain_text("map-only")
            before_drag = page.locator("#mediaLat").input_value()
            page.mouse.move(bounds["x"] + bounds["width"] * 0.52, bounds["y"] + bounds["height"] * 0.52)
            page.mouse.down()
            page.mouse.move(bounds["x"] + bounds["width"] * 0.56, bounds["y"] + bounds["height"] * 0.56, steps=8)
            page.mouse.up()
            assert page.locator("#mediaLat").input_value() != before_drag
            page.locator("#mediaForm button[type=submit]").click()
            expect(page.locator("#libraryStatus")).to_contain_text("Location saved")
            page.screenshot(path=str(folder / "media-desktop.png"))
            results.append("Real Cesium click and drag edit an off-trail pin without requiring GPS")
            page.locator("#mediaClose").click()
            video = page.evaluate("""async () => {
                const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
                canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:9999'; document.body.append(canvas);
                const context = canvas.getContext('2d'), stream = canvas.captureStream(0);
                const recorder = new MediaRecorder(stream, {mimeType: 'video/webm;codecs=vp8'}), chunks = [];
                recorder.ondataavailable = event => chunks.push(event.data);
                const stopped = new Promise(resolve => recorder.onstop = resolve);
                recorder.start();
                for (let frame = 0; frame < 12; frame++) {
                    context.fillStyle = frame % 2 ? '#cfa' : '#347'; context.fillRect(0,0,80,60);
                    stream.getVideoTracks()[0].requestFrame();
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop()); canvas.remove();
                return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
            }""")
            (folder / "media-fixture.webm").write_bytes(bytes(video))
            page.locator("#mediaFiles").set_input_files({"name": "trail-clip.webm", "mimeType": "video/webm", "buffer": bytes(video)})
            expect(page.locator("#mediaPreview video")).to_be_visible()
            page.locator("#mediaScrub").click()
            page.locator("#mediaForm button[type=submit]").click()
            expect(page.locator("#libraryStatus")).to_contain_text("Location saved")
            results.append("Personal video without GPS imports, previews, and saves at trail position")
            page.locator("#mediaClose").click()
            with page.expect_download() as download:
                page.locator("#mediaBackup").click()
            backup = folder / "media-test-backup.trailmedia"
            download.value.save_as(str(backup))
            page.locator("#mediaRestore").set_input_files(str(backup))
            expect(page.locator("#libraryStatus")).to_contain_text("duplicate/conflict skipped")
            expect(page.locator("[data-media-open]")).to_have_count(3)
            results.append("Backup includes files; duplicate restore reports conflicts and retains local pins")
            fresh = browser.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True)
            mobile = fresh.new_page(); mobile.on("pageerror", lambda error: errors.append(str(error)))
            mobile.goto(page.url, wait_until="domcontentloaded")
            mobile.wait_for_selector("body[data-ready=true]", timeout=60000)
            mobile.locator("#addMedia").click()
            mobile.locator("#mediaRestore").set_input_files(str(backup))
            expect(mobile.locator("[data-media-open]")).to_have_count(3)
            mobile.get_by_role("button", name="Approach view", exact=True).click()
            expect(mobile.locator("#mediaTitle")).to_have_value("Approach view")
            mobile.locator("#mediaLat").fill("40.152")
            mobile.locator("#mediaLon").fill("-105.492")
            mobile.locator("#mediaForm button[type=submit]").click()
            expect(mobile.locator("#libraryStatus")).to_contain_text("Location saved")
            assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth")
            mobile.wait_for_selector("body[data-map-ready=true]", timeout=60000)
            mobile.screenshot(path=str(folder / "media-mobile.png"), full_page=True)
            fresh.close()
            results.append("Fresh-browser restore recovers media; 390px manual placement has no horizontal overflow")
            page.locator("#mediaFilter").select_option("all")
            page.locator(".media-card").filter(has_text="geotagged.jpg").locator("[data-media-select]").check()
            page.get_by_text("Prepare selected media for publication", exact=True).click()
            with page.expect_download() as download:
                page.locator("#mediaPublish").click()
            publication = folder / "media-test-publication.trailmedia"
            download.value.save_as(str(publication))
            sys.path.insert(0, str(ROOT / "tools/pipeline"))
            from media_publication import read_publication
            published = read_publication(publication, "bunce-school-road")
            assert len(published) == 1 and published[0][0]["original_gps"] is None
            assert published[0][0]["mime"] == "image/jpeg"
            assert b"Exif\x00\x00" not in published[0][1]
            results.append("Selected photo publication strips metadata, preserves reviewed pin, and exports without uploading")
            import package_site
            from import_media import import_media
            # Exercise a repository import and then a normal build, without writing
            # generated fixtures into the user's source media manifest.
            checkout = package_site.package("bunce-school-road", "dist/media-qa-" + uuid.uuid4().hex[:8])
            import_media(publication, "bunce-school-road", checkout / "viewer")
            with patch.object(package_site, "REPO", checkout):
                artifact = package_site.package("bunce-school-road", checkout / "dist/shared")
            packaged_context = browser.new_context()
            packaged = packaged_context.new_page()
            packaged.on("pageerror", lambda error: errors.append(str(error)))
            packaged.goto(f"http://127.0.0.1:{server.server_port}/{artifact.relative_to(ROOT).as_posix()}/viewer/", wait_until="domcontentloaded")
            packaged.wait_for_selector("body[data-ready=true]", timeout=60000)
            packaged.locator("#addMedia").click()
            expect(packaged.locator("#mediaList")).to_contain_text("Published")
            packaged.locator("[data-media-open]").first.click()
            expect(packaged.locator("#mediaPreview img")).to_be_visible()
            expect(packaged.locator("#mediaForm")).to_be_hidden()
            packaged_context.close()
            results.append("Repository import survives a normal build; fresh browser loads shared media read-only under a project subdirectory")
            page.locator("#mediaFiles").set_input_files({"name": "unplaced.jpg", "mimeType": "image/jpeg", "buffer": base64.b64decode(media["jpeg"])})
            expect(page.locator("#mediaEditor")).to_be_visible()
            page.locator("#mediaUnplaced").click()
            expect(page.locator("#libraryStatus")).to_contain_text("Saved in Unplaced")
            page.locator("#mediaClose").click()
            page.locator("#mediaFilter").select_option("unplaced")
            expect(page.locator("[data-media-open]")).to_have_count(1)
            page.locator("#mediaClear").click()
            page.locator("#mediaSelect").click()
            page.locator("#mediaBatchPin").click()
            expect(page.locator("#libraryStatus")).to_contain_text("pinned.")
            expect(page.locator("[data-media-open]")).to_have_count(0)
            page.locator("#mediaFilter").select_option("nearby")
            expect(page.locator("[data-media-open]")).to_have_count(2)
            page.locator("#scrub").evaluate("input => { input.value = 900; input.dispatchEvent(new Event('input', {bubbles:true})); }")
            expect(page.locator("[data-media-open]")).to_have_count(0)
            results.append("Unplaced inbox, explicit batch placement, and scrub-nearby gallery work")
            page.locator("#mediaFilter").select_option("all")
            page.evaluate("""() => {
                const put = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function(...args) {
                    IDBObjectStore.prototype.put = put;
                    throw new DOMException('Simulated storage full; existing files kept', 'QuotaExceededError');
                };
            }""")
            page.locator("#mediaFiles").set_input_files({"name": "quota.jpg", "mimeType": "image/jpeg", "buffer": jpeg_gps(base64.b64decode(media["jpeg"])) + b"new"})
            expect(page.locator("#libraryStatus")).to_contain_text("storage full")
            expect(page.locator("[data-media-open]")).to_have_count(4)
            results.append("Quota failure is visible and leaves existing attachments intact")
            denied_context = browser.new_context()
            denied_context.add_init_script("indexedDB.open = () => { throw new DOMException('Storage disabled', 'SecurityError'); }")
            denied = denied_context.new_page()
            denied.goto(page.url, wait_until="domcontentloaded")
            denied.wait_for_selector("body[data-ready=true]", timeout=60000)
            denied.locator("#addMedia").click()
            expect(denied.locator("#libraryStatus")).to_contain_text("storage unavailable")
            denied_context.close()
            results.append("Blocked media storage does not prevent the trail viewer from booting")
            assert not uploads, uploads
            assert not errors, errors
            print(json.dumps({"passed": results, "app_errors": errors, "uploads": uploads}, indent=2))
        except Exception:
            page.screenshot(path=str(folder / "media-failure.png"), full_page=True)
            print(json.dumps({"passed": results, "app_errors": errors, "status": page.locator("#libraryStatus").inner_text()}, indent=2))
            raise
        finally:
            browser.close(); server.shutdown()


if __name__ == "__main__":
    main()
