"""Real SQLite + ASGI messages. No network or host DB writes."""
import asyncio
import datetime as dt
import json
import pathlib
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/mapdal'))
from experiment_client import ExperimentOutbox
from experiment_asgi import ExperimentASGI, close_from_reconciliation

class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.unit=str(uuid.uuid4());now=dt.datetime.now(dt.timezone.utc)
        self.box=ExperimentOutbox(self.tmp.name+'/box.sqlite',dict(campaignId='c',designId='d',designVersion=1,registrationDigest='a'*64,startAt=(now-dt.timedelta(days=1)).isoformat(),endAt=(now+dt.timedelta(days=1)).isoformat()))
        self.context=dict(unitId=self.unit,csrfToken='synthetic-csrf-token-long-enough',consent=dict(granted=True,noticeVersion='v1',observedAt=now.isoformat()))
        async def resolve(scope):return self.context
        self.app=ExperimentASGI(self.box,resolve)
    def tearDown(self):self.tmp.cleanup()
    def call(self,value,origin='https://mapdal.kr',csrf=None,method='POST',extra=None):
        body=json.dumps(value).encode();headers=[(b'origin',origin.encode()),(b'content-type',b'application/json'),(b'x-csrf-token',(csrf or self.context['csrfToken']).encode()),(b'host',b'mapdal.kr')]+(extra or [])
        scope=dict(type='http',method=method,path='/collective/experiment',headers=headers,query_string=b'')
        result=[]
        async def receive():return dict(type='http.request',body=body)
        async def send(event):result.append(event)
        asyncio.run(self.app(scope,receive,send));return result[0]['status'],json.loads(result[1]['body'])
    def ack(self):
        self.box.deliver_one(lambda e:dict(recorded=True,arm='treatment',unitHash='b'*64,revision=e['revision'],unitVersion=e['revision']),lambda unit:self.context['consent'])
    def test_assign_waits_for_server_ack_and_returns_only_arm(self):
        self.assertEqual(self.call(dict(action='assign')),(202,dict(status='pending',arm=None)))
        self.ack();self.assertEqual(self.call(dict(action='assign')),(200,dict(status='assigned',arm='treatment')))
    def test_browser_cannot_supply_arm_order_money_or_unit(self):
        for key in ['arm','orders','amount','unitId','consent']:
            self.assertEqual(self.call(dict(action='assign',**{key:'fake'}))[0],400)
        with self.box.db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM units').fetchone()[0],0)
    def test_origin_csrf_duplicates_and_methods_denied(self):
        self.assertEqual(self.call(dict(action='assign'),origin='https://evil.test')[0],403)
        self.assertEqual(self.call(dict(action='assign'),csrf='wrong')[0],403)
        self.assertEqual(self.call(dict(action='assign'),extra=[(b'origin',b'https://mapdal.kr')])[0],400)
        self.assertEqual(self.call(dict(action='assign'),method='GET')[0],405)
    def test_missing_current_consent_suppresses_existing_assignment(self):
        self.call(dict(action='assign'));self.ack();self.context=dict(self.context,consent=dict(self.context['consent'],granted=False))
        self.assertEqual(self.call(dict(action='exposure'))[0],403);self.assertTrue(self.box.state(self.unit)['withdrawn'])
    def test_withdraw_is_idempotent_and_never_exposes_arm(self):
        self.call(dict(action='assign'));self.ack()
        self.assertEqual(self.call(dict(action='withdraw')),(200,dict(status='withdrawn',arm=None)))
        self.assertEqual(self.call(dict(action='withdraw'))[0],200)
    def test_rate_and_body_are_bounded(self):
        self.assertEqual(self.call(dict(action='x'*300))[0],413)
        for _ in range(30):self.call(dict(action='assign'))
        self.assertEqual(self.call(dict(action='assign'))[0],429)
    def test_new_notice_version_withdraws_previous_assignment(self):
        self.call(dict(action='assign'));self.ack()
        self.context=dict(self.context,consent=dict(self.context['consent'],noticeVersion='v2'))
        self.assertEqual(self.call(dict(action='assign'))[0],403)
        self.assertTrue(self.box.state(self.unit)['withdrawn'])
    def test_resolver_failure_leaks_no_details(self):
        async def broken(scope):raise RuntimeError('private server token')
        self.app.resolve_context=broken
        status,result=self.call(dict(action='assign'))
        self.assertEqual(status,503);self.assertNotIn('private',str(result))
    def test_slow_body_times_out(self):
        result=[];original=asyncio.wait_for
        async def receive():await asyncio.sleep(60)
        async def send(event):result.append(event)
        scope=dict(type='http',method='POST',headers=[(b'origin',b'https://mapdal.kr'),(b'host',b'mapdal.kr'),(b'content-type',b'application/json')])
        async def short_wait(awaitable,timeout):return await original(awaitable,timeout=0.01)
        with patch('experiment_asgi.asyncio.wait_for',new=short_wait):
            asyncio.run(self.app(scope,receive,send))
        self.assertEqual(result[0]['status'],408)

    def test_slow_local_storage_does_not_block_response_deadline(self):
        original_assign=self.box.assign;original_wait=asyncio.wait_for
        def slow_assign(*args):time.sleep(0.05);return original_assign(*args)
        async def short_wait(awaitable,timeout):return await original_wait(awaitable,timeout=0.01)
        with patch.object(self.box,'assign',side_effect=slow_assign),patch('experiment_asgi.asyncio.wait_for',new=short_wait):
            status,result=self.call(dict(action='assign'))
        self.assertEqual(status,408)

    def test_withdraw_before_assignment_commit_blocks_delayed_assignment(self):
        entered=threading.Event();resume=threading.Event();result=[]
        original_assign=self.box.assign
        def delayed_assign(*args):
            entered.set()
            if not resume.wait(3):raise TimeoutError('test barrier')
            return original_assign(*args)
        with patch.object(self.box,'assign',side_effect=delayed_assign):
            worker=threading.Thread(target=lambda:result.append(self.call(dict(action='assign'))))
            worker.start()
            try:
                self.assertTrue(entered.wait(3))
                self.assertEqual(self.call(dict(action='withdraw'))[0],200)
            finally:
                resume.set();worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertEqual(result[0][0],409)
        self.assertTrue(self.box.state(self.unit)['withdrawn'])
        sent=[]
        self.assertEqual(self.box.deliver_one(lambda event:sent.append(event),lambda unit:self.context['consent'])['status'],'idle')
        self.assertEqual(sent,[])

    def test_browser_close_is_unavailable(self):
        self.assertEqual(self.call(dict(action='tracking_close'))[0],400)
    def test_close_requires_explicit_full_reconciliation(self):
        class Box:
            def close(self,*args):self.args=args;return 'event'
        box=Box()
        for evidence in [None,{},dict(orders=[],trackingThrough=self.context['consent']['observedAt'],orderReconciliationComplete=False,observationWindowComplete=True,contaminated=False)]:
            self.assertFalse(close_from_reconciliation(box,self.unit,evidence))
        self.assertFalse(hasattr(box,'args'))
        self.assertTrue(close_from_reconciliation(box,self.unit,dict(orders=[],trackingThrough=self.context['consent']['observedAt'],orderReconciliationComplete=True,observationWindowComplete=True,contaminated=False)))
        self.assertTrue(box.args[2])

if __name__=='__main__':unittest.main()
