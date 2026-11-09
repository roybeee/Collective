// Cloudflare Workers 직접 배포 도구(I1, docs/INFRA-WORKERS.ko.md). 기본은 dry-run: 원격 명령은 정확한 명령만 출력하고 실행하지 않는다.
// 실행하려면 --execute를 명시한다. D1 원격 마이그레이션은 --execute와 --yes-i-understand가 모두 있어야 한다.
//
//   node scripts/deploy-workers.mjs check [--dry-run]      설정·바인딩·AUTH_MODE·마이그레이션 목록(로컬) 점검, 번들 검사(versions upload --dry-run, 업로드 없음)
//   node scripts/deploy-workers.mjs preview [--tag T] [--message M] [--alias A] [--execute]  wrangler versions upload → 미리보기 URL(--alias면 고정 별칭 URL)
//   node scripts/deploy-workers.mjs promote <version-id> [--message M] [--execute]  wrangler versions deploy <id>@100%
//   node scripts/deploy-workers.mjs rollback [version-id] [--message M] [--execute] wrangler rollback
//   node scripts/deploy-workers.mjs migrate [--execute --yes-i-understand]        wrangler d1 migrations apply DB --remote
//
// 먼저 DEPLOY_TARGET=workers node scripts/run-framework.mjs build 로 dist/server/wrangler.json을 만든다.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {configProblems, readWorkersConfig} from '../deploy/workers-config.mjs';

export const BUILT_CONFIG = 'dist/server/wrangler.json';
export const WRANGLER = Object.freeze(['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js']);
const LOCAL_DB_ID = '00000000-0000-4000-8000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTIONS = Object.freeze(['check', 'preview', 'promote', 'rollback', 'migrate']);
const VALUE_FLAGS = new Set(['--tag', '--message', '--alias']);
const BOOL_FLAGS = new Set(['--dry-run', '--execute', '--yes-i-understand']);

/** argv(명령 뒤 인자)를 {action, positional, flags}로 읽는다. 모르는 플래그·값 없는 플래그는 오류다. */
export function parseArgs(argv) {
 const [action, ...rest] = argv;
 if (!ACTIONS.includes(action)) throw new Error(`명령은 ${ACTIONS.join('|')} 중 하나여야 합니다.`);
 const flags = {}, positional = [];
 for (let i = 0; i < rest.length; i++) {
  const arg = rest[i];
  if (BOOL_FLAGS.has(arg)) flags[arg.slice(2)] = true;
  else if (VALUE_FLAGS.has(arg)) {
   const value = rest[++i];
   if (value === undefined || value.startsWith('--')) throw new Error(`${arg}에는 값이 필요합니다.`);
   flags[arg.slice(2)] = value;
  } else if (arg.startsWith('--')) throw new Error(`모르는 플래그입니다: ${arg}`);
  else positional.push(arg);
 }
 if (flags['dry-run'] && flags.execute) throw new Error('--dry-run과 --execute는 함께 쓸 수 없습니다.');
 return {action, positional, flags};
}

function text(value, label, max) {
 if (value === undefined) return undefined;
 if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`${label}은 ${max}자 이하 한 줄이어야 합니다.`);
 return value;
}

// 별칭은 URL 첫 이름표(<별칭>-<worker>.<계정>.workers.dev)에 들어가므로 소문자·숫자·하이픈만 받는다.
function previewAlias(value) {
 if (value === undefined) return undefined;
 if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(value)) throw new Error('--alias는 소문자·숫자·하이픈 32자 이하여야 합니다.');
 return value;
}

function versionId(value, {optional = false} = {}) {
 if (value === undefined && optional) return undefined;
 if (!UUID.test(value ?? '')) throw new Error('버전 ID는 wrangler versions list에 나오는 UUID여야 합니다.');
 return value;
}

/**
 * 명령 하나를 만든다(순수). remote: Cloudflare 계정에 닿는 명령, confirm: --yes-i-understand가 더 필요한 명령.
 * @returns {{args: string[], remote: boolean, confirm: boolean}}
 */
