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
