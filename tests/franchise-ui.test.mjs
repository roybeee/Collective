// 트랙 R 가맹 모집 화면(app/franchise-*.tsx): 화면 모듈이 내보낸 순수 계산(시각 변환·요청 번호·재시도·오류 필드 보존·증빙 요청 모양)을 불러 확인하고,
// 개인정보 취급 규칙(콘솔·브라우저 저장소 없음, 자동 완성 끔, 연락처 보기 60초, 광고성 정보 동의 기본 없음, 역할별 노출)은 원문 검사로 고정한다.
// 근거: mocked(fetch 대역, 화면 부품·react는 이름만 있는 대역). 실제 브라우저 렌더링은 not_run(Playwright는 이번 게이트 밖).
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';

let fetchImpl=async()=>{throw new Error('fetch not set')};
const context=createContext({console,URL,URLSearchParams,Date,Intl,TextEncoder,crypto:globalThis.crypto,setTimeout,clearTimeout,fetch:(...args)=>fetchImpl(...args)}),cache=new Map();
const transpile=file=>ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function importedNames(code){
 const names=new Map(),file=ts.createSourceFile('m.js',code,ts.ScriptTarget.ES2022,false,ts.ScriptKind.JS);
 for(const s of file.statements){if(!ts.isImportDeclaration(s))continue;const spec=s.moduleSpecifier.text,set=names.get(spec)||new Set(),clause=s.importClause;if(clause?.name)set.add('default');const bound=clause?.namedBindings;if(bound&&ts.isNamedImports(bound))for(const e of bound.elements)set.add((e.propertyName||e.name).text);names.set(spec,set)}
 return names;
}
function moduleFor(file){file=resolve(file);if(cache.has(file))return cache.get(file);const code=transpile(file),m=new SourceTextModule(code,{context,identifier:file});m.imports=importedNames(code);cache.set(file,m);return m}
const stub=names=>new SyntheticModule([...names],function(){for(const n of names)this.setExport(n,()=>null)},{context});
// 실제로 불러오는 것: lib 모듈 전부(순수 계산)와 가맹 화면의 공용·상세 모듈. 그 밖(화면 부품·react·아이콘·계정 문맥)은 대역이다.
const REAL_APP=new Set(['./franchise-common','./franchise-lead-detail']);
function target(spec,from){
 if(spec.startsWith('@/lib/'))return resolve(spec.slice(2))+'.ts';
 if(spec.startsWith('.')&&(from.includes('/lib/')||REAL_APP.has(spec))){const base=resolve(dirname(from),spec);return existsSync(base+'.ts')?base+'.ts':base+'.tsx'}
 return null;
}
async function load(file){
 const m=moduleFor(file);
 if(m.status==='unlinked')await m.link((spec,ref)=>{const t=target(spec,ref.identifier);return t?moduleFor(t):stub(ref.imports.get(spec)||new Set())});
 if(m.status!=='evaluated')await m.evaluate();return m.namespace;
}
const common=await load('app/franchise-common.tsx'),detail=await load('app/franchise-lead-detail.tsx'),lib=await load('lib/franchise.ts');
const plain=v=>JSON.parse(JSON.stringify(v));
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const acheck=async(name,fn)=>{try{await fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const reply=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});

// ── 1) 시각 입력 ──
check('now sends the server-time literal',()=>assert.equal(common.timeOf(common.NOW),'now'));
check('a KST wall-clock time is sent with +09:00',()=>{assert.equal(common.timeOf({now:false,local:'2026-09-25T10:30'}),'2026-09-25T10:30:00+09:00');assert.equal(common.timeOf({now:false,local:'2026-09-25T10:30:15'}),'2026-09-25T10:30:15+09:00');assert.equal(common.timeOf({now:false,local:''}),'')});
check('date-only fields are KST midnight instants',()=>{assert.equal(common.kstDate('2027-09-24'),'2027-09-24T00:00:00+09:00');assert.equal(common.kstDate(''),'')});
check('display times are KST',()=>{assert.equal(common.kst('2026-09-25T05:00:13.157Z'),'2026-09-25 14:00 KST');assert.equal(common.kst(null),'-')});