export function buildCommand(action, {positional = [], flags = {}} = {}, config = BUILT_CONFIG) {
 const tag = text(flags.tag, '--tag', 100), message = text(flags.message, '--message', 300), alias = previewAlias(flags.alias);
 const withMessage = message ? ['--message', message] : [];
 if (action === 'preview') return {args: ['versions', 'upload', '--config', config, ...(tag ? ['--tag', tag] : []), ...withMessage, ...(alias ? ['--preview-alias', alias] : [])], remote: true, confirm: false};
 if (action === 'promote') return {args: ['versions', 'deploy', `${versionId(positional[0])}@100%`, '--yes', '--config', config, ...withMessage], remote: true, confirm: false};
 if (action === 'rollback') {
  const id = versionId(positional[0], {optional: true});
  return {args: ['rollback', ...(id ? [id] : []), '--yes', '--config', config, ...withMessage], remote: true, confirm: false};
 }
 if (action === 'migrate') return {args: ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config], remote: true, confirm: true};
 if (action === 'migrations-list') return {args: ['d1', 'migrations', 'list', 'DB', '--remote', '--config', config], remote: true, confirm: false};
 if (action === 'bundle-check') return {args: ['versions', 'upload', '--dry-run', '--config', config], remote: false, confirm: false};
 throw new Error(`명령을 만들 수 없습니다: ${action}`);
}

const quote = arg => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
/** 복사해 실행할 수 있는 셸 명령 문자열. */
export function formatCommand(args) {
 return ['node', ...WRANGLER, ...args].map(quote).join(' ');
}

/** 원격 명령을 실행해도 되는지 판단한다(순수). 막히면 이유 목록을 돌려준다. */
export function executionBlockers(command, flags, {built, env}) {
 const blockers = [];
 if (!command.remote) return blockers;
 if (!flags.execute) blockers.push('dry-run: --execute가 없어 실행하지 않았습니다.');
 if (command.confirm && !flags['yes-i-understand']) blockers.push('원격 D1을 바꾸는 명령은 --yes-i-understand가 필요합니다.');
 if (!built) blockers.push(`${BUILT_CONFIG}가 없습니다. DEPLOY_TARGET=workers로 먼저 빌드하세요.`);
 else blockers.push(...builtProblems(built, env, {strict: true}));
 if (!env.CLOUDFLARE_ACCOUNT_ID) blockers.push('CLOUDFLARE_ACCOUNT_ID가 없습니다(소유자 계정).');
 return blockers;
}

/** 빌드 결과 설정이 Workers 대상 빌드인지 본다. strict면 자리 값(로컬 D1 ID 등)도 막는다. */
export function builtProblems(built, env = {}, {strict = false} = {}) {
 const problems = configProblems(built);
 if (!built.triggers?.crons?.length) problems.push('빌드 설정에 triggers.crons가 없습니다(Sites 대상 빌드일 수 있음).');
 if (!built.secrets?.required?.length) problems.push('빌드 설정에 secrets.required가 없습니다(Sites 대상 빌드일 수 있음).');
 if (built.observability?.enabled !== true) problems.push('observability.enabled가 켜져 있지 않습니다.');
 if (strict) {
  const db = (built.d1_databases ?? []).find(item => item.binding === 'DB');
  if (!db || db.database_id === LOCAL_DB_ID) problems.push('D1 database_id가 로컬 자리 값입니다. CF_D1_DATABASE_ID를 넣고 다시 빌드하세요.');
  else if (env.CF_D1_DATABASE_ID && db.database_id !== env.CF_D1_DATABASE_ID) problems.push('빌드 설정의 D1 ID가 현재 CF_D1_DATABASE_ID와 다릅니다. 다시 빌드하세요.');
  if (!built.vars?.AUTH_ORIGIN) problems.push('vars.AUTH_ORIGIN이 없습니다. 배포 origin을 넣고 다시 빌드하세요.');
 }
 return problems;
}

/** wrangler versions upload 출력에서 버전 ID와 미리보기 URL을 찾는다. */
export function parseUploadOutput(output) {
 const id = output.match(/Worker Version ID:\s*([0-9a-f-]{36})/i)?.[1];
 const url = output.match(/Version Preview URL:\s*(https:\/\/\S+)/i)?.[1];
 const alias = output.match(/Version Preview Alias URL:\s*(https:\/\/\S+)/i)?.[1];
 return {versionId: id, previewUrl: url, aliasUrl: alias};
}

