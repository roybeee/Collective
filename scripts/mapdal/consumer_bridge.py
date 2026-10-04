"""Independent signed consumer outbox reference. No SMS/email transport is included.

Install behind TLS only after supplying a production recipient/consent/template
store. SQLite fixtures are not proof of MAPDAL installation or real delivery.
A transport claims once, then records a receipt. Unknown claims NEVER requeue.
"""
import datetime as dt
import hashlib
import hmac
import json
import re
import sqlite3
import time
import uuid
import urllib.parse
import urllib.request

PREFIX = '/collective/v1/consumer/'
MAX_BODY = 32768
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', re.I)
HEX = re.compile(r'[a-f0-9]{64}')
ID = re.compile(r'[A-Za-z0-9_-]{1,100}')
PURPOSES = {'post_purchase', 'marketing_reorder'}


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def payload_digest(value):
    # The client hashes JSON.stringify(payload), preserving the wire key order.
    return hashlib.sha256(dumps(value).encode()).hexdigest()


def iso(timestamp):
    return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


class Rejected(Exception):
    def __init__(self, status=400, code='invalid_request'):
        self.status, self.code = status, code


def require(ok, status=400, code='invalid_request'):
    if not ok:
        raise Rejected(status, code)


def money(value):
    return type(value) is int and 0 <= value <= 100000000


def validate(action, body):
    keys = {'tenantId', 'storeId', 'requestId', 'payloadDigest'}
    require(isinstance(body, dict) and set(body) == keys | ({'payload'} if action == 'send' else set()))
    require(all(isinstance(body[k], str) and ID.fullmatch(body[k]) for k in ('tenantId', 'storeId')))
    require(isinstance(body['requestId'], str) and UUID.fullmatch(body['requestId']))
    require(isinstance(body['payloadDigest'], str) and HEX.fullmatch(body['payloadDigest']))
    if action != 'send':
        return
    p = body['payload']
    require(isinstance(p, dict) and set(p) == {'requestId', 'recipientId', 'purpose', 'templateId', 'templateDigest', 'maxCostKrw', 'expiresAt', 'consentDigest'} | ({'serviceContext'} if p.get('purpose') == 'service_reply' else set()))
    require(all(isinstance(p[k], str) and UUID.fullmatch(p[k]) for k in ('requestId', 'recipientId', 'templateId')))
    require(p['requestId'] == body['requestId'] and p['purpose'] in PURPOSES | {'service_reply'})
    require(all(isinstance(p[k], str) and HEX.fullmatch(p[k]) for k in ('templateDigest', 'consentDigest')))
    if p['purpose'] == 'service_reply':
        ref = p['serviceContext']
        require(isinstance(ref, dict) and set(ref) == {'ticketId', 'ticketVersion', 'sourceDigest'})
        require(isinstance(ref['ticketId'], str) and UUID.fullmatch(ref['ticketId']) and type(ref['ticketVersion']) is int and ref['ticketVersion'] >= 1 and isinstance(ref['sourceDigest'], str) and HEX.fullmatch(ref['sourceDigest']) and p['maxCostKrw'] == 0)
    require(money(p['maxCostKrw']))
    require(isinstance(p['expiresAt'], str) and p['expiresAt'].endswith('Z'))
    dt.datetime.fromisoformat(p['expiresAt'].replace('Z', '+00:00'))
    require(hmac.compare_digest(payload_digest(p), body['payloadDigest']))


