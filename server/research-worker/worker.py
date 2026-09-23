#!/usr/bin/env python3
"""Drive the durable COLLECTIVE queue without an open browser or personal Mac."""
import json
import random
import signal
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

# 401/403은 자격증명 재발급·gate 교체처럼 사람이 고쳐야 풀린다. 영구 정지 대신 30분에서 6시간까지 늘려 가며 다시 확인한다.
REJECTED_BACKOFF = 30 * 60
REJECTED_BACKOFF_MAX = 6 * 60 * 60

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def tick(config):
    request = urllib.request.Request(
        config['site'] + '/api/research-worker', data=b'{}', method='POST',
        headers={'Content-Type': 'application/json',
                 'Authorization': 'Bearer ' + config['token'],
                 'X-Collective-Owner': config['owner'],
                 'OAI-Sites-Authorization': 'Bearer ' + config['gate']})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
        result = json.loads(response.read(4096))
    if result.get('status') not in ('idle', 'processed', 'retry'):
        raise ValueError('Unexpected worker response')
    return result

def rejected_delay(rejections):
    return min(REJECTED_BACKOFF_MAX, REJECTED_BACKOFF * 2 ** min(rejections - 1, 4))

def run(config, stop, wait=None):
    wait = wait or stop.wait
    failures = rejections = 0
    while not stop.is_set():
        delay = None
        try:
            result = tick(config)
            failures = rejections = 0
            print('queue:', result['status'], flush=True)
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
    config = json.loads(Path(sys.argv[1]).read_text())
    if not config['site'].startswith('https://'):
        raise SystemExit('HTTPS Site address required')
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    return run(config, stop)

if __name__ == '__main__':
    sys.exit(main())
