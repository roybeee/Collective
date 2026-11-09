// I1 Cloudflare Workers 직접 배포 경로: 설정 템플릿 채우기, 배포 명령 생성(순수), 요청 경계, 예약 tick 순환을 검사한다. 원격 명령은 실행하지 않는다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEPLOY_TARGETS, REQUIRED_ENV, configProblems, deployTarget, renderWorkersConfig, stripJsonComments} from '../deploy/workers-config.mjs';
import {ACTIVE_OWNERS_SQL, CRON_LOCK_SUFFIX, CRON_QUEUES, cronEnabled, guardRequest, runInternalCron} from '../deploy/workers-runtime.mjs';
import {buildCommand, builtProblems, executionBlockers, formatCommand, parseArgs, parseUploadOutput} from '../scripts/deploy-workers.mjs';

let passed = 0;
const check = (ok, name) => { assert.ok(ok, name); passed++; };
const template = readFileSync('deploy/wrangler.workers.jsonc', 'utf8');
const ID = '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f';
const ownerEnv = {CF_D1_DATABASE_ID: ID, CF_R2_BUCKET: 'collective-prod', AUTH_ORIGIN: 'https://app.example.com', CLOUDFLARE_ACCOUNT_ID: 'acct'};

// 빌드 대상
check(deployTarget(undefined) === 'sites' && deployTarget('') === 'sites' && deployTarget('workers') === 'workers', 'DEPLOY_TARGET defaults to sites');
assert.throws(() => deployTarget('vercel'), /sites 또는 workers/); passed++;
check(DEPLOY_TARGETS.length === 2 && Object.isFrozen(DEPLOY_TARGETS), 'only two frozen targets');

// JSONC
check(JSON.parse(stripJsonComments('{"u":"https://a.b/c", // x\n/* y */"n":1}')).u === 'https://a.b/c', 'comment stripping keeps // inside strings');
check(JSON.parse(stripJsonComments('{"s":"a\\"//b"}')).s === 'a"//b', 'escaped quote inside string');

// 템플릿: 비밀값·계정 ID를 담지 않는다
check(!/account_id/.test(stripJsonComments(template)), 'template has no account_id');
check(!/[0-9a-f]{32}/.test(template.replace(/-/g, '')), 'template has no hex ids');
check(/"AUTH_MODE": "email"/.test(template), 'template fixes AUTH_MODE=email');

// 로컬·CI 빌드(strict 아님)
const local = renderWorkersConfig(template, {});
check(local.problems.length === 0, `local render has no problems: ${local.problems}`);
check(REQUIRED_ENV.every(name => local.missing.includes(name)), 'missing reports required owner env');
check(local.config.d1_databases[0].database_id === '00000000-0000-4000-8000-000000000000' && local.config.d1_databases[0].binding === 'DB', 'local D1 placeholder');
check(local.config.d1_databases[0].migrations_dir === '../../drizzle', 'migrations dir is relative to dist/server');
check(local.config.r2_buckets[0].binding === 'BUCKET' && local.config.r2_buckets[0].bucket_name === 'collective-r2-local', 'local R2 placeholder');
check(local.config.vars.AUTH_MODE === 'email' && local.config.vars.INTERNAL_CRON === '0' && !('AUTH_ORIGIN' in local.config.vars), 'vars: email, cron off, empty origin dropped');
check(local.config.triggers.crons[0] === '*/5 * * * *' && local.config.observability.enabled === true, 'cron and observability');
check(local.config.secrets.required.includes('AGENCY_ENCRYPTION_KEY') && local.config.main === './deploy/worker-entry.ts', 'secrets listed without values, custom entry');
check(local.config.name === 'collective', 'default worker name');

