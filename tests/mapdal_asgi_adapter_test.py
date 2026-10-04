import asyncio
import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts/mapdal'))
from asgi_adapter import LandingASGI


class AsgiTest(unittest.IsolatedAsyncioTestCase):
    async def request(self, body=b'{}', **changes):
        self.calls = []
        class Bridge:
            def handle(inner, method, path, headers, raw):
                self.calls.append((method, path, raw))
                return 200, {'ok': True}
        scope = {'type': 'http', 'method': 'POST', 'path': '/collective/v1/landing/read', 'headers': [(b'content-type', b'application/json')], **changes}
        async def receive():
            return {'type': 'http.request', 'body': body}
        output = []
        async def send(event):
            output.append(event)
        await LandingASGI(Bridge())(scope, receive, send)
        return output[0]['status']

    async def test_full_and_mounted_path(self):
        self.assertEqual(await self.request(), 200)
        self.assertEqual(self.calls[0][1], '/collective/v1/landing/read')
        self.assertEqual(await self.request(path='/read'), 200)
        self.assertEqual(self.calls[0][1], '/collective/v1/landing/read')

    async def test_no_query_and_duplicate_signature(self):
        self.assertEqual(await self.request(query_string=b'a=1'), 400)
        self.assertEqual(self.calls, [])
        self.assertEqual(await self.request(headers=[(b'content-type', b'application/json'), (b'x-collective-signature', b'a'), (b'x-collective-signature', b'b')]), 400)
        self.assertEqual(self.calls, [])

    async def test_content_type_length_and_limit(self):
        self.assertEqual(await self.request(headers=[]), 415)
        self.assertEqual(await self.request(headers=[(b'content-type', b'application/json'), (b'content-length', b'3')]), 400)
        self.assertEqual(await self.request(body=b'x' * 32769), 413)
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
