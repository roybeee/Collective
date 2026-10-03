// 상품 리서치 출처 레지스트리 경계(lib/product-research/sources.ts + collectors/*). docs/PRODUCT-RESEARCH-PLAN.ko.md 3절, 루브릭 ⑫.
// 검사 1(정적): 수집기 파일이 부르는 https 호스트는 모두 레지스트리의 api·licensed 출처 hosts 안에 있고, manual 출처 ID는 자동 수집 파일에 나오지 않으며,
//               네트워크는 http.ts의 fetchSourceJson 한 곳에서만, 레지스트리 확인 뒤에만 나간다. passed · 정적
// 검사 2(실행): assertAutoFetch가 manual·internal·자동 수집 꺼진 출처와 등록 밖 호스트를 던진다. 가져오기 해석기는 manual·licensed만 받는다. passed · mocked(fetch 미호출)
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const reg=await rt.load('lib/product-research/sources.ts');
const types=await rt.load('lib/product-research/types.ts');
const c=await rt.load('lib/product-research/collectors/index.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const SOURCES=JSON.parse(JSON.stringify(reg.SOURCES));
const ids=JSON.parse(JSON.stringify(types.SOURCE_IDS));
const byId=new Map(SOURCES.map(s=>[s.id,s]));

// ── 레지스트리 자체 ──
check(ids.length===SOURCES.length&&ids.every(id=>byId.has(id)),'every source id has exactly one registry entry');
const manual=SOURCES.filter(s=>s.method==='manual'),internal=SOURCES.filter(s=>s.method==='internal');
check(manual.length===3&&manual.every(s=>s.autoFetch===false&&s.hosts.length===0),'manual sources: autoFetch false, no hosts');
check(internal.every(s=>s.autoFetch===false&&s.hosts.length===0),'internal sources: autoFetch false, no hosts');
check(SOURCES.filter(s=>s.method==='api').every(s=>s.autoFetch&&s.hosts.length>0),'api sources: autoFetch with fixed hosts');
const allowedHosts=new Set(SOURCES.filter(s=>s.method==='api'||s.method==='licensed').flatMap(s=>s.hosts));
check(SOURCES.every(s=>s.hosts.every(h=>/^[a-z0-9.-]+$/.test(h)&&!h.includes('/'))),'registry hosts are bare host names');

// ── assertAutoFetch ──
const throws=(fn,name)=>{assert.throws(fn,undefined,name);passed++};
for(const s of [...manual,...internal])throws(()=>reg.assertAutoFetch(s.id,'www.coupang.com'),`assertAutoFetch throws for ${s.method} source ${s.id}`);
for(const s of manual)throws(()=>reg.assertAutoFetch(s.id,''),`assertAutoFetch throws for ${s.id} even with empty host`);
throws(()=>reg.assertAutoFetch('licensed_ranking','api.vendor.example'),'assertAutoFetch throws for licensed source until a contract registers a host');
throws(()=>reg.assertAutoFetch('naver_shop_search','evil.example.com'),'assertAutoFetch throws for unregistered host');
throws(()=>reg.assertAutoFetch('naver_searchad_keyword','openapi.naver.com'),'assertAutoFetch throws for a host registered to a different source');
throws(()=>reg.assertAutoFetch('youtube_data','www.googleapis.com.evil.example'),'assertAutoFetch throws for suffix-spoofed host');
throws(()=>reg.assertAutoFetch('not_a_source','openapi.naver.com'),'assertAutoFetch throws for unknown source');
for(const s of SOURCES.filter(s=>s.method==='api'))for(const h of s.hosts){reg.assertAutoFetch(s.id,h);passed++}
check(JSON.stringify([...reg.IMPORTABLE_SOURCES].sort())===JSON.stringify(['coupang_ranking_manual','licensed_ranking','musinsa_ranking_manual','oliveyoung_ranking_manual']),'importable sources are manual + licensed only');

// ── 수집기 정적 검사 ──
const DIR='lib/product-research/collectors';
const files=readdirSync(DIR).filter(f=>f.endsWith('.ts')).sort();
const src=new Map(files.map(f=>[f,readFileSync(`${DIR}/${f}`,'utf8')]));
const code=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:'"`])\/\/.*$/gm,'$1');// 주석 제거(문자열 속 https://는 남긴다)
check(['http.ts','naver-searchad.ts','naver-datalab.ts','naver-shop.ts','youtube.ts','coupang-partners.ts','imports.ts','quota.ts','index.ts'].every(f=>src.has(f)),'all collector files present');
const hostsUsed=new Map();
for(const [f,s] of src)for(const m of s.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g))hostsUsed.set(m[1],[...(hostsUsed.get(m[1])??[]),f]);
check(hostsUsed.size>=4,'scanner found the collector host literals');
const stray=[...hostsUsed].filter(([h])=>!allowedHosts.has(h));
assert.deepEqual(stray,[],'수집기에 레지스트리 밖 호스트가 있습니다: '+JSON.stringify(stray));passed++;
check(!files.some(f=>/http:\/\//.test(code(src.get(f)))),'no plain http:// literal in collectors');
const manualIds=manual.map(s=>s.id);
const fetchers=files.filter(f=>f!=='imports.ts');
for(const f of fetchers){
 const hits=manualIds.filter(id=>src.get(f).includes(id));
 assert.deepEqual(hits,[],`${f}가 manual 출처 ID를 참조합니다: ${hits.join(', ')}`);passed++;
}
// 자동 수집 파일이 쓰는 출처 ID 문자열은 모두 자동 수집이 허용된 api 출처다(quota.ts·index.ts는 ID 문자열이 youtube_data뿐이다).
for(const f of fetchers)for(const id of ids)if(new RegExp(`'${id}'`).test(code(src.get(f)))){assert.ok(byId.get(id).method==='api'&&byId.get(id).autoFetch,`${f}: ${id}는 자동 수집 출처가 아닙니다`);passed++}
check(!/\bfetch\s*\(|fetchSourceJson|https:\/\//.test(code(src.get('imports.ts'))),'imports.ts has no network path');
const directFetch=files.filter(f=>/\bfetch\s*\(/.test(code(src.get(f))));
assert.deepEqual(directFetch,[],'수집기가 fetch를 직접 부릅니다: '+directFetch.join(', '));passed++;
const http=code(src.get('http.ts'));
check(http.indexOf('assertAutoFetch(')>0&&http.indexOf('assertAutoFetch(')<http.indexOf('await call('),'http.ts checks the registry before calling fetch');
check(/redirect:'manual'/.test(http)&&/AbortSignal\.timeout\(/.test(http)&&/readBoundedText\(/.test(http),'http.ts: manual redirect, timeout, bounded read');
for(const f of ['naver-searchad.ts','naver-datalab.ts','naver-shop.ts','youtube.ts','coupang-partners.ts']){
 const s=code(src.get(f));
 check(/fetchSourceJson\(/.test(s)&&/const [A-Z_]+_BASE='https:\/\/[a-z0-9.-]+[a-z0-9/]*'/.test(s),`${f}: calls through fetchSourceJson with a fixed https base constant`);
}
// 공개 함수 시그니처에 url·host 매개변수가 없다(사용자 URL을 받지 않는다).
for(const f of fetchers){
 const sigs=[...code(src.get(f)).matchAll(/export async function \w+\(([^)]*)\)/g)].map(m=>m[1]);
 if(f==='http.ts')continue;
 check(sigs.every(p=>!/\b(url|host|baseUrl|endpoint)\s*:/i.test(p)),`${f}: exported collectors take no url/host parameter`);
}

// ── 실행 검사: 레지스트리 관문과 가져오기 출처 ──
let fetched=0;
const deps={fetch:async()=>{fetched++;return new Response('{}')},now:()=>new Date('2026-10-03T00:00:00Z')};
for(const s of [...manual,...internal,byId.get('licensed_ranking')]){
 for(const host of ['www.coupang.com','www.musinsa.com','www.oliveyoung.co.kr','openapi.naver.com']){
  try{await c.fetchSourceJson(s.id,`https://${host}/ranking`,{},deps,{label:s.label});assert.fail('막혀야 합니다')}catch(e){assert.equal(e.code,'not_allowed',`${s.id}@${host}`)}
  passed++;
 }
}
check(fetched===0,'blocked sources never reach fetch');
for(const s of SOURCES.filter(s=>s.method==='api'||s.method==='internal')){
 const r=JSON.parse(JSON.stringify(await c.parseImport({sourceId:s.id,fileName:'x.csv',text:'순위,상품명\n1,가\n',scope:'x',observedDate:'2026-10-01'},{now:()=>new Date('2026-10-03T00:00:00Z')})));
 check(r.ok===false,`parseImport refuses ${s.method} source ${s.id}`);
}
for(const id of reg.IMPORTABLE_SOURCES){
 const r=JSON.parse(JSON.stringify(await c.parseImport({sourceId:id,fileName:'x.csv',text:'순위,상품명\n1,가\n',scope:'x',observedDate:'2026-10-01'},{now:()=>new Date('2026-10-03T00:00:00Z')})));
 check(r.ok===true&&r.draft.method===byId.get(id).method,`parseImport accepts ${id} with registry method`);
}

console.log(JSON.stringify({passed,external:'not_called'}));
