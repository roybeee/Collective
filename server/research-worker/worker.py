#!/usr/bin/env python3
"""Drive the durable COLLECTIVE queue without an open browser or personal Mac."""
import json
import os
import random
import re
import signal
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

# 401/403은 자격증명 재발급·gate 교체처럼 사람이 고쳐야 풀린다. 영구 정지 대신 30분에서 6시간까지 늘려 가며 다시 확인한다.
REJECTED_BACKOFF = 30 * 60
REJECTED_BACKOFF_MAX = 6 * 60 * 60
# 앱은 토큰 만료 14일 전부터 tick 응답에 다음 토큰을 한 번 싣는다. 저장에 성공한 뒤에만 다음 tick부터 쓴다.
TOKEN = re.compile(r'[a-f0-9]{64}')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def tick(config, rotation=False):
    headers = {'Content-Type': 'application/json',
               'Authorization': 'Bearer ' + config['token'],
               'X-Collective-Owner': config['owner'],
               'OAI-Sites-Authorization': 'Bearer ' + config['gate']}
    if rotation:
        # 새 토큰을 저장할 수 있을 때만 알린다. 앱은 이 헤더가 있는 tick에만 다음 토큰을 싣는다.
        headers['X-Collective-Rotation'] = 'ready'
    request = urllib.request.Request(
        config['site'] + '/api/research-worker', data=b'{}', method='POST', headers=headers)
    with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
        result = json.loads(response.read(4096))
    if result.get('status') not in ('idle', 'processed', 'retry'):
        raise ValueError('Unexpected worker response')
    return result

def save_config(path, config):
    # 같은 폴더의 임시 파일(0600)에 쓰고 fsync한 뒤 os.replace로 한 번에 바꾼다. 중간에 멈추면 이전 파일이 그대로 남는다.
    fd, temporary = tempfile.mkstemp(prefix='.worker-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(json.dumps(config))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    # 바뀐 디렉터리 항목도 디스크에 남긴다. 그러지 않으면 전원 손실 뒤 앱이 이미 폐기한 이전 토큰으로 돌아갈 수 있다.
    # 파일은 이미 새 토큰으로 바뀌었으므로 여기서 실패해도 새 토큰을 쓴다(경고만 남긴다).
    try:
        folder = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(folder)
        finally:
            os.close(folder)
    except OSError as exc:
        print('worker_rotation_folder_sync_failed: the new token was saved but the folder sync failed (%s).' % exc.__class__.__name__, file=sys.stderr, flush=True)

def adopt_rotation(config, path, result):
    rotation = result.get('rotation')
    if rotation is None:
        return config
    token = rotation.get('token') if isinstance(rotation, dict) else None
    if not isinstance(token, str) or not TOKEN.fullmatch(token) or path is None:
        print('worker_rotation_ignored: the new token was malformed or cannot be saved; keeping the current token.', file=sys.stderr, flush=True)
        return config
    updated = {**config, 'token': token}
    try:
        save_config(path, updated)
    except OSError as exc:
        # 토큰·경로 원문은 남기지 않는다. 저장하지 못하면 이전 토큰을 계속 쓰고 앱은 다음 tick에 새 토큰을 다시 보낸다.
        print('worker_rotation_failed: could not save the new token (%s); keeping the current token. Reissue the installer before the token expires.' % exc.__class__.__name__, file=sys.stderr, flush=True)
        return config
    print('worker_rotated: new token saved; using it from the next tick.', flush=True)
    return updated

def rotation_ready(path):
    return os.access(path.parent, os.W_OK)

def rejected_delay(rejections):
    return min(REJECTED_BACKOFF_MAX, REJECTED_BACKOFF * 2 ** min(rejections - 1, 4))

def run(config, stop, wait=None, path=None):
    wait = wait or stop.wait
    failures = rejections = 0
    while not stop.is_set():
        delay = None
        try:
            result = tick(config, path is not None and rotation_ready(path))
            failures = rejections = 0
            print('queue:', result['status'], flush=True)
            config = adopt_rotation(config, path, result)
        except urllib.error.HTTPError as exc:
            print('worker HTTP status:', exc.code, flush=True)
            if exc.code in (401, 403):
                rejections += 1
                delay = rejected_delay(rejections)
                print('worker_rejected: HTTP %d; retrying in %d minutes. Reissue the installer in COLLECTIVE if this persists.' % (exc.code, delay // 60), file=sys.stderr, flush=True)
            else:
                failures += 1
        except Exception:
            # Never log response bodies, auth headers, or full urllib request objects.
            print('Temporary queue connection failure; retrying.', flush=True)
            failures += 1
        wait((delay or min(300, 15 * 2 ** min(failures, 4))) + random.random() * 2)
    return 0

def main():
    path = Path(sys.argv[1])
    config = json.loads(path.read_text())
    if not config['site'].startswith('https://'):
        raise SystemExit('HTTPS Site address required')
    if not rotation_ready(path):
        print('worker_rotation_unavailable: the config folder is read-only, so automatic token rotation cannot be saved. Reissue the installer before the token expires.', file=sys.stderr, flush=True)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    return run(config, stop, path=path)

if __name__ == '__main__':
    sys.exit(main())