class SQLiteConsumerStore:
    """Synthetic reference; recipient IDs never contain addresses or phone numbers.

    Production transport must check its current opt-out policy again immediately
    before sending, and use requestId as the transport idempotency key. finish()
    is called only from a trusted authenticated transport receipt, never the UI.
    """
    def __init__(self, path, authorize=None):
        self.authorize = authorize
        self.db = sqlite3.connect(path, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS consumer_recipients(tenant TEXT,store TEXT,id TEXT,consents TEXT,PRIMARY KEY(tenant,store,id));
          CREATE TABLE IF NOT EXISTS consumer_templates(tenant TEXT,store TEXT,id TEXT,digest TEXT,purpose TEXT,cost INTEGER,PRIMARY KEY(tenant,store,id));
          CREATE TABLE IF NOT EXISTS consumer_nonces(tenant TEXT,store TEXT,id TEXT,at INTEGER,PRIMARY KEY(tenant,store,id));
          CREATE TABLE IF NOT EXISTS consumer_outbox(tenant TEXT,store TEXT,id TEXT,digest TEXT,payload TEXT,status TEXT,receipt TEXT,max_cost INTEGER,cancel_pending INTEGER DEFAULT 0,PRIMARY KEY(tenant,store,id));
        ''')

    def close(self):
        self.db.close()

    def recipient(self, tenant, store, recipient, consents):
        require(UUID.fullmatch(recipient) and set(consents) <= PURPOSES)
        require(all(type(expiry) is int and expiry > 0 for expiry in consents.values()))
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO consumer_recipients VALUES(?,?,?,?)', (tenant, store, recipient, dumps(consents)))

    def template(self, tenant, store, template, digest, purpose, cost):
        require(UUID.fullmatch(template) and HEX.fullmatch(digest) and purpose in PURPOSES and money(cost))
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO consumer_templates VALUES(?,?,?,?,?,?)', (tenant, store, template, digest, purpose, cost))

    def nonce(self, tenant, store, nonce, now):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            require(self.db.execute('SELECT count(*) FROM consumer_nonces WHERE tenant=? AND store=? AND at>?', (tenant, store, now - 60)).fetchone()[0] < 120, 429, 'rate_limited')
            try:
                self.db.execute('INSERT INTO consumer_nonces VALUES(?,?,?,?)', (tenant, store, nonce, now))
            except sqlite3.IntegrityError:
                raise Rejected(409, 'nonce_replay') from None
            self.db.execute('DELETE FROM consumer_nonces WHERE at<?', (now - 600,))

    def _eligible(self, tenant, store, p, now):
        if p.get('purpose') not in PURPOSES:
            return False
        recipient = self.db.execute('SELECT consents FROM consumer_recipients WHERE tenant=? AND store=? AND id=?', (tenant, store, p['recipientId'])).fetchone()
        template = self.db.execute('SELECT * FROM consumer_templates WHERE tenant=? AND store=? AND id=?', (tenant, store, p['templateId'])).fetchone()
        expires = dt.datetime.fromisoformat(p['expiresAt'].replace('Z', '+00:00')).timestamp()
        return bool(recipient and template and json.loads(recipient['consents']).get(p['purpose'], 0) > now and expires > now and template['digest'] == p['templateDigest'] and template['purpose'] == p['purpose'] and template['cost'] <= p['maxCostKrw'])

    def _row(self, tenant, store, request):
        return self.db.execute('SELECT * FROM consumer_outbox WHERE tenant=? AND store=? AND id=?', (tenant, store, request)).fetchone()

    @staticmethod
    def _receipt(request, digest, status, cost, now, code=None):
        return dict(requestId=request, payloadDigest=digest, status=status, costKrw=cost, receiptId=str(uuid.uuid4()), at=iso(now), code=code)

    def execute(self, action, tenant, store, body, now):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self._row(tenant, store, body['requestId'])
            if row:
                require(row['digest'] == body['payloadDigest'], 409, 'request_conflict')
            if action == 'send':
                if row:
                    return json.loads(row['receipt']) if row['receipt'] else None
                require(self._eligible(tenant, store, body['payload'], now), 409, 'consent_template_or_expiry')
                receipt = self._receipt(body['requestId'], body['payloadDigest'], 'accepted', None, now)
                self.db.execute('INSERT INTO consumer_outbox VALUES(?,?,?,?,?,?,?,?,0)', (tenant, store, body['requestId'], body['payloadDigest'], dumps(body['payload']), 'accepted', dumps(receipt), body['payload']['maxCostKrw']))
                return receipt
            if not row:
                return None
            if action == 'cancel':
                if row['status'] == 'accepted':
                    receipt = self._receipt(row['id'], row['digest'], 'failed', 0, now, 'cancelled')
                    self.db.execute("UPDATE consumer_outbox SET status='failed',receipt=?,payload='{}',cancel_pending=0 WHERE tenant=? AND store=? AND id=?", (dumps(receipt), tenant, store, row['id']))
                    return receipt
                self.db.execute("UPDATE consumer_outbox SET payload='{}',cancel_pending=? WHERE tenant=? AND store=? AND id=?", (1 if row['status'] == 'unknown' else 0, tenant, store, row['id']))
            return json.loads(row['receipt']) if row['receipt'] else None

    def claim(self, tenant, store, request, now):
        """Durable intent BEFORE one transport invocation; crashes stay unknown."""
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self._row(tenant, store, request)
            if not row or row['status'] != 'accepted':
                return None
            payload = json.loads(row['payload'])
            if not self._eligible(tenant, store, payload, now):
                receipt = self._receipt(request, row['digest'], 'failed', 0, now, 'rejected')
                self.db.execute("UPDATE consumer_outbox SET status='failed',receipt=?,payload='{}' WHERE tenant=? AND store=? AND id=?", (dumps(receipt), tenant, store, request))
                return None
            # No callback, network error, stale signature or busy workspace: remain accepted.
            # Explicit current denial is terminal, even when cancellation has not arrived.
            try:
                authorization = self.authorize(tenant, store, request, row['digest'], now) if self.authorize else None
            except Exception:
                authorization = None
            if authorization is False:
                receipt = self._receipt(request, row['digest'], 'failed', 0, now, 'rejected')
                self.db.execute("UPDATE consumer_outbox SET status='failed',receipt=?,payload='{}' WHERE tenant=? AND store=? AND id=?", (dumps(receipt), tenant, store, request))
                return None
            if authorization is not True:
                return None
            self.db.execute("UPDATE consumer_outbox SET status='unknown',receipt=NULL WHERE tenant=? AND store=? AND id=?", (tenant, store, request))
            return payload

    def deliver(self, tenant, store, request, transport, now=None):
        """One transport invocation, with a NEW authorization after durable claim.

        Production workers must call this method, not hold/reuse claim payloads.
        Transport must enforce the UUID idempotency key and return trusted costs.
        """
        clock = lambda: int(time.time()) if now is None else now
        payload = self.claim(tenant, store, request, clock())
        if payload is None:
            return None
        row = self._row(tenant, store, request)
        try:
            allowed = self.authorize(tenant, store, request, row['digest'], clock()) if self.authorize else None
        except Exception:
            allowed = None
        if allowed is False:
            return self.finish(tenant, store, request, 'failed', 0, clock())
        if allowed is not True:
            return None
        if not self._ready_to_send(tenant, store, request, payload, clock()):
            return None
        # There is no stored/reusable permit between this check and transport.
        try:
            result = transport(request, payload)
            if not isinstance(result, dict) or set(result) != {'status', 'costKrw'}:
                return None
            return self.finish(tenant, store, request, result['status'], result['costKrw'], clock())
        except Exception:
            return None

    def _ready_to_send(self, tenant, store, request, payload, now):
        # The callback can take seconds: re-read provider-local consent/template/cancel
        # after it returns. No network call holds this transaction open.
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self._row(tenant, store, request)
            if not row or row['status'] != 'unknown':
                return False
            eligible = not row['cancel_pending'] and row['payload'] == dumps(payload) and self._eligible(tenant, store, payload, now)
            if not eligible:
                receipt = self._receipt(request, row['digest'], 'failed', 0, now, 'rejected')
                self.db.execute("UPDATE consumer_outbox SET status='failed',receipt=?,payload='{}',cancel_pending=0 WHERE tenant=? AND store=? AND id=?", (dumps(receipt), tenant, store, request))
            return bool(eligible)

    def finish(self, tenant, store, request, status, cost, now):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self._row(tenant, store, request)
            require(row is not None and row['status'] == 'unknown', 409, 'not_claimed')
            require(status in {'delivered', 'failed'} and money(cost) and cost <= row['max_cost'])
            receipt = self._receipt(request, row['digest'], status, cost, now)
            self.db.execute("UPDATE consumer_outbox SET status=?,receipt=?,payload='{}',cancel_pending=0 WHERE tenant=? AND store=? AND id=?", (status, dumps(receipt), tenant, store, request))
            return receipt


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class CollectiveAuthorizationClient:
    """Configure origin/owner/campaign out of band; never accept them from message payload.

    Call for EVERY claim immediately before transport invocation. No authorization
    cache. Signed negative means suppress; any missing/invalid response means wait.
    """
    def __init__(self, origin, owner, campaign_id, secret, allowed_hosts):
        parsed = urllib.parse.urlsplit(origin)
        require(parsed.scheme == 'https' and parsed.hostname in set(allowed_hosts) and not parsed.username and not parsed.password and parsed.path in {'', '/'} and not parsed.query and not parsed.fragment and parsed.port in {None, 443})
        require(isinstance(owner, str) and 1 <= len(owner) <= 200 and ID.fullmatch(campaign_id) and 32 <= len(secret) <= 512)
        self.origin, self.owner, self.campaign_id, self.secret = origin.rstrip('/'), owner, campaign_id, secret.encode()
        self.opener = urllib.request.build_opener(NoRedirect())

    def __call__(self, tenant, store, request_id, digest, now):
        path, nonce, stamp = '/api/growth/consumer-delivery/authorize', str(uuid.uuid4()), str(int(now))
        raw = dumps(dict(owner=self.owner, campaignId=self.campaign_id, requestId=request_id, payloadDigest=digest, tenantId=tenant, storeId=store)).encode()
        signed = (stamp + '\n' + nonce + '\nPOST\n' + path + '\n').encode() + raw
        headers = {'Content-Type': 'application/json', 'x-collective-timestamp': stamp, 'x-collective-nonce': nonce, 'x-collective-signature': hmac.new(self.secret, signed, hashlib.sha256).hexdigest()}
        try:
            req = urllib.request.Request(self.origin + path, data=raw, headers=headers, method='POST')
            with self.opener.open(req, timeout=5) as response:
                if response.status != 200 or 'application/json' not in response.headers.get('Content-Type', ''):
                    return None
                body = response.read(4097)
                if len(body) > 4096:
                    return None
                expected = hmac.new(self.secret, (nonce + '\n').encode() + body, hashlib.sha256).hexdigest()
                if not hmac.compare_digest(expected, response.headers.get('x-collective-signature', '')):
                    return None
                result = json.loads(body)
                if set(result) != {'allowed', 'requestId', 'payloadDigest', 'nonce', 'checkedAt'} or type(result['allowed']) is not bool or result['requestId'] != request_id or result['payloadDigest'] != digest or result['nonce'] != nonce:
                    return None
                checked = dt.datetime.fromisoformat(result['checkedAt'].replace('Z', '+00:00')).timestamp()
                if abs(checked - time.time()) > 5:
                    return None
                return result['allowed']
        except Exception:
            return None


class ConsumerBridge:
    def __init__(self, store, secret, tenant, shop, enabled=False, prefix=PREFIX):
        require(isinstance(secret, str) and 32 <= len(secret) <= 512)
        self.store, self.secret, self.tenant, self.shop, self.enabled = store, secret.encode(), tenant, shop, enabled
        self.prefix = prefix

    def handle(self, method, path, headers, raw, now=None):
        now = int(time.time()) if now is None else now
        try:
            require(method == 'POST', 405)
            require(path.startswith(self.prefix) and path[len(self.prefix):] in {'send', 'receipt', 'cancel'}, 404)
            require(len(raw) <= MAX_BODY, 413)
            stamp, nonce, signature = (headers.get(k, '') for k in ('x-collective-timestamp', 'x-collective-nonce', 'x-collective-signature'))
            require(stamp.isdigit() and len(stamp) <= 12 and abs(int(stamp) - now) <= 300, 401, 'signature_expired')
            require(UUID.fullmatch(nonce) and HEX.fullmatch(signature), 401, 'invalid_signature')
            signed = (stamp + '\n' + nonce + '\nPOST\n' + path + '\n').encode() + raw
            require(hmac.compare_digest(hmac.new(self.secret, signed, hashlib.sha256).hexdigest(), signature), 401, 'invalid_signature')
            body = json.loads(raw.decode('utf-8'))
            action = path[len(self.prefix):]
            validate(action, body)
            require(body['tenantId'] == self.tenant and body['storeId'] == self.shop, 403, 'scope_denied')
            if action == 'send':
                require(self.enabled, 409, 'disabled')
            self.store.nonce(self.tenant, self.shop, nonce, now)
            return 200, self.store.execute(action, self.tenant, self.shop, body, now)
        except Rejected as error:
            return error.status, {'status': 'rejected', 'code': error.code}
        except (ValueError, TypeError, UnicodeError, OverflowError):
            return 400, {'status': 'rejected', 'code': 'invalid_request'}
        except Exception:
            return 503, {'status': 'unknown', 'code': 'provider_unavailable'}

    def __call__(self, environ, start_response):
        from http import HTTPStatus
        try:
            length = int(environ.get('CONTENT_LENGTH', '0'))
            require(0 < length <= MAX_BODY, 413)
            require(environ.get('CONTENT_TYPE', '').split(';')[0] == 'application/json', 415)
            require(not environ.get('QUERY_STRING'))
            raw = environ['wsgi.input'].read(length)
            require(len(raw) == length)
            headers = {k: environ.get('HTTP_' + k.upper().replace('-', '_'), '') for k in ('x-collective-timestamp', 'x-collective-nonce', 'x-collective-signature')}
            status, result = self.handle(environ['REQUEST_METHOD'], environ['PATH_INFO'], headers, raw)
        except (Rejected, ValueError) as error:
            status, result = getattr(error, 'status', 400), {'status': 'rejected', 'code': 'invalid_request'}
        response = dumps(result).encode()
        start_response(str(status) + ' ' + HTTPStatus(status).phrase, [('Content-Type', 'application/json'), ('Content-Length', str(len(response))), ('Cache-Control', 'no-store')])
        return [response]