function readBuilt() {
 return existsSync(BUILT_CONFIG) ? JSON.parse(readFileSync(BUILT_CONFIG, 'utf8')) : null;
}

function runWrangler(args) {
 const run = spawnSync(process.execPath, [...WRANGLER, ...args], {encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe']});
 process.stdout.write(run.stdout ?? '');
 process.stderr.write(run.stderr ?? '');
 return {status: run.status ?? 1, output: `${run.stdout ?? ''}\n${run.stderr ?? ''}`};
}

function report(lines) {
 for (const [level, message] of lines) process.stdout.write(`${level.padEnd(5)} ${message}\n`);
}

function check(flags, env) {
 const lines = [], dry = !!flags['dry-run'];
 const {missing, problems} = readWorkersConfig(env, {strict: true});
 for (const name of missing) lines.push([dry ? 'WARN' : 'FAIL', `환경변수 ${name}가 없습니다.`]);
 for (const problem of problems) if (!missing.length || dry === false) lines.push([dry ? 'WARN' : 'FAIL', `템플릿: ${problem}`]);
 for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) lines.push([env[name] ? 'OK' : (dry ? 'WARN' : 'FAIL'), `${name} ${env[name] ? '있음(값은 출력하지 않음)' : '없음'}`]);
 const built = readBuilt();
 if (!built) lines.push(['FAIL', `${BUILT_CONFIG}가 없습니다. DEPLOY_TARGET=workers로 먼저 빌드하세요.`]);
 else {
  const issues = builtProblems(built, env, {strict: !dry});
  lines.push(...(issues.length ? issues.map(issue => ['FAIL', `빌드: ${issue}`]) : [['OK', `빌드 설정: ${built.name}, AUTH_MODE=${built.vars.AUTH_MODE}, cron ${built.triggers.crons.join(' | ')}, INTERNAL_CRON=${built.vars.INTERNAL_CRON ?? '0'}`]]));
  if (existsSync('dist/.openai')) lines.push(['FAIL', 'dist/.openai가 있습니다. Sites 플러그인이 포함된 빌드입니다.']);
 }
 const migrations = readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort();
 lines.push(['OK', `로컬 마이그레이션 ${migrations.length}개: ${migrations.join(', ')}`]);
 report(lines);
 if (built && !lines.some(([level]) => level === 'FAIL')) {
  const bundle = buildCommand('bundle-check');
  process.stdout.write(`\n번들 검사(업로드 없음): ${formatCommand(bundle.args)}\n`);
  const result = runWrangler(bundle.args);
  if (result.status !== 0) lines.push(['FAIL', '번들 검사 실패']);
 }
 const remote = buildCommand('migrations-list');
 process.stdout.write(`\n원격 마이그레이션 비교(소유자 실행): ${formatCommand(remote.args)}\n`);
 if (flags.execute) execute(remote, flags, env);
 return lines.some(([level]) => level === 'FAIL') ? 1 : 0;
}

function execute(command, flags, env) {
 const display = formatCommand(command.args);
 process.stdout.write(`명령: ${display}\n`);
 const blockers = executionBlockers(command, flags, {built: readBuilt(), env});
 if (blockers.length) {
  for (const blocker of blockers) process.stdout.write(`- ${blocker}\n`);
  return flags.execute ? 1 : 0;
 }
 const result = runWrangler(command.args);
 const parsed = parseUploadOutput(result.output);
 if (parsed.versionId) process.stdout.write(`\n버전 ID: ${parsed.versionId}\n`);
 if (parsed.previewUrl) process.stdout.write(`미리보기 URL: ${parsed.previewUrl}\n`);
 if (parsed.aliasUrl) process.stdout.write(`별칭 미리보기 URL: ${parsed.aliasUrl}\n`);
 return result.status;
}

export function main(argv, env = process.env) {
 const {action, positional, flags} = parseArgs(argv);
 if (action === 'check') return check(flags, env);
 return execute(buildCommand(action, {positional, flags}), flags, env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 process.chdir(fileURLToPath(new URL('../', import.meta.url)));
 try {
  process.exitCode = main(process.argv.slice(2));
 } catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
 }
}
