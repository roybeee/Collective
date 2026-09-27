"""Queue/transport tests only. Actual speech-model accuracy is a deployment gate."""
import importlib.util
import pathlib
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('interview_stt', pathlib.Path(__file__).resolve().parents[1] / 'server/interview-transcriber/service.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.queue = module.Queue(self.temp.name)
    def test_duplicate_and_payload_conflict(self):
        self.assertEqual(self.queue.submit('one', b'audio')[0], 202)
        self.assertEqual(self.queue.submit('one', b'audio')[0], 202)
        self.assertEqual(self.queue.submit('one', b'different')[0], 409)
        with self.queue.db() as db:
            self.assertEqual(db.execute('select count(*) from jobs').fetchone()[0], 1)
    def test_transcript_persists_and_audio_is_deleted(self):
        self.queue.submit('one', b'audio')
        self.queue.step(lambda path: '실제 음성 대신 테스트 결과')
        self.assertEqual(self.queue.submit('one', b'audio'), (200, {'text': '실제 음성 대신 테스트 결과'}))
        self.assertEqual(list(pathlib.Path(self.temp.name).glob('*.audio')), [])
    def test_failure_preserves_no_audio_or_text(self):
        self.queue.submit('one', b'audio')
        self.queue.step(lambda _: 1/0)
        self.assertEqual(self.queue.submit('one', b'audio')[0], 422)
        self.assertEqual(list(pathlib.Path(self.temp.name).glob('*.audio')), [])
    def test_restart_requeues_running(self):
        self.queue.submit('one', b'audio')
        with self.queue.db() as db:
            db.execute("update jobs set status='running'")
        restored = module.Queue(self.temp.name)
        self.assertTrue(restored.step(lambda _: '재시작 후 완료'))
    def test_expired_result_scrubbed(self):
        self.queue.submit('one', b'audio')
        with self.queue.db() as db:
            db.execute('update jobs set created=0')
        self.assertFalse(self.queue.step(lambda _: 'never'))
        self.assertEqual(self.queue.submit('one', b'audio')[1], {'error': 'expired'})
        self.assertEqual(list(pathlib.Path(self.temp.name).glob('*.audio')), [])
    def test_bounded_queue(self):
        for i in range(16):
            self.queue.submit(str(i), b'audio')
        self.assertEqual(self.queue.submit('overflow', b'audio')[0], 429)
    def test_multipart_signature(self):
        payload = b'--b\r\nContent-Disposition: form-data; name="file"; filename="x.webm"\r\n\r\n\x1a\x45\xdf\xa3sound\r\n--b--\r\n'
        self.assertTrue(module.decode_upload('multipart/form-data; boundary=b', payload).startswith(b'\x1a\x45'))
        with self.assertRaises(ValueError):
            module.decode_upload('multipart/form-data; boundary=b', payload.replace(b'\x1a\x45\xdf\xa3', b'fake'))
if __name__ == '__main__':
    unittest.main()
