"""Temporary SQLite + synthetic consent/templates; no live provider or messages."""
import hashlib
import hmac
import importlib.util
import json
import pathlib
import tempfile
import time
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('consumer_bridge', ROOT / 'scripts/mapdal/consumer_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ConsumerBridgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.authorization=True
        self.store = bridge.SQLiteConsumerStore(str(pathlib.Path(self.tmp.name) / 'consumer.db'), authorize=lambda *args:self.authorization)
        self.secret = 'synthetic-consumer-secret-more-than-32'
        self.now = 1800000000
        self.recipient, self.template, self.request = [str(uuid.uuid4()) for _ in range(3)]
        self.store.recipient('tenant', 'shop', self.recipient, {'post_purchase': self.now + 3600})
        self.store.template('tenant', 'shop', self.template, 'a' * 64, 'post_purchase', 5)
        self.app = bridge.ConsumerBridge(self.store, self.secret, 'tenant', 'shop', enabled=True)
        self.payload = dict(requestId=self.request, recipientId=self.recipient, purpose='post_purchase', templateId=self.template, templateDigest='a' * 64, maxCostKrw=10, expiresAt=bridge.iso(self.now + 3600), consentDigest='b' * 64)
        self.digest = bridge.payload_digest(self.payload)

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def call(self, action, payload=None, nonce=None, signature=None):
        value = dict(tenantId='tenant', storeId='shop', requestId=self.request, payloadDigest=self.digest)
        if payload is not None:
            value['payload'] = payload
        raw = json.dumps(value, separators=(',', ':')).encode()
        path, nonce, stamp = '/collective/v1/consumer/' + action, nonce or str(uuid.uuid4()), str(self.now)
        signed = (stamp + '\n' + nonce + '\nPOST\n' + path + '\n').encode() + raw
        headers = {'x-collective-timestamp': stamp, 'x-collective-nonce': nonce, 'x-collective-signature': signature or hmac.new(self.secret.encode(), signed, hashlib.sha256).hexdigest()}
        return self.app.handle('POST', path, headers, raw, self.now)

    def test_default_disabled(self):
        self.app = bridge.ConsumerBridge(self.store, self.secret, 'tenant', 'shop')
        self.assertEqual(self.call('send', self.payload)[0], 409)

    def test_send_is_durable_acceptance_not_delivery(self):
        status, receipt = self.call('send', self.payload)
        self.assertEqual((status, receipt['status'], receipt['costKrw']), (200, 'accepted', None))
        self.assertEqual(self.call('send', self.payload)[1]['receiptId'], receipt['receiptId'])
        self.assertEqual(self.call('receipt')[1], receipt)

    def test_payload_conflict_and_raw_contact_rejected(self):
        self.assertEqual(self.call('send', {**self.payload, 'phone': '01012345678'})[0], 400)
        self.call('send', self.payload)
        self.payload['maxCostKrw'] = 20
        self.digest = bridge.payload_digest(self.payload)
        self.assertEqual(self.call('send', self.payload)[0], 409)

    def test_signature_and_nonce_replay(self):
        self.assertEqual(self.call('send', self.payload, signature='0' * 64)[0], 401)
        nonce = str(uuid.uuid4())
        self.assertEqual(self.call('send', self.payload, nonce=nonce)[0], 200)
        self.assertEqual(self.call('receipt', nonce=nonce)[0], 409)

    def test_purpose_and_template_and_cost_current_validation(self):
        self.store.recipient('tenant', 'shop', self.recipient, {'marketing_reorder': self.now + 3600})
        self.assertEqual(self.call('send', self.payload)[0], 409)
        self.store.recipient('tenant', 'shop', self.recipient, {'post_purchase': self.now + 3600})
        self.store.template('tenant', 'shop', self.template, 'c' * 64, 'post_purchase', 5)
        self.assertEqual(self.call('send', self.payload)[0], 409)
        self.store.template('tenant', 'shop', self.template, 'a' * 64, 'post_purchase', 11)
        self.assertEqual(self.call('send', self.payload)[0], 409)

    def test_withdraw_before_claim_suppresses_pending(self):
        self.call('send', self.payload)
        self.store.recipient('tenant', 'shop', self.recipient, {})
        self.assertIsNone(self.store.claim('tenant', 'shop', self.request, self.now))
        self.assertEqual(self.call('receipt')[1]['status'], 'failed')

    def test_unknown_claim_never_reissued(self):
        self.call('send', self.payload)
        self.assertEqual(self.store.claim('tenant', 'shop', self.request, self.now)['recipientId'], self.recipient)
        self.assertIsNone(self.store.claim('tenant', 'shop', self.request, self.now))
        self.assertIsNone(self.call('receipt')[1])
        self.assertIsNone(self.call('cancel')[1])
        self.assertIsNone(self.store.claim('tenant', 'shop', self.request, self.now))

    def test_cancel_accepted_is_terminal_and_scrubbed(self):
        self.call('send', self.payload)
        result = self.call('cancel')[1]
        self.assertEqual((result['status'], result['costKrw']), ('failed', 0))
        self.assertIsNone(self.store.claim('tenant', 'shop', self.request, self.now))
        self.assertNotIn(self.recipient, self.store.db.execute('SELECT payload FROM consumer_outbox').fetchone()[0])

    def test_collective_withdrawal_blocks_claim_before_cancel_arrives(self):
        self.call('send', self.payload)
        self.authorization = False
        self.assertIsNone(self.store.claim('tenant', 'shop', self.request, self.now))
        self.assertEqual(self.call('receipt')[1]['status'], 'failed')

    def test_unavailable_collective_authorization_keeps_pending_without_send(self):
        self.call('send', self.payload)
        self.authorization = None
        self.assertIsNone(self.store.claim('tenant', 'shop', self.request, self.now))
        self.assertEqual(self.call('receipt')[1]['status'], 'accepted')
        self.authorization = True
        self.assertIsNotNone(self.store.claim('tenant', 'shop', self.request, self.now))

    def test_missing_callback_is_closed_by_default(self):
        self.call('send', self.payload)
        self.store.authorize = None
        self.assertIsNone(self.store.claim('tenant', 'shop', self.request, self.now))
        self.assertEqual(self.call('receipt')[1]['status'], 'accepted')

    def test_withdraw_between_claim_and_transport_never_sends(self):
        self.call('send', self.payload)
        decisions = iter([True, False])
        self.store.authorize = lambda *args: next(decisions)
        calls = []
        self.store.deliver('tenant', 'shop', self.request, lambda *args:calls.append(args), now=self.now)
        self.assertEqual(calls, [])
        self.assertEqual(self.call('receipt')[1]['status'], 'failed')

    def test_transport_exception_stays_unknown_without_second_send(self):
        self.call('send', self.payload)
        calls = []
        def transport(*args):
            calls.append(args)
            raise RuntimeError('synthetic timeout')
        self.store.deliver('tenant', 'shop', self.request, transport, now=self.now)
        self.store.deliver('tenant', 'shop', self.request, transport, now=self.now)
        self.assertEqual(len(calls), 1)
        self.assertIsNone(self.call('receipt')[1])

    def test_provider_local_changes_during_final_callback_never_send(self):
        for mutation in ['withdraw', 'template', 'cancel']:
            with self.subTest(mutation=mutation):
                self.request = str(uuid.uuid4())
                self.payload = {**self.payload, 'requestId': self.request}
                self.digest = bridge.payload_digest(self.payload)
                self.store.recipient('tenant', 'shop', self.recipient, {'post_purchase': self.now + 3600})
                self.store.template('tenant', 'shop', self.template, 'a' * 64, 'post_purchase', 5)
                self.call('send', self.payload)
                count = 0
                def authorize(*args):
                    nonlocal count
                    count += 1
                    if count == 2:
                        if mutation == 'withdraw':
                            self.store.recipient('tenant', 'shop', self.recipient, {})
                        elif mutation == 'template':
                            self.store.template('tenant', 'shop', self.template, 'c' * 64, 'post_purchase', 5)
                        else:
                            self.call('cancel')
                    return True
                self.store.authorize = authorize
                sent = []
                self.store.deliver('tenant', 'shop', self.request, lambda *args: sent.append(args), now=self.now)
                self.assertEqual(sent, [])
                receipt = self.call('receipt')[1]
                self.assertEqual((receipt['status'], receipt['costKrw']), ('failed', 0))
                self.assertEqual(receipt['code'], 'rejected')

    def test_signed_callback_client_refetches_current_authorization(self):
        client = bridge.CollectiveAuthorizationClient('https://collective.example', 'workspace', 'campaign', self.secret, {'collective.example'})
        calls = []
        state = {'allowed': True, 'signed': True, 'stale': False}
        class Response:
            status = 200
            def __init__(inner, req):
                headers = {k.lower(): v for k, v in req.header_items()}
                nonce = headers['x-collective-nonce']
                signed = (headers['x-collective-timestamp'] + '\n' + nonce + '\nPOST\n/api/growth/consumer-delivery/authorize\n').encode() + req.data
                self.assertEqual(headers['x-collective-signature'], hmac.new(self.secret.encode(), signed, hashlib.sha256).hexdigest())
                body = json.loads(req.data)
                self.assertEqual(body['owner'], 'workspace')
                result = dict(allowed=state['allowed'], requestId=body['requestId'], payloadDigest=body['payloadDigest'], nonce=nonce, checkedAt=bridge.iso(time.time() - (60 if state['stale'] else 0)))
                inner.raw = bridge.dumps(result).encode()
                signature = hmac.new(self.secret.encode(), (nonce + '\n').encode() + inner.raw, hashlib.sha256).hexdigest()
                inner.headers = {'Content-Type': 'application/json', 'x-collective-signature': signature if state['signed'] else '0' * 64}
            def __enter__(inner): return inner
            def __exit__(inner, *args): pass
            def read(inner, size): return inner.raw[:size]
        class Opener:
            def open(inner, req, timeout):
                calls.append(req.full_url)
                self.assertEqual(timeout, 5)
                return Response(req)
        client.opener = Opener()
        self.assertTrue(client('tenant', 'shop', self.request, self.digest, int(time.time())))
        state['allowed'] = False
        self.assertFalse(client('tenant', 'shop', self.request, self.digest, int(time.time())))
        state['signed'] = False
        self.assertIsNone(client('tenant', 'shop', self.request, self.digest, int(time.time())))
        state.update(signed=True, stale=True)
        self.assertIsNone(client('tenant', 'shop', self.request, self.digest, int(time.time())))
        self.assertEqual(len(calls), 4)
        with self.assertRaises(bridge.Rejected):
            bridge.CollectiveAuthorizationClient('https://evil.example', 'workspace', 'campaign', self.secret, {'collective.example'})

    def test_finish_requires_claim_and_receipt_cap(self):
        self.call('send', self.payload)
        with self.assertRaises(bridge.Rejected):
            self.store.finish('tenant', 'shop', self.request, 'delivered', 5, self.now)
        self.store.claim('tenant', 'shop', self.request, self.now)
        with self.assertRaises(bridge.Rejected):
            self.store.finish('tenant', 'shop', self.request, 'delivered', 11, self.now)
        self.store.finish('tenant', 'shop', self.request, 'delivered', 5, self.now)
        self.assertEqual(self.call('receipt')[1]['status'], 'delivered')


if __name__ == '__main__':
    unittest.main()