// ── 2) 쓰기 요청: 요청 번호·재시도·오류 필드 ──
await acheck('a network failure is retried once with the same request id',async()=>{
 const bodies=[];let n=0;
 fetchImpl=async(url,init)=>{bodies.push({url,body:JSON.parse(init.body),method:init.method});if(++n===1)throw new TypeError('network');return reply(200,{ok:true,result:{leadId:'x'}})};
 const r=await common.franchisePost('update_task',{brandId:'fr-a',leadId:'x',version:3,task:{timingBand:'3m_6m'}});
 assert.equal(r.status,200);assert.equal(bodies.length,2);assert.equal(bodies[0].url,'/api/franchise');assert.equal(bodies[0].method,'POST');
 assert.deepEqual(bodies[0].body,bodies[1].body);assert.equal(bodies[0].body.action,'update_task');assert.match(bodies[0].body.requestId,/^[A-Za-z0-9_-]{8,64}$/);
});
await acheck('each user action gets a new request id',async()=>{
 const ids=[];fetchImpl=async(url,init)=>{ids.push(JSON.parse(init.body).requestId);return reply(200,{ok:true})};
 await common.franchisePost('claim_lead',{brandId:'fr-a'});await common.franchisePost('claim_lead',{brandId:'fr-a'});
 assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
});
await acheck('HTTP errors are not retried and keep gate fields',async()=>{
 let n=0;const gate={error:'지금은 이 단계로 진행할 수 없습니다. 사유를 확인해 주세요.',reasons:[{code:'contract_too_early',message:'계약 가능 시각 전입니다. 대기기간이 지나야 계약을 기록할 수 있습니다.'}],warnings:[{code:'holiday_calendar_unverified',message:'공휴일 목록이 없거나 해당 연도를 포함하지 않아 주말만 반영했습니다.'}],earliestContractAt:'2026-10-13T00:00:00+09:00',disclaimer:'COLLECTIVE 휴리스틱 · 법률 자문 아님',window:{at:'2026-10-13T00:00:00+09:00'}};
 fetchImpl=async()=>{n++;return reply(409,gate)};
 const r=await common.franchisePost('record_contract',{brandId:'fr-a',leadId:'x',version:1,signedAt:'now'});
 assert.equal(n,1);assert.equal(r.status,409);
 const p=plain(common.problemOf(r));
 assert.deepEqual(p,{error:gate.error,reasons:gate.reasons,warnings:gate.warnings,window:gate.window,earliestContractAt:gate.earliestContractAt,disclaimer:gate.disclaimer});
});
await acheck('a duplicate keeps only the existing system code',async()=>{
 fetchImpl=async()=>reply(409,{error:'이미 등록된 연락처입니다. 기존 리드 코드를 확인해 주세요.',duplicateOf:{systemCode:'LKB728BT'}});
 const p=plain(common.problemOf(await common.franchisePost('create_lead',{brandId:'fr-a'})));
 assert.deepEqual(p,{error:'이미 등록된 연락처입니다. 기존 리드 코드를 확인해 주세요.',duplicateOf:{systemCode:'LKB728BT'}});
});
await acheck('two network failures return a Korean error without a third try',async()=>{
 let n=0;fetchImpl=async()=>{n++;throw new TypeError('offline')};
 const r=await common.franchisePost('purge',{brandId:'fr-a'});
 assert.equal(n,2);assert.equal(r.status,0);assert.match(r.body.error,/네트워크 오류/);
});
await acheck('reads go to /api/franchise with query parameters and surface the server message',async()=>{
 const urls=[];fetchImpl=async url=>{urls.push(url);return reply(403,{error:'대표·관리자만 할 수 있습니다.'})};
 await assert.rejects(common.franchiseGet({view:'settings',brandId:'fr-a'}),e=>e.message==='대표·관리자만 할 수 있습니다.'&&e.status===403);
 assert.equal(urls[0],'/api/franchise?view=settings&brandId=fr-a');
});

