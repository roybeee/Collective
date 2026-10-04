"""Actual SQLite outbox, synthetic transport; no external requests."""
import datetime as dt
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts/mapdal'))
from experiment_client import ExperimentOutbox, SignedTransport


class ExperimentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(pathlib.Path(self.tmp.name) / 'measurement.sqlite')
        self.now = dt.datetime.now(dt.timezone.utc)
        self.config = dict(campaignId='campaign', designId='design', designVersion=2,
                           registrationDigest='a' * 64,
                           startAt=(self.now - dt.timedelta(days=1)).isoformat(),
                           endAt=(self.now + dt.timedelta(hours=1)).isoformat())
        self.box = ExperimentOutbox(self.path, self.config)
        self.unit = str(uuid.uuid4())
        self.consent = dict(granted=True, noticeVersion='measurement-v1',
                            observedAt=(self.now - dt.timedelta(minutes=1)).isoformat())
        self.sent = []

    def tearDown(self):
        self.tmp.cleanup()

    def transport(self, event):
        self.sent.append(event)
        return dict(recorded=True, arm='treatment', unitHash='b' * 64,
                    revision=event['revision'], unitVersion=event['revision'], mayExecute=False)

    def deliver(self, transport=None, **kwargs):
        return self.box.deliver_one(transport or self.transport, lambda unit: self.consent, **kwargs)

    def assign(self):
        event = self.box.assign(self.unit, self.consent)
        self.deliver()
        return event

    def test_assignment_is_durable_and_identical_after_restart(self):
        first = self.box.assign(self.unit, self.consent)
        other = ExperimentOutbox(self.path, self.config)
        self.assertEqual(other.assign(self.unit, self.consent), first)
        self.assertIsNone(other.state(self.unit)['arm'])
        other.deliver_one(self.transport, lambda unit: self.consent)
        self.assertEqual(other.state(self.unit)['arm'], 'treatment')
        self.assertEqual(other.deliver_one(self.transport, lambda unit: self.consent)['status'], 'idle')
        self.assertEqual(len(self.sent), 1)

    def test_response_loss_replays_exact_event_not_new_assignment(self):
        self.box.assign(self.unit, self.consent)
        def lost(event):
            self.sent.append(event)
            raise TimeoutError('private-provider-details')
        self.assertEqual(self.deliver(lost, now=100)['status'], 'retry')
        self.assertEqual(self.deliver(self.transport, now=100)['status'], 'idle')
        self.deliver(self.transport, now=102)
        self.assertEqual(self.sent[0], self.sent[1])
        self.assertNotIn('private-provider-details', pathlib.Path(self.path).read_bytes().decode(errors='ignore'))

    def test_exposure_requires_assignment_and_render_confirmation(self):
        self.box.assign(self.unit, self.consent)
        with self.assertRaises(ValueError):
            self.box.expose(self.unit)
        self.deliver(self.transport)
        first = self.box.expose(self.unit)
        self.assertEqual(self.box.expose(self.unit), first)
        self.deliver(self.transport)
        self.assertEqual([e['action'] for e in self.sent], ['assign', 'exposure'])

    def test_nonbuyer_close_never_infers_tracking_completion(self):
        self.assign()
        self.box.expose(self.unit)
        self.deliver(self.transport)
        with self.assertRaises(ValueError):
            self.box.close(self.unit, [], True, self.now.isoformat(), False)
        end = (self.now - dt.timedelta(seconds=1)).isoformat()
        past = dict(self.config, endAt=end)
        # A frozen experiment cannot be silently changed to make it mature.
        with self.assertRaises(ValueError):
            ExperimentOutbox(self.path, past)
        event = self.box.close(self.unit, [], False, self.now.isoformat(), False)
        self.deliver(self.transport)
        self.assertEqual(self.sent[-1]['eventId'], event)
        self.assertFalse(self.sent[-1]['trackingComplete'])
        self.assertEqual(self.sent[-1]['orders'], [])

    def test_withdraw_supersedes_unknown_exposure_and_blocks_new_tracking(self):
        self.assign()
        self.box.expose(self.unit)
        self.deliver(lambda event: (_ for _ in ()).throw(TimeoutError()))
        event = self.box.withdraw(self.unit)
        self.assertEqual(self.box.withdraw(self.unit), event)
        self.deliver(self.transport)
        self.assertEqual(self.sent[-1]['action'], 'withdraw')
        self.assertEqual(self.sent[-1]['revision'], 3)
        self.assertIsNone(self.box.state(self.unit)['arm'])
        with self.assertRaises(ValueError):
            self.box.expose(self.unit)
        with self.assertRaises(ValueError):
            self.box.assign(self.unit, self.consent)

    def test_unattempted_assignment_is_cancelled_without_external_call(self):
        self.box.assign(self.unit, self.consent)
        self.box.withdraw(self.unit)
        self.assertEqual(self.deliver(self.transport)['status'], 'idle')
        self.assertEqual(self.sent, [])

    def test_unknown_withdraw_is_durable_and_blocks_delayed_assignment(self):
        self.assertIsNone(self.box.withdraw(self.unit))
        other = ExperimentOutbox(self.path, self.config)
        self.assertTrue(other.state(self.unit)['withdrawn'])
        self.assertIsNone(other.withdraw(self.unit))
        with self.assertRaises(ValueError):
            other.assign(self.unit, self.consent)
        self.assertEqual(other.deliver_one(self.transport, lambda unit: self.consent)['status'], 'idle')
        self.assertEqual(self.sent, [])
        with other.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 0)

    def test_order_and_consent_allowlist(self):
        with self.assertRaises(ValueError):
            self.box.assign(self.unit, dict(self.consent, email='private@example.com'))
        with self.assertRaises(ValueError):
            self.box.assign('private@example.com', self.consent)
        with self.assertRaises(ValueError):
            self.box.assign(self.unit, dict(self.consent, granted=False))
        self.assign(); self.box.expose(self.unit); self.deliver(self.transport)
        for orders in [[{'externalId': 'customer@example.com', 'revision': 1}],
                       [{'externalId': 'MD-20261004-ABCDEF', 'revision': 1, 'paid': 100}]]:
            with self.assertRaises(ValueError):
                self.box.close(self.unit, orders, False, self.now.isoformat(), False)

    def test_malformed_receipt_does_not_acknowledge(self):
        self.box.assign(self.unit, self.consent)
        self.assertEqual(self.deliver(lambda event: {'recorded': True, 'arm': 'control'})['status'], 'retry')
        self.assertIsNone(self.box.state(self.unit)['arm'])

    def test_failed_unit_does_not_starve_another_unit(self):
        self.box.assign(self.unit, self.consent)
        other = str(uuid.uuid4())
        self.box.assign(other, self.consent)
        self.deliver(lambda event: (_ for _ in ()).throw(TimeoutError()), now=100)
        self.deliver(self.transport, now=100)
        self.assertEqual(self.sent[-1]['unitKey'], other)

    def test_latest_consent_checked_before_background_retry(self):
        self.assign()
        self.box.expose(self.unit)
        self.deliver(lambda event: (_ for _ in ()).throw(TimeoutError()), now=100)
        self.consent = dict(self.consent, granted=False)
        self.deliver(now=102)
        self.assertTrue(self.box.state(self.unit)['withdrawn'])
        self.deliver(now=102)
        self.assertEqual([event['action'] for event in self.sent], ['assign', 'withdraw'])

    def test_missing_current_consent_fails_closed_without_inferred_withdrawal(self):
        self.box.assign(self.unit, self.consent)
        self.assertEqual(self.box.deliver_one(self.transport, lambda unit: None, now=100)['status'], 'retry')
        self.assertFalse(self.box.state(self.unit)['withdrawn'])
        self.assertEqual(self.sent, [])

    def test_signed_transport_matches_collective_header_contract(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size): return b'{"recorded":true}'
        class Opener:
            def open(self, request, timeout):
                headers = {k.lower(): v for k, v in request.header_items()}
                self_test.assertIn('x-collective-timestamp', headers)
                self_test.assertIn('x-collective-signature', headers)
                self_test.assertEqual(timeout, 10)
                self_test.assertTrue(request.full_url.startswith('https://mealzip-agency.hflameb.chatgpt.site/api/growth/experiments/events/'))
                return Response()
        self_test = self
        with patch('experiment_client.urllib.request.build_opener', return_value=Opener()):
            SignedTransport(str(uuid.uuid4()), 'test-signing-secret-at-least-32-characters')({'eventId': str(uuid.uuid4())})


if __name__ == '__main__':
    unittest.main()
