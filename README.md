# COLLECTIVE — AI Marketing Company

Private marketing workspace for Mealzip. Built with React, Vinext, Cloudflare Workers and D1.

## Included

- Brand knowledge for OFD, ODA, MAPDAL, and Dr.alan623.
- Editable first OFD pilot brief; campaign creation, search and brand filtering.
- Eight-role sequential AI workflow through HERMES, with the existing optional OpenAI Responses background execution preserved. The open campaign view advances roles; closing it pauses future stages, while already-submitted provider work continues.
- Text deliverables: strategy, copy, scripts, production instructions, measurement plans and independent review. Image/video rendering, media buying, social publishing and POS ingestion are not connected.
- Manual artifacts, revision history, version-specific approval and upstream invalidation.
- Campaign measurements and cost-based calculations. Before/after differences are observational, not causal attribution.
- D1 persistence, per-user isolation, owner-private Sites access, same-origin writes, serialized mutations, and encrypted API-key storage.
- API status and output are never simulated in the product. The provider is mocked only in tests.

## Connection

The default connection is an authenticated HTTPS HERMES gateway in **연결 및 설정**, checked for run submission, status, stopping, and durable idempotency. Existing OpenAI connections remain supported; choosing HERMES never silently falls back to an OpenAI API call. Secrets are AES-GCM encrypted using the server-only `AGENCY_ENCRYPTION_KEY` (32 bytes, base64). Never rotate the encryption key without re-encrypting stored credentials. Do not commit `.env` or secrets.

The model must support Responses background execution and web search. The default model is `gpt-6-astra`; users can set an available compatible model. Official references: https://developers.openai.com/api/docs/guides/agents and https://developers.openai.com/api/docs/models/gpt-6-astra .

Ambiguous submission failures are held for reconciliation, not automatically retried. Recover with the matching provider response ID, or explicitly confirm no submission exists in provider records before retrying. Active work blocks provider/endpoint changes. Credentials for the same HERMES endpoint may be revalidated to recover active work.

## Verification

`node --experimental-vm-modules tests/workflow.mjs`

28 integration assertions exercise actual route handlers with SQLite, crypto and a mocked provider: authentication, ownership, input validation, persistence, approval/version invalidation, concurrent edits, encrypted keys, completion handling and uncertain submission deduplication. No live paid model call was performed during initial development because no API credential was connected.

Browser QA verified campaign and manual artifact creation against the development D1 database. WebMCP tool registration is feature-detected; the QA browser did not expose modelContext, so WebMCP runtime execution was unavailable.

`node node_modules/typescript/bin/tsc --noEmit`

Use the Sites build/publish workflow for deployment. D1 migrations in `drizzle/` are schema-only. Production authentication depends on trusted Sites dispatcher headers; development-only preview identity is removed from production builds. The site is intentionally owner-private.

## Viral learning lab

- Sidebar **바이럴 학습**: source cases, observed metrics with nullable unknowns, chronological observations, structured causal hypotheses, A/B creative variants, experiments, trial rules, and execution history.
- HERMES discovery uses the gateway's available read-only research tools and returns at most six source cases. Tool limitations and inaccessible sources produce explicit errors, not synthetic findings. The direct ASIDE connection, unattended scheduling, video/audio ingestion, social publishing and automatic performance ingestion are not implemented here. Research capability through the user's live HERMES/ASIDE session has not been verified by development tests.
- HERMES analysis uses the supplied evidence and subsequent observations, separating facts, hooks, retention, sharing, distribution, counterexamples and unknowns. Manual evidence/analysis is available without a model connection. AI-reported observations are labeled accordingly and are not independently certified.
- Lock a plan before measurement: one changed variable, primary metric, minimum denominator per arm, minimum observation hours, practical relative lift, and comparison conditions. Save measured results with sources. Unknown or insufficient data blocks adoption.
- Evaluation is a descriptive aggregate comparison, **not** significance testing or causal proof. The sample/time defaults do not constitute a power calculation. Shares/clicks are event counts and can exceed reach/impressions; completions cannot exceed starts. A zero control rate does not yield infinite uplift.
- Adopt an eligible positive result or negative finding as a scoped, 30-day trial rule. Adoption is idempotent. Result corrections retire previous rules; rules can also be paused. Expired, retired, paused, different-brand or different-channel rules are excluded from new campaign runs.
- Campaign blueprint drafts and campaign role runs automatically retrieve applicable rules; draft submissions retain the exact context. For role runs, their exact ID/version/content are included in the run input hash and an immutable historical snapshot. Previously generated artifacts are not retroactively rewritten when learning changes. New knowledge is memory/tool guidance, not online model-weight training.
- All data uses the existing owner-scoped D1 records and jobs tables. No schema migrations were necessary. Raw provider responses are retained for diagnosis; secrets are not returned by the learning endpoint.