// ── 3) 증빙 요청 모양(서버 whitelist와 같은 키, 자유 입력 없음) ──
const hand=detail.evidenceRequest(detail.blankEvidence('delivery'));
check('a hand delivery sends only the whitelisted keys',()=>{
 assert.equal(hand.action,'record_delivery');
 assert.deepEqual(Object.keys(hand.payload).sort(),['deliveredAt','doc','evidence','method','versionId']);
 assert.equal(hand.payload.deliveredAt,'now');assert.deepEqual(Object.keys(hand.payload.evidence),['hand']);
 assert.deepEqual(Object.keys(hand.payload.evidence.hand).sort(),Object.keys(lib.HAND_EVIDENCE_LABELS).sort());
 assert.ok(hand.times.every(t=>t.now),'now needs no backdate reason');
});
check('an electronic delivery with a past receipt needs a backdate reason',()=>{
 const f={...detail.blankEvidence('delivery'),method:'electronic',received:true,receivedAt:{now:false,local:'2026-09-20T09:00'},printable:true};
 const r=detail.evidenceRequest(f);
 assert.deepEqual(plain(r.payload.evidence),{electronic:{channel:'email',receivedAt:'2026-09-20T09:00:00+09:00',printable:true}});
 assert.ok(r.times.some(t=>!t.now));
});
check('a draft delivery carries the template id and no version id',()=>{
 const r=detail.evidenceRequest({...detail.blankEvidence('delivery'),doc:'draft',templateId:'ct-1',method:'certified_mail',receiptConfirmed:true});
 assert.equal(r.payload.templateId,'ct-1');assert.ok(!('versionId' in r.payload));assert.deepEqual(plain(r.payload.evidence),{certifiedMail:{receiptConfirmed:true}});
});
check('an escrow fee always sends agreementAt (null when not recorded)',()=>{
 const r=detail.evidenceRequest(detail.blankEvidence('fee'));
 assert.equal(r.action,'record_fee');assert.deepEqual(plain(r.payload),{category:'a_join',paidAt:'now',escrow:{institutionType:'bank',firstDepositAt:'now',agreementAt:null}});
});
check('an insurance fee sends KST date instants and no escrow',()=>{
 const r=detail.evidenceRequest({...detail.blankEvidence('fee'),paid:false,proof:'insurance',coverageFrom:'2026-09-01',coverageTo:'2027-08-31'});
 assert.deepEqual(plain(r.payload),{category:'a_join',insurance:{coverageFrom:'2026-09-01T00:00:00+09:00',coverageTo:'2027-08-31T00:00:00+09:00'}});assert.equal(r.times.length,0);
});
check('advice maps unknown answers to null and has no evidence times',()=>{
 const r=detail.evidenceRequest({...detail.blankEvidence('advice'),advisedOn:'2026-09-24',hqPaid:'no'});
 assert.deepEqual(plain(r.payload),{advisorType:'franchise_consultant',registrationVerified:false,advisedOn:'2026-09-24',targetDoc:'disclosure',hqPaid:false,hqReferred:null});assert.equal(r.times.length,0);
});
check('a correction sends supersedes with its reason, and the hash and storage label when given',()=>{
 const r=detail.evidenceRequest({...detail.blankEvidence('forecast'),docSha256:'a'.repeat(64),storageLabel:'본사 문서함',supersedes:'fd-1',correctionReason:'typo'});
 assert.deepEqual(plain(r.payload),{docSha256:'a'.repeat(64),storageLabel:'본사 문서함',supersedes:'fd-1',correctionReason:'typo',providedAt:'now'});
});
check('no evidence request carries a contact or free-text field',()=>{
 for(const type of Object.keys(lib.EVIDENCE_TYPE_LABELS)){const text=JSON.stringify(detail.evidenceRequest(detail.blankEvidence(type)).payload);for(const k of ['"name"','"phone"','"email"','"memo"','"note"'])assert.ok(!text.includes(k),type+' '+k)}
});
check('revealed phone and email become tel: and mailto: links, names and memos do not',()=>{
 assert.equal(detail.contactHref('phone','010-0000-0101'),'tel:01000000101');assert.equal(detail.contactHref('email','lead.one@example.com'),'mailto:lead.one@example.com');
 assert.equal(detail.contactHref('email','a+b?x@example.com'),'mailto:a%2Bb%3Fx@example.com');assert.equal(detail.contactHref('name','김가상'),null);assert.equal(detail.contactHref('memo','가상'),null);
});
check('erasure and reopen messages follow the server result',()=>{
 assert.equal(detail.eraseDone({alreadyErased:false,closedRequestIds:['sr-1']}),'연락처·메모·중복 키를 삭제했습니다. 삭제 요청 1건을 완료로 기록했습니다.');
 assert.equal(detail.eraseDone({alreadyErased:true,closedRequestIds:['sr-2']}),'이미 삭제된 연락처입니다. 삭제 요청 1건을 완료로 기록했습니다.');
 assert.equal(detail.eraseDone({alreadyErased:false,closedRequestIds:[]}),'연락처·메모·중복 키를 삭제했습니다.');
 assert.equal(detail.reopenDone({recheck:{ok:true}}),'리드를 다시 열었습니다.');
 assert.match(detail.reopenDone({recheck:{ok:false,reasons:[{message:'예상매출액 산정서 서면 제공 기록이 필요합니다.'}]}}),/^리드를 다시 열었습니다\. 지금 설정으로 다시 판정하면 막힙니다: 예상매출액 산정서 서면 제공 기록이 필요합니다\. \(COLLECTIVE 휴리스틱 · 법률 자문 아님\)$/);
});
check('lead lines show masked values or the contact state only',()=>{
 assert.equal(detail.contactLine({contact:{name:'김*상',phone:'***-****-0101',email:'l***@example.com',hasPhone:true,hasEmail:true},contactState:'present'}),'김*상 · ***-****-0101');
 assert.equal(detail.contactLine({contact:{name:'김*상',phone:'***-****-0101',email:'l***@example.com',hasPhone:true,hasEmail:true},contactState:'present'},true),'김*상 · ***-****-0101 · l***@example.com');
 assert.equal(detail.contactLine({contact:null,contactState:'erased'}),'삭제됨');
 assert.equal(detail.assigneeLabel({assigneeId:null,assignedToMe:false},[]),'담당 없음');assert.equal(detail.assigneeLabel({assigneeId:'u-2',assignedToMe:false},[{id:'u-2',label:'staff@test.invalid'}]),'staff@test.invalid');
});

