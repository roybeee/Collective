// 마케팅 스킬 이식 P0(출처 고정): 사전의 마케팅 묶음(pack 'mkt') 규칙과 확장마다 출처 기록이 있고, 『카피수업』(B06)만으로 선 규칙이 없으며,
// 출처 기록·대응표 문서에 40자가 넘는 인용이 없다. 공개 저장소라 스킬 원문·브랜드 사실·원문 행 번호도 넣지 않는다. 네트워크 호출 없음.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
async function load(path){const m=moduleFor(path);if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const {COMPLIANCE_LEXICON}=await load('lib/graders/compliance-lexicon.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};

const PROV_PATH='docs/marketing-skills/provenance.json',DOC_PATH='docs/MARKETING-SKILLS.ko.md',DRIFT='scripts/marketing-skills-drift.mjs';
check('provenance, mapping doc and drift script exist',()=>{for(const p of [PROV_PATH,DOC_PATH,DRIFT])assert.ok(existsSync(p),p)});
const provText=readFileSync(PROV_PATH,'utf8'),prov=JSON.parse(provText),doc=readFileSync(DOC_PATH,'utf8');
const mktIds=COMPLIANCE_LEXICON.rules.filter(r=>r.pack==='mkt').map(r=>r.id);
const extIds=COMPLIANCE_LEXICON.rules.filter(r=>r.extend?.pack==='mkt').map(r=>r.id);
const entry=id=>prov.rules.find(r=>r.id===id);

check('provenance pins the skill repo commit a63c6b7 at tag v1',()=>{assert.equal(prov.commit,'a63c6b73daceda3692da1300a9352f65fd5bad91');assert.equal(prov.tag,'v1');assert.equal(prov.lexiconVersion,COMPLIANCE_LEXICON.version)});
check('the mkt pack has 14 new rules and two extensions of existing rules',()=>{assert.equal(mktIds.length,14);assert.equal(JSON.stringify(extIds.toSorted()),JSON.stringify(['disease_claim','kr.ad.outcome_guarantee']))});
check('every pack:mkt rule has a provenance entry',()=>{for(const id of mktIds)assert.ok(entry(id)?.kind==='rule',id)});
check('every mkt extension of an existing rule has a provenance entry',()=>{for(const id of extIds)assert.ok(entry(id)?.kind==='extension',id)});
check('no provenance rule entry names a rule the lexicon does not have',()=>{const all=new Set(COMPLIANCE_LEXICON.rules.map(r=>r.id));for(const r of prov.rules)assert.ok(all.has(r.id),r.id)});
check('every file entry has a sha256 and lists the rule ids and prompt units derived from it',()=>{
 for(const f of prov.files){assert.match(f.sha256,/^[0-9a-f]{64}$/,f.path);assert.ok(Array.isArray(f.rules)&&Array.isArray(f.promptUnits),f.path);assert.ok(!/^\/|\.\./.test(f.path),f.path)}
 const listed=new Set(prov.files.flatMap(f=>f.rules));
 for(const id of [...mktIds,...extIds])assert.ok(listed.has(id),'file list misses '+id);
 for(const r of prov.rules)for(const p of r.files)assert.ok(prov.files.some(f=>f.path===p&&f.rules.includes(r.id)),`${r.id} → ${p}`);
});
// 근거는 LEGAL-CHECK 법령 행(legal) 또는 B06이 아닌 책(books)이어야 한다. B06만 있는 규칙은 없다.
check('no rule rests only on B06',()=>{
 for(const r of prov.rules){
  const legal=(r.legal||[]).length,books=(r.books||[]).filter(b=>b!=='B06');
  assert.ok(legal+books.length>0,`${r.id} has no basis other than B06`);
  for(const b of r.books||[])assert.match(b,/^B0[1-8]$/,r.id);
 }
});
check('law citations come from the LEGAL-CHECK row list only',()=>{
 const rows=new Set(prov.legalCheckRows);
 for(const r of prov.rules)for(const l of r.legal)assert.ok(rows.has(l.row),`${r.id}: ${l.row}`);
});
check('every mkt rule cites lexicon sources that exist and severity is block or warn',()=>{
 for(const id of mktIds){const r=COMPLIANCE_LEXICON.rules.find(x=>x.id===id);assert.ok(['block','warn'].includes(r.severity),id);for(const s of r.sources)assert.ok(COMPLIANCE_LEXICON.sources[s],`${id}: ${s}`)}
});
// 인용: 따옴표·낫표·백틱으로 감싼 한 구간이 40자를 넘으면 원문 인용으로 본다.
const QUOTED=/‘([^’\n]*)’|“([^”\n]*)”|「([^」\n]*)」|『([^』\n]*)』|"([^"\n]*)"|'([^'\n]*)'/g;
const longQuotes=text=>[...text.matchAll(QUOTED)].map(m=>m.slice(1).find(x=>x!==undefined)).filter(q=>[...q].length>40);
check('no quoted run over 40 characters in the provenance values',()=>{
 const values=[];const walk=v=>{if(typeof v==='string')values.push(v);else if(v&&typeof v==='object')Object.values(v).forEach(walk)};walk(prov);
 for(const v of values){assert.ok([...v].length<=200||/^[0-9a-f]{64}$/.test(v),'long value: '+v.slice(0,30));assert.deepEqual(longQuotes(v),[])}
});
check('no quoted run over 40 characters in the mapping doc',()=>assert.deepEqual(longQuotes(doc.replace(/```[\s\S]*?```/g,'')),[]));
// 공개 저장소: 스킬의 브랜드 이름·사업 사실·원문 행 번호를 출처 기록·문서·마케팅 규칙에 넣지 않는다.
const PRIVATE=/올드페리|OFD|ODA|맵달|MAPDAL|밀집|Dr\.\s?alan|매각|경영권|brands\.md|#L\d+|\.md:\d+/;
check('provenance, doc and mkt rule text carry no brand names, sale talk or source line numbers',()=>{
 assert.ok(!PRIVATE.test(provText),'provenance');assert.ok(!PRIVATE.test(doc),'doc');
 for(const r of COMPLIANCE_LEXICON.rules.filter(x=>x.pack==='mkt'))assert.ok(!PRIVATE.test(r.title+r.match+(r.context||'')),r.id);
});
check('the drift script is local-only: no network, no git, skips when the skill repo is absent',()=>{
 const s=readFileSync(DRIFT,'utf8');
 assert.ok(!/fetch\(|https?:\/\/|child_process|spawn|execSync/.test(s));assert.match(s,/marketing-skills/);assert.match(s,/process\.exit\(0\)/);
});

console.log(JSON.stringify({passed:passed.length}));
