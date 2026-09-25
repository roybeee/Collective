import {DatabaseSync} from 'node:sqlite';
import {SourceTextModule, SyntheticModule, createContext} from 'node:vm';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {webcrypto, createHash} from 'node:crypto';
import ts from 'typescript';

// 모의 런타임: 메모리 SQLite(drizzle 마이그레이션) + TypeScript 모듈을 vm 컨텍스트에 올린다. 공급자 호출은 넘겨받은 fetch 스텁만 쓴다.
// 테스트(tests/helpers/runtime.mjs testRuntime)와 합성 케이스 생성기(scripts/eval/synthesize.mjs)가 함께 쓴다.
// options.Date·options.crypto: 컨텍스트 안의 시각·난수를 바꾼다. 기본은 실제 Date·webcrypto이고, 생성기는 deterministicClock·deterministicCrypto를 넣는다.
export function moduleRuntime(fetch, hooks = {}, options = {}) {
 const sql = new DatabaseSync(':memory:');
 for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync('drizzle/' + f, 'utf8'));
 class Statement {
  constructor(query, values = []) { this.query = query; this.values = values; }
  bind(...values) { return new Statement(this.query, values); }
  async first() { return sql.prepare(this.query).get(...this.values) || null; }
  async all() { return {results: sql.prepare(this.query).all(...this.values)}; }
  async run() {
   hooks.beforeRun?.(this);
   const result = sql.prepare(this.query).run(...this.values);
   return {meta: {changes: Number(result.changes)}};
  }
 }
 const DB = {
  prepare: q => new Statement(q),
  batch: async statements => {
   sql.exec('BEGIN');
   try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; }
   catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
 };
 // 운영 빌드는 AUTH_MODE가 비면 닫히므로(lib/auth-session.ts authMode) 헤더 인증 스위트는 legacy를 명시한다.
 const env = {DB, AUTH_MODE: 'legacy', AGENCY_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64')};
 const processEnv = {NODE_ENV: 'production'};
 const context = createContext({console, crypto: options.crypto || webcrypto, Response, Request, Headers, TextEncoder, TextDecoder, Uint8Array, Date: options.Date || Date, URL, AbortSignal, DecompressionStream, btoa, atob, fetch, process: {env: processEnv}});
 const modules = new Map();
 const envModule = new SyntheticModule(['env'], function() { this.setExport('env', env); }, {context});
 // next/server의 after()는 응답 뒤 작업을 예약한다. 테스트는 hooks.after로 받거나 실행하지 않는다.
 const nextModule = new SyntheticModule(['after'], function() { this.setExport('after', task => hooks.after?.(task)); }, {context});
 function moduleFor(file) {
  file = resolve(file);
  if (modules.has(file)) return modules.get(file);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
  const mod = new SourceTextModule(code, {context, identifier: file});
  modules.set(file, mod); return mod;
 }
 async function load(file) {
  const mod = moduleFor(file);
  if (mod.status === 'unlinked') await mod.link((spec, ref) => {
   if (spec === 'cloudflare:workers') return envModule;
   if (spec === 'next/server') return nextModule;
   const path = spec.startsWith('@/') ? resolve(spec.slice(2)) : resolve(dirname(ref.identifier), spec);
   return moduleFor(path.endsWith('.ts') ? path : path + '.ts');
  });
  if (mod.status !== 'evaluated') await mod.evaluate();
  return mod.namespace;
 }
 return {sql, env, load, processEnv};
}

// 고정 시각: 인자 없는 new Date()·Date.now()는 시작 시각에서 호출마다 1ms씩 흐른다. 호출 순서가 같으면 값도 같다(실제 시계를 읽지 않는다).
export function deterministicClock(startIso) {
 const start = Date.parse(startIso);
 if (!Number.isFinite(start)) throw new Error('고정 시각(now)이 ISO 시각이 아닙니다: ' + startIso);
 let tick = 0;
 const next = () => start + tick++;
 return class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [next()])); }
  static now() { return next(); }
 };
}
// 결정적 난수: randomUUID·getRandomValues가 seed와 호출 순번의 SHA-256에서 나온다. subtle(암호화·해시)은 실제 구현이다.
export function deterministicCrypto(seed) {
 let n = 0;
 const bytes = size => { const out = Buffer.alloc(size); for (let at = 0; at < size; at += 32) createHash('sha256').update(`${seed}:${n++}`).digest().copy(out, at); return out; };
 return {
  subtle: webcrypto.subtle,
  getRandomValues(array) { const b = bytes(array.byteLength); new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(b); return array; },
  randomUUID() { const h = bytes(16).toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; },
 };
}
