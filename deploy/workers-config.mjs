// Cloudflare Workers 직접 배포 설정 만들기(I1, docs/INFRA-WORKERS.ko.md).
// deploy/wrangler.workers.jsonc 템플릿의 ${NAME}·${NAME:-기본값} 자리표시자를 환경변수로 채운다.
// vite.config.ts(DEPLOY_TARGET=workers 빌드)와 scripts/deploy-workers.mjs가 같이 쓴다. 파일 읽기 외에는 순수 함수다.
import {readFileSync} from 'node:fs';

export const DEPLOY_TARGETS = Object.freeze(['sites', 'workers']);
export const TEMPLATE_PATH = new URL('./wrangler.workers.jsonc', import.meta.url);
// 소유자 계정에 배포할 때 반드시 채워야 하는 값. 로컬·CI 빌드는 아래 LOCAL_FALLBACK으로 채운다(원격에 쓰이지 않는 자리 값).
export const REQUIRED_ENV = Object.freeze(['CF_D1_DATABASE_ID', 'CF_R2_BUCKET', 'AUTH_ORIGIN']);
const LOCAL_FALLBACK = Object.freeze({
 CF_D1_DATABASE_ID: '00000000-0000-4000-8000-000000000000',
 CF_R2_BUCKET: 'collective-r2-local',
});
const PLACEHOLDER = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @param {string|undefined} value @returns {'sites'|'workers'} */
export function deployTarget(value) {
 const target = value === undefined || value === '' ? 'sites' : value;
 if (!DEPLOY_TARGETS.includes(target)) throw new Error(`DEPLOY_TARGET은 sites 또는 workers여야 합니다(받은 값: ${target}).`);
 return /** @type {'sites'|'workers'} */ (target);
}

/** JSONC의 // · 블록 주석을 지운다. 문자열 안의 // (URL 등)는 남긴다. @param {string} text */
export function stripJsonComments(text) {
 let out = '', inString = false, escaped = false;
 for (let i = 0; i < text.length; i++) {
  const char = text[i], next = text[i + 1];
  if (inString) {
   out += char;
   if (escaped) escaped = false;
   else if (char === '\\') escaped = true;
   else if (char === '"') inString = false;
  } else if (char === '"') {
   inString = true;
   out += char;
  } else if (char === '/' && next === '/') {
   while (i < text.length && text[i] !== '\n') i++;
   out += '\n';
  } else if (char === '/' && next === '*') {
   i += 2;
   while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
   i++;
  } else out += char;
 }
 return out;
}

function substitute(value, env, strict, missing) {
 return value.replace(PLACEHOLDER, (_, name, fallback) => {
  const given = env[name];
  if (typeof given === 'string' && given !== '') return given;
  if (fallback !== undefined) return fallback;
  missing.add(name);
  return strict ? '' : LOCAL_FALLBACK[name] ?? '';
 });
}

function fill(node, env, strict, missing) {
 if (typeof node === 'string') return substitute(node, env, strict, missing);
 if (Array.isArray(node)) return node.map(item => fill(item, env, strict, missing));
 if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, fill(item, env, strict, missing)]));
 return node;
}

/** 채운 설정의 형식 문제를 모은다(빈 목록이면 통과). */
export function configProblems(config) {
 const problems = [];
 const vars = config.vars ?? {};
 if (vars.AUTH_MODE !== 'email') problems.push('vars.AUTH_MODE는 email이어야 합니다(Workers 직접 배포에는 Sites 로그인 앞단이 없다).');
 if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.name ?? '')) problems.push(`Worker 이름 형식이 맞지 않습니다: ${config.name}`);
 const db = (config.d1_databases ?? []).find(item => item.binding === 'DB');
 if (!db) problems.push('D1 바인딩 DB가 없습니다.');
 else if (!UUID.test(db.database_id ?? '')) problems.push('CF_D1_DATABASE_ID는 D1 UUID 형식이어야 합니다.');
 const bucket = (config.r2_buckets ?? []).find(item => item.binding === 'BUCKET');
 if (!bucket?.bucket_name) problems.push('R2 바인딩 BUCKET의 버킷 이름이 없습니다.');
 if (vars.AUTH_ORIGIN !== undefined) {
  let ok = false;
  try { const url = new URL(vars.AUTH_ORIGIN); ok = url.protocol === 'https:' && url.origin === vars.AUTH_ORIGIN; } catch { ok = false; }
  if (!ok) problems.push('AUTH_ORIGIN은 끝 / 없는 정확한 https origin이어야 합니다.');
 }
 if (!['0', '1'].includes(vars.INTERNAL_CRON ?? '0')) problems.push('INTERNAL_CRON은 0 또는 1이어야 합니다.');
 if (!(config.triggers?.crons ?? []).every(cron => typeof cron === 'string' && cron.trim().split(/\s+/).length === 5)) problems.push('triggers.crons는 5필드 cron 식이어야 합니다.');
 return problems;
}

/**
 * 템플릿 텍스트를 환경변수로 채운다. strict(소유자 배포)면 빠진 필수값을 빈 값으로 두고 missing으로 알린다.
 * strict가 아니면(로컬·CI 빌드) 빠진 값을 원격에 쓰이지 않는 자리 값으로 채운다. 빈 vars 값(AUTH_ORIGIN 등)은 뺀다.
 * @returns {{config: Record<string, any>, missing: string[], problems: string[]}}
 */
export function renderWorkersConfig(templateText, env = {}, {strict = false} = {}) {
 const missing = new Set();
 const filled = fill(JSON.parse(stripJsonComments(templateText)), env, strict, missing);
 const vars = Object.fromEntries(Object.entries(filled.vars ?? {}).filter(([, value]) => value !== ''));
 const config = {...filled, vars};
 return {config, missing: [...missing].sort(), problems: configProblems(config)};
}

/** 디스크의 템플릿을 읽어 채운다. */
export function readWorkersConfig(env = process.env, options = {}) {
 return renderWorkersConfig(readFileSync(TEMPLATE_PATH, 'utf8'), env, options);
}
