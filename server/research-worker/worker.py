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

def main():
    config = json.loads(Path(sys.argv[1]).read_text())
    if not config['site'].startswith('https://'):
        raise SystemExit('HTTPS Site address required')
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    failures = 0
    while not stop.is_set():
        try:
            result = tick(config)
            failures = 0
            print('queue:', result['status'], flush=True)
        except urllib.error.HTTPError as exc:
            print('worker HTTP status:', exc.code, flush=True)
            if exc.code in (401, 403):
                print('Worker authorization rejected; reissue installer in COLLECTIVE.', flush=True)
                return 78
            failures += 1
        except Exception:
            # Never log response bodies, auth headers, or full urllib request objects.
            print('Temporary queue connection failure; retrying.', flush=True)
            failures += 1
        stop.wait(min(300, 15 * 2 ** min(failures, 4)) + random.random() * 2)
    return 0

if __name__ == '__main__':
    sys.exit(main())
