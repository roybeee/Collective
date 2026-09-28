"""MAPDAL explicit export or read-only database source -> minimal order outbox."""
import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import pathlib
import re
import sqlite3
import time
import urllib.parse
import urllib.request

HOST = 'mealzip-agency.hflameb.chatgpt.site'
KST = dt.timezone(dt.timedelta(hours=9))
MODES = {'standard': 'delivery', 'pickup': 'pickup'}


def integer(value):
    return type(value) is int and 0 <= value <= 10**12


def convert(source, refund=None):
    """Return six allowlisted fields (outbox assigns revision), or safe reason."""
    if not isinstance(source, dict):
        return None, 'held'
    status = source.get('status')
    if status in ('PENDING', 'WAITING_DEPOSIT', 'FAILED'):
        return None, 'skipped'
    if status not in ('PAID', 'CANCELLED') or (status == 'CANCELLED' and refund is None):
        return None, 'held'
    order_id, amount = source.get('order_id'), source.get('amount')
    if not isinstance(order_id, str) or not re.fullmatch(r'MD-\d{8}-[A-F0-9]{6}', order_id):
        return None, 'held'
    if not integer(amount) or amount <= 0 or source.get('ship_method') not in MODES:
        return None, 'held'
    created = source.get('created')
    if not isinstance(created, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?', created):
        return None, 'held'
    try:
        day = dt.datetime.fromisoformat(created).date()
    except ValueError:
        return None, 'held'
    if day > dt.datetime.now(KST).date():
        return None, 'held'
    refunded = 0
    if refund is not None:
        if not valid_refund(refund, amount):
            return None, 'held'
        refunded = refund['refund_amount']
    if status == 'CANCELLED' and refunded != amount:
        return None, 'held'
    return dict(order_id=order_id, order_date=day.isoformat(), status='refunded' if refunded == amount else 'paid', paid_amount=amount, refund_amount=refunded, mode=MODES[source['ship_method']]), None


def valid_refund(proof, amount):
    return (isinstance(proof, dict) and set(proof) == {'confirmed', 'reference', 'paid_amount', 'refund_amount'}
            and proof.get('confirmed') is True and type(proof.get('paid_amount')) is int
            and proof['paid_amount'] == amount and integer(proof.get('refund_amount'))
            and 0 < proof['refund_amount'] <= amount and isinstance(proof.get('reference'), str)
            and re.fullmatch(r'refund-[A-Za-z0-9_-]{1,64}', proof['reference']) is not None)


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'))


class Outbox:
    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=10)
        self.db.execute('CREATE TABLE IF NOT EXISTS outbox(order_id TEXT, revision INTEGER, digest TEXT, body TEXT, sent INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(order_id,revision), UNIQUE(order_id,digest))')
        self.db.execute('CREATE TABLE IF NOT EXISTS holds(order_id TEXT PRIMARY KEY)')
        self.db.execute('CREATE TABLE IF NOT EXISTS scope(key TEXT PRIMARY KEY, value TEXT NOT NULL)')

    def close(self):
        self.db.close()

    def stage(self, source, refund=None):
        row, reason = convert(source, refund)
        if reason:
            if isinstance(source, dict) and source.get('status') in ('CANCELLED', 'DEPOSIT_AFTER_CANCEL') and isinstance(source.get('order_id'), str) and re.fullmatch(r'MD-\d{8}-[A-F0-9]{6}', source['order_id']):
                with self.db:
                    self.db.execute('INSERT OR IGNORE INTO holds(order_id) VALUES(?)', (source['order_id'],))
            return {'outcome': reason}
        digest = hashlib.sha256(canonical(row).encode()).hexdigest()
        self.db.execute('BEGIN IMMEDIATE')
        try:
            result = self._stage(row, digest)
            self.db.commit()
            return result
        except Exception:
            self.db.rollback()
            raise

    def _stage(self, row, digest):
        held = self.db.execute('SELECT 1 FROM holds WHERE order_id=?', (row['order_id'],)).fetchone()
        if held and row['status'] != 'refunded':
            return {'outcome': 'held'}
        previous = self.db.execute('SELECT body FROM outbox WHERE order_id=? AND digest=?', (row['order_id'], digest)).fetchone()
        if previous:
            if held and row['status'] == 'refunded':
                self.db.execute('DELETE FROM holds WHERE order_id=?', (row['order_id'],))
            return {'outcome': 'duplicate', 'body': previous[0]}
        latest = self.db.execute('SELECT revision,body FROM outbox WHERE order_id=? ORDER BY revision DESC LIMIT 1', (row['order_id'],)).fetchone()
        if latest:
            old = json.loads(latest[1])['orders'][0]
            if any(row[k] != old[k] for k in ('order_date', 'paid_amount', 'mode')) or row['refund_amount'] < old['refund_amount']:
                return {'outcome': 'held'}
        revision = latest[0] + 1 if latest else 1
        body = canonical({'orders': [{**row, 'revision': revision}]})
        self.db.execute('INSERT INTO outbox(order_id,revision,digest,body) VALUES(?,?,?,?)', (row['order_id'], revision, digest, body))
        if held:
            self.db.execute('DELETE FROM holds WHERE order_id=?', (row['order_id'],))
        return {'outcome': 'staged', 'body': body}

    def pending(self):
        return self.db.execute('SELECT order_id,revision,body FROM outbox WHERE sent=0 AND order_id NOT IN (SELECT order_id FROM holds) ORDER BY order_id,revision').fetchall()

    def acknowledge(self, order_id, revision):
        with self.db:
            self.db.execute('UPDATE outbox SET sent=1 WHERE order_id=? AND revision=?', (order_id, revision))

    def bind_endpoint(self, endpoint):
        validate_endpoint(endpoint)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO scope(key,value) VALUES('endpoint',?)", (endpoint,))
            saved = self.db.execute("SELECT value FROM scope WHERE key='endpoint'").fetchone()[0]
            if saved != endpoint:
                raise ValueError('Outbox is bound to another destination')


