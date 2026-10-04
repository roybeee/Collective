"""Real immutable order outbox; synthetic source only; no network."""
import asyncio
import json
import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts/mapdal'))
from adapter import Outbox
from order_pull import OrderPull, OrderPullASGI


class PullTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(pathlib.Path(self.tmp.name) / 'outbox.sqlite')
        self.box = Outbox(self.path)
        self.token = 'synthetic-pull-token-with-at-least-32-characters'
        self.pull = OrderPull(self.path, self.token)

    def tearDown(self):
        self.box.close()
        self.tmp.cleanup()

    def source(self, number=1, status='PAID'):
        return dict(order_id=f'MD-20260928-{number:06X}', created='2026-09-28T12:00:00', status=status, amount=1000, ship_method='standard')

    def get(self, query='limit=100', **kwargs):
        return self.pull.handle('GET', '/collective/v1/orders', query, {'authorization': 'Bearer ' + self.token}, **kwargs)

    def test_exact_seven_fields_no_customer_data(self):
        self.box.stage({**self.source(), 'buyer': {'name': 'must not export'}, 'payment_key': 'must not export'})
        status, body = self.get()
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {'orders', 'nextCursor', 'hasMore'})
        self.assertEqual(set(body['orders'][0]), {'order_id', 'revision', 'order_date', 'status', 'paid_amount', 'refund_amount', 'mode'})
        self.assertNotIn('must not export', json.dumps(body))
        self.assertFalse(body['hasMore'])
        self.assertEqual(self.get('limit=100&cursor=' + body['nextCursor'])[1]['orders'], [])

    def test_revision_coalescing_and_stable_replay(self):
        self.box.stage(self.source())
        self.box.stage(self.source(), {'confirmed': True, 'reference': 'refund-one', 'paid_amount': 1000, 'refund_amount': 200})
        first = self.get()
        self.assertEqual(first, self.get())
        self.assertEqual(len(first[1]['orders']), 1)
        self.assertEqual(first[1]['orders'][0]['revision'], 2)

    def test_bounded_pages_and_opaque_cursor(self):
        for number in range(1, 103):
            self.box.stage(self.source(number))
        _, page = self.get()
        self.assertEqual(len(page['orders']), 100)
        self.assertTrue(page['hasMore'])
        _, last = self.get('limit=100&cursor=' + page['nextCursor'])
        self.assertEqual(len(last['orders']), 2)
        self.assertFalse(last['hasMore'])
        self.assertEqual(self.get('limit=100&cursor=1')[0], 400)

    def test_unresolved_cancel_does_not_advance_over_hold(self):
        self.box.stage(self.source())
        self.box.stage(self.source(status='CANCELLED'))
        self.assertEqual(self.get()[0], 409)
        self.box.stage(self.source(status='CANCELLED'), {'confirmed': True, 'reference': 'refund-full', 'paid_amount': 1000, 'refund_amount': 1000})
        self.assertEqual(self.get()[1]['orders'][0]['status'], 'refunded')

    def test_auth_method_path_query_and_cursor_tampering(self):
        for method, path, query, headers in [('GET', '/collective/v1/orders', '', {}), ('POST', '/collective/v1/orders', '', {'authorization': 'Bearer ' + self.token}), ('GET', '/other', '', {'authorization': 'Bearer ' + self.token}), ('GET', '/collective/v1/orders', 'limit=101', {'authorization': 'Bearer ' + self.token}), ('GET', '/collective/v1/orders', 'limit=100&extra=x', {'authorization': 'Bearer ' + self.token})]:
            self.assertGreaterEqual(self.pull.handle(method, path, query, headers)[0], 400)
        self.box.stage(self.source())
        cursor = self.get()[1]['nextCursor']
        self.assertEqual(self.get('limit=100&cursor=' + cursor[:-1] + ('0' if cursor[-1] != '0' else '1'))[0], 400)

    def test_rate_limit_and_no_source_or_outbox_mutation(self):
        self.box.stage(self.source())
        before = pathlib.Path(self.path).read_bytes()
        for _ in range(120):
            self.assertEqual(self.get(now=1)[0], 200)
        self.assertEqual(self.get(now=1)[0], 429)
        self.assertEqual(self.get(now=62)[0], 200)
        self.assertEqual(pathlib.Path(self.path).read_bytes(), before)

    def test_corrupt_outbox_never_exports_arbitrary_text(self):
        self.box.stage(self.source())
        raw = json.loads(self.box.db.execute('SELECT body FROM outbox').fetchone()[0])
        raw['orders'][0]['mode'] = 'private-customer-text'
        with self.box.db:
            self.box.db.execute('UPDATE outbox SET body=?', (json.dumps(raw),))
        status, body = self.get()
        self.assertEqual(status, 503)
        self.assertNotIn('private-customer-text', json.dumps(body))

    def test_asgi_mounted_paths_and_duplicate_auth(self):
        self.box.stage(self.source())
        async def request(path, duplicate=False):
            messages = []
            async def send(message):
                messages.append(message)
            headers = [(b'authorization', ('Bearer ' + self.token).encode())]
            await OrderPullASGI(self.pull)({'type': 'http', 'method': 'GET', 'path': path,
                'query_string': b'limit=100', 'headers': headers * (2 if duplicate else 1)}, None, send)
            return messages[0]['status'], json.loads(messages[1]['body'])
        for path in ('/collective/v1/orders/', '/collective/v1/orders', '/'):
            status, body = asyncio.run(request(path))
            self.assertEqual(status, 200)
            self.assertEqual(len(body['orders']), 1)
        self.assertEqual(asyncio.run(request('/collective/v1/orders/', True))[0], 401)
        self.assertEqual(asyncio.run(request('/collective/v1/orders/other'))[0], 404)


if __name__ == '__main__':
    unittest.main()
