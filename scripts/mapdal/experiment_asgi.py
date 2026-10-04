"""Same-origin action-only ASGI surface. Resolve context from host session storage.

This adapter never sends events externally. A separately installed worker drains
ExperimentOutbox with a fresh trusted consent callback before every attempt.
"""
import asyncio
from collections import deque
import hmac
import json
import time
import threading
from experiment_client import unit_id

ORIGIN='https://mapdal.kr'
MAX_BODY=256


def close_from_reconciliation(box,unit,evidence):
    """Server job only: missing reconciliation/window evidence means no close."""
    fields={'orders','trackingThrough','orderReconciliationComplete','observationWindowComplete','contaminated'}
    if not isinstance(evidence,dict) or set(evidence)!=fields:return False
    if evidence['orderReconciliationComplete'] is not True or evidence['observationWindowComplete'] is not True:return False
    box.close(unit,evidence['orders'],True,evidence['trackingThrough'],evidence['contaminated'])
    return True


class Rejected(Exception):
    def __init__(self,status):self.status=status


class ExperimentASGI:
    def __init__(self,outbox,resolve_context):
        self.box,self.resolve_context=outbox,resolve_context
        self.rates={}
        self.rate_lock=threading.Lock()
    def _rate(self,unit):
        with self.rate_lock:self._rate_locked(unit)
    def _rate_locked(self,unit):
        now=time.monotonic()
        self.rates={key:q for key,q in self.rates.items() if q and q[-1]>now-60}
        if unit not in self.rates and len(self.rates)>=4096:raise Rejected(429)
        queue=self.rates.setdefault(unit,deque())
        while queue and queue[0]<=now-60:queue.popleft()
        if len(queue)>=30:raise Rejected(429)
        queue.append(now)
    async def _body(self,scope,receive):
        if scope.get('method')!='POST':raise Rejected(405)
        pairs=[(k.decode('latin1').lower(),v.decode('latin1')) for k,v in scope.get('headers',[])]
        headers=dict(pairs)
        for name in ['origin','host','content-type','content-length','x-csrf-token','sec-fetch-site']:
            if sum(k==name for k,_ in pairs)>1:raise Rejected(400)
        if scope.get('query_string'):raise Rejected(400)
        if headers.get('origin')!=ORIGIN or headers.get('host')!='mapdal.kr':raise Rejected(403)
        if headers.get('sec-fetch-site','same-origin')!='same-origin':raise Rejected(403)
        if headers.get('content-type','').split(';')[0]!='application/json':raise Rejected(415)
        raw=bytearray()
        while True:
            event=await receive()
            if event.get('type')!='http.request':raise Rejected(400)
            raw.extend(event.get('body',b''))
            if len(raw)>MAX_BODY:raise Rejected(413)
            if not event.get('more_body',False):break
        if 'content-length' in headers and int(headers['content-length'])!=len(raw):raise Rejected(400)
        def unique(pairs):
            value={}
            for k,v in pairs:
                if k in value:raise Rejected(400)
                value[k]=v
            return value
        value=json.loads(raw,object_pairs_hook=unique)
        if not isinstance(value,dict) or set(value)!={'action'} or value['action'] not in {'assign','exposure','withdraw'}:raise Rejected(400)
        return headers,value['action']
    def _action(self,context,action):
        unit=unit_id(context['unitId']);consent=context.get('consent')
        try:state=self.box.state(unit)
        except ValueError:state=None
        if action=='withdraw':
            self.box.withdraw(unit)
            return 200,dict(status='withdrawn',arm=None)
        self._rate(unit)
        if not isinstance(consent,dict) or consent.get('granted') is not True:
            if state and isinstance(consent,dict) and consent.get('granted') is False:self.box.withdraw(unit)
            raise Rejected(403)
        if state and state.get('noticeVersion')!=consent.get('noticeVersion'):
            self.box.withdraw(unit);raise Rejected(403)
        if action=='assign':
            self.box.assign(unit,consent);state=self.box.state(unit)
            return (200,dict(status='assigned',arm=state['arm'])) if state['arm'] else (202,dict(status='pending',arm=None))
        self.box.expose(unit)
        return 202,dict(status='queued',arm=None)
    async def _handle(self,scope,receive):
        headers,action=await self._body(scope,receive)
        context=await self.resolve_context(scope)
        if not isinstance(context,dict) or set(context)!={'unitId','consent','csrfToken'}:raise Rejected(403)
        token=context.get('csrfToken');provided=headers.get('x-csrf-token','')
        if not isinstance(token,str) or not 24<=len(token)<=256 or not hmac.compare_digest(token.encode(),provided.encode()):raise Rejected(403)
        return await asyncio.to_thread(self._action,context,action)
    async def __call__(self,scope,receive,send):
        if scope.get('type')!='http':return
        try:status,result=await asyncio.wait_for(self._handle(scope,receive),timeout=5)
        except Rejected as error:status,result=error.status,dict(status='rejected',arm=None)
        except asyncio.TimeoutError:status,result=408,dict(status='rejected',arm=None)
        except (ValueError,KeyError,TypeError):status,result=409,dict(status='rejected',arm=None)
        except Exception:status,result=503,dict(status='unavailable',arm=None)
        await send(dict(type='http.response.start',status=status,headers=[(b'content-type',b'application/json'),(b'cache-control',b'no-store'),(b'x-content-type-options',b'nosniff')]))
        await send(dict(type='http.response.body',body=json.dumps(result,separators=(',',':')).encode()))
