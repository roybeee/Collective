import contextlib
import importlib.util
import io
import json
import os
import stat
import threading
import tempfile
import unittest
import urllib.error
from unittest import mock
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location('worker', Path(__file__).parents[1] / 'server/research-worker/worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
install_spec = importlib.util.spec_from_file_location('installer', Path(__file__).parents[1] / 'server/research-worker/install.py')
installer = importlib.util.module_from_spec(install_spec)
install_spec.loader.exec_module(installer)

class BrowserDiscoveryTest(unittest.TestCase):
    def test_flat_and_legacy_download_layouts(self):
        for relative in ('chrome-153.0.8010.47/chrome', 'chrome-153.0.8010.47/chrome-linux64/chrome'):
            with self.subTest(layout=relative), tempfile.TemporaryDirectory() as folder:
                chrome = Path(folder) / relative
                chrome.parent.mkdir(parents=True)
                chrome.write_text('test executable')
                chrome.chmod(0o755)
                self.assertEqual(installer.find_chrome(Path(folder)), chrome)
    def test_missing_or_non_executable_browser_stops_before_config(self):
        with tempfile.TemporaryDirectory() as folder:
            chrome = Path(folder) / 'chrome-153' / 'chrome'
            chrome.parent.mkdir()
            chrome.write_text('incomplete download')
            chrome.chmod(0o600)
            with self.assertRaises(RuntimeError):
                installer.find_chrome(Path(folder))

class Handler(BaseHTTPRequestHandler):
    redirect = False
    requests = []
    statuses = []
    bodies = []
    def do_POST(self):
        # 본문을 읽지 않고 닫으면 커널이 RST를 보내 클라이언트 read가 ConnectionResetError로 끊긴다.
        self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.requests.append((self.path, dict(self.headers)))
        if self.redirect:
            self.send_response(307)
            self.send_header('Location', '/unexpected')
            self.end_headers()
        elif self.statuses:
            self.send_response(self.statuses.pop(0))
            self.send_header('Content-Length', '0')
            self.end_headers()
        else:
            body = json.dumps(self.bodies.pop(0) if self.bodies else {'status': 'idle', 'pending': 0}).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    def log_message(self, *_):
        pass

class LocalWorkerServer(unittest.TestCase):
    def setUp(self):
        Handler.requests = []
        Handler.redirect = False
        Handler.statuses = []
        Handler.bodies = []
        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.config = {'site': 'http://127.0.0.1:'+str(self.server.server_port), 'token': 'scoped-test-token', 'owner': 'test-owner', 'gate': 'test-gate'}
    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
    def run_worker(self, ticks, path=None):
        # 대기 시간을 주입해 실제로 잠들지 않고 루프가 고른 지연만 기록한다.
        stop, delays, out, err = threading.Event(), [], io.StringIO(), io.StringIO()
        def wait(seconds):
            delays.append(seconds)
            if len(delays) >= ticks:
                stop.set()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = worker.run(self.config, stop, wait, path)
        return code, delays, out.getvalue(), err.getvalue()

class WorkerTransportTest(LocalWorkerServer):
    def test_scoped_machine_request_without_human_identity(self):
        self.assertEqual(worker.tick(self.config)['status'], 'idle')
        path, headers = Handler.requests[0]
        self.assertEqual(path, '/api/research-worker')
        self.assertEqual(headers['Authorization'], 'Bearer scoped-test-token')
        self.assertEqual(headers['Oai-Sites-Authorization'], 'Bearer test-gate')
        self.assertNotIn('Oai-Authenticated-User-Id', headers)
    def test_redirect_never_forwards_credentials(self):
        Handler.redirect = True
        with self.assertRaises(urllib.error.HTTPError) as error:
            worker.tick(self.config)
        self.assertEqual(error.exception.code, 307)
        self.assertEqual(len(Handler.requests), 1)
    def assertDelays(self, delays, expected):
        self.assertEqual(len(delays), len(expected))
        for delay, base in zip(delays, expected):
            self.assertTrue(base <= delay < base + 2, (delay, base))
    def test_rejection_backs_off_for_hours_instead_of_stopping(self):
        Handler.statuses = [401, 403, 401, 403, 401, 401]
        code, delays, out, err = self.run_worker(6)
        self.assertEqual(code, 0)
        self.assertEqual(len(Handler.requests), 6)
        self.assertDelays(delays, [1800, 3600, 7200, 14400, 21600, 21600])
        self.assertEqual(err.count('worker_rejected'), 6)
        self.assertIn('retrying in 360 minutes', err)
        for secret in ('scoped-test-token', 'test-gate'):
            self.assertNotIn(secret, out + err)
    def test_accepted_tick_after_rejection_resets_backoff(self):
        Handler.statuses = [403, 401]
        code, delays, out, err = self.run_worker(4)
        self.assertEqual(code, 0)
        self.assertDelays(delays, [1800, 3600, 15, 15])
        self.assertEqual(err.count('worker_rejected'), 2)
        self.assertEqual(out.count('queue: idle'), 2)

NEW_TOKEN = 'b' * 64
ROTATION = {'status': 'idle', 'pending': 0, 'rotation': {'token': NEW_TOKEN, 'expiresAt': '2026-12-23T00:00:00.000Z'}}

class WorkerRotationTest(LocalWorkerServer):
    # security-ops-4: tick 응답의 새 토큰을 worker.json에 원자적으로 저장한 뒤에만 다음 tick부터 쓴다.
    def setUp(self):
        super().setUp()
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / 'worker.json'
        self.path.write_text(json.dumps(self.config))
        self.path.chmod(0o600)
    def tearDown(self):
        self.folder.cleanup()
        super().tearDown()
    def tokens(self):
        return [headers['Authorization'] for _, headers in Handler.requests]
    def test_rotation_replaces_config_atomically_and_uses_new_token(self):
        Handler.bodies = [ROTATION]
        code, delays, out, err = self.run_worker(3, self.path)
        self.assertEqual(code, 0)
        self.assertEqual(self.tokens(), ['Bearer scoped-test-token', 'Bearer ' + NEW_TOKEN, 'Bearer ' + NEW_TOKEN])
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved, {**self.config, 'token': NEW_TOKEN})
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertEqual(os.listdir(self.folder.name), ['worker.json'])
        self.assertIn('worker_rotated', out)
        self.assertEqual(self.config['token'], 'scoped-test-token')
        for secret in (NEW_TOKEN, 'scoped-test-token', 'test-gate'):
            self.assertNotIn(secret, out + err)
    def test_failed_save_keeps_current_token_and_file(self):
        original = self.path.read_bytes()
        for target in ('replace', 'fsync'):
            with self.subTest(failure=target):
                Handler.requests = []
                Handler.bodies = [ROTATION]
                with mock.patch.object(worker.os, target, side_effect=OSError(30, 'Read-only file system')):
                    code, delays, out, err = self.run_worker(2, self.path)
                self.assertEqual(code, 0)
                self.assertEqual(self.tokens(), ['Bearer scoped-test-token'] * 2)
                self.assertEqual(self.path.read_bytes(), original)
                self.assertEqual(os.listdir(self.folder.name), ['worker.json'])
                self.assertIn('worker_rotation_failed', err)
                self.assertNotIn(NEW_TOKEN, out + err)
    def test_malformed_or_unsaved_rotation_is_not_adopted(self):
        original = self.path.read_bytes()
        for body, path in (({**ROTATION, 'rotation': {'token': 'not-a-token'}}, self.path), ({**ROTATION, 'rotation': 'x'}, self.path), (ROTATION, None)):
            with self.subTest(body=body['rotation'], path=path):
                Handler.requests = []
                Handler.bodies = [body]
                code, delays, out, err = self.run_worker(2, path)
                self.assertEqual(self.tokens(), ['Bearer scoped-test-token'] * 2)
                self.assertEqual(self.path.read_bytes(), original)
                self.assertNotIn(NEW_TOKEN, out + err)
    def test_replace_is_followed_by_a_folder_fsync(self):
        # 교체한 디렉터리 항목도 디스크에 남겨야 전원 손실 뒤 이미 폐기된 이전 토큰으로 돌아가지 않는다.
        synced, real = [], os.fsync
        def record(fd):
            synced.append(stat.S_ISDIR(os.fstat(fd).st_mode))
            return real(fd)
        Handler.bodies = [ROTATION]
        with mock.patch.object(worker.os, 'fsync', side_effect=record):
            self.run_worker(2, self.path)
        self.assertEqual(synced, [False, True])
        self.assertEqual(json.loads(self.path.read_text())['token'], NEW_TOKEN)
    def test_folder_fsync_failure_still_adopts_the_replaced_file(self):
        # 파일은 이미 새 토큰으로 바뀌었으므로 폴더 fsync가 실패해도 파일과 같은 새 토큰을 쓴다.
        real = os.fsync
        def fail_on_folder(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                raise OSError(5, 'I/O error')
            return real(fd)
        Handler.bodies = [ROTATION]
        with mock.patch.object(worker.os, 'fsync', side_effect=fail_on_folder):
            code, delays, out, err = self.run_worker(2, self.path)
        self.assertEqual(self.tokens(), ['Bearer scoped-test-token', 'Bearer ' + NEW_TOKEN])
        self.assertEqual(json.loads(self.path.read_text())['token'], NEW_TOKEN)
        self.assertIn('worker_rotation_folder_sync_failed', err)
        self.assertNotIn(NEW_TOKEN, out + err)
    def test_rotation_ready_header_only_when_the_token_can_be_saved(self):
        # 앱은 이 헤더가 있는 tick에만 다음 토큰을 싣는다. 저장할 곳이 없으면 보내지 않는다.
        self.run_worker(1, self.path)
        self.run_worker(1, None)
        rotation = lambda headers: {key.lower(): value for key, value in headers.items()}.get('x-collective-rotation')
        self.assertEqual([rotation(headers) for _, headers in Handler.requests], ['ready', None])
        if os.geteuid() != 0:
            os.chmod(self.folder.name, 0o500)
            try:
                self.run_worker(1, self.path)
            finally:
                os.chmod(self.folder.name, 0o700)
            self.assertIsNone(rotation(Handler.requests[-1][1]))
    def test_read_only_config_folder_is_reported(self):
        self.assertTrue(worker.rotation_ready(self.path))
        if os.geteuid() == 0:
            self.skipTest('root ignores folder write bits')
        os.chmod(self.folder.name, 0o500)
        try:
            self.assertFalse(worker.rotation_ready(self.path))
        finally:
            os.chmod(self.folder.name, 0o700)

if __name__ == '__main__':
    unittest.main()
