"""Run inside the Hermes checkout using scripts/run_tests.sh; no real credentials."""
import time
from contextlib import nullcontext
from hermes_cli import auth


def test_profile_inherits_global_quota(monkeypatch):
    entry = dict(access_token='synthetic-test-only', last_status='exhausted',
                 last_error_code=429, last_error_reset_at=time.time() + 3600,
                 label='synthetic')
    global_store = {'credential_pool': {'openai-codex': [entry]}}
    local_store = {}
    monkeypatch.setattr(auth, '_load_auth_store', lambda: local_store)
    monkeypatch.setattr(auth, '_load_global_auth_store', lambda: global_store)
    monkeypatch.setattr(auth, '_auth_store_lock', nullcontext)
    assert auth._codex_pool_rate_limit_status() is not None
    # A configured local provider remains authoritative.
    local_store['credential_pool'] = {'openai-codex': [dict(entry, last_status='ready')]}
    assert auth._codex_pool_rate_limit_status() is None
    local_store.clear()
    entry['last_error_reset_at'] = time.time() - 1
    assert auth._codex_pool_rate_limit_status() is None
    entry['last_error_reset_at'] = time.time() + 3600
    entry['access_token'] = ''
    assert auth._codex_pool_rate_limit_status() is None
