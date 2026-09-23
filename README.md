# COLLECTIVE — AI Marketing Company

Private marketing workspace for Mealzip. Built with React, Vinext, Cloudflare Workers and D1.

## Included

- Brand knowledge for OFD, ODA, MAPDAL, and Dr.alan623.
- Editable first OFD pilot brief; campaign creation, search and brand filtering.
- Eight-role sequential AI workflow through HERMES, with the existing optional OpenAI Responses background execution preserved. An explicitly started campaign sequence is persisted and advanced by the registered machine worker; individual provider results can still be collected from an open view when the worker is offline.
- Text deliverables: strategy, copy, scripts, production instructions, measurement plans and independent review. Image/video rendering, media buying, social publishing and POS ingestion are not connected.
- Manual artifacts, revision history, version-specific approval and upstream invalidation.
- Campaign measurements and cost-based calculations. Before/after differences are observational, not causal attribution.
- D1 persistence, per-workspace isolation, invitation-only email/password login (`AUTH_MODE=email`) behind a public Sites entry, same-origin writes, serialized mutations, and encrypted API-key storage.
- API status and output are never simulated in the product. The provider is mocked only in tests.

## Connection

The default connection is an authenticated HTTPS HERMES gateway in **연결 및 설정**, checked for run submission, status, stopping, and durable idempotency. Existing OpenAI connections remain supported; choosing HERMES never silently falls back to an OpenAI API call. Secrets are AES-GCM encrypted using the server-only `AGENCY_ENCRYPTION_KEY` (32 bytes, base64). Never rotate the encryption key without re-encrypting stored credentials. Do not commit `.env` or secrets.

The model must support Responses background execution and web search. The default model is `gpt-6-astra`; users can set an available compatible model. Official references: https://developers.openai.com/api/docs/guides/agents and https://developers.openai.com/api/docs/models/gpt-6-astra .

Ambiguous submission failures are held for reconciliation, not automatically retried. Recover with the matching provider response ID, or explicitly confirm no submission exists in provider records before retrying. Active work blocks provider/endpoint changes. Credentials for the same HERMES endpoint may be revalidated to recover active work.

## Reliability, usage and review history

See [실행·사용량·작업물 보완](docs/RELIABILITY.ko.md) and [보안 경계](docs/SECURITY-BOUNDARIES.ko.md). Role and viral submission preparation is atomic; active runs are returned independently of the history limit. The settings page shows a provider usage ledger and explicitly versioned manual pricing. Campaign detail includes previous-version comparison and source-scoped measurements with unknown costs preserved. Installation downloads require `RESEARCH_WORKER_ADMIN_IDS`; existing worker credentials continue to function.

## Verification

`node --experimental-vm-modules tests/workflow.mjs`

33 integration assertions (main `3f68f21`) exercise actual route handlers with SQLite, crypto and a mocked provider: authentication, ownership, input validation, persistence, approval/version invalidation, concurrent edits, encrypted keys, completion handling and uncertain submission deduplication. No live paid model call was performed during initial development because no API credential was connected.

Browser QA verified campaign and manual artifact creation against the development D1 database. WebMCP tool registration is feature-detected; the QA browser did not expose modelContext, so WebMCP runtime execution was unavailable.

`node node_modules/typescript/bin/tsc --noEmit`

Use the Sites build/publish workflow for deployment. D1 migrations in `drizzle/` are schema-only. Production runs with `AUTH_MODE=email`: the Sites entry is public, and every data and account API requires the app's own session cookie ([이메일 로그인 운영 안내](docs/EMAIL-AUTH.ko.md)). The legacy mode that trusts the Sites dispatcher header `oai-authenticated-user-id` is for local development and E2E, and in production only after Sites access is restored to owner-only per the recovery steps in [EMAIL-AUTH.ko.md](docs/EMAIL-AUTH.ko.md); never switch production back to it while Sites access is public — leaving `AUTH_MODE` unset also selects legacy. Development-only preview identity is removed from production builds. Current production state: [docs/STATUS.md](docs/STATUS.md).

## Viral learning lab

