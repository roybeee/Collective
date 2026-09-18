# Unattended brand research

The Sites D1 database is the durable queue and archive. The Hetzner systemd worker
polls a dedicated machine endpoint every 15 seconds, advancing one due research
job per tick. It needs neither an open application tab nor the personal Mac.
This worker advances **brand research and archive classification**, not campaign
meetings or all AI-team tasks.

## Installation

1. Finish or cancel active AI jobs before restarting the default HERMES gateway.
2. In COLLECTIVE **연결 및 설정 → Mac 없이 브랜드 조사**, download the installer.
3. Copy it to the existing Ubuntu x86_64 server and run it as root:

   ```sh
   scp ~/Downloads/install-collective-server.py root@2.28.40.57:/root/
   ssh root@2.28.40.57 'python3 /root/install-collective-server.py'
   ```

4. Wait for the worker heartbeat in Settings. Start a new brand investigation.
5. After confirming installation, delete both copies of the generated installer.
   It contains private connection credentials. Never commit or share it.

The installer uses the existing `hermes` account, installs pinned
`agent-browser@0.26.0` under `/opt/collective-browser`, downloads Chromium under
that account, and checks the title of `https://example.com` in a real browser.
It does not upgrade HERMES or copy Mac browser profiles. Ubuntu package installs
are performed as root. The browser and queue worker run as `hermes`.

The default profile API toolsets become `browser`, `web`, `no_mcp`. Global Aside
MCP configuration remains available for other platforms, including Slack.
Local browser selection is explicit, with headed/remote-CDP overrides cleared in
both the service environment and the default profile dotenv. Configuration and
dotenv backups are timestamped beside the originals. Other HERMES profiles are
not edited.

## Authentication and recovery

Production runtime requires `RESEARCH_WORKER_SITE_ORIGIN` and the secret
`RESEARCH_WORKER_GATE_TOKEN` (the Sites-issued machine gate bearer token).
The installer receives an additional random, owner-scoped credential. Only its
SHA-256 hash is stored in D1. Machine requests use the Sites gate header and
scoped Authorization credential; they never assert a browser user identity.
The endpoint accepts no caller-specified job actions or arbitrary destinations.
Redirects are not followed with credentials.

Reissuing the installer rotates the credential. Revoking it stops future ticks;
an already accepted HERMES run can still execute and can be cancelled from the
application. The worker exits on HTTP 401/403 and must be reinstalled after fixing
the authorization problem. Temporary errors use backoff. A heartbeat means the
queue worker reached the app, not that every target website is accessible.

New server-mode investigations have four durable steps. Each completed initial
step stores validated sources; the final step stores the detailed report and
diagnosis. Existing submissions retain their request body and idempotency key.
Lost acknowledgements are recovered with the same request. Retries, UI polling,
and process restarts use per-job leases; inactive or completed jobs are not rerun.
Malformed results remain visible in research records for recovery.

```sh
systemctl status collective-research-worker.service --no-pager
journalctl -u collective-research-worker.service -n 30 --no-pager
```

Authenticated social accounts need a separate server login process. Access blocks,
missing credentials, and unavailable observations must be recorded as limitations.
No CAPTCHA bypass or invented metrics are part of this implementation.

## Verification boundary

Local tests cover queue completion without UI calls, intermediate persistence,
lost acknowledgements, credential isolation/rotation/revocation, fairness,
redirect rejection, and existing archive validation. They use simulated HERMES
responses. Actual server browser installation and an end-to-end production brand
investigation must be checked on the user's Hetzner server after installation.

Official implementation references:

- https://hermes-agent.nousresearch.com/docs/user-guide/features/browser/
- https://github.com/NousResearch/hermes-agent/blob/main/tools/browser_tool_install.py
- https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/env_loader.py
- https://github.com/vercel-labs/agent-browser/tree/v0.26.0
