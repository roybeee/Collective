"""MAPDAL app.db/Cx adapter: actual products.descr and receipts share one transaction.

Pass app.db and app.IS_PG explicitly after the shop's own schema migration.
Construction has no database side effects. Run migrate() as an installation step.
Only explicitly mapped products are accessible; detail_html/price/stock are untouched.
"""
import datetime as dt
import json
from bridge import ID, PRODUCT_ID, canonical, digest, require


class MapdalLandingStore:
    def __init__(self, db, is_pg, tenant, shop, products):
        if not ID.fullmatch(tenant) or not ID.fullmatch(shop):
            raise ValueError('invalid scope')
        if not products or len(products) > 1000:
            raise ValueError('explicit product mapping required')
        if any(not PRODUCT_ID.fullmatch(key) or key != value for key, value in products.items()):
            raise ValueError('invalid product mapping')
        if len(set(products.values())) != len(products):
            raise ValueError('duplicate real product mapping')
        self.db, self.lock = db, ' FOR UPDATE' if is_pg else ''
        self.tenant, self.shop, self.products = tenant, shop, dict(products)

    def migrate(self):
        """Explicit, additive migration only. Never create/seed the real products table."""
        statements = [
            'CREATE TABLE IF NOT EXISTS collective_landing_scope (tenant TEXT, store TEXT, PRIMARY KEY(tenant,store))',
            'CREATE TABLE IF NOT EXISTS collective_landing_state (tenant TEXT, store TEXT, product TEXT, real_id TEXT, version INTEGER NOT NULL, fields_digest TEXT NOT NULL, PRIMARY KEY(tenant,store,product))',
            'CREATE TABLE IF NOT EXISTS collective_landing_nonces (tenant TEXT, store TEXT, nonce TEXT, at BIGINT, PRIMARY KEY(tenant,store,nonce))',
            'CREATE INDEX IF NOT EXISTS collective_landing_nonce_rate ON collective_landing_nonces(tenant,store,at)',
            'CREATE TABLE IF NOT EXISTS collective_landing_receipts (tenant TEXT, store TEXT, request TEXT, body_digest TEXT NOT NULL, receipt TEXT NOT NULL, before_snapshot TEXT NOT NULL, PRIMARY KEY(tenant,store,request))',
        ]
        with self.db() as c:
            # Missing descr is an installation failure, never silently use a shadow column.
            c.exec('SELECT id,descr FROM products LIMIT 0')
            for statement in statements:
                c.exec(statement)
            c.exec('INSERT INTO collective_landing_scope(tenant,store) VALUES(?,?) ON CONFLICT(tenant,store) DO NOTHING', (self.tenant, self.shop))

    def _scope(self, c, tenant, store):
        require(tenant == self.tenant and store == self.shop, 403, 'scope_denied')
        require(c.one('SELECT tenant FROM collective_landing_scope WHERE tenant=? AND store=?' + self.lock, (tenant, store)) is not None, 503, 'adapter_not_installed')

    def nonce(self, tenant, store, nonce, timestamp):
        with self.db() as c:
            self._scope(c, tenant, store)
            require(c.one('SELECT nonce FROM collective_landing_nonces WHERE tenant=? AND store=? AND nonce=?', (tenant, store, nonce)) is None, 409, 'nonce_replayed')
            count = c.one('SELECT COUNT(*) AS n FROM collective_landing_nonces WHERE tenant=? AND store=? AND at>=?', (tenant, store, timestamp - 60))
            require(count['n'] < 120, 429, 'rate_limited')
            c.exec('INSERT INTO collective_landing_nonces VALUES(?,?,?,?)', (tenant, store, nonce, timestamp))

    def _product(self, c, tenant, store, product):
        real_id = self.products.get(product)
        require(real_id is not None, 404, 'product_not_mapped')
        actual = c.one('SELECT id,descr FROM products WHERE id=?' + self.lock, (real_id,))
        require(actual is not None, 404, 'product_not_found')
        fields = {'description': actual['descr'] or ''}
        require(isinstance(fields['description'], str) and len(fields['description']) <= 8000, 409, 'unsupported_description')
        current_digest = digest(fields)
        state = c.one('SELECT real_id,version,fields_digest FROM collective_landing_state WHERE tenant=? AND store=? AND product=?', (tenant, store, product))
        require(state is None or state['real_id'] == real_id, 409, 'product_mapping_changed')
        version = 1 if state is None else state['version'] + int(state['fields_digest'] != current_digest)
        if state is None:
            c.exec('INSERT INTO collective_landing_state VALUES(?,?,?,?,?,?)', (tenant, store, product, real_id, version, current_digest))
        elif state['fields_digest'] != current_digest:
            c.exec('UPDATE collective_landing_state SET version=?,fields_digest=? WHERE tenant=? AND store=? AND product=?', (version, current_digest, tenant, store, product))
        return {'version': version, 'fields': fields}

    @staticmethod
    def _receipt(c, tenant, store, request):
        return c.one('SELECT body_digest,receipt,before_snapshot FROM collective_landing_receipts WHERE tenant=? AND store=? AND request=?', (tenant, store, request))

    def execute(self, action, tenant, store, body, now):
        with self.db() as c:
            self._scope(c, tenant, store)
            if action == 'read':
                product = self._product(c, tenant, store, body['productId'])
                return {'productId': body['productId'], **product, 'digest': digest(product)}
            previous = self._receipt(c, tenant, store, body['requestId'])
            if action == 'receipt':
                return json.loads(previous['receipt']) if previous else None
            require(action in {'apply', 'rollback'}, 400, 'invalid_action')
            body_digest = digest({'action': action, 'body': body})
            if previous:
                require(previous['body_digest'] == body_digest, 409, 'idempotency_conflict')
                return json.loads(previous['receipt'])
            return self._write(c, action, tenant, store, body, body_digest, now)

    def _write(self, c, action, tenant, store, body, body_digest, now):
        product_id, next_fields = body.get('productId'), body.get('fields')
        if action == 'rollback':
            original = self._receipt(c, tenant, store, body['originalRequestId'])
            require(original is not None, 404, 'receipt_not_found')
            receipt = json.loads(original['receipt'])
            require(receipt['operation'] == 'apply' and receipt['afterDigest'] == body['expectedDigest'], 409, 'rollback_digest_mismatch')
            product_id, next_fields = receipt['productId'], json.loads(original['before_snapshot'])['fields']
        before = self._product(c, tenant, store, product_id)
        require(digest(before) == body['expectedDigest'], 409, 'stale_product')
        after = {'version': before['version'] + 1, 'fields': next_fields}
        # The actual product row is locked until the receipt and sidecar are committed.
        updated = c.exec('UPDATE products SET descr=? WHERE id=?', (next_fields['description'], self.products[product_id]))
        require(updated.rowcount == 1, 409, 'product_not_found')
        c.exec('UPDATE collective_landing_state SET version=?,fields_digest=? WHERE tenant=? AND store=? AND product=?', (after['version'], digest(next_fields), tenant, store, product_id))
        receipt = {'requestId': body['requestId'], 'productId': product_id, 'beforeDigest': digest(before), 'afterDigest': digest(after), 'approvalDigest': body['approvalDigest'], 'operation': action, 'at': dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat().replace('+00:00', 'Z'), 'status': 'applied'}
        if action == 'rollback':
            receipt['originalRequestId'] = body['originalRequestId']
        c.exec('INSERT INTO collective_landing_receipts VALUES(?,?,?,?,?,?)', (tenant, store, body['requestId'], body_digest, canonical(receipt), canonical(before)))
        return receipt