- Sidebar **바이럴 학습**: source cases, observed metrics with nullable unknowns, chronological observations, structured causal hypotheses, A/B creative variants, experiments, trial rules, and execution history.
- HERMES discovery uses the gateway's available read-only research tools and returns at most six source cases. Tool limitations and inaccessible sources produce explicit errors, not synthetic findings. The direct ASIDE connection, unattended scheduling, video/audio ingestion, social publishing and automatic performance ingestion are not implemented here. Research capability through the user's live HERMES/ASIDE session has not been verified by development tests.
- HERMES analysis uses the supplied evidence and subsequent observations, separating facts, hooks, retention, sharing, distribution, counterexamples and unknowns. Manual evidence/analysis is available without a model connection. AI-reported observations are labeled accordingly and are not independently certified.
- Lock a plan before measurement: one changed variable, primary metric, minimum denominator per arm, minimum observation hours, practical relative lift, and comparison conditions. Save measured results with sources. Unknown or insufficient data blocks adoption.
- Evaluation is a descriptive aggregate comparison, **not** significance testing or causal proof. The sample/time defaults do not constitute a power calculation. Shares/clicks are event counts and can exceed reach/impressions; completions cannot exceed starts. A zero control rate does not yield infinite uplift.
- 판정 통계: Beta(1,1) 사후확률(B가 A보다 나을 확률)·lift 90% 신용구간·중간 확인 경고·통계 권고와 사람 확정 기록(권고와 어긋남·선택 사유) — [docs/VIRAL-STATS.ko.md](docs/VIRAL-STATS.ko.md)
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

An owner-scoped campaign job remains active throughout the meeting, including between steps. Step inputs and provider idempotency keys are persisted atomically before submission. Unknown acknowledgements remain locked until recovered, including credential errors during recovery; cancellation stops follow-on work. The registered machine worker advances meetings without an open tab, sharing a fair queue with research, role runs, brief/viral work and measurements. An open meeting tab remains a fallback when the worker is unavailable.

The final revisions and quality report are committed atomically as review-pending artifacts. Prior versions are retained in history, affected unrevised downstream artifacts become outdated, and no AI verdict approves the campaign. Follow-up meetings receive the preceding decisions, unresolved questions and quality review alongside current campaign context. Campaign deletion removes meeting records and provider input snapshots; shared viral source cases remain.

`node --experimental-vm-modules tests/meetings.test.mjs` checks actual route handlers against SQLite with mocked HERMES responses: cross-role context, role order, output/version preservation, frozen inputs, concurrency, uncertainty, recovery, cancellation, stale rejection, atomic final storage and scoped deletion. Live HERMES response quality and gateway connectivity require an actual configured run.

### Practical role skills and quality gates

- `lib/practice.ts` supplies versioned working methods, deliverables, review criteria and handoffs for all eight roles. Individual runs and meeting revisions use the full contract; discussions focus on one bottleneck and a concrete response to a previous contribution. Campaign channel guides and evidence discipline are included in model input.
- The AI team role dialog exposes these working methods and deliverables. New artifacts and meetings record the practice version. Existing artifacts are unchanged until the next run or meeting.
- New independent reviews use `lib/quality.ts`: five explicit criteria (evidence, brand, execution, economics, measurement), plus one check per meeting task. Missing/duplicate checks, missing tasks, or outdated downstream work cannot yield ready-for-review. Structured `needs_data` and `revise` findings override optimistic model verdicts. These are structural checks, not automated proof of facts or marketing effectiveness. Legacy in-flight meetings/jobs keep their original response contract.
- Individual role handoffs carry artifact IDs, versions, original lengths and explicit excerpt flags at 12,000 characters. Reviewers must not claim to have checked omitted material. Role output budgets replace the former 1,800-character target.
- Newly adopted learning rules retain test/caution direction and the actual observational assessment (metric, rates, lift, samples, dates, conditions and limitations); past snapshots remain immutable. There is no automatic training of model weights.
- Verification: `node --experimental-vm-modules tests/practice.test.mjs`, `tests/meetings.test.mjs`, `tests/learning.test.mjs`. Live HERMES output quality and conversion performance still require authenticated real runs and observed experiments.

