"""Read-only bearer endpoint for adapter.py's durable minimal order outbox.

The existing bounded PostgreSQL/SQLite importer populates this outbox. No shop
database, customer fields, refunds, or source credentials are accessed by HTTP.
"""
import asyncio
import collections
import datetime as dt
import hashlib
import hmac
import json
import pathlib
import re
import sqlite3
import threading
import time
import urllib.parse

PATH = '/collective/v1/orders'
FIELDS = {'order_id', 'revision', 'order_date', 'status', 'paid_amount', 'refund_amount', 'mode'}


class OrderPull:
    def __init__(self, outbox, token, expected_scope=None):
        if not isinstance(token, str) or not 32 <= len(token) <= 500 or re.search(r'\s', token):
            raise ValueError('strong dedicated bearer token required')
        if expected_scope is not None and (not isinstance(expected_scope,tuple) or len(expected_scope)!=2 or any(not isinstance(v,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',v) for v in expected_scope)):
            raise ValueError('invalid scope')
        self.expected_scope = expected_scope
        self.path = pathlib.Path(outbox).resolve(strict=True)
        self.key = token.encode()
        self.token_hash = hashlib.sha256(self.key).digest()
        self.calls, self.lock = collections.deque(), threading.Lock()

    def cursor(self, sequence):
        value = str(sequence)
        signature = hmac.new(self.key, ('orders-v1\n' + str(self.path) + '\n' + value).encode(), hashlib.sha256).hexdigest()
        return value + '.' + signature

    def sequence(self, cursor):
        if cursor is None:
            return 0
        if not re.fullmatch(r'[0-9]{1,16}\.[a-f0-9]{64}', cursor):
            raise ValueError('invalid cursor')
        value = int(cursor.split('.')[0])
        if not hmac.compare_digest(cursor, self.cursor(value)):
            raise ValueError('invalid cursor')
        return value

    def handle(self, method, path, query, headers, now=None):
        token = headers.get('authorization', '')
        candidate = token[7:] if token.startswith('Bearer ') else ''
        if not hmac.compare_digest(hashlib.sha256(candidate.encode()).digest(), self.token_hash):
            return 401, {'error': 'unauthorized'}
        if method != 'GET' or path != PATH:
            return 405 if method != 'GET' else 404, {'error': 'unsupported_request'}
        try:
            params = urllib.parse.parse_qs(query, keep_blank_values=True, max_num_fields=2, strict_parsing=True)
            if set(params) - {'cursor', 'limit'} or params.get('limit') != ['100'] or any(len(v) != 1 for v in params.values()):
                raise ValueError('invalid query')
            sequence = self.sequence(params.get('cursor', [None])[0])
        except ValueError:
            return 400, {'error': 'invalid_query'}
        now = time.monotonic() if now is None else now
        with self.lock:
            while self.calls and self.calls[0] <= now - 60:
                self.calls.popleft()
            if len(self.calls) >= 120:
                return 429, {'error': 'rate_limited'}
            self.calls.append(now)
        try:
            return self._page(sequence)
        except (sqlite3.Error, ValueError, KeyError, TypeError):
            return 503, {'error': 'outbox_unavailable'}

    def _page(self, sequence):
        db = sqlite3.connect(self.path.as_uri() + '?mode=ro', uri=True, timeout=2)
        try:
            deadline = time.monotonic() + 2
            db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
            db.execute('BEGIN')
            if self.expected_scope is not None:
                scope = dict(db.execute("SELECT key,value FROM scope WHERE key IN ('collective_tenant','collective_store')"))
                if (scope.get('collective_tenant'),scope.get('collective_store')) != self.expected_scope:
                    raise ValueError('outbox_scope_mismatch')
            # An unresolved cancellation is visible even if its original row was
            # already exported. Never silently advance a cursor past uncertainty.
            if db.execute('SELECT 1 FROM holds LIMIT 1').fetchone():
                return 409, {'error': 'unresolved_order_hold'}
            rows = db.execute('SELECT rowid,body FROM outbox WHERE rowid>? ORDER BY rowid LIMIT 101', (sequence,)).fetchall()
            latest = {}
            for _, raw in rows[:100]:
                if len(raw) > 4096:
                    raise ValueError('invalid outbox size')
                body = json.loads(raw)
                if set(body) != {'orders'} or len(body['orders']) != 1:
                    raise ValueError('invalid outbox')
                row = body['orders'][0]
                if set(row) != FIELDS or not re.fullmatch(r'MD-\d{8}-[A-F0-9]{6}', row['order_id']):
                    raise ValueError('invalid row')
                if any(type(row[name]) is not int for name in ('revision', 'paid_amount', 'refund_amount')):
                    raise ValueError('invalid amounts')
                if not 1 <= row['revision'] <= 9999999999 or not 0 <= row['refund_amount'] <= row['paid_amount'] <= 10**12:
                    raise ValueError('invalid amounts')
                if row['status'] not in {'paid', 'refunded', 'cancelled'} or row['mode'] not in {'hall', 'pickup', 'delivery', 'group'}:
                    raise ValueError('invalid status or mode')
                if dt.date.fromisoformat(row['order_date']).isoformat() != row['order_date']:
                    raise ValueError('invalid date')
                if (row['status'] != 'paid' and row['refund_amount'] != row['paid_amount']) or (row['status'] == 'paid' and row['paid_amount'] > 0 and row['paid_amount'] == row['refund_amount']):
                    raise ValueError('inconsistent refund')
                latest[row['order_id']] = row
            next_sequence = rows[min(99, len(rows) - 1)][0] if rows else sequence
            return 200, {'orders': list(latest.values()), 'nextCursor': self.cursor(next_sequence) if next_sequence else None, 'hasMore': len(rows) > 100}
        finally:
            db.close()


class OrderPullASGI:
    def __init__(self, pull):
        self.pull = pull

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return
        pairs = [(k.decode('latin1').lower(), v.decode('latin1')) for k, v in scope.get('headers', [])]
        if sum(k == 'authorization' for k, _ in pairs) != 1:
            status, value = 401, {'error': 'unauthorized'}
        else:
            path = scope['path']
            path = PATH if path in {'', '/', PATH, PATH + '/'} else path
            status, value = await asyncio.to_thread(self.pull.handle, scope['method'], path, scope.get('query_string', b'').decode('ascii', errors='replace'), dict(pairs))
        raw = json.dumps(value, separators=(',', ':')).encode()
        await send({'type': 'http.response.start', 'status': status, 'headers': [(b'content-type', b'application/json'), (b'cache-control', b'no-store')]})
        await send({'type': 'http.response.body', 'body': raw})
