// 사실 근거 상태(스위치 fact_evidence_state, 마케팅 스킬 이식 P3): 확인(confirmed+document 또는 basis 없음)·진술(confirmed+statement)·미확인(후보·만료).
// 해석은 원장에 저장하지 않는다. 스위치가 꺼져 있거나 basis가 없으면 사실 JSON·근거 컨텍스트·역할 입력 바이트가 이전과 같아야 한다.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더 주입, 합성 사실). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async url=>{throw new Error('외부 호출 금지: '+url)});
const server=await rt.load('lib/server.ts'),facts=await rt.load('lib/brand-facts.ts'),ctx=await rt.load('lib/ai-context.ts'),factsServer=await rt.load('lib/brand-facts-server.ts');
const flags=await rt.load('lib/feature-flags.ts'),confidence=await rt.load('lib/evidence-confidence.ts'),instruction=await rt.load('lib/role-instruction.ts'),agency=await rt.load('lib/agency.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const owner='fes-owner',by={id:'owner-account',email:null},admin={id:'admin-1',email:null,role:'owner'};
await server.seedBrands(owner);
const now=Date.now(),past=new Date(now-60000).toISOString(),future=new Date(now+86400000).toISOString();
const fact=(id,extra={})=>({id,brandId:'oda',key:id,value:id+' 값',status:'confirmed',source:'점주 확인',verifiedAt:past,validUntil:future,version:1,updatedAt:past,...extra});
// 행 순서(updated_at)를 고정해 바이트 비교가 쓰기 시각에 흔들리지 않게 한다.
const order=new Map();const put=f=>{if(!order.has(f.id))order.set(f.id,'2026-01-01T00:00:0'+order.size+'.000Z');rt.sql.prepare('INSERT OR REPLACE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:brand_fact:${f.id}`,owner,'brand_fact','oda',JSON.stringify(f),order.get(f.id))};
const strip=f=>Object.fromEntries(Object.entries(f).filter(([k])=>k!=='basis'&&k!=='speaker'));

// (1) 순수 판정: 상태 셋과 라벨. 해석은 상태가 아니다.
check('labels are exactly 확인·진술·미확인 (해석 is never a stored state)',JSON.stringify(facts.FACT_EVIDENCE_LABELS)===JSON.stringify({confirmed:'확인',statement:'진술',unconfirmed:'미확인'}));
check('confirmed without basis is 확인',facts.factEvidenceState(fact('a'),now)==='confirmed');
check('confirmed + document is 확인',facts.factEvidenceState(fact('a',{basis:'document'}),now)==='confirmed');
check('confirmed + statement is 진술',facts.factEvidenceState(fact('a',{basis:'statement',speaker:'대표'}),now)==='statement');
check('candidate is 미확인',facts.factEvidenceState(fact('a',{status:'candidate'}),now)==='unconfirmed');
check('expired confirmed is 미확인',facts.factEvidenceState(fact('a',{validUntil:past}),now)==='unconfirmed');
check('rejected has no evidence state',facts.factEvidenceState(fact('a',{status:'rejected'}),now)===null);
check('statement quote uses 는 after a vowel-final speaker',facts.statementQuote({speaker:'대표',value:'매일 아침 반죽한다'})==='대표는 "매일 아침 반죽한다"라고 말한다');
check('statement quote uses 은 after a consonant-final speaker',facts.statementQuote({speaker:'점장',value:'주말이 붐빈다'})==='점장은 "주말이 붐빈다"라고 말한다');
check('basis values are only document and statement',facts.isFactBasis('document')&&facts.isFactBasis('statement')&&!facts.isFactBasis('interpretation')&&!facts.isFactBasis(''));

// (2) 근거 컨텍스트: 스위치가 꺼져 있으면 basis가 있어도 basis를 뺀 원장과 바이트가 같다.
const ledger=[fact('hours'),fact('origin',{basis:'statement',speaker:'대표',value:'매일 아침 반죽한다'}),fact('address',{basis:'document'}),fact('popular',{status:'candidate',source:'',verifiedAt:'',validUntil:'',value:'동네 1위'}),fact('oven',{status:'rejected',value:'화덕'})];
for(const f of ledger)put(f);
const campaign={id:'',brandId:'oda'};
const offWithBasis=await ctx.evidenceContext(rt.env.DB,owner,campaign);
for(const f of ledger)put(strip(f));
const offWithout=await ctx.evidenceContext(rt.env.DB,owner,campaign);
check('flag off: evidence context with basis equals the context without basis (bytes)',JSON.stringify(offWithBasis)===JSON.stringify(offWithout));
check('flag off: the statement still counts as a confirmed fact (pre-P3 behaviour)',offWithBasis.facts.confirmed.length===3&&!('statements' in offWithBasis.facts));
// 스위치를 켜도 basis를 기록한 사실이 범위에 없으면 바이트가 같다.
await flags.setFeatureFlag(owner,{flag:'fact_evidence_state',enabled:true},by);
const onWithout=await ctx.evidenceContext(rt.env.DB,owner,campaign);
check('flag on but no basis recorded: context bytes are unchanged',JSON.stringify(onWithout)===JSON.stringify(offWithout));
for(const f of ledger)put(f);
const on=await ctx.evidenceContext(rt.env.DB,owner,campaign);
check('flag on: the statement is not a confirmed fact',on.facts.confirmed.length===2&&!on.facts.confirmed.some(f=>f.key==='origin'));
check('flag on: confirmed items carry the 확인 label',on.facts.confirmed.every(f=>f.evidenceState==='확인'));
check('flag on: candidates carry the 미확인 label',on.facts.candidate.length===1&&on.facts.candidate.every(f=>f.evidenceState==='미확인'));
const st=on.facts.statements?.[0];
check('flag on: the statement is listed separately as quoted speech only',on.facts.statements?.length===1&&st.evidenceState==='진술'&&st.quote==='대표는 "매일 아침 반죽한다"라고 말한다'&&!('value' in st)&&/인용/.test(st.use)&&/수치·날짜·횟수/.test(st.use));
check('flag on: prohibited facts are unchanged',JSON.stringify(on.facts.prohibited)===JSON.stringify(offWithout.facts.prohibited));
check('flag on: fact refs (change detection) are the same as with the flag off',JSON.stringify(on.factRefs)===JSON.stringify(offWithBasis.factRefs));
check('flag on: the evidence summary does not count the statement as a confirmed fact',ctx.evidenceSummary(on).confirmedFacts===2);
const explicitOff=await ctx.evidenceContext(rt.env.DB,owner,campaign,{factEvidenceState:false});
check('explicit option false overrides the stored flag (bytes equal to flag off)',JSON.stringify(explicitOff)===JSON.stringify(offWithBasis));
await flags.setFeatureFlag(owner,{flag:'fact_evidence_state',enabled:false},by);

// (3) 역할 입력: 꺼짐이면 basis가 있어도 없을 때와 바이트가 같다.
const brand=agency.brands?.find?.(b=>b.id==='oda')??(await server.readRecord(owner,'brand','oda'));
const c={id:'c1',brandId:'oda',title:'합성',goal:'합성 목표',version:1,status:'draft'};
const req=evidence=>({role:'content',campaign:c,brand,archive:{},evidence,learning:[],previous:[]});
check('flag off: role input bytes with basis equal those without basis',instruction.buildRoleInput(req(offWithBasis))===instruction.buildRoleInput(req(offWithout)));
check('flag on: role input carries the labels',/"evidenceState":"진술"/.test(instruction.buildRoleInput(req(on))));

// (4) 근거 단계: 진술 항목은 확정 사실 건수에 넣지 않는다. statementKeys가 없으면 결과가 같다.
const text='매장은 오전 9시에 엽니다(확정 사실 hours). 대표는 반죽을 직접 한다고 말합니다(확정 사실 origin).';
const base=confidence.evidenceConfidence(text,{factKeys:['hours','origin']});
check('without statementKeys the result is unchanged',JSON.stringify(confidence.evidenceConfidence(text,{factKeys:['hours','origin'],statementKeys:[]}))===JSON.stringify(base));
const excluded=confidence.evidenceConfidence(text,{factKeys:['hours','origin'],statementKeys:['origin']});
check('a statement key does not count as a confirmed fact',base.counts.confirmedFacts===2&&excluded.counts.confirmedFacts===1&&excluded.counts.cited===base.counts.cited);

// (5) 저장: 꺼짐이면 basis 입력은 409, 없으면 JSON에 키가 없다. 켜면 진술은 말한 사람이 필요하고 해석은 저장하지 않는다.
const save=(data,extra={})=>factsServer.saveBrandFact(owner,{data:{brandId:'oda',status:'confirmed',source:'사업자 등록증',verifiedAt:past,validUntil:future,...data},confirmed:true,...extra},admin);
await assert.rejects(()=>save({key:'k-off',value:'v',basis:'document'}),e=>e.status===409);passed.push('flag off: a basis input is a 409');
const plain=await save({key:'k-plain',value:'v'});
check('flag off: saved fact JSON has no basis or speaker key',!('basis' in plain.fact)&&!('speaker' in plain.fact));
await flags.setFeatureFlag(owner,{flag:'fact_evidence_state',enabled:true},by);
await assert.rejects(()=>save({key:'k-st',value:'v',basis:'statement'}),e=>e.status===400);passed.push('flag on: a statement without a speaker is a 400');
await assert.rejects(()=>save({key:'k-int',value:'v',basis:'interpretation'}),e=>e.status===400);passed.push('flag on: interpretation is never stored (400)');
const stated=await save({key:'k-st',value:'v',basis:'statement',speaker:'대표'});
check('flag on: statement and speaker are saved',stated.fact.basis==='statement'&&stated.fact.speaker==='대표');
const doc=await save({key:'k-doc',value:'v',basis:'document',speaker:'무시'});
check('flag on: a document basis drops the speaker',doc.fact.basis==='document'&&!('speaker' in doc.fact));
const kept=await factsServer.saveBrandFact(owner,{id:stated.id,version:stated.version,data:{brandId:'oda',key:'k-st',value:'v',status:'confirmed',source:'사업자 등록증',verifiedAt:past,validUntil:future},confirmed:true},admin);
check('omitting basis on edit keeps the previous basis',kept.fact.basis==='statement'&&kept.fact.speaker==='대표');
const moved=await factsServer.saveBrandFact(owner,{id:kept.id,version:kept.version,data:{brandId:'oda',key:'k-st',value:'v',status:'confirmed',source:'사업자 등록증',verifiedAt:past,validUntil:future,basis:'document'},confirmed:true},admin);
check('changing a confirmed fact from statement to document affects publications',moved.affectsPublications===true&&moved.fact.basis==='document');
const cleared=await factsServer.saveBrandFact(owner,{id:moved.id,version:moved.version,data:{brandId:'oda',key:'k-st',value:'v',status:'confirmed',source:'사업자 등록증',verifiedAt:past,validUntil:future,basis:null},confirmed:true},admin);
check('basis null clears the basis key',!('basis' in cleared.fact)&&!('speaker' in cleared.fact));
check('the GET overview flag reports evidenceState only when the switch is on',await factsServer.factEvidenceStateEnabled(owner)===true);
await flags.setFeatureFlag(owner,{flag:'fact_evidence_state',enabled:false},by);
check('the GET overview flag is off by default',await factsServer.factEvidenceStateEnabled(owner)===false);

console.log(JSON.stringify({passed:passed.length,checks:passed},null,1));
