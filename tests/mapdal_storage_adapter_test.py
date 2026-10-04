"""Real temporary SQLite with MAPDAL products.descr schema, no production/network."""
import contextlib
import pathlib
import sqlite3
import sys
import tempfile
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/mapdal'))
from storage_adapter import MapdalLandingStore
from bridge import Rejected


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(pathlib.Path(self.tmp.name) / 'shop.db')
        with self.db() as c:
            c.exec('CREATE TABLE products(id TEXT PRIMARY KEY, descr TEXT, detail_html TEXT, price INTEGER)')
            c.exec('INSERT INTO products VALUES(?,?,?,?)', ('mpd::123', '원래 설명', '기존 본문', 1000))
        self.store = MapdalLandingStore(self.db, False, 'tenant', 'store', {'mpd::123': 'mpd::123'})
        self.store.migrate()

    @contextlib.contextmanager
    def db(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute('BEGIN IMMEDIATE')
        class Cx:
            def exec(self, query, args=()):
                return conn.execute(query, args)
            def one(self, query, args=()):
                row = self.exec(query, args).fetchone()
                return dict(row) if row else None
        try:
            yield Cx()
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def tearDown(self):
        self.tmp.cleanup()

    def execute(self, action, **kwargs):
        return self.store.execute(action, 'tenant', 'store', {'tenantId': 'tenant', 'storeId': 'store', **kwargs}, 1800000000)

    def read(self):
        return self.execute('read', productId='mpd::123')

    def apply(self):
        return self.execute('apply', productId='mpd::123', requestId=str(uuid.uuid4()), expectedDigest=self.read()['digest'], approvalDigest='a' * 64, fields={'description': '새 설명'})

    def test_actual_product_column_and_receipt(self):
        receipt = self.apply()
        with self.db() as c:
            row = c.one('SELECT * FROM products')
        self.assertEqual((row['descr'], row['detail_html'], row['price']), ('새 설명', '기존 본문', 1000))
        self.assertEqual(self.execute('receipt', requestId=receipt['requestId']), receipt)
        self.assertEqual(receipt['afterDigest'], self.read()['digest'])

    def test_out_of_band_edit_invalidates_cas(self):
        before = self.read()
        with self.db() as c:
            c.exec('UPDATE products SET descr=?', ('관리자 변경',))
        with self.assertRaises(Rejected):
            self.execute('apply', productId='mpd::123', requestId=str(uuid.uuid4()), expectedDigest=before['digest'], approvalDigest='a' * 64, fields={'description': '덮어쓰기'})
        self.assertEqual(self.read()['fields']['description'], '관리자 변경')

    def test_rollback_restores_real_column(self):
        receipt = self.apply()
        self.execute('rollback', requestId=str(uuid.uuid4()), originalRequestId=receipt['requestId'], expectedDigest=receipt['afterDigest'], approvalDigest='a' * 64)
        self.assertEqual(self.read()['fields']['description'], '원래 설명')

    def test_unmapped_product_and_foreign_scope_rejected(self):
        for tenant, shop, product in [('other', 'store', 'mpd::123'), ('tenant', 'other', 'mpd::123'), ('tenant', 'store', 'unmapped')]:
            with self.assertRaises(Rejected):
                self.store.execute('read', tenant, shop, {'productId': product}, 1800000000)

    def test_receipt_failure_rolls_back_product(self):
        self.read()
        with self.db() as c:
            c.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON collective_landing_receipts BEGIN SELECT RAISE(ABORT,'fail'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.apply()
        self.assertEqual(self.read()['fields']['description'], '원래 설명')

    def test_nonce_replay_and_rate_limit(self):
        nonce = str(uuid.uuid4())
        self.store.nonce('tenant', 'store', nonce, 1800000000)
        with self.assertRaises(Rejected):
            self.store.nonce('tenant', 'store', nonce, 1800000000)
        for _ in range(119):
            self.store.nonce('tenant', 'store', str(uuid.uuid4()), 1800000000)
        with self.assertRaises(Rejected):
            self.store.nonce('tenant', 'store', str(uuid.uuid4()), 1800000000)

    def test_explicit_migration_and_idempotent_restart(self):
        receipt = self.apply()
        again = MapdalLandingStore(self.db, False, 'tenant', 'store', {'mpd::123': 'mpd::123'})
        again.migrate()
        self.assertEqual(again.execute('receipt', 'tenant', 'store', {'requestId': receipt['requestId']}, 1800000000), receipt)


if __name__ == '__main__':
    unittest.main()
