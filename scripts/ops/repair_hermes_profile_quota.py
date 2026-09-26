"""Apply the reviewed quota-reporting fix to a Hermes checkout, never auth data."""
from pathlib import Path
import sys

path = Path(sys.argv[1]) / "hermes_cli/auth.py"
original = path.read_text()
start = original.index("def _codex_pool_rate_limit_status(")
end = original.index("\ndef ", start + 1)
section = original[start:end]
before = '''        with _auth_store_lock():
            auth_store = _load_auth_store()
        pool = auth_store.get("credential_pool")
        if not isinstance(pool, dict):
            return None
        entries = pool.get("openai-codex")
'''
after = '''        with _auth_store_lock():
            # Match credential selection, including supported profile inheritance.
            entries = read_credential_pool("openai-codex")
'''
if section.count(before) != 1:
    raise SystemExit("Expected unmodified quota detector; refusing to change this checkout")
updated = original[:start] + section.replace(before, after, 1) + original[end:]
compile(updated, str(path), "exec")
path.write_text(updated)
print("Updated quota reporting only; credential stores were not modified")