## Brand archive and onboarding

Brands can now be registered with an intake (official website/social URLs, market, client need and alternatives). The archive connects intake → source evidence → diagnosis → campaign planning. Confirmed archive evidence, an adopted current diagnosis and scoped channel observations are passed to brief generation, individual roles and frozen meeting snapshots. Brand edits, intake, source review and measurements advance the archive revision; stale adopted diagnoses are excluded from subsequent context.

- Brand registration atomically saves the brand and its optional research job without calling HERMES. Manual start also returns a durable queued job immediately. A server after-response task then hands off one idempotent run to HERMES (20-second handoff budget within the Worker response lifetime). It includes a business-specific plan, brand/operations, customers/competitors, comparable content, critique and at most two follow-up investigations, then diagnosis. The default plan targets 15 own-brand content cases in 90 days and three alternatives; unmet targets remain explicit gaps. HERMES continues an accepted run while the screen is closed. A workspace-wide monitor advances/synchronizes jobs across tabs, with up to three requests in parallel and fair rotation. Reopening resumes queued or interrupted handoffs using the same stored idempotency key. Submission/recovery waits up to 90 seconds and each status/stop request up to 45 seconds; transient failures preserve the active run and back off from 30 seconds to five minutes. Research has no application-side elapsed-time deadline; HERMES model/tool/runtime limits remain gateway configuration. This is not a durable Site scheduler: if the first handoff is interrupted before acceptance and the entire app is closed, recovery waits for reopening. Existing four-step jobs and classification (batches of 30 plus diagnosis) now advance through the workspace monitor too. Registration does not run tool preflight; the separate authenticated tool check is still available. Research uses per-job locks so a slow gateway does not hold the workspace mutation lock. Exact input and idempotency keys persist before submission; uncertain acknowledgements stay locked for recovery.
- The authenticated tool check inspects HERMES capabilities and its advertised `/v1/toolsets`. Enabled/configured Aside or browser tools are marked as registered, never as successfully connected to a site. The run is instructed to use available read-only browsing and record access methods, scopes and limitations. Model/reasoning settings remain HERMES configuration; no Astra-ultra setting or direct Aside installation is implemented. Actual HERMES/Aside browsing has not been verified by the mocked development tests.
- Investigation reports retain source-linked customer signals, competitors, content observations, hypotheses, alternative explanations, phase summaries and critique. Video viewing claims require consistent viewed ranges and scene timestamps; search snippets cannot claim video viewing. Comparisons require at least six cases sharing account, channel, format, known ad scope, elapsed-time bucket and video-length bucket. Rankings are sample-relative, not causal or universal viral scores. The server checks references, duplicate evidence, coverage and sample sufficiency; these checks cannot verify the truth of provider-reported observations. Missing evidence blocks adoption of that deep diagnosis, and a follow-up starts with its missing-evidence questions.
- Every source retains origin, URL, observation time, scope, category, version and candidate/confirmed/excluded state. AI results start as candidates. A diagnosis can be adopted only against its current archive revision and confirmed source IDs. Source review followed by re-diagnosis intentionally separates raw research from approved strategy context.
- Original files use the private logical R2 `BUCKET`; D1 stores owner-scoped metadata and extracted text. PDF/DOCX/TXT/MD/CSV/JSON and PNG/JPEG/WebP are accepted, maximum 8 MB and 200 sources per brand. Text extraction is browser-side; PDF limits are 80 pages/80,000 characters, DOCX body only, images/scans have no OCR. Truncation and extraction failure are explicit. Downloads require ownership and force attachment/nosniff. Failed metadata writes clean up the just-uploaded object.
- Diagnosis uses the latest 30 nonexcluded sources (4,500-character excerpts), 12 observations and prior research summaries. Ordinary campaign context uses up to 20 confirmed sources (3,500 characters), 12 observations and current adopted diagnosis. Omitted counts and excerpt flags travel with inputs. Classification batches cover all archived sources.
- Metrics separate reach, attention, shares/saves, link clicks, key-event sessions, revenue and recorded-cost remainder. Unknown values remain null; zero denominators are distinct. Comparison requires the same account/channel/scope/method/definition and interval length and displays the comparison dates. Public cumulative snapshots are excluded from period comparisons. No universal viral index, channel reach sum, invented private insights, revenue causality or profitability claim is produced. Social API connectors and automatic analytics import are not implemented; measured observations are entered from identified sources.
- Official metric references: [YouTube Analytics](https://developers.google.com/youtube/analytics/metrics), [GA4 Data API](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema), [TikTok video fields](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object), [Meta Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

Verification: `node --experimental-vm-modules tests/archive.test.mjs` exercises ownership/origin, dynamic brands, measurements, confirmed context, diagnosis invalidation, real route state transitions with mocked HERMES, batch coverage, lost acknowledgements/recovery/cancellation, original download and failed-write cleanup. Deep research cases additionally check tool discovery boundaries, comparison cohorts, video-claim consistency, canonical evidence references, server-owned quality decisions, follow-up isolation and atomic result synchronization/retry. Mock-provider checks are not live HERMES verification.


## Store marketing

The 점포 마케팅 navigation and brand archive shortcut manage brand-owned locations, 11 channel checklists, evidence-backed tasks, experiment plans, dated measurements and retrospective decisions. Records use the existing owner-scoped D1 records table; there is no schema migration or fixture data added to production. Channel checks and business metrics are user-entered, with source/definition/date requirements; public browsing never supplies invented private metrics.

Store research uses the existing durable HERMES/worker queue with identity, customer, channel and store_diagnosis stages. It snapshots the location, channel checks and previous local experiments, and saves stage sources plus the final structured report atomically. It has no viral-content sample requirement. Reports remain AI drafts; changed locations or excluded evidence invalidate their use for new experiment proposals. Actual unattended progress requires the installed worker to remain operational.

Experiments lock on start or campaign linking. Campaign creation requires a complete experimental plan and is idempotent; linked drafts are preserved and a follow-up experiment can be created instead. Location changes invalidate linked campaign artifacts and approval state. Existing brand-only campaigns remain compatible. Local campaign briefs, agent jobs and meetings receive the selected store's experiments and measurements, never another location's records. Measurements retain nulls, distinguish navigation actions from purchases, reject overlapping dates and invalid denominators, and only compute repeat purchase rates for user-confirmed mature cohorts. Closing an experiment preserves its measurements and stores a user decision for later planning. No ad platform publishing, spending or automatic POS/Insights ingestion is performed.

The 매장 실행 준비 cards require observations, evidence and a confirmation date before a check can be marked complete. A location edit makes previous confirmations stale. The 주문 장부 supports manual orders, atomic CSV imports of up to 200 rows, refund corrections, unknown costs, attribution evidence and advertising/production expenses. Duplicate source/date/order-number identities are rejected. Recorded contribution is not total store profit; missing costs remain unknown and cancelled orders retain incurred costs.

Running experiments can import only their explicitly linked orders and expenses into dated measurement snapshots. Overlapping measurements are rejected, unconfirmed advertising costs remain unknown, and ledger data does not invent new-customer or repeat-purchase counts. Changed ledger records require re-import before adopting an experiment. Completed retrospectives preserve their original measurements, evidence level, confounders and next actions; follow-up experiments keep their parent link. Agent context includes only the selected store's diagnostic records and recent aggregated ledger, without raw order numbers.

Validation: `node --experimental-vm-modules tests/stores.test.mjs` uses actual handlers with transactional SQLite and mocked HERMES replies, covering ownership, version conflicts, local research, excluded evidence, campaign linkage, measurement boundaries, duplicate imports, partial/full refunds, unknown costs, retrospective snapshots and learning isolation. Existing archive, brief, meeting, learning, deletion and workspace suites remain applicable. Test module loading leaves graph instantiation to VM to support shared dependency graphs. Live HERMES browsing and actual marketing performance need a configured production run.

## Verdict, collection and review gates

The channel vocabulary has a single source: `lib/channels.ts` holds the registry, the display names stored in existing records, the store checklist keys and `ConnectorKey`. The connector modules no longer declare a second `ChannelKey`; `lib/store-marketing.ts` keeps the store checklist key under that name.

Automatic collection is bounded. A collection is accepted only for a running experiment and only from the connector whose registry channel matches that experiment's channel; numbers from one channel can no longer land in another channel's arm. Collected store values such as advertising cost are kept on the draft instead of appearing once in the response. The worker stops a collection source when its experiment is no longer running or its record is gone, records why it stopped, and never calls the external API for that source again. `comparable` stays false: a person still confirms comparability in `save_results`.

A retrospective that describes itself as a single `observation` cannot become a 30-day learning rule. The retrospective is still stored; only the promotion is blocked. Store measurements carry `scope`: a `baseline` measurement is recorded for a period before the experiment starts, is kept out of the adoption gate and out of rule promotion, and does not collide with in-experiment periods. Pre-period baselines can only be built by calendar time, so the schema accepts them now.

The independent quality report states what it did not review: the five criteria are a structural check and do not include legal review of advertising claims, rights coverage or personal data handling. This is a disclosure, not a new check.

`assertNoActiveJobs` takes an optional campaign. Saving or approving an artifact is checked against its own campaign, so an AI run on one campaign no longer blocks the human approval gate on another. Connection and setting changes keep the account-wide check.

Verification: `node scripts/test.mjs` runs every suite (current suite and assertion counts are in [docs/STATUS.md](docs/STATUS.md)). `node node_modules/typescript/bin/tsc --noEmit` and `node scripts/lint-gate.mjs` (baseline in `scripts/lint-baseline.json`; increases are blocked, and decreases must lower the baseline with `--update`) complete the gate. The blocking `verify` job in `.github/workflows/ci.yml` runs these three plus `node scripts/run-framework.mjs build` and `python3 tests/research_worker_test.py` on every branch. `pnpm run <script>` fails in this repository because of `pnpm-workspace.yaml`, so each step calls node directly. The worker contract test used to fail intermittently because its local HTTP server closed connections without reading the request body; the server now consumes the body, so the test blocks. Browser E2E remains non-blocking ([docs/E2E.ko.md](docs/E2E.ko.md)). Every suite stubs fetch, so no test makes a paid model call or a real connector call — but the product itself has been run live: see `docs/observations/2026-09-23-live-run.md` for 18 completed HERMES runs and what they showed.

## Deployment identity

`GET /api/version` returns `{build, tree}` to a signed-in session. `tree` is the committed source tree hash injected at build time by `vite.config.ts`. The GitHub commit and the Sites commit that publishes the same files have different SHAs but the same tree, so the tree — not the commit — identifies which reviewed revision a running deployment was built from.

The value is fail-closed. Vite bundles what is on disk, so a modified working tree would ship code that `HEAD`'s tree does not describe; the build reports `dirty` in that case, and `unknown` when git is unavailable. `lib/app-version.ts` accepts only 40 lowercase hex characters and maps everything else to `unknown`, so a deployment can never be reported as verified against a revision it was not built from. `COLLECTIVE_SOURCE_TREE` overrides the build-time lookup for environments without git.

Reading it requires a signed-in email session, so sign in to the app and fetch it from the page rather than typing the URL:

```js
await (await fetch('/api/version', {credentials: 'same-origin', cache: 'no-store'})).json()
```

Compare the returned `tree` with `git rev-parse <sha>^{tree}` for the GitHub revision that was published. A `tree` of `unknown` or `dirty` means the deployment has no verifiable identity, not that it is current.

Publication itself is unchanged: the Sites build/publish workflow deploys, and a GitHub merge does not. Verify GitHub state, tests and the running deployment separately.

Verification: `node --experimental-vm-modules tests/version.test.mjs` covers the identity rules, and `tests/workflow.mjs` covers the route's owner-only access and its uninjected default.

## 공동개발

이 저장소의 `main`이 COLLECTIVE 제품 소스의 정본입니다. Claude, Codex, HERMES 및 로컬 개발 환경은 [AGENTS.md](AGENTS.md)의 규칙을 따릅니다. 작업 인계에는 [docs/HANDOFF_TEMPLATE.md](docs/HANDOFF_TEMPLATE.md)를 사용합니다.