// ── 4) 원문 검사: 개인정보 취급·역할·스위치·면책 ──
const files=readdirSync('app').filter(x=>/^franchise.*\.tsx$/.test(x)).map(x=>'app/'+x),src=Object.fromEntries(files.map(f=>[f,readFileSync(f,'utf8')]));
const panel=src['app/franchise-panel.tsx'],lead=src['app/franchise-lead-detail.tsx'],settings=src['app/franchise-settings.tsx'],shared=src['app/franchise-common.tsx'];
check('the four franchise screen modules exist',()=>assert.deepEqual(files.sort(),['app/franchise-common.tsx','app/franchise-lead-detail.tsx','app/franchise-panel.tsx','app/franchise-settings.tsx']));
check('franchise screens never log or keep values in browser storage',()=>{for(const [f,s] of Object.entries(src))for(const bad of ['console.','localStorage','sessionStorage','indexedDB','document.cookie','history.pushState','location.search'])assert.ok(!s.includes(bad),f+' '+bad)});
check('every contact input turns autofill off',()=>{
 const inputs=[...panel.matchAll(/<(?:Input|Textarea)[^>]*value=\{(?:f\.(?:name|phone|email|memo)|phone|email)\}[^>]*>/g),...lead.matchAll(/<(?:Input|Textarea)[^>]*value=\{f\.(?:name|phone|email|memo)\}[^>]*>/g)].map(m=>m[0]);
 assert.equal(inputs.length,10,'create 4 + find 2 + contact edit 4');for(const i of inputs)assert.ok(i.includes('autoComplete="off"'),i);
});
check('revealed values are cleared after 60 seconds and the log is explained',()=>{assert.ok(lead.includes('const REVEAL_MS=60000;'));assert.ok(lead.includes('setTimeout(()=>setValues(null),REVEAL_MS)'));assert.ok(lead.includes('열람 목적과 항목이 기록에 남습니다.'));assert.ok(lead.includes("{can(lead,'reveal_contact')&&<RevealBox key={lead.version}"))});
check('marketing consent is off by default and only owner/admin record it',()=>{assert.match(panel,/const blankCreate:CreateForm=\{[^;]*marketing:false/);assert.ok(panel.includes("...(admin&&f.marketing?{marketing:{status:'given'"));assert.ok(panel.includes("{admin?<fieldset className=\"field\"><legend>광고성 정보 수신 동의"));assert.ok(lead.includes("lead.marketingOptions.includes('given')"))});
check('the default collection basis is an inquiry response',()=>assert.match(panel,/basis:'inquiry_response'/));
check('owner/admin-only sections are gated',()=>{assert.ok(panel.includes('{admin&&<TabsTrigger value="settings">설정</TabsTrigger>}'));assert.ok(panel.includes("const shown:FranchiseTab=tab==='settings'&&!admin?'leads':tab;"));assert.ok(lead.includes('{admin&&lead.gate&&<GateCard'));assert.ok(lead.includes('{admin&&lead.evidence&&<EvidenceSection'));
 assert.ok(panel.includes('{admin&&keyReady&&<Button variant="outline" onClick={()=>setDialog(\'export\')}>'));assert.ok(panel.includes('{admin&&<Button variant="outline" disabled={busy} onClick={purge}>'))});
check('buttons follow the server allow-lists',()=>{for(const a of ['reveal_contact','update_task','update_contact','claim_lead','assign_lead','reopen_lead','record_source_notice','add_subject_request','erase_lead','void_evidence','record_delivery'])assert.ok(lead.includes(`can(lead,'${a}')`),a);assert.ok(lead.includes('lead.allowedMoves.filter('))});
check('the switch off hides lead registration and claiming and shows the banner',()=>{assert.ok(panel.includes("canCreate=enabled&&keyReady&&intake?.profileBranch==='A'"));assert.ok(panel.includes("enabled&&l.assigneeId===null&&l.contactState==='present'"));assert.ok(panel.includes('{status&&!enabled&&<p className="notice" role="note">{OFF_BANNER}</p>}'))});
check('a missing key or branch shows the fixed Korean text',()=>{assert.ok(panel.includes('FRANCHISE_ERRORS.KEY_MISSING.text'));assert.ok(panel.includes('FRANCHISE_ERRORS.BRANCH_BLOCKED.text:UNDETERMINED_BANNER'))});
check('gate problems show reasons, the earliest contract time and the disclaimer',()=>{assert.ok(shared.includes("계약 가능 시각: {kstLabel(p.earliestContractAt??null)??'아직 계산할 수 없습니다'}"));assert.ok(shared.includes('{p.disclaimer||GATE_DISCLAIMER}'));assert.ok(panel.includes('{GATE_DISCLAIMER} · {CONTACT_NOTE}'));assert.ok(lead.includes("<b>{w.atKst??'아직 계산할 수 없습니다'}</b></p><Disclaimer/>"))});
check('a duplicate shows the existing lead code',()=>assert.ok(shared.includes('이미 등록된 연락처입니다. 기존 리드 코드: ${p.duplicateOf.systemCode')));
check('erasure, export and purge are confirmed and explained',()=>{assert.ok(lead.includes("export const ERASE_CONFIRM='연락처·메모·중복 키를 지우고 되돌릴 수 없습니다. 단계·증빙 기록은 남습니다.'"));assert.ok(panel.includes('내보내기는 목적과 건수가 감사 기록에 남습니다.'));assert.ok(panel.includes('disabled={busy||!purpose}'));assert.ok(panel.includes("window.confirm('보존 기한(COLLECTIVE 휴리스틱 H11)"))});
check('settings explain the SME certificate, the contract draft and the latest disclosure',()=>{assert.ok(settings.includes('중소기업 확인서를 받기 전에는 모름으로 두세요.'));assert.ok(settings.includes('서명한 계약서가 아닙니다.'));assert.ok(settings.includes('등록된 최신 정보공개서의 파일 해시와 등록일·유효 기간을 입력합니다.'));assert.ok(settings.includes('파일은 올리지 않고 해시만 저장합니다.'))});
check('the board search sends only a code prefix or a region and points phones and emails to the audited finder',()=>{assert.ok(panel.includes("if(!isBoardQuery(q)){setQuery('');setProblem({error:SEARCH_HINT});return}"));assert.ok(panel.includes('전화·이메일은 ‘연락처로 찾기’를 쓰세요'))});
check('to-do chips filter the board',()=>{assert.ok(panel.includes("onClick={()=>setFilters({...filters,todo:filters.todo===key?'':key})}"));assert.ok(panel.includes("for(const k of ['stage','assignee','source','q','todo'] as const)"))});
check('the requests tab hides a second erasure for an erased lead and words the result from the server',()=>{assert.ok(panel.includes("erased=row.leadContactState==='erased'"));assert.ok(panel.includes('삭제 완료로 기록'));assert.ok(!panel.includes("'연락처·메모·중복 키를 삭제하고 요청을 완료로 기록했습니다.'"))});
check('settings offer a reasoned correction for disclosure versions and templates and an inclusive end date',()=>{assert.ok(settings.includes("run('amend_disclosure_version'"));assert.ok(settings.includes("run('amend_contract_template'"));assert.ok(settings.includes('유효 기간 끝 (이날까지 유효)'));assert.ok(settings.includes('정정 사유'))});
check('revealed contacts are tappable links',()=>assert.ok(lead.includes('<a href={href}>{v}</a>')));
check('franchise screens make no legal-compliance claim',()=>{for(const [f,s] of Object.entries(src))for(const bad of ['법적으로 적합','준수 완료','합법'])assert.ok(!s.includes(bad),f+' '+bad)});
console.log(JSON.stringify({passed},null,2));
