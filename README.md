# COLLECTIVE — AI Marketing Company

Private marketing workspace for Mealzip. Built with React, Vinext, Cloudflare Workers and D1.

## Included

- Brand knowledge for OFD, ODA, MAPDAL, and Dr.alan623.
- Editable first OFD pilot brief; campaign creation, search and brand filtering.
- Eight-role sequential AI workflow with real OpenAI Responses API background jobs. Research role can use web search. The open campaign view advances roles; closing it pauses future stages, while already-submitted provider work continues.
- Text deliverables: strategy, copy, scripts, production instructions, measurement plans and independent review. Image/video rendering, media buying, social publishing and POS ingestion are not connected.
- Manual artifacts, revision history, version-specific approval and upstream invalidation.
- Campaign measurements and cost-based calculations. Before/after differences are observational, not causal attribution.
- D1 persistence, per-user isolation, owner-private Sites access, same-origin writes, serialized mutations, and encrypted API-key storage.
- API status and output are never simulated in the product. The provider is mocked only in tests.

## Connection

The deployed app accepts an OpenAI API key and model ID in **연결 및 설정**. API billing is separate from a ChatGPT subscription. Secrets are AES-GCM encrypted using the server-only `AGENCY_ENCRYPTION_KEY` (32 bytes, base64). An optional `OPENAI_API_KEY` server environment value is supported. Never rotate the encryption key without re-encrypting stored credentials. Do not commit `.env` or secrets.

The model must support Responses background execution and web search. The default model is `gpt-6-astra`; users can set an available compatible model. Official references: https://developers.openai.com/api/docs/guides/agents and https://developers.openai.com/api/docs/models/gpt-6-astra .

Ambiguous submission failures are held for reconciliation, not automatically retried. Recover with the matching provider response ID, or explicitly confirm no submission exists in provider records before retrying. Active work blocks changes to credentials.

## Verification

`node --experimental-vm-modules tests/workflow.mjs`

28 integration assertions exercise actual route handlers with SQLite, crypto and a mocked provider: authentication, ownership, input validation, persistence, approval/version invalidation, concurrent edits, encrypted keys, completion handling and uncertain submission deduplication. No live paid model call was performed during initial development because no API credential was connected.

Browser QA verified campaign and manual artifact creation against the development D1 database. WebMCP tool registration is feature-detected; the QA browser did not expose modelContext, so WebMCP runtime execution was unavailable.

`node node_modules/typescript/bin/tsc --noEmit`

Use the Sites build/publish workflow for deployment. D1 migrations in `drizzle/` are schema-only. Production authentication depends on trusted Sites dispatcher headers; development-only preview identity is removed from production builds. The site is intentionally owner-private.

## Goal-to-brief workflow

The dashboard's HERMES action submits a durable, owner-scoped draft using the existing gateway. Brand context, the three latest same-brand campaigns, recorded metrics, and approved research/measurement reviews form its context. `/api/brief` supports start/load/poll/recover/cancel. The submission and draft are stored atomically before the external request. Recovery reuses the original idempotency key. No OpenAI API fallback is used by the brief flow.

A structured HERMES result fills only empty strategy fields. Existing input is preserved; competing suggestions can be applied one at a time. Baseline, target, operating facts, owner, learned results, numeric budget, and calendar dates are never auto-filled from model suggestions. Up to three questions collect missing decisions. Campaigns retain the plan, AI provenance and assumptions. Drafts can be resumed from the dashboard; explicit campaign save prevents duplicate creation on retry and rejects stale campaign versions.

The blueprint covers customer behavior/barrier, offer/message/journey, KPI/baseline/target, experiment/tracking/decision criteria, deliverables/schedule/operations/budget, and evidence/learning. Readiness shows missing inputs, not a claim of factual verification or campaign success. The existing eight-role team receives the whole saved plan. No ads or messages are sent by this workflow.

Design references:
- Google Ads, experiment best practices: https://support.google.com/google-ads/answer/7281575?hl=en
- GA4, campaign URL tracking: https://support.google.com/analytics/answer/10917952?hl=en
- GA4, key events: https://support.google.com/analytics/answer/9322688?hl=en

Verification: `node --experimental-vm-modules tests/brief-workflow.mjs` runs owner/origin isolation, HERMES adapter lifecycle, acknowledgement-loss recovery, cancellation, response validation, input preservation, protected facts, persisted provenance, save idempotency, stale version rejection and atomic storage failure checks. `tests/fixtures/brief.json` is a local mock fixture only, never a production generation fallback. Live HERMES execution requires a configured user session and is separate from these tests.
