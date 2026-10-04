"""Installable WSGI landing contract; SQLite store is a synthetic reference only.

Production adapters must atomically CAS the real product and persist immutable
snapshots/receipts in the SAME transaction. This module never accesses MAPDAL DBs.
"""
import datetime as dt
import hashlib
import hmac
import json
import re
import sqlite3
import time
from typing import Protocol

PREFIX = '/collective/v1/landing/'
ACTIONS = {'read', 'apply', 'receipt', 'rollback'}
MAX_BODY = 32768
ID = re.compile(r'[A-Za-z0-9_-]{1,100}')
PRODUCT_ID = re.compile(r'[A-Za-z0-9_:-]{1,100}')
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
HEX = re.compile(r'[0-9a-f]{64}')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


class Rejected(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code


def require(condition, status=400, code='invalid_request'):
    if not condition:
        raise Rejected(status, code)


def validate(action, body):
    common = {'tenantId', 'storeId'}
    fields = {
        'read': {'productId'}, 'receipt': {'requestId'},
        'apply': {'requestId', 'productId', 'expectedDigest', 'approvalDigest', 'fields'},
        'rollback': {'requestId', 'originalRequestId', 'expectedDigest', 'approvalDigest'},
    }
    require(isinstance(body, dict) and set(body) == common | fields[action])
    for key in common:
        require(isinstance(body[key], str) and ID.fullmatch(body[key]))
    if action in {'read', 'apply'}:
        require(isinstance(body['productId'], str) and PRODUCT_ID.fullmatch(body['productId']))
    for key in ('requestId', 'originalRequestId'):
        if key in body:
            require(isinstance(body[key], str) and UUID.fullmatch(body[key]))
    for key in ('expectedDigest', 'approvalDigest'):
        if key in body:
            require(isinstance(body[key], str) and HEX.fullmatch(body[key]))
    if action == 'apply':
        value = body['fields']
        require(isinstance(value, dict) and set(value) == {'description'})
        text = value['description']
        require(isinstance(text, str) and 1 <= len(text) <= 8000)
        require(not re.search(r'[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', text))
        require(not any(0xD800 <= ord(char) <= 0xDFFF for char in text))


class LandingStore(Protocol):
    """nonce() must be durable and unique; execute() must be one transaction."""
    def nonce(self, tenant, store, nonce, timestamp): ...
    def execute(self, action, tenant, store, body, now): ...


class SQLiteLandingStore:
    """Reference storage, NOT a mirror pretending to update a production shop."""
    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=10)
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS bridge_products (
              tenant TEXT, store TEXT, product TEXT, version INTEGER NOT NULL,
              fields TEXT NOT NULL, PRIMARY KEY(tenant,store,product));
            CREATE TABLE IF NOT EXISTS bridge_nonces (
              tenant TEXT, store TEXT, nonce TEXT, timestamp INTEGER,
              PRIMARY KEY(tenant,store,nonce));
            CREATE INDEX IF NOT EXISTS bridge_nonce_rate ON bridge_nonces(tenant,store,timestamp);
            CREATE TABLE IF NOT EXISTS bridge_receipts (
              tenant TEXT, store TEXT, request TEXT, body_digest TEXT NOT NULL,
              receipt TEXT NOT NULL, before_snapshot TEXT NOT NULL,
              after_snapshot TEXT NOT NULL, PRIMARY KEY(tenant,store,request));
            CREATE TRIGGER IF NOT EXISTS bridge_receipt_no_update
              BEFORE UPDATE ON bridge_receipts BEGIN SELECT RAISE(ABORT,'immutable'); END;
            CREATE TRIGGER IF NOT EXISTS bridge_receipt_no_delete
              BEFORE DELETE ON bridge_receipts BEGIN SELECT RAISE(ABORT,'immutable'); END;
        ''')

    def close(self):
        self.db.close()

    def seed(self, tenant, store, product, fields):
        """Synthetic fixtures only; existing products cannot be overwritten."""
        with self.db:
            self.db.execute('INSERT INTO bridge_products VALUES(?,?,?,1,?)', (tenant, store, product, canonical(fields)))

    def nonce(self, tenant, store, nonce, timestamp):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            # Durable uniqueness also rejects reuse with a fresh timestamp.
            try:
                count = self.db.execute('SELECT COUNT(*) FROM bridge_nonces WHERE tenant=? AND store=? AND timestamp>=?', (tenant, store, timestamp - 60)).fetchone()[0]
                require(count < 120, 429, 'rate_limited')
                self.db.execute('INSERT INTO bridge_nonces VALUES(?,?,?,?)', (tenant, store, nonce, timestamp))
            except sqlite3.IntegrityError:
                raise Rejected(409, 'nonce_replayed') from None
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def execute(self, action, tenant, store, body, now):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            result = self._execute(action, tenant, store, body, now)
            self.db.commit()
            return result
        except Exception:
            self.db.rollback()
            raise

    def _receipt(self, tenant, store, request):
        return self.db.execute('SELECT body_digest,receipt,before_snapshot FROM bridge_receipts WHERE tenant=? AND store=? AND request=?', (tenant, store, request)).fetchone()

    def _product(self, tenant, store, product):
        row = self.db.execute('SELECT version,fields FROM bridge_products WHERE tenant=? AND store=? AND product=?', (tenant, store, product)).fetchone()
        require(row is not None, 404, 'product_not_found')
        return {'version': row[0], 'fields': json.loads(row[1])}

    def _execute(self, action, tenant, store, body, now):
        if action == 'read':
            product = self._product(tenant, store, body['productId'])
            return {'productId': body['productId'], **product, 'digest': digest(product)}
        previous = self._receipt(tenant, store, body['requestId'])
        if action == 'receipt':
            return json.loads(previous[1]) if previous else None
        body_digest = digest({'action': action, 'body': body})
        if previous:
            require(previous[0] == body_digest, 409, 'idempotency_conflict')
            return json.loads(previous[1])
        product_id, next_fields = body.get('productId'), body.get('fields')
        if action == 'rollback':
            original = self._receipt(tenant, store, body['originalRequestId'])
            require(original is not None, 404, 'receipt_not_found')
            original_receipt = json.loads(original[1])
            require(original_receipt['operation'] == 'apply', 409, 'not_apply_receipt')
            require(body['expectedDigest'] == original_receipt['afterDigest'], 409, 'rollback_digest_mismatch')
            product_id = original_receipt['productId']
            next_fields = json.loads(original[2])['fields']
        before = self._product(tenant, store, product_id)
        require(digest(before) == body['expectedDigest'], 409, 'stale_product')
        after = {'version': before['version'] + 1, 'fields': next_fields}
        receipt = {
            'requestId': body['requestId'], 'productId': product_id,
            'beforeDigest': digest(before), 'afterDigest': digest(after),
            'approvalDigest': body['approvalDigest'], 'operation': action,
            'at': dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat().replace('+00:00', 'Z'),
            'status': 'applied',
        }
        if action == 'rollback':
            receipt['originalRequestId'] = body['originalRequestId']
        updated = self.db.execute('UPDATE bridge_products SET version=?,fields=? WHERE tenant=? AND store=? AND product=? AND version=?', (after['version'], canonical(next_fields), tenant, store, product_id, before['version']))
        require(updated.rowcount == 1, 409, 'stale_product')
        self.db.execute('INSERT INTO bridge_receipts VALUES(?,?,?,?,?,?,?)', (tenant, store, body['requestId'], body_digest, canonical(receipt), canonical(before), canonical(after)))
        return receipt


class LandingBridge:
    def __init__(self, store: LandingStore, secret, tenant, shop, scopes):
        if not isinstance(secret, str) or len(secret.encode()) < 32:
            raise ValueError('bridge signing key must contain at least 32 bytes')
        if not ID.fullmatch(tenant) or not ID.fullmatch(shop):
            raise ValueError('invalid bridge scope')
        self.store, self.secret = store, secret.encode()
        self.tenant, self.shop, self.scopes = tenant, shop, frozenset(scopes)

    def _authenticate(self, method, path, headers, raw, now):
        stamp, nonce, signature = (headers.get('x-collective-' + key, '') for key in ('timestamp', 'nonce', 'signature'))
        require(re.fullmatch(r'[0-9]{10}', stamp) and abs(now - int(stamp)) <= 300, 401, 'invalid_signature')
        require(UUID.fullmatch(nonce) and HEX.fullmatch(signature), 401, 'invalid_signature')
        signed = (stamp + '\n' + nonce + '\n' + method + '\n' + path + '\n').encode() + raw
        require(hmac.compare_digest(hmac.new(self.secret, signed, hashlib.sha256).hexdigest(), signature), 401, 'invalid_signature')
        return nonce, int(stamp)

    def handle(self, method, path, headers, raw, now=None):
        now = int(time.time()) if now is None else now
        try:
            require(len(raw) <= MAX_BODY, 413, 'request_too_large')
            require(path.startswith(PREFIX) and path[len(PREFIX):] in ACTIONS, 404, 'unknown_path')
            require(method == 'POST', 405, 'invalid_method')
            nonce, stamp = self._authenticate(method, path, headers, raw, now)
            body = json.loads(raw.decode('utf-8'), parse_constant=lambda _: None)
            action = path[len(PREFIX):]
            validate(action, body)
            require(body['tenantId'] == self.tenant and body['storeId'] == self.shop, 403, 'scope_denied')
            scope = 'landing:read' if action in {'read', 'receipt'} else 'landing:write'
            require(scope in self.scopes, 403, 'scope_denied')
            try:
                # Rate limits use server time, never the caller's allowed clock skew.
                self.store.nonce(self.tenant, self.shop, nonce, now)
                return 200, self.store.execute(action, self.tenant, self.shop, body, now)
            except Rejected:
                raise
            except Exception:
                return 503, {'status': 'unknown', 'code': 'provider_unavailable'}
        except Rejected as error:
            return error.status, {'status': 'rejected', 'code': error.code}
        except (ValueError, UnicodeError, TypeError):
            return 400, {'status': 'rejected', 'code': 'invalid_request'}
        except Exception:
            # Adapter failures may follow a remote commit: never declare rejected.
            return 503, {'status': 'unknown', 'code': 'provider_unavailable'}

    def __call__(self, environ, start_response):
        """WSGI adapter; serve only behind TLS with bounded worker concurrency."""
        try:
            length = int(environ.get('CONTENT_LENGTH', '0'))
            require(0 < length <= MAX_BODY, 413, 'request_too_large')
            require(environ.get('CONTENT_TYPE', '').split(';')[0] == 'application/json', 415, 'content_type')
            require(not environ.get('QUERY_STRING'), 400, 'query_not_allowed')
            raw = environ['wsgi.input'].read(length)
            require(len(raw) == length)
            headers = {name: environ.get('HTTP_' + name.upper().replace('-', '_'), '') for name in ('x-collective-timestamp', 'x-collective-nonce', 'x-collective-signature')}
            status, result = self.handle(environ['REQUEST_METHOD'], environ['PATH_INFO'], headers, raw)
        except (Rejected, ValueError) as error:
            status = error.status if isinstance(error, Rejected) else 400
            result = {'status': 'rejected', 'code': 'invalid_request'}
        response = canonical(result).encode('utf-8')
        from http import HTTPStatus
        start_response(str(status) + ' ' + HTTPStatus(status).phrase, [('Content-Type', 'application/json; charset=utf-8'), ('Content-Length', str(len(response))), ('Cache-Control', 'no-store')])
        return [response]