// 소유자 배포(strict)
const owner = renderWorkersConfig(template, {...ownerEnv, INTERNAL_CRON: '1', CF_WORKER_NAME: 'collective-prod', CF_CRON: '*/10 * * * *'}, {strict: true});
check(owner.missing.length === 0 && owner.problems.length === 0, `owner render clean: ${owner.problems}`);
check(owner.config.d1_databases[0].database_id === ID && owner.config.vars.AUTH_ORIGIN === 'https://app.example.com' && owner.config.vars.INTERNAL_CRON === '1', 'owner values substituted');
check(owner.config.name === 'collective-prod' && owner.config.triggers.crons[0] === '*/10 * * * *', 'overrides applied');
const strictEmpty = renderWorkersConfig(template, {}, {strict: true});
check(strictEmpty.problems.some(p => /UUID/.test(p)) && strictEmpty.problems.some(p => /버킷/.test(p)), 'strict without env fails');
check(renderWorkersConfig(template, {...ownerEnv, AUTH_ORIGIN: 'https://app.example.com/'}).problems.some(p => /AUTH_ORIGIN/.test(p)), 'trailing slash origin rejected');
check(renderWorkersConfig(template, {...ownerEnv, AUTH_ORIGIN: 'http://app.example.com'}).problems.some(p => /AUTH_ORIGIN/.test(p)), 'http origin rejected');
check(renderWorkersConfig(template, {...ownerEnv, INTERNAL_CRON: 'yes'}).problems.some(p => /INTERNAL_CRON/.test(p)), 'INTERNAL_CRON must be 0/1');
check(renderWorkersConfig(template, {...ownerEnv, CF_CRON: '* *'}).problems.some(p => /cron/.test(p)), 'bad cron rejected');
check(renderWorkersConfig(template, {...ownerEnv, CF_WORKER_NAME: 'Bad_Name'}).problems.some(p => /이름/.test(p)), 'bad worker name rejected');
check(configProblems({...owner.config, vars: {...owner.config.vars, AUTH_MODE: 'legacy'}}).some(p => /AUTH_MODE/.test(p)), 'legacy auth mode is a problem');
check(owner.config !== local.config && template === readFileSync('deploy/wrangler.workers.jsonc', 'utf8'), 'rendering does not mutate inputs');

// 인자 읽기
check(parseArgs(['preview', '--tag', 'v1', '--execute']).flags.tag === 'v1', 'value flag');
assert.throws(() => parseArgs(['deploy']), /명령은/); passed++;
assert.throws(() => parseArgs(['preview', '--force']), /모르는 플래그/); passed++;
assert.throws(() => parseArgs(['preview', '--tag']), /값이 필요/); passed++;
assert.throws(() => parseArgs(['check', '--dry-run', '--execute']), /함께 쓸 수 없/); passed++;

// 명령 생성(순수)
const preview = buildCommand('preview', {flags: {tag: 'abc1234', message: 'wave3 preview'}});
check(preview.remote && !preview.confirm && preview.args.join(' ') === 'versions upload --config dist/server/wrangler.json --tag abc1234 --message wave3 preview', 'preview command');
check(buildCommand('preview', {flags: {alias: 'staging'}}).args.slice(-2).join(' ') === '--preview-alias staging', 'preview alias');
assert.throws(() => buildCommand('preview', {flags: {alias: 'Staging_1'}}), /--alias/); passed++;
check(parseUploadOutput('Version Preview Alias URL: https://staging-collective.o.workers.dev').aliasUrl === 'https://staging-collective.o.workers.dev', 'alias URL parsed');
const promote = buildCommand('promote', {positional: [ID]});
check(promote.args.slice(0, 4).join(' ') === `versions deploy ${ID}@100% --yes`, 'promote to 100%');
assert.throws(() => buildCommand('promote', {positional: ['latest']}), /UUID/); passed++;
assert.throws(() => buildCommand('promote', {}), /UUID/); passed++;
check(buildCommand('rollback').args.join(' ') === 'rollback --yes --config dist/server/wrangler.json', 'rollback to previous');
check(buildCommand('rollback', {positional: [ID], flags: {message: 'bad deploy'}}).args.join(' ') === `rollback ${ID} --yes --config dist/server/wrangler.json --message bad deploy`, 'rollback to id');
const migrate = buildCommand('migrate');
check(migrate.remote && migrate.confirm && migrate.args.join(' ') === 'd1 migrations apply DB --remote --config dist/server/wrangler.json', 'migrate needs confirm');
check(buildCommand('migrations-list').args.includes('--remote') && !buildCommand('bundle-check').remote && buildCommand('bundle-check').args.includes('--dry-run'), 'list remote, bundle check local');
assert.throws(() => buildCommand('preview', {flags: {message: 'a\nb'}}), /한 줄/); passed++;
assert.throws(() => buildCommand('preview', {flags: {tag: 'x'.repeat(101)}}), /100자/); passed++;
check(formatCommand(['rollback', '--message', "it's bad"]) === `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js rollback --message 'it'\\''s bad'`, 'shell quoting');

