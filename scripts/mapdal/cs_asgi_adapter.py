"""Bounded ASGI adapter for mounting CsBridge in MAPDAL's FastAPI app."""
import asyncio
import time
from consumer_bridge import MAX_BODY, dumps as canonical
from cs_bridge import PREFIX


class CsASGI:
    def __init__(self, bridge):
        self.bridge = bridge

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return
        status, result = 400, {'status': 'rejected', 'code': 'invalid_request'}
        try:
            pairs = [(k.decode('latin1').lower(), v.decode('latin1')) for k, v in scope.get('headers', [])]
            headers = dict(pairs)
            checked = ['content-type', 'content-length', 'x-collective-timestamp', 'x-collective-nonce', 'x-collective-signature']
            duplicate = any(sum(k == name for k, _ in pairs) > 1 for name in checked)
            if duplicate or scope.get('query_string'):
                raise ValueError('invalid headers/query')
            if headers.get('content-type', '').split(';')[0] != 'application/json':
                status = 415
                raise ValueError('content type')
            body = bytearray()
            deadline = time.monotonic() + 10
            while True:
                event = await asyncio.wait_for(receive(), timeout=max(0, deadline - time.monotonic()))
                if event['type'] != 'http.request':
                    raise ValueError('disconnected')
                body.extend(event.get('body', b''))
                if len(body) > MAX_BODY:
                    status = 413
                    raise ValueError('body too large')
                if not event.get('more_body', False):
                    break
            if 'content-length' in headers and int(headers['content-length']) != len(body):
                raise ValueError('content length mismatch')
            path = scope['path']
            if not path.startswith(PREFIX):
                path = PREFIX + path.lstrip('/')
            status, result = await asyncio.to_thread(self.bridge.handle, scope['method'], path, headers, bytes(body))
        except (ValueError, KeyError, asyncio.TimeoutError):
            pass
        response = canonical(result).encode('utf-8')
        await send({'type': 'http.response.start', 'status': status, 'headers': [(b'content-type', b'application/json; charset=utf-8'), (b'cache-control', b'no-store')]})
        await send({'type': 'http.response.body', 'body': response})
