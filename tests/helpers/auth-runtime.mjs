import {DatabaseSync} from 'node:sqlite';
import {SourceTextModule, SyntheticModule, createContext} from 'node:vm';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {webcrypto} from 'node:crypto';
import * as nodeCrypto from 'node:crypto';
import ts from 'typescript';

export function testRuntime(fetch, hooks = {}) {
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
   try { const results = statements.map(s => { const r=sql.prepare(s.query).run(...s.values); return {meta:{changes:Number(r.changes)}}; }); sql.exec('COMMIT'); return results; }
   catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
 };
 const env = {DB, AGENCY_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64')};
 const context = createContext({console, crypto: webcrypto, Response, Request, Headers, TextEncoder, TextDecoder, Uint8Array, Date, URL, AbortSignal, btoa, atob, fetch, process: {env: {NODE_ENV: 'production'}}});
 const modules = new Map();
 const envModule = new SyntheticModule(['env'], function() { this.setExport('env', env); }, {context});
 const cryptoModule = new SyntheticModule(Object.keys(nodeCrypto), function() { for(const k of Object.keys(nodeCrypto))this.setExport(k,nodeCrypto[k]); }, {context});
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
   if (spec === 'node:crypto') return cryptoModule;
   const path = spec.startsWith('@/') ? resolve(spec.slice(2)) : resolve(dirname(ref.identifier), spec);
   return moduleFor(path.endsWith('.ts') ? path : path + '.ts');
  });
  if (mod.status !== 'evaluated') await mod.evaluate();
  return mod.namespace;
 }
 return {sql, env, load};
}