// 실행 차단(기본 dry-run)
const built = {...owner.config, main: 'index.js'};
check(executionBlockers(preview, {}, {built, env: ownerEnv}).some(b => /dry-run/.test(b)), 'no --execute = dry-run');
check(executionBlockers(preview, {execute: true}, {built, env: ownerEnv}).length === 0, 'execute with owner build allowed');
check(executionBlockers(migrate, {execute: true}, {built, env: ownerEnv}).some(b => /yes-i-understand/.test(b)), 'migrate needs --yes-i-understand');
check(executionBlockers(migrate, {execute: true, 'yes-i-understand': true}, {built, env: ownerEnv}).length === 0, 'migrate allowed with both flags');
check(executionBlockers(preview, {execute: true}, {built: {...local.config}, env: ownerEnv}).some(b => /자리 값/.test(b)), 'placeholder build blocked');
check(executionBlockers(preview, {execute: true}, {built: null, env: ownerEnv}).some(b => /먼저 빌드/.test(b)), 'missing build blocked');
check(executionBlockers(preview, {execute: true}, {built, env: {...ownerEnv, CLOUDFLARE_ACCOUNT_ID: ''}}).some(b => /CLOUDFLARE_ACCOUNT_ID/.test(b)), 'account id required');
check(executionBlockers(preview, {execute: true}, {built, env: {...ownerEnv, CF_D1_DATABASE_ID: '11111111-1111-4111-8111-111111111111'}}).some(b => /다릅니다/.test(b)), 'stale build blocked');
check(executionBlockers(buildCommand('bundle-check'), {}, {built: null, env: {}}).length === 0, 'local bundle check never blocked');
const sitesBuilt = {name: 'site-creator-vinext-starter', vars: {}, triggers: {}, d1_databases: [{binding: 'DB', database_id: '00000000-0000-4000-8000-000000000000'}], r2_buckets: [{binding: 'BUCKET', bucket_name: 'site-creator-r2'}], observability: {enabled: true}};
check(builtProblems(sitesBuilt).some(p => /AUTH_MODE/.test(p)) && builtProblems(sitesBuilt).some(p => /triggers/.test(p)), 'sites build is not a workers build');
check(builtProblems({...local.config, main: 'index.js'}).length === 0, 'local workers build passes non-strict check');
const upload = parseUploadOutput(`Uploaded collective (3.1 sec)\nWorker Version ID: ${ID}\nVersion Preview URL: https://abcd1234-collective.owner.workers.dev\n`);
check(upload.versionId === ID && upload.previewUrl === 'https://abcd1234-collective.owner.workers.dev', 'upload output parsed');
check(parseUploadOutput('nothing').versionId === undefined, 'no id when absent');

// 요청 경계
const legacy = guardRequest(new Request('https://app.example.com/api/workspace'), {AUTH_MODE: 'legacy'});
check('response' in legacy && legacy.response.status === 503, 'legacy mode closed with 503');
check('response' in guardRequest(new Request('https://app.example.com/'), undefined), 'missing env closed');
const spoofed = guardRequest(new Request('https://app.example.com/api/workspace', {headers: {'OAI-Authenticated-User-Id': 'victim', 'oai-authenticated-user-email': 'v@x', 'oai-sites-authorization': 'Bearer g', 'cookie': 'a=1'}}), {AUTH_MODE: 'email'});
check('request' in spoofed && !spoofed.request.headers.has('oai-authenticated-user-id') && !spoofed.request.headers.has('oai-authenticated-user-email'), 'spoofable GPT headers removed');
check(spoofed.request.headers.get('oai-sites-authorization') === 'Bearer g' && spoofed.request.headers.get('cookie') === 'a=1', 'other headers kept');
const plain = new Request('https://app.example.com/api/version/public');
check(guardRequest(plain, {AUTH_MODE: 'email'}).request === plain, 'clean request passes untouched');
const body = guardRequest(new Request('https://app.example.com/api/auth', {method: 'POST', body: '{"a":1}', headers: {'oai-authenticated-user-id': 'x'}}), {AUTH_MODE: 'email'});
check(body.request.method === 'POST' && await body.request.text() === '{"a":1}', 'body preserved when headers stripped');