Verification: `node --experimental-vm-modules tests/learning.test.mjs` exercises real handlers, SQLite and crypto with mocked HERMES. It checks evidence deduplication, ownership, plan locking, insufficient data, result correction, rule expiration/scope, actual campaign prompt injection, preserved snapshots and provider completion idempotency. Browser QA uses explicitly labeled local-only fixtures; none are seeded into production.

## Goal-to-brief workflow

The dashboard's HERMES action submits a durable, owner-scoped draft using the existing gateway. Brand context, the three latest same-brand campaigns, recorded metrics, and approved research/measurement reviews form its context. `/api/brief` supports start/load/poll/recover/cancel. The submission and draft are stored atomically before the external request. Recovery reuses the original idempotency key. No OpenAI API fallback is used by the brief flow.

A structured HERMES result fills only empty strategy fields. Existing input is preserved; competing suggestions can be applied one at a time. Baseline, target, operating facts, owner, learned results, numeric budget, and calendar dates are never auto-filled from model suggestions. Up to three questions collect missing decisions. Campaigns retain the plan, AI provenance and assumptions. Drafts can be resumed from the dashboard; explicit campaign save prevents duplicate creation on retry and rejects stale campaign versions.

The blueprint covers customer behavior/barrier, offer/message/journey, KPI/baseline/target, experiment/tracking/decision criteria, deliverables/schedule/operations/budget, and evidence/learning. Readiness shows missing inputs, not a claim of factual verification or campaign success. The existing eight-role team receives the whole saved plan. No ads or messages are sent by this workflow.

Design references:
- Google Ads, experiment best practices: https://support.google.com/google-ads/answer/7281575?hl=en
- GA4, campaign URL tracking: https://support.google.com/analytics/answer/10917952?hl=en
- GA4, key events: https://support.google.com/analytics/answer/9322688?hl=en

Verification: `node --experimental-vm-modules tests/brief-workflow.mjs` runs owner/origin isolation, HERMES adapter lifecycle, acknowledgement-loss recovery, cancellation, response validation, input preservation, protected facts, persisted provenance, save idempotency, stale version rejection and atomic storage failure checks. `tests/fixtures/brief.json` is a local mock fixture only, never a production generation fallback. Live HERMES execution requires a configured user session and is separate from these tests.


## Campaign team meetings

Each campaign has a team meeting tab backed by HERMES: eight separate role contributions, a CMO synthesis assigning 1–3 roles, dependency-ordered revisions, then a separate quality review (maximum 13 provider operations per meeting). Each contribution after the first must reference an actual previous speaker. No synthetic conversation or silent provider fallback is used.

An owner-scoped campaign job remains active throughout the meeting, including between steps. Step inputs and provider idempotency keys are persisted atomically before submission. Unknown acknowledgements remain locked until recovered, including credential errors during recovery; cancellation stops follow-on work. The meeting advances while its tab is open and resumes when reopened. No unattended scheduler is implied.

The final revisions and quality report are committed atomically as review-pending artifacts. Prior versions are retained in history, affected unrevised downstream artifacts become outdated, and no AI verdict approves the campaign. Follow-up meetings receive the preceding decisions, unresolved questions and quality review alongside current campaign context. Campaign deletion removes meeting records and provider input snapshots; shared viral source cases remain.

`node --experimental-vm-modules tests/meetings.test.mjs` checks actual route handlers against SQLite with mocked HERMES responses: cross-role context, role order, output/version preservation, frozen inputs, concurrency, uncertainty, recovery, cancellation, stale rejection, atomic final storage and scoped deletion. Live HERMES response quality and gateway connectivity require an actual configured run.