def signature(secret, timestamp, body):
    return 'sha256=' + hmac.new(secret.encode(), (timestamp + '.' + body).encode(), hashlib.sha256).hexdigest()


def validate_endpoint(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname != HOST or parsed.netloc not in (HOST, HOST + ':443')
            or parsed.query or parsed.fragment or not re.fullmatch(r'/api/storefront-webhooks/[a-f0-9-]{36}', parsed.path)):
        raise ValueError('Endpoint is outside the fixed COLLECTIVE webhook scope')
    return url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Webhook redirects are not allowed')


def send(body, endpoint, secret):
    """Only explicitly called by --send; no redirects, credentials in headers only."""
    validate_endpoint(endpoint)
    if not isinstance(secret, str) or len(secret) < 32:
        raise ValueError('Webhook signing secret is missing')
    timestamp = str(int(time.time()))
    request = urllib.request.Request(endpoint, data=body.encode(), method='POST', headers={
        'Content-Type': 'application/json', 'x-collective-timestamp': timestamp,
        'x-collective-signature': signature(secret, timestamp, body)})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=20) as response:
        if response.status != 200:
            raise ValueError('Webhook did not acknowledge delivery')
        result = json.loads(response.read(16384))
    # Do not acknowledge a login page or arbitrary 200 response.
    counts = [result.get(k) for k in ('created', 'updated', 'duplicates', 'older')]
    if any(type(x) is not int or x < 0 for x in counts) or sum(counts) != 1:
        raise ValueError('Webhook acknowledgement is invalid')


def source_range(args):
    if not args.allow_live_input:
        raise ValueError('Source DB requires --allow-live-input')
    if not args.date_from or not args.date_to:
        raise ValueError('Source DB requires a bounded date range')
    start, end = dt.date.fromisoformat(args.date_from), dt.date.fromisoformat(args.date_to)
    if end < start or (end-start).days >= 31:
        raise ValueError('Source range must be 1 to 31 days')
    return start.isoformat()+'T00:00:00', (end+dt.timedelta(days=1)).isoformat()+'T00:00:00'


def postgres_rows(args):
    bounds = source_range(args)
    dsn = os.environ.get('MAPDAL_SOURCE_DATABASE_URL', '')
    parsed = urllib.parse.urlsplit(dsn)
    if parsed.scheme not in ('postgresql', 'postgres') or not parsed.hostname:
        raise ValueError('Explicit PostgreSQL source URL is required')
    ssl_modes = urllib.parse.parse_qs(parsed.query).get('sslmode', ['require'])
    if len(ssl_modes) != 1 or ssl_modes[0] not in ('require', 'verify-ca', 'verify-full'):
        raise ValueError('Source SSL must not allow plaintext fallback')
    # Optional dependency: only imported for this explicitly selected source.
    import psycopg
    from psycopg.rows import dict_row
    db = psycopg.connect(dsn, autocommit=False, row_factory=dict_row, connect_timeout=2, sslmode=ssl_modes[0])
    try:
        db.execute('SET TRANSACTION READ ONLY')
        db.execute("SET LOCAL statement_timeout = '2s'")
        rows = db.execute('SELECT order_id,created,status,amount,ship_method FROM orders WHERE created>=%s AND created<%s ORDER BY created,order_id LIMIT 101', bounds).fetchall()
        if len(rows)>100:
            raise ValueError('Source range exceeds 100 rows; use a smaller range or bounded export')
        return rows
    finally:
        try:
            db.rollback()
        finally:
            db.close()


