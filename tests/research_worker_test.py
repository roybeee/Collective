import importlib.util
import json
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location('worker', Path(__file__).parents[1] / 'server/research-worker/worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class Handler(BaseHTTPRequestHandler):
    redirect = False
    requests = []
    def do_POST(self):
        self.requests.append((self.path, dict(self.headers)))
        if self.redirect:
            self.send_response(307)
            self.send_header('Location', '/unexpected')
            self.end_headers()
        else:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'idle', 'pending': 0}).encode())
    def log_message(self, *_):
        pass

class WorkerTransportTest(unittest.TestCase):
    def setUp(self):
        Handler.requests = []
        Handler.redirect = False
        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.config = {'site': 'http://127.0.0.1:'+str(self.server.server_port), 'token': 'scoped-test-token', 'owner': 'test-owner', 'gate': 'test-gate'}
    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
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

if __name__ == '__main__':
    unittest.main()
