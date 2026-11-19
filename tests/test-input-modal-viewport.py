"""弹窗视口与交互回归：python3 tests/test-input-modal-viewport.py"""

import functools
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


class InputModalViewportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(QuietHandler, directory=str(ROOT))
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base_url = f'http://127.0.0.1:{cls.server.server_port}/index.html'
        cls.playwright = sync_playwright().start()
        cls.browsers = {}
        cls.launch_errors = {}
        for engine in ('chromium', 'webkit'):
            try:
                cls.browsers[engine] = getattr(cls.playwright, engine).launch()
            except Exception as exc:
                cls.launch_errors[engine] = str(exc)

    @classmethod
    def tearDownClass(cls):
        for browser in cls.browsers.values():
            browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join()

    def browser(self, engine):
        if engine not in self.browsers:
            self.skipTest(f'{engine} 不可用：{self.launch_errors.get(engine, "未知错误")}')
        return self.browsers[engine]

    def open_page(self, engine, mobile):
        options = {'viewport': {'width': 390 if mobile else 1280, 'height': 844 if mobile else 900}}
        if mobile:
            options.update({'is_mobile': True, 'has_touch': True, 'device_scale_factor': 2})
        context = self.browser(engine).new_context(**options)
        page = context.new_page()
        page.route('https://**/*', lambda route: route.abort())
        page.goto(self.base_url, wait_until='domcontentloaded')
        page.wait_for_function("()=>document.getElementById('loadingMask')?.classList.contains('hide')")
        page.wait_for_timeout(350)
        return context, page

    def snapshot(self, page):
        return page.evaluate("""()=>{
          const v=visualViewport,m=document.getElementById('giongbeta-input-modal');
          const p=m?.querySelector('div'),r=p?.getBoundingClientRect(),mr=m?.getBoundingClientRect();
          const rect=x=>x&&{left:x.left,top:x.top,right:x.right,bottom:x.bottom,width:x.width,height:x.height};
          return {scale:v?.scale||1,visualWidth:v?.width||innerWidth,visualHeight:v?.height||innerHeight,
            offsetLeft:v?.offsetLeft||0,offsetTop:v?.offsetTop||0,scrollX,scrollY,
            viewportContent:document.querySelector('meta[name="viewport"]')?.content||'',
            rootTouchAction:document.documentElement.style.touchAction,bodyTouchAction:document.body.style.touchAction,
            modalTouchAction:m?.style.touchAction||'',modalTransform:m?.style.transform||'',
            modalTransitionProperty:m?.style.transitionProperty||'',visibility:m?.style.visibility||'missing',
            guardActive:Boolean(GIONGBETA_INPUT_MODAL._viewportGuard),panelRect:rect(r),modalRect:rect(mr),
            callback:window.__modalCallback,activeElement:document.activeElement?.id||''};
        }""")

    def open_direct(self, page):
        page.evaluate("""()=>{
          window.__modalCallback='unset';
          GIONGBETA_INPUT_MODAL.show('验证弹窗','请输入','初始值',value=>{
            window.__modalCallback=value===null?'cancel':value;
          });
        }""")
        page.wait_for_timeout(450)

    def activate(self, page, selector, position=None):
        locator = page.locator(selector)
        if page.evaluate("()=>matchMedia('(pointer: coarse)').matches"):
            locator.tap(position=position)
        else:
            locator.click(position=position)
        page.wait_for_timeout(400)

    def assert_closed_and_restored(self, page, original):
        state = self.snapshot(page)
        self.assertEqual(state['visibility'], 'hidden')
        self.assertFalse(state['guardActive'])
        self.assertEqual(state['viewportContent'], original['viewportContent'])
        self.assertEqual(state['rootTouchAction'], original['rootTouchAction'])
        self.assertEqual(state['bodyTouchAction'], original['bodyTouchAction'])
        self.assertEqual(state['modalTouchAction'], original['modalTouchAction'])
        self.assertEqual(state['modalTransform'], original['modalTransform'])
        self.assertEqual(state['modalTransitionProperty'], original['modalTransitionProperty'] or 'all')

    def assert_panel_in_view(self, state):
        panel = state['panelRect']
        self.assertIsNotNone(panel)
        self.assertGreaterEqual(panel['left'], state['offsetLeft'] - 0.05)
        self.assertLessEqual(panel['right'], state['offsetLeft'] + state['visualWidth'] + 0.05)
        self.assertGreaterEqual(panel['top'], state['offsetTop'] - 0.05)
        self.assertLessEqual(panel['bottom'], state['offsetTop'] + state['visualHeight'] + 0.05)

    def pinch(self, page, factor):
        session = page.context.new_cdp_session(page)
        session.send('Input.synthesizePinchGesture', {
            'x': 100, 'y': 160, 'scaleFactor': factor,
            'relativeSpeed': 800, 'gestureSourceType': 'touch'
        })
        session.detach()
        page.wait_for_timeout(500)

    def run_default_lifecycle(self, engine, mobile):
        context, page = self.open_page(engine, mobile)
        try:
            original = self.snapshot(page)
            trigger = page.locator('[data-action="saveFilterPrompt"]')
            trigger.scroll_into_view_if_needed()
            self.activate(page, '[data-action="saveFilterPrompt"]')
            opened = self.snapshot(page)
            self.assertEqual(opened['visibility'], 'visible')
            self.assertEqual(opened['guardActive'], mobile)
            self.assertEqual(opened['scale'], original['scale'])
            self.assert_panel_in_view(opened)
            self.activate(page, '#giongbeta-modal-cancel')
            self.assert_closed_and_restored(page, original)

            self.open_direct(page)
            page.locator('#giongbeta-modal-input').fill('验证方案 A')
            self.activate(page, '#giongbeta-modal-confirm')
            self.assertEqual(self.snapshot(page)['callback'], '验证方案 A')
            self.assert_closed_and_restored(page, original)

            self.open_direct(page)
            self.activate(page, '#giongbeta-modal-cancel')
            self.assertEqual(self.snapshot(page)['callback'], 'cancel')
            self.assert_closed_and_restored(page, original)

            self.open_direct(page)
            self.activate(page, '#giongbeta-input-modal', {'x': 5, 'y': 5})
            self.assertEqual(self.snapshot(page)['callback'], 'cancel')
            self.assert_closed_and_restored(page, original)

            for _ in range(2):
                self.open_direct(page)
                self.assert_panel_in_view(self.snapshot(page))
                self.activate(page, '#giongbeta-modal-cancel')
                self.assert_closed_and_restored(page, original)

            selector = '.tag[data-group="colorsx"][data-value="红单"]'
            tag = page.locator(selector)
            tag.scroll_into_view_if_needed()
            before = tag.get_attribute('class')
            self.activate(page, selector)
            self.assertNotEqual(tag.get_attribute('class'), before)
            self.assertEqual(page.evaluate('()=>visualViewport.scale'), original['scale'])
        finally:
            context.close()

    def test_chromium_desktop(self):
        self.run_default_lifecycle('chromium', False)

    def test_webkit_desktop(self):
        self.run_default_lifecycle('webkit', False)

    def test_chromium_mobile(self):
        self.run_default_lifecycle('chromium', True)

    def test_webkit_mobile(self):
        self.run_default_lifecycle('webkit', True)

    def test_chromium_mobile_prezoom(self):
        context, page = self.open_page('chromium', True)
        try:
            self.pinch(page, 2)
            original = self.snapshot(page)
            self.assertGreater(original['scale'], 1.5)
            self.open_direct(page)
            opened = self.snapshot(page)
            self.assertTrue(opened['guardActive'])
            self.assert_panel_in_view(opened)
            page.wait_for_timeout(300)
            settled = self.snapshot(page)
            self.assertEqual(settled['panelRect'], opened['panelRect'])
            self.assertEqual(settled['modalRect'], opened['modalRect'])
            self.assertEqual(settled['viewportContent'], original['viewportContent'])
            for state in (opened, settled):
                self.assertAlmostEqual(state['scale'], original['scale'], delta=0.001)
                self.assertAlmostEqual(state['offsetLeft'], original['offsetLeft'], delta=0.01)
                self.assertAlmostEqual(state['offsetTop'], original['offsetTop'], delta=0.01)

            page.locator('#giongbeta-modal-input').fill('预缩放输入')
            page.evaluate("""()=>{
              window.__lastClickTarget='';
              document.addEventListener('click',event=>{window.__lastClickTarget=event.target.id},{once:true,capture:true});
            }""")
            point = page.locator('#giongbeta-modal-cancel').evaluate("""el=>{
              const r=el.getBoundingClientRect(),v=visualViewport;
              return {x:r.left+r.width/2-v.offsetLeft,y:r.top+r.height/2-v.offsetTop};
            }""")
            page.touchscreen.tap(point['x'], point['y'])
            page.wait_for_timeout(400)
            closed = self.snapshot(page)
            self.assertEqual(page.evaluate('()=>window.__lastClickTarget'), 'giongbeta-modal-cancel')
            self.assertEqual(closed['callback'], 'cancel')
            self.assertAlmostEqual(closed['scale'], original['scale'], delta=0.001)
            self.assertAlmostEqual(closed['offsetLeft'], original['offsetLeft'], delta=0.01)
            self.assertAlmostEqual(closed['offsetTop'], original['offsetTop'], delta=0.01)
            self.assert_closed_and_restored(page, original)
        finally:
            context.close()

    def test_chromium_pinch_lock_and_restore(self):
        context, page = self.open_page('chromium', True)
        try:
            original = self.snapshot(page)
            self.open_direct(page)
            self.pinch(page, 2)
            self.assertEqual(self.snapshot(page)['scale'], 1)
            self.activate(page, '#giongbeta-modal-cancel')
            self.assert_closed_and_restored(page, original)
            self.pinch(page, 2)
            self.assertGreater(self.snapshot(page)['scale'], 1.5)
        finally:
            context.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