def source_rows(args):
    bounds = source_range(args)
    path = pathlib.Path(args.source_db).resolve(strict=True)
    target = pathlib.Path(args.outbox).resolve()
    if path == target or (target.exists() and path.samefile(target)):
        raise ValueError('Source and outbox must be different files')
    db = sqlite3.connect(path.as_uri()+'?mode=ro', uri=True, timeout=2)
    try:
        # Bound both returned rows and work on a missing/unhelpful source index.
        deadline = time.monotonic()+2
        db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
        db.row_factory = sqlite3.Row
        kind = db.execute("SELECT type FROM sqlite_schema WHERE name='orders'").fetchone()
        if not kind or kind['type'] != 'table':
            raise ValueError('Source orders must be a physical table')
        rows = db.execute('SELECT order_id,created,status,amount,ship_method FROM orders WHERE created>=? AND created<? ORDER BY created,order_id LIMIT 101',
                          bounds).fetchall()
        if len(rows)>100:
            raise ValueError('Source range exceeds 100 rows; use a smaller range or bounded export')
        return [dict(row) for row in rows]
    finally:
        db.close()


def input_data(args):
    if getattr(args, 'source_postgres', False):
        if args.input or getattr(args, 'source_db', None):
            raise ValueError('Choose exactly one source')
        return postgres_rows(args), {}
    if getattr(args, 'source_db', None):
        if args.input:
            raise ValueError('Choose input export or source DB, not both')
        return source_rows(args), {}
    path = pathlib.Path(args.input)
    if path.stat().st_size > 2_000_000:
        raise ValueError('Input exceeds the batch limit')
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or (data.get('synthetic') is not True and not args.allow_live_input):
        raise ValueError('Live exports require --allow-live-input')
    rows, refunds = data.get('orders'), data.get('refunds', {})
    if not isinstance(rows, list) or len(rows) > 100 or not isinstance(refunds, dict):
        raise ValueError('Input requires up to 100 orders and optional structured refunds')
    return rows, refunds


def run(args):
    rows, refunds = input_data(args)
    if args.send and (not args.enqueue or not args.allow_live_input):
        raise ValueError('--send requires --enqueue and --allow-live-input')
    if args.send:
        validate_endpoint(os.environ.get('COLLECTIVE_WEBHOOK_URL', ''))
    box = Outbox(args.outbox if args.enqueue else ':memory:')
    summary = dict(staged=0, duplicate=0, held=0, skipped=0, transmitted=0, dry_run=not args.enqueue)
    try:
        for row in rows:
            proof = refunds.get(row.get('order_id')) if isinstance(row, dict) else None
            summary[box.stage(row, proof)['outcome']] += 1
        if args.send:
            box.bind_endpoint(os.environ['COLLECTIVE_WEBHOOK_URL'])
            for order_id, revision, raw in box.pending():
                send(raw, os.environ['COLLECTIVE_WEBHOOK_URL'], os.environ.get('COLLECTIVE_WEBHOOK_SECRET', ''))
                box.acknowledge(order_id, revision)
                summary['transmitted'] += 1
        return summary
    finally:
        box.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--input')
    source.add_argument('--source-db')
    source.add_argument('--source-postgres', action='store_true')
    parser.add_argument('--date-from')
    parser.add_argument('--date-to')
    parser.add_argument('--outbox', default='mapdal-outbox.sqlite')
    parser.add_argument('--enqueue', action='store_true')
    parser.add_argument('--allow-live-input', action='store_true')
    parser.add_argument('--send', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), ensure_ascii=False))
    except Exception:
        # Never log source rows, order IDs, tokens, response bodies or exception URLs.
        print(json.dumps({'error': 'adapter_failed', 'detail': '입력 계약·outbox·연결 설정을 확인하세요. 원문은 로그에 남기지 않습니다.'}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