// 예약 tick
check(cronEnabled({INTERNAL_CRON: '1'}) && !cronEnabled({INTERNAL_CRON: '0'}) && !cronEnabled({}) && !cronEnabled(undefined), 'INTERNAL_CRON=1 only');
check(CRON_QUEUES.join(',') === 'scheduled_runs,digest,storefront_pull,pos_pull,measurement,growth_daily' && !CRON_QUEUES.includes('research'), 'cron queues exclude worker-only queues');
check(/status='active'/.test(ACTIVE_OWNERS_SQL) && /LIMIT \d+/.test(ACTIVE_OWNERS_SQL), 'owners query bounded to active accounts');
const calls = [];
const fakeLocks = {acquire: async key => { calls.push(['acquire', key]); if (key.startsWith('busy')) throw Object.assign(new Error('busy'), {status: 409}); return 'tok-' + key; }, release: async (key, token) => { calls.push(['release', key, token]); }};
const errors = [];
const results = await runInternalCron({
 owners: ['busy', 'a'],
 ...fakeLocks,
 queuesFor: async () => ({research: async () => { calls.push(['research']); return {status: 'processed'}; }, growth_daily: async o => { calls.push(['growth_daily', o]); return {status: 'processed'}; }, digest: async () => { throw new Error('boom'); }, scheduled_runs: undefined, measurement: async o => { calls.push(['measurement', o]); return {status: 'idle'}; }}),
 onError: queue => errors.push(queue),
});
check(results[0].status === 'busy' && !calls.some(c => c[0] === 'release' && c[1] === 'busy' + CRON_LOCK_SUFFIX), 'busy owner skipped without release');
check(calls.some(c => c[0] === 'acquire' && c[1] === 'a:research-worker'), 'same lock key as worker tick');
check(results[1].status === 'ran' && results[1].queues.map(q => q.queue).join(',') === 'digest,measurement,growth_daily', 'queues in fixed order, undefined skipped');
check(results[1].queues[0].status === 'error' && errors.includes('digest') && results[1].queues[2].status === 'processed', 'queue failure does not stop later queues');
check(!calls.some(c => c[0] === 'research'), 'worker-only queue never runs from cron');
check(calls.some(c => c[0] === 'release' && c[1] === 'a:research-worker' && c[2] === 'tok-a:research-worker'), 'lock released with its token');
let clock = 0;
const deferred = await runInternalCron({owners: ['x', 'y'], ...fakeLocks, queuesFor: async () => { clock += 30000; return {}; }, now: () => clock, budgetMs: 20000});
check(deferred[0].status === 'ran' && deferred[1].status === 'deferred', 'budget defers remaining owners');
const failing = await runInternalCron({owners: ['z'], acquire: async () => 't', release: async () => { throw new Error('release'); }, queuesFor: async () => { throw new Error('flags'); }, onError: q => errors.push(q)});
check(failing[0].status === 'error' && errors.includes('queues') && errors.includes('release'), 'queue setup and release failures recorded');

// 빌드 설정·진입점 정합(정적)
const vite = readFileSync('vite.config.ts', 'utf8');
check(/\.\.\.\(target === "sites" \? \[sites\(\{ mockAuth: !managedLinux \}\)\] : \[\]\)/.test(vite), 'Sites login plugin only on sites target');
check(/config: target === "sites" \? localBindingConfig : workersConfig\(\)/.test(vite) && /main: "vinext\/server\/fetch-handler"/.test(vite), 'sites binding config unchanged');
const entry = readFileSync('deploy/worker-entry.ts', 'utf8'), route = readFileSync('app/api/research-worker/route.ts', 'utf8');
check(CRON_QUEUES.every(q => entry.includes(`${q}:`)), 'entry wires every cron queue');
for (const fn of ['runDigestQueue', 'runGrowthDaily', 'runStorefrontPulls', 'runPosPulls', 'collectDueMeasurements', 'scheduledRunsQueue']) check(entry.includes(`{${fn}}`) && route.includes(`{${fn}}`), `entry and worker route share ${fn}`);
check(/import handler from 'vinext\/server\/fetch-handler'/.test(entry) && /scheduled\(/.test(entry), 'entry delegates fetch and adds scheduled');

console.log(JSON.stringify({passed}));
