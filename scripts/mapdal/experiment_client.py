"""Trusted storefront hooks. Browser inputs never supply orders, arms or money.

The host supplies a random session UUID and its current measurement consent.
Persist this file separately from application/customer databases. Frozen design
changes require a new outbox. Withdrawal takes priority over uncertain events.
"""
import contextlib
import datetime as dt
import hashlib
import hmac
import json
import re
import sqlite3
import time
import urllib.request
import uuid

DOMAIN = 'collective.growth-experiment.events.v1'
HOST = 'https://mealzip-agency.hflameb.chatgpt.site'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)


def instant(value):
    if not isinstance(value, str):
        raise ValueError('invalid timestamp')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('timezone required')
    return parsed.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def now_iso():
    return instant(dt.datetime.now(dt.timezone.utc).isoformat())


def unit_id(value):
    if not isinstance(value, str) or str(uuid.UUID(value, version=4)) != value:
        raise ValueError('random UUID v4 required')
    return value


def safe_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value):
        raise ValueError('opaque ID required')
    return value


class ExperimentOutbox:
    def __init__(self, path, config):
        if set(config) != {'campaignId', 'designId', 'designVersion', 'registrationDigest', 'startAt', 'endAt'}:
            raise ValueError('invalid frozen design')
        safe_id(config['campaignId']); safe_id(config['designId'])
        if type(config['designVersion']) is not int or not 1 <= config['designVersion'] <= 10**9:
            raise ValueError('invalid design version')
        if not re.fullmatch('[a-f0-9]{64}', config['registrationDigest']):
            raise ValueError('invalid registration digest')
        self.config = dict(config, startAt=instant(config['startAt']), endAt=instant(config['endAt']))
        if self.config['startAt'] >= self.config['endAt']:
            raise ValueError('invalid observation window')
        self.path = path
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS design (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS units (id TEXT PRIMARY KEY, consent TEXT NOT NULL, revision INTEGER NOT NULL, ack INTEGER NOT NULL DEFAULT 0, arm TEXT, exposed INTEGER NOT NULL DEFAULT 0, withdrawn INTEGER NOT NULL DEFAULT 0)')
            db.execute('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, unit TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, lease TEXT, lease_at REAL, retry_at REAL NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, UNIQUE(unit,revision))')
            previous = db.execute('SELECT body FROM design WHERE id=1').fetchone()
            body = canonical(self.config)
            if previous and previous['body'] != body:
                raise ValueError('frozen design changed')
            db.execute('INSERT OR IGNORE INTO design(id,body) VALUES(1,?)', (body,))

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=3)
        db.row_factory = sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _unit(self, db, unit):
        row = db.execute('SELECT * FROM units WHERE id=?', (unit_id(unit),)).fetchone()
        if not row:
            raise ValueError('unknown measurement session')
        return row

    def state(self, unit):
        with self.db() as db:
            row = self._unit(db, unit)
            return {'arm': None if row['withdrawn'] else row['arm'], 'withdrawn': bool(row['withdrawn']), 'exposed': bool(row['exposed']), 'noticeVersion': json.loads(row['consent'])['noticeVersion']}

    def _enqueue(self, db, unit, action, consent, extra=None):
        row = self._unit(db, unit)
        if row['withdrawn'] and action != 'withdraw':
            raise ValueError('measurement consent withdrawn')
        pending = db.execute("SELECT id FROM events WHERE unit=? AND state IN ('pending','sending')", (unit,)).fetchone()
        if pending:
            raise ValueError('previous event requires recovery')
        if action not in {'withdraw', 'tracking_close'} and db.execute('SELECT COUNT(*) FROM events').fetchone()[0] >= 20000:
            raise ValueError('new measurement capacity reached')
        revision, event_id = row['revision'] + 1, str(uuid.uuid4())
        event = {k: self.config[k] for k in ('campaignId', 'designId', 'designVersion', 'registrationDigest')}
        event.update(eventId=event_id, action=action, unitKey=unit, revision=revision,
                     occurredAt=now_iso(), consent=consent, **(extra or {}))
        db.execute('INSERT INTO events(id,unit,revision,action,body,state) VALUES(?,?,?,?,?,?)', (event_id, unit, revision, action, canonical(event), 'pending'))
        db.execute('UPDATE units SET revision=? WHERE id=?', (revision, unit))
        return event_id

    def assign(self, unit, consent):
        unit_id(unit)
        if not isinstance(consent, dict) or set(consent) != {'granted', 'noticeVersion', 'observedAt'} or consent['granted'] is not True:
            raise ValueError('current measurement consent required')
        consent = dict(consent, noticeVersion=safe_id(consent['noticeVersion']), observedAt=instant(consent['observedAt']))
        now = now_iso()
        if consent['observedAt'] > now or not self.config['startAt'] <= now <= self.config['endAt']:
            raise ValueError('outside measurement window')
        with self.db() as db:
            old = db.execute('SELECT * FROM units WHERE id=?', (unit,)).fetchone()
            if old:
                if old['withdrawn']:
                    raise ValueError('measurement consent withdrawn')
                return db.execute("SELECT id FROM events WHERE unit=? AND action='assign'", (unit,)).fetchone()['id']
            if db.execute('SELECT COUNT(*) FROM units').fetchone()[0] >= 5000:
                raise ValueError('unit capacity reached')
            db.execute('INSERT INTO units(id,consent,revision) VALUES(?,?,0)', (unit, canonical(consent)))
            return self._enqueue(db, unit, 'assign', consent)

    def expose(self, unit):
        with self.db() as db:
            row = self._unit(db, unit)
            if row['withdrawn'] or not row['arm'] or not self.config['startAt'] <= now_iso() <= self.config['endAt']:
                raise ValueError('current acknowledged assignment required')
            existing = db.execute("SELECT id FROM events WHERE unit=? AND action='exposure'", (unit,)).fetchone()
            if existing:
                return existing['id']
            return self._enqueue(db, unit, 'exposure', json.loads(row['consent']))

    def close(self, unit, orders, tracking_complete, tracking_through, contaminated):
        if type(tracking_complete) is not bool or type(contaminated) is not bool or not isinstance(orders, list) or len(orders) > 20:
            raise ValueError('explicit server tracking evidence required')
        for order in orders:
            if not isinstance(order, dict) or set(order) != {'externalId', 'revision'} or not re.fullmatch(r'MD-\d{8}-[A-F0-9]{6}', order.get('externalId', '')) or type(order.get('revision')) is not int or not 1 <= order['revision'] <= 10**9:
                raise ValueError('canonical order references only')
        if len({o['externalId'] for o in orders}) != len(orders):
            raise ValueError('duplicate order reference')
        through = instant(tracking_through)
        if through > now_iso() or (tracking_complete and through < self.config['endAt']):
            raise ValueError('full observation window not yet tracked')
        with self.db() as db:
            row = self._unit(db, unit)
            if not row['exposed']:
                raise ValueError('acknowledged exposure required')
            return self._enqueue(db, unit, 'tracking_close', json.loads(row['consent']),
                                 dict(orders=orders, trackingComplete=tracking_complete, trackingThrough=through, contaminated=contaminated))

    def withdraw(self, unit):
        with self.db() as db:
            row = db.execute('SELECT * FROM units WHERE id=?', (unit_id(unit),)).fetchone()
            if not row:
                # The cap permanently blocks new assignments; never evict a
                # tombstone while a delayed assignment may still be in flight.
                if db.execute('SELECT COUNT(*) FROM units').fetchone()[0] < 5000:
                    consent = dict(granted=False, noticeVersion='withdrawn', observedAt=now_iso())
                    db.execute('INSERT INTO units(id,consent,revision,withdrawn) VALUES(?,?,0,1)', (unit, canonical(consent)))
                return None
            if row['withdrawn']:
                event = db.execute("SELECT id FROM events WHERE unit=? AND action='withdraw'", (unit,)).fetchone()
                return event['id'] if event else None
            attempted = db.execute('SELECT 1 FROM events WHERE unit=? AND attempts>0', (unit,)).fetchone()
            db.execute("UPDATE events SET state='superseded',lease=NULL WHERE unit=? AND state IN ('pending','sending')", (unit,))
            db.execute('UPDATE units SET withdrawn=1,arm=NULL WHERE id=?', (unit,))
            if not attempted:
                return None
            consent = dict(json.loads(row['consent']), granted=False, observedAt=now_iso())
            return self._enqueue(db, unit, 'withdraw', consent)

    def deliver_one(self, transport, current_consent, now=None):
        now = time.time() if now is None else now
        lease = str(uuid.uuid4())
        with self.db() as db:
            row = db.execute("SELECT * FROM events WHERE (state='pending' AND retry_at<=?) OR (state='sending' AND lease_at<?) ORDER BY CASE WHEN action='withdraw' THEN 0 ELSE 1 END,rowid LIMIT 1", (now, now - 30)).fetchone()
            if not row:
                return {'status': 'idle'}
            db.execute("UPDATE events SET state='sending',lease=?,lease_at=? WHERE id=?", (lease, now, row['id']))
        try:
            event = json.loads(row['body'])
            if row['action'] != 'withdraw':
                consent = current_consent(row['unit'])
                if not isinstance(consent, dict) or set(consent) != {'granted', 'noticeVersion', 'observedAt'} or type(consent['granted']) is not bool:
                    raise ValueError('current consent unavailable')
                observed = instant(consent['observedAt'])
                if observed > now_iso() or observed < event['consent']['observedAt']:
                    raise ValueError('current consent unavailable')
                if not consent['granted'] or consent['noticeVersion'] != event['consent']['noticeVersion']:
                    self.withdraw(row['unit'])
                    return {'status': 'processed'}
            with self.db() as db:
                changed = db.execute("UPDATE events SET attempts=attempts+1 WHERE id=? AND lease=? AND state='sending'", (row['id'], lease)).rowcount
                if not changed:
                    return {'status': 'processed'}
            result = transport(event)
            if not isinstance(result, dict) or result.get('recorded') is not True or result.get('arm') not in {'control', 'treatment'} or type(result.get('revision')) is not int or result['revision'] != row['revision'] or type(result.get('unitVersion')) is not int or result['unitVersion'] < (0 if row['action'] == 'withdraw' else 1) or not isinstance(result.get('unitHash'), str) or not re.fullmatch('[a-f0-9]{64}', result['unitHash']):
                raise ValueError('invalid ingestion receipt')
        except Exception:
            with self.db() as db:
                db.execute("UPDATE events SET state='pending',lease=NULL,retry_at=? WHERE id=? AND lease=? AND state='sending'", (now + min(300, 2 ** min(row['attempts'], 9)), row['id'], lease))
            return {'status': 'retry'}
        with self.db() as db:
            changed = db.execute("UPDATE events SET state='accepted',lease=NULL WHERE id=? AND lease=? AND state='sending'", (row['id'], lease)).rowcount
            if changed:
                db.execute('UPDATE units SET ack=?,arm=CASE WHEN withdrawn=0 THEN ? ELSE NULL END,exposed=CASE WHEN ?=\'exposure\' THEN 1 ELSE exposed END WHERE id=?', (row['revision'], result['arm'], row['action'], row['unit']))
        return {'status': 'processed'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class SignedTransport:
    def __init__(self, connection_id, secret):
        unit_id(connection_id)
        if not isinstance(secret, str) or not 32 <= len(secret) <= 500:
            raise ValueError('dedicated signing secret required')
        self.path = '/api/growth/experiments/events/' + connection_id
        self.key = secret.encode()

    def __call__(self, event):
        raw, timestamp = canonical(event).encode(), str(int(time.time()))
        message = (DOMAIN + '\nPOST\n' + self.path + '\n' + timestamp + '\n').encode() + raw
        request = urllib.request.Request(HOST + self.path, data=raw, method='POST', headers={
            'Content-Type': 'application/json', 'X-Collective-Timestamp': timestamp,
            'X-Collective-Signature': 'sha256=' + hmac.new(self.key, message, hashlib.sha256).hexdigest()})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=10) as response:
            raw = response.read(16385)
            if response.status != 200 or len(raw) > 16384:
                raise ValueError('ingestion unavailable')
            return json.loads(raw)
