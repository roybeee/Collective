"""Real temporary SQLite, synthetic products; no network or production adapter."""
import concurrent.futures
import hashlib
import hmac
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bridge', ROOT / 'scripts/mapdal/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(pathlib.Path(self.tmp.name) / 'bridge.db')
        self.secret = 'synthetic-test-secret-with-32-bytes'
        self.now = 1800000000
        self.store = bridge.SQLiteLandingStore(self.path)
        self.store.seed('tenant', 'store', 'product', {'description': '원본'})
        self.app = bridge.LandingBridge(self.store, self.secret, 'tenant', 'store', {'landing:read', 'landing:write'})

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def call(self, action, payload=None, app=None, nonce=None, stamp=None):
        body = json.dumps({'tenantId': 'tenant', 'storeId': 'store', **(payload or {})}, ensure_ascii=False, separators=(',', ':')).encode()
        stamp = str(self.now if stamp is None else stamp)
        nonce = nonce or str(uuid.uuid4())
        path = '/collective/v1/landing/' + action
        signed = (stamp + '\n' + nonce + '\nPOST\n' + path + '\n').encode() + body
        headers = {'x-collective-timestamp': stamp, 'x-collective-nonce': nonce, 'x-collective-signature': hmac.new(self.secret.encode(), signed, hashlib.sha256).hexdigest()}
        return (app or self.app).handle('POST', path, headers, body, now=self.now)

    def read(self):
        return self.call('read', {'productId': 'product'})[1]

    def apply_body(self, **changes):
        return {'requestId': str(uuid.uuid4()), 'productId': 'product', 'expectedDigest': self.read()['digest'], 'approvalDigest': 'a' * 64, 'fields': {'description': '승인된 설명'}, **changes}

    def test_read_is_scoped_and_text_only(self):
        self.assertEqual(self.read()['fields'], {'description': '원본'})
        self.assertEqual(self.call('read', {'productId': 'product', 'storeId': 'other'})[0], 403)

    def test_native_mapdal_colon_product_id_does_not_expand_tenant_scope(self):
        self.store.seed('tenant', 'store', 'mpd::123', {'description': '원본'})
        self.assertEqual(self.call('read', {'productId': 'mpd::123'})[0], 200)
        self.assertEqual(self.call('read', {'productId': 'mpd::123', 'tenantId': 'tenant:other'})[0], 400)
        self.assertEqual(self.call('read', {'productId': '../mpd::123'})[0], 400)

    def test_signature_and_stale_timestamp_are_denied(self):
        self.assertEqual(self.app.handle('POST', '/collective/v1/landing/read', {}, b'{}', now=self.now)[0], 401)
        self.assertEqual(self.call('read', {'productId': 'product'}, stamp=self.now - 301)[0], 401)

    def test_signature_is_bound_to_method_path_and_body(self):
        for method, path, raw in [('GET', '/collective/v1/landing/read', b'{}'), ('POST', '/collective/v1/landing/apply', b'{}'), ('POST', '/collective/v1/landing/read', b'{"changed":true}')]:
            stamp, nonce = str(self.now), str(uuid.uuid4())
            signature = hmac.new(self.secret.encode(), (stamp + '\n' + nonce + '\nPOST\n/collective/v1/landing/read\n{}').encode(), hashlib.sha256).hexdigest()
            headers = {'x-collective-timestamp': stamp, 'x-collective-nonce': nonce, 'x-collective-signature': signature}
            self.assertIn(self.app.handle(method, path, headers, raw, now=self.now)[0], (401, 405))

    def test_nonce_replay_is_denied(self):
        nonce = str(uuid.uuid4())
        self.assertEqual(self.call('read', {'productId': 'product'}, nonce=nonce)[0], 200)
        self.assertEqual(self.call('read', {'productId': 'product'}, nonce=nonce)[0], 409)
        self.now += 1000
        self.assertEqual(self.call('read', {'productId': 'product'}, nonce=nonce)[0], 409)

    def test_apply_replay_returns_identical_receipt_after_restart(self):
        body = self.apply_body()
        status, receipt = self.call('apply', body)
        self.assertEqual(status, 200)
        self.store.close()
        self.store = bridge.SQLiteLandingStore(self.path)
        self.app = bridge.LandingBridge(self.store, self.secret, 'tenant', 'store', {'landing:read', 'landing:write'})
        self.assertEqual(self.call('apply', body), (200, receipt))
        self.assertEqual(self.call('receipt', {'requestId': body['requestId']}), (200, receipt))

    def test_idempotency_key_different_body_is_conflict(self):
        body = self.apply_body()
        self.call('apply', body)
        self.assertEqual(self.call('apply', {**body, 'fields': {'description': '다른 설명'}})[0], 409)

    def test_stale_cas_keeps_original(self):
        self.assertEqual(self.call('apply', self.apply_body(expectedDigest='0' * 64))[0], 409)
        self.assertEqual(self.read()['fields']['description'], '원본')

    def test_missing_receipt_is_unknown_not_failed(self):
        self.assertEqual(self.call('receipt', {'requestId': str(uuid.uuid4())}), (200, None))

    def test_rollback_restores_snapshot_and_is_idempotent(self):
        original = self.call('apply', self.apply_body())[1]
        payload = {'requestId': str(uuid.uuid4()), 'originalRequestId': original['requestId'], 'expectedDigest': original['afterDigest'], 'approvalDigest': 'b' * 64}
        result = self.call('rollback', payload)
        self.assertEqual(result[0], 200)
        self.assertEqual(self.read()['fields']['description'], '원본')
        self.assertEqual(self.call('rollback', payload), result)

    def test_rollback_does_not_overwrite_later_editor(self):
        original = self.call('apply', self.apply_body())[1]
        self.call('apply', self.apply_body(fields={'description': '다음 편집'}))
        result = self.call('rollback', {'requestId': str(uuid.uuid4()), 'originalRequestId': original['requestId'], 'expectedDigest': original['afterDigest'], 'approvalDigest': 'b' * 64})
        self.assertEqual(result[0], 409)
        self.assertEqual(self.read()['fields']['description'], '다음 편집')

    def test_two_writers_same_digest_only_one_succeeds(self):
        body = self.apply_body()
        def run(index):
            store = bridge.SQLiteLandingStore(self.path)
            try:
                app = bridge.LandingBridge(store, self.secret, 'tenant', 'store', {'landing:read', 'landing:write'})
                return self.call('apply', {**body, 'requestId': str(uuid.uuid4()), 'fields': {'description': str(index)}}, app=app)[0]
            finally:
                store.close()
        with concurrent.futures.ThreadPoolExecutor(2) as executor:
            self.assertEqual(sorted(executor.map(run, [1, 2])), [200, 409])

    def test_write_scope_required(self):
        read_only = bridge.LandingBridge(self.store, self.secret, 'tenant', 'store', {'landing:read'})
        self.assertEqual(self.call('apply', self.apply_body(), app=read_only)[0], 403)

    def test_html_and_extra_price_fields_are_rejected(self):
        self.assertEqual(self.call('apply', self.apply_body(fields={'description': '<script>x</script>'}))[0], 400)
        self.assertEqual(self.call('apply', self.apply_body(fields={'description': 'valid', 'price': 1}))[0], 400)

    def test_body_size_and_unknown_paths_are_rejected(self):
        self.assertEqual(self.app.handle('POST', '/collective/v1/landing/read', {}, b'x' * 32769, now=self.now)[0], 413)
        self.assertEqual(self.call('delete', {})[0], 404)

    def test_receipt_insert_failure_rolls_back_product(self):
        self.store.db.execute("CREATE TRIGGER reject_receipt BEFORE INSERT ON bridge_receipts BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
        self.assertEqual(self.call('apply', self.apply_body())[0], 503)
        self.assertEqual(self.read()['fields']['description'], '원본')

    def test_adapter_exception_is_unknown_even_after_commit(self):
        store = self.store
        class LostResponse:
            def nonce(self, *args):
                return store.nonce(*args)
            def execute(self, *args):
                store.execute(*args)
                raise ValueError('response lost after commit')
        app = bridge.LandingBridge(LostResponse(), self.secret, 'tenant', 'store', {'landing:read', 'landing:write'})
        body = self.apply_body()
        self.assertEqual(self.call('apply', body, app=app)[0], 503)
        self.assertEqual(self.call('receipt', {'requestId': body['requestId']})[1]['status'], 'applied')

    def test_receipts_cannot_be_updated_or_deleted(self):
        self.call('apply', self.apply_body())
        for statement in ('DELETE FROM bridge_receipts', "UPDATE bridge_receipts SET receipt='{}'"):
            with self.assertRaises(Exception):
                self.store.db.execute(statement)
            self.store.db.rollback()

    def test_wsgi_rejects_unbounded_and_wrong_content_type(self):
        for env, status in [({'CONTENT_LENGTH': '32769'}, '413'), ({'CONTENT_LENGTH': '2', 'CONTENT_TYPE': 'text/plain'}, '415'), ({'CONTENT_LENGTH': '2', 'CONTENT_TYPE': 'application/json', 'QUERY_STRING': 'x=1'}, '400')]:
            captured = []
            response = self.app({'wsgi.input': io.BytesIO(b'{}'), **env}, lambda s, h: captured.append(s))
            self.assertTrue(captured[0].startswith(status))
            self.assertEqual(json.loads(response[0])['status'], 'rejected')

    def test_wsgi_valid_signed_request(self):
        import time
        stamp, nonce = str(int(time.time())), str(uuid.uuid4())
        raw = b'{"tenantId":"tenant","storeId":"store","productId":"product"}'
        path = '/collective/v1/landing/read'
        signature = hmac.new(self.secret.encode(), (stamp + '\n' + nonce + '\nPOST\n' + path + '\n').encode() + raw, hashlib.sha256).hexdigest()
        env = {'wsgi.input': io.BytesIO(raw), 'CONTENT_LENGTH': str(len(raw)), 'CONTENT_TYPE': 'application/json', 'REQUEST_METHOD': 'POST', 'PATH_INFO': path, 'HTTP_X_COLLECTIVE_TIMESTAMP': stamp, 'HTTP_X_COLLECTIVE_NONCE': nonce, 'HTTP_X_COLLECTIVE_SIGNATURE': signature}
        captured = []
        response = self.app(env, lambda s, h: captured.append(s))
        self.assertEqual(captured[0], '200 OK')
        self.assertEqual(json.loads(response[0])['fields']['description'], '원본')

    def test_rate_limit_is_shared_by_sqlite_connections(self):
        for _ in range(120):
            self.assertEqual(self.call('read', {'productId': 'product'})[0], 200)
        other = bridge.SQLiteLandingStore(self.path)
        try:
            app = bridge.LandingBridge(other, self.secret, 'tenant', 'store', {'landing:read'})
            self.assertEqual(self.call('read', {'productId': 'product'}, app=app)[0], 429)
        finally:
            other.close()


if __name__ == '__main__':
    unittest.main()
