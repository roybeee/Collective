import importlib.util
import json
import pathlib
import sqlite3
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('adapter', pathlib.Path(__file__).parents[1] / 'scripts/mapdal/adapter.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.box = adapter.Outbox(pathlib.Path(self.temp.name) / 'outbox.sqlite')
        self.row = dict(order_id='MD-20260928-AABBCC', created='2026-09-28T00:01:02', status='PAID', amount=12000, ship_method='standard', buyer='SECRET', payment_key='SECRET', items='SECRET', contact_phone_norm='SECRET')

    def tearDown(self):
        self.box.close()
        self.temp.cleanup()

    def test_allowlist_and_kst(self):
        row, reason = adapter.convert(self.row)
        self.assertIsNone(reason)
        self.assertEqual(set(row), {'order_id', 'order_date', 'status', 'paid_amount', 'refund_amount', 'mode'})
        self.assertEqual(row['order_date'], '2026-09-28')
        self.assertEqual(row['mode'], 'delivery')
        self.assertNotIn('SECRET', json.dumps(row))
        self.assertEqual(adapter.convert({**self.row, 'ship_method':'pickup'})[0]['mode'], 'pickup')
        self.assertIsNotNone(adapter.convert({**self.row, 'ship_method':'unknown'})[1])
        self.assertEqual(adapter.convert({**self.row, 'fulfill':'DONE'})[0]['status'], 'paid')

    def test_unpaid_cancel_held(self):
        for status in ['WAITING_DEPOSIT', 'PENDING', 'FAILED', 'CANCELLED', 'DEPOSIT_AFTER_CANCEL', 'SHIPPED']:
            self.assertIsNone(adapter.convert({**self.row, 'status':status})[0])
        self.box.stage(self.row)
        self.assertEqual(self.box.stage({**self.row, 'status':'CANCELLED'})['outcome'], 'held')
        self.assertEqual(len(self.box.pending()), 0)
        self.assertEqual(self.box.stage(self.row)['outcome'], 'held')
        self.assertEqual(self.box.stage({**self.row, 'status':'CANCELLED'}, dict(confirmed=True, reference='refund-1', paid_amount=12000, refund_amount=12000))['outcome'], 'staged')
        self.assertEqual(len(self.box.pending()), 2)

    def test_validation(self):
        for patch in [{'amount':True}, {'amount':1.5}, {'amount':'12000'}, {'amount':-1}, {'order_id':'a@example.com'}, {'created':'2026-02-30T00:00:00'}, {'created':'2026-09-28T00:00:00Z'}]:
            self.assertIsNotNone(adapter.convert({**self.row, **patch})[1])

    def test_new_cancel_tombstone_blocks_late_paid(self):
        for index, status in enumerate(['CANCELLED', 'DEPOSIT_AFTER_CANCEL']):
            row = {**self.row, 'order_id': f'MD-20260928-AABB0{index}'}
            self.assertEqual(self.box.stage({**row, 'status': status})['outcome'], 'held')
            self.assertEqual(self.box.stage(row)['outcome'], 'held')
        self.assertEqual(len(self.box.pending()), 0)

    def test_revision_replay_and_refund(self):
        first = self.box.stage(self.row)
        repeat = self.box.stage({**self.row, 'buyer':'CHANGED'})
        self.assertEqual(first['body'], repeat['body'])
        proof = dict(confirmed=True, reference='refund-001', paid_amount=12000, refund_amount=3000)
        changed = self.box.stage(self.row, proof)
        self.assertEqual(json.loads(changed['body'])['orders'][0]['revision'], 2)
        replay = self.box.stage(self.row)
        self.assertEqual(replay['body'], first['body'])
        self.assertEqual(len(self.box.pending()), 2)
        full = self.box.stage({**self.row, 'status':'CANCELLED'}, {**proof, 'refund_amount':12000})
        self.assertEqual(json.loads(full['body'])['orders'][0]['status'], 'refunded')
        self.assertEqual(self.box.stage(self.row, {**proof, 'refund_amount':2000})['outcome'], 'held')

    def test_refund_proof_and_changed_original(self):
        self.box.stage(self.row)
        self.assertEqual(self.box.stage({**self.row, 'amount':13000})['outcome'], 'held')
        self.assertIsNone(adapter.convert({**self.row, 'status':'CANCELLED'}, dict(confirmed=True, reference='refund-1', paid_amount=12000, refund_amount=3000))[0])
        self.assertIsNone(adapter.convert(self.row, dict(confirmed=False))[0])

    def test_signature_and_endpoint(self):
        body = self.box.stage(self.row)['body']
        first = adapter.signature('secret', '1900000000', body)
        self.assertEqual(first, adapter.signature('secret', '1900000000', body))
        self.assertNotEqual(first, adapter.signature('secret', '1900000001', body))
        for url in ['http://localhost/a', 'https://evil.test/api/storefront-webhooks/x', 'https://127.0.0.1/api/storefront-webhooks/x']:
            self.assertRaises(ValueError, adapter.validate_endpoint, url)
        self.assertEqual(len(json.loads(body)['orders'][0]), 7)

    def test_restart_persistence(self):
        first = self.box.stage(self.row)
        self.box.close()
        self.box = adapter.Outbox(pathlib.Path(self.temp.name) / 'outbox.sqlite')
        self.assertEqual(self.box.stage(self.row)['body'], first['body'])

    def test_refund_duplicate_proof_releases_hold(self):
        cancelled = {**self.row, 'status':'CANCELLED'}
        proof = dict(confirmed=True, reference='refund-001', paid_amount=12000, refund_amount=12000)
        first = self.box.stage(cancelled, proof)
        self.assertEqual(first['outcome'], 'staged')
        self.assertEqual(self.box.stage(cancelled)['outcome'], 'held')
        self.assertEqual(self.box.pending(), [])
        duplicate = self.box.stage(cancelled, proof)
        self.assertEqual(duplicate['body'], first['body'])
        self.assertEqual(len(self.box.pending()), 1)

    def test_concurrent_revision(self):
        path = pathlib.Path(self.temp.name) / 'outbox.sqlite'
        def stage(_):
            box = adapter.Outbox(path)
            try:
                return box.stage(self.row)
            finally:
                box.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            result = list(pool.map(stage, range(2)))
        self.assertEqual(sorted(x['outcome'] for x in result), ['duplicate', 'staged'])
        self.assertEqual(len(self.box.pending()), 1)

    def test_dry_run_and_explicit_send_gate(self):
        path = pathlib.Path(self.temp.name) / 'input.json'
        path.write_text(json.dumps({'synthetic':True, 'orders':[self.row]}))
        output = pathlib.Path(self.temp.name) / 'not-created.sqlite'
        args = SimpleNamespace(input=str(path), outbox=str(output), enqueue=False, send=False, allow_live_input=False)
        with patch.object(adapter, 'send', side_effect=AssertionError('No network')):
            result = adapter.run(args)
            self.assertTrue(result['dry_run'])
            self.assertEqual(result['transmitted'], 0)
            self.assertFalse(output.exists())
            args.send = True
            self.assertRaises(ValueError, adapter.run, args)
        path.write_text(json.dumps({'orders':[self.row]}))
        args.send = False
        self.assertRaises(ValueError, adapter.run, args)

    def test_endpoint_no_redirect_and_unsigned_ack(self):
        valid = 'https://' + adapter.HOST + '/api/storefront-webhooks/00000000-0000-0000-0000-000000000000'
        self.assertEqual(adapter.validate_endpoint(valid), valid)
        self.box.bind_endpoint(valid)
        self.assertRaises(ValueError, self.box.bind_endpoint, valid[:-1]+'1')
        for suffix in ['?x=1', '#x', '/more']:
            self.assertRaises(ValueError, adapter.validate_endpoint, valid+suffix)
        self.assertRaises(ValueError, adapter.NoRedirect().redirect_request, None, None, 302, '', {}, 'https://evil.test')
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{"created":0,"updated":0,"duplicates":0,"older":0}'
        opener = unittest.mock.MagicMock()
        opener.open.return_value = response
        with patch.object(adapter.urllib.request, 'build_opener', return_value=opener):
            self.assertRaises(ValueError, adapter.send, self.box.stage(self.row)['body'], valid, 'x'*64)

    def test_transaction_failure_rolls_back(self):
        self.box.db.execute("CREATE TRIGGER reject_write BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected'); END")
        self.assertRaises(Exception, self.box.stage, self.row)
        self.assertEqual(self.box.pending(), [])
        self.box.db.execute('DROP TRIGGER reject_write')
        self.assertEqual(json.loads(self.box.stage(self.row)['body'])['orders'][0]['revision'], 1)

    def source_fixture(self, schema=True):
        path = pathlib.Path(self.temp.name) / 'source.sqlite'
        with sqlite3.connect(path) as db:
            if schema:
                db.execute('CREATE TABLE orders(order_id TEXT PRIMARY KEY,created TEXT,status TEXT,amount INTEGER,ship_method TEXT,buyer TEXT,payment_key TEXT)')
                db.execute('CREATE INDEX orders_created ON orders(created)')
                db.execute('INSERT INTO orders VALUES(?,?,?,?,?,?,?)', tuple(self.row[k] for k in ('order_id','created','status','amount','ship_method','buyer','payment_key')))
            else:
                db.execute('CREATE TABLE orders(order_id TEXT)')
        return path

    def source_args(self, path):
        return SimpleNamespace(input=None, source_db=str(path), date_from='2026-09-28', date_to='2026-09-28', outbox=str(pathlib.Path(self.temp.name)/'new-outbox.sqlite'), enqueue=False, send=False, allow_live_input=True)

    def test_source_readonly_five_fields(self):
        path = self.source_fixture()
        before = path.read_bytes()
        queries = []
        connect = sqlite3.connect
        def traced(database_uri, **kwargs):
            self.assertTrue(str(database_uri).endswith('?mode=ro'))
            self.assertTrue(kwargs['uri'])
            db = connect(database_uri, **kwargs)
            db.set_trace_callback(queries.append)
            return db
        with patch.object(adapter.sqlite3, 'connect', side_effect=traced):
            rows = adapter.source_rows(self.source_args(path))
        self.assertEqual(set(rows[0]), {'order_id','created','status','amount','ship_method'})
        self.assertNotIn('SECRET', json.dumps(rows))
        self.assertFalse(any('buyer' in q or 'payment_key' in q or 'SELECT *' in q for q in queries))
        self.assertEqual(path.read_bytes(), before)
        with patch.object(adapter, 'send', side_effect=AssertionError('network')):
            result = adapter.run(self.source_args(path))
        self.assertEqual(result['staged'], 1)
        self.assertTrue(result['dry_run'])
        self.assertEqual(path.read_bytes(), before)

    def test_source_gates_and_schema(self):
        path = self.source_fixture(False)
        args = self.source_args(path)
        args.allow_live_input = False
        self.assertRaises(ValueError, adapter.run, args)
        args.allow_live_input = True
        self.assertRaises(sqlite3.OperationalError, adapter.run, args)
        args.outbox = str(path)
        args.enqueue = True
        self.assertRaises(ValueError, adapter.run, args)
        args.outbox = str(path.parent/'separate.sqlite')
        args.date_from = None
        self.assertRaises(ValueError, adapter.run, args)

    def test_source_batch_limit_and_date_scope(self):
        path = self.source_fixture()
        with sqlite3.connect(path) as db:
            for n in range(100):
                db.execute('INSERT INTO orders VALUES(?,?,?,?,?,?,?)', (f'MD-20260928-{n:06X}',self.row['created'],'PAID',12000,'standard','SECRET','SECRET'))
        args = self.source_args(path)
        self.assertRaises(ValueError, adapter.run, args)
        args.date_from = '2026-09-27'
        args.date_to = '2026-09-27'
        self.assertEqual(adapter.run(args)['staged'], 0)
        args.date_from = '2026-01-01'
        args.date_to = '2026-09-28'
        self.assertRaises(ValueError, adapter.run, args)

    def postgres_mock(self, rows):
        driver = unittest.mock.MagicMock()
        db = driver.connect.return_value
        db.execute.return_value.fetchall.return_value = rows
        modules = {'psycopg':driver, 'psycopg.rows':SimpleNamespace(dict_row='synthetic-dict-row')}
        args = self.source_args('unused')
        args.source_db = None
        args.source_postgres = True
        return driver, db, modules, args

    def test_postgres_readonly_contract(self):
        values = {k:self.row[k] for k in ('order_id','created','status','amount','ship_method')}
        driver, db, modules, args = self.postgres_mock([values])
        with patch.dict(sys.modules, modules), patch.dict(adapter.os.environ, {'MAPDAL_SOURCE_DATABASE_URL':'postgresql://synthetic.invalid/mapdal?sslmode=verify-full'}, clear=True):
            result = adapter.run(args)
        self.assertEqual(result['staged'], 1)
        self.assertTrue(result['dry_run'])
        kwargs = driver.connect.call_args.kwargs
        self.assertFalse(kwargs['autocommit'])
        self.assertEqual(kwargs['row_factory'], 'synthetic-dict-row')
        self.assertEqual(kwargs['sslmode'], 'verify-full')
        statements = [call.args[0] for call in db.execute.call_args_list]
        self.assertEqual(statements[0], 'SET TRANSACTION READ ONLY')
        self.assertEqual(statements[1], "SET LOCAL statement_timeout = '2s'")
        self.assertIn('SELECT order_id,created,status,amount,ship_method', statements[2])
        self.assertNotIn('buyer', ' '.join(statements))
        self.assertNotIn('payment_key', ' '.join(statements))
        self.assertEqual(db.execute.call_args_list[2].args[1], ('2026-09-28T00:00:00','2026-09-29T00:00:00'))
        db.rollback.assert_called_once()
        db.close.assert_called_once()

    def test_postgres_failure_closes_and_limit(self):
        driver, db, modules, args = self.postgres_mock([{}]*101)
        with patch.dict(sys.modules, modules), patch.dict(adapter.os.environ, {'MAPDAL_SOURCE_DATABASE_URL':'postgresql://synthetic.invalid/mapdal'}, clear=True):
            self.assertRaises(ValueError, adapter.run, args)
        self.assertEqual(driver.connect.call_args.kwargs['sslmode'], 'require')
        db.close.assert_called_once()
        driver, db, modules, args = self.postgres_mock([])
        db.execute.side_effect = RuntimeError('synthetic connection failed')
        with patch.dict(sys.modules, modules), patch.dict(adapter.os.environ, {'MAPDAL_SOURCE_DATABASE_URL':'postgresql://synthetic.invalid/mapdal'}, clear=True):
            self.assertRaises(RuntimeError, adapter.run, args)
        db.close.assert_called_once()

    def test_postgres_live_gate_missing_driver_and_ssl(self):
        driver, db, modules, args = self.postgres_mock([])
        args.allow_live_input = False
        with patch.dict(sys.modules, modules):
            self.assertRaises(ValueError, adapter.run, args)
        driver.connect.assert_not_called()
        args.allow_live_input = True
        with patch.dict(sys.modules, {'psycopg':None}), patch.dict(adapter.os.environ, {'MAPDAL_SOURCE_DATABASE_URL':'postgresql://synthetic.invalid/mapdal'}, clear=True):
            self.assertRaises(ImportError, adapter.run, args)
        with patch.dict(sys.modules, modules), patch.dict(adapter.os.environ, {'MAPDAL_SOURCE_DATABASE_URL':'postgresql://synthetic.invalid/mapdal?sslmode=disable'}, clear=True):
            self.assertRaises(ValueError, adapter.run, args)
        driver.connect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
