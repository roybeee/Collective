"""Optional local STT bridge for COLLECTIVE. Never enabled by the web app.
Routes /v1/capabilities and /v1/audio/transcriptions through this service;
all other Hermes routes stay on the existing gateway. See README.md.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.parse import urlparse

LIMIT = 8 * 1024 * 1024
TTL = 24 * 3600

def decode_upload(content_type, payload):
    if not content_type.startswith('multipart/form-data;'):
        raise ValueError('multipart required')
    msg = BytesParser(policy=policy.default).parsebytes(
        ('Content-Type: ' + content_type + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + payload)
    if not msg.is_multipart():
        raise ValueError('invalid multipart')
    parts = list(msg.iter_parts())
    files = [p for p in parts if p.get_param('name', header='content-disposition') == 'file']
    if len(files) != 1 or len(parts) > 4:
        raise ValueError('one audio file required')
    data = files[0].get_payload(decode=True)
    if not data or len(data) > LIMIT:
        raise ValueError('audio limit exceeded')
    # The app also checks signatures; validate independently at this boundary.
    if not (data.startswith((b'ID3', b'OggS', b'\x1a\x45\xdf\xa3')) or
            (data[:4] == b'RIFF' and data[8:12] == b'WAVE') or
            data[4:8] == b'ftyp' or (len(data) > 1 and data[0] == 255 and data[1] & 224 == 224)):
        raise ValueError('unsupported audio')
    return data

class Queue:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = self.folder / 'jobs.sqlite3'
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, digest TEXT, status TEXT, text TEXT, created REAL)')
            db.execute("UPDATE jobs SET status='queued' WHERE status='running'")
        os.chmod(self.path, 0o600)
    def db(self):
        return sqlite3.connect(self.path, timeout=10)
    def submit(self, key, audio):
        identity = hashlib.sha256(key.encode()).hexdigest()
        digest = hashlib.sha256(audio).hexdigest()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT digest,status,text FROM jobs WHERE id=?', (identity,)).fetchone()
            if row:
                if row[0] != digest:
                    return 409, {'error': 'idempotency payload mismatch'}
                if row[1] == 'completed':
                    return 200, {'text': row[2]}
                if row[1] in ('failed', 'expired'):
                    return 422, {'error': row[1]}
                return 202, {'status': row[1]}
            if db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0] >= 16:
                return 429, {'error': 'queue full'}
            target = self.folder / (identity + '.audio')
            with open(target, 'wb') as f:
                f.write(audio)
            os.chmod(target, 0o600)
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?)', (identity, digest, 'queued', '', time.time()))
            return 202, {'status': 'queued'}
    def step(self, transcribe):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            expired = db.execute("SELECT id FROM jobs WHERE created<? AND status!='expired'", (time.time()-TTL,)).fetchall()
            for (identity,) in expired:
                (self.folder / (identity + '.audio')).unlink(missing_ok=True)
            db.execute("UPDATE jobs SET status='expired',text='' WHERE created<?", (time.time()-TTL,))
            row = db.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if not row:
                return False
            identity = row[0]
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (identity,))
        path = self.folder / (identity + '.audio')
        try:
            text = transcribe(path)
            if not isinstance(text, str) or not text.strip() or len(text) > 80000:
                raise ValueError('invalid transcript')
            status = 'completed'
        except Exception:
            status, text = 'failed', ''  # Never log audio, transcript, credentials or provider errors.
        finally:
            path.unlink(missing_ok=True)
        with self.db() as db:
            db.execute('UPDATE jobs SET status=?,text=? WHERE id=?', (status, text, identity))
        return True

class Speech:
    def __init__(self, model):
        from faster_whisper import WhisperModel
        self.model = WhisperModel(model, device='cpu', compute_type='int8', cpu_threads=2)
    def __call__(self, path):
        import av
        # Browser WebM often omits container duration. Inspect packet timestamps
        # without decoding samples first, bounding duration and packet count.
        with av.open(str(path)) as audio:
            if audio.duration is not None and audio.duration / av.time_base > 1200:
                raise ValueError('audio duration exceeds 20 minutes')
            latest = 0.0
            for count, packet in enumerate(audio.demux(audio=0)):
                if count > 1000000:
                    raise ValueError('too many packets')
                if packet.pts is not None and packet.time_base is not None:
                    latest = max(latest, float((packet.pts + (packet.duration or 0)) * packet.time_base))
                if latest > 1200:
                    raise ValueError('audio duration exceeds 20 minutes')
            if latest <= 0:
                raise ValueError('unreadable audio timeline')
        segments, _ = self.model.transcribe(str(path), language='ko', vad_filter=True, beam_size=5)
        result = []
        for segment in segments:
            result.append(f'[{segment.start:.1f}s–{segment.end:.1f}s] {segment.text.strip()}')
            if sum(map(len, result)) > 80000:
                raise ValueError('transcript too long')
        return '\n'.join(result)

def main():
    key = os.environ.get('INTERVIEW_GATEWAY_KEY', '')
    upstream = os.environ.get('HERMES_LOCAL_UPSTREAM', 'http://127.0.0.1:8642').rstrip('/')
    parsed = urlparse(upstream)
    if len(key) < 20 or parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.path or parsed.username:
        raise SystemExit('Set a strong INTERVIEW_GATEWAY_KEY and a loopback HERMES_LOCAL_UPSTREAM')
    queue = Queue(os.environ.get('INTERVIEW_STT_STATE', '/var/lib/collective-interview'))
    speech = Speech(os.environ.get('INTERVIEW_STT_MODEL', 'small'))
    def worker():
        while True:
            if not queue.step(speech):
                time.sleep(1)
    threading.Thread(target=worker, daemon=True).start()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def reply(self, status, data):
            raw = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        def authorized(self):
            if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + key):
                self.reply(401, {'error': 'unauthorized'})
                return False
            return True
        def do_GET(self):
            if not self.authorized():
                return
            if self.path != '/v1/capabilities':
                return self.reply(404, {'error': 'not found'})
            try:
                with urlopen(Request(upstream + '/v1/capabilities', headers={'Authorization': 'Bearer ' + key}), timeout=5) as r:
                    data = json.loads(r.read(100000))
                data.setdefault('features', {})['audio_transcription'] = {'protocol': 'collective-multipart-v1', 'path': '/v1/audio/transcriptions'}
                self.reply(200, data)
            except Exception:
                self.reply(502, {'error': 'gateway unavailable'})
        def do_POST(self):
            if not self.authorized():
                return
            if self.path != '/v1/audio/transcriptions':
                return self.reply(404, {'error': 'not found'})
            request_key = self.headers.get('Idempotency-Key', '')
            if not re.fullmatch(r'interview-audio-[a-zA-Z0-9_-]{1,100}', request_key):
                return self.reply(400, {'error': 'idempotency key required'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > LIMIT + 65536:
                    return self.reply(413, {'error': 'payload too large'})
                self.connection.settimeout(30)
                payload = self.rfile.read(length)
                if len(payload) != length:
                    raise ValueError('truncated upload')
                audio = decode_upload(self.headers.get('Content-Type', ''), payload)
                status, data = queue.submit(request_key, audio)
                self.reply(status, data)
            except (ValueError, TimeoutError):
                self.reply(400, {'error': 'invalid upload'})
    ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('INTERVIEW_STT_PORT', '8643'))), Handler).serve_forever()

if __name__ == '__main__':
    main()
