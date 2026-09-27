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
// R15a-2b 모집 자료·행사 탭: 순수 도우미를 불러 확인한다. 판정 모듈(lib/franchise-assets.ts)은 가명 코드 규칙 교차 확인에만 쓴다(화면은 import하지 않는다).
const assetsUi=await load('app/franchise-assets-panel.tsx'),eventsUi=await load('app/franchise-events-panel.tsx'),fa=await load('lib/franchise-assets.ts');
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

// ── 3b) R15a-2b 공용 추가: 텍스트 저장·복사·200 경고·요청 번호·실패 뒤 할 일 ──
// 근거: mocked(vm 문맥에 Blob·document·navigator·URL 대역을 검사 안에서만 넣는다).
await acheck('U1: saveText saves the exact server text as UTF-8 plain text without a BOM and revokes after one second',async()=>{
 const made=[],revoked=[],timers=[],clicks=[],origURL=context.URL,origTimeout=context.setTimeout;
 class StubURL extends URL{static createObjectURL(b){made.push(b);return 'blob:stub-'+made.length}static revokeObjectURL(u){revoked.push(u)}}
 const anchor={href:'',download:'',click(){clicks.push({href:this.href,download:this.download})}};
 context.URL=StubURL;context.Blob=Blob;context.setTimeout=(fn,ms)=>{timers.push([fn,ms]);return 0};context.document={createElement:tag=>{assert.equal(tag,'a');return anchor}};
 const TEXT='■ 창업비용 표 [사실]\r\n총 창업비용 · 소형 매장: 4,500만원\n끝 줄';
 try{
  common.saveText('recruitment-startup_page-fr-a-20261005-v2.txt',TEXT);
  assert.equal(made.length,1);assert.equal(made[0].type,'text/plain;charset=utf-8');
  const bytes=[...new Uint8Array(await made[0].arrayBuffer())];
  assert.deepEqual(bytes,[...new TextEncoder().encode(TEXT)],'byte-exact, CRLF kept');assert.notEqual(bytes[0],0xef,'no BOM');
  assert.deepEqual(clicks,[{href:'blob:stub-1',download:'recruitment-startup_page-fr-a-20261005-v2.txt'}]);
  assert.equal(timers.length,1);assert.equal(timers[0][1],1000);assert.deepEqual(revoked,[]);timers[0][0]();assert.deepEqual(revoked,['blob:stub-1']);
 }finally{context.URL=origURL;context.setTimeout=origTimeout;delete context.document;delete context.Blob}
});
await acheck('U2: copyText reports success, refusal and a missing clipboard without throwing',async()=>{
 const written=[];
 try{
  context.navigator={clipboard:{writeText:async t=>{written.push(t)}}};assert.equal(await common.copyText('가\r\n나'),true);assert.deepEqual(written,['가\r\n나']);
  context.navigator={clipboard:{writeText:async()=>{throw new Error('NotAllowedError')}}};assert.equal(await common.copyText('x'),false);
  context.navigator={};assert.equal(await common.copyText('x'),false);
  delete context.navigator;assert.equal(await common.copyText('x'),false);
 }finally{delete context.navigator}
});
check('U3: stringWarnings keeps only string warnings from a 200 body',()=>{
 assert.deepEqual(plain(common.stringWarnings({status:200,body:{ok:true,warnings:['설명회에 덱이 없습니다.',{code:'x',message:'y'},3,null,'둘째 경고']}})),['설명회에 덱이 없습니다.','둘째 경고']);
 assert.deepEqual(plain(common.stringWarnings({status:200,body:{ok:true}})),[]);assert.deepEqual(plain(common.stringWarnings({status:200,body:{warnings:'문자열'}})),[]);
});
check('U4: attemptId reuses the id only for the same key',()=>{
 assert.match(common.attemptId(null,'k1'),/^[A-Za-z0-9_-]{8,64}$/);
 assert.equal(common.attemptId({id:'rq-keep-000001',key:'k1'},'k1'),'rq-keep-000001');
 assert.notEqual(common.attemptId({id:'rq-keep-000001',key:'k1'},'k2'),'rq-keep-000001');
 assert.notEqual(common.attemptId(null,'k1'),common.attemptId(null,'k1'));
});
await acheck('U4: sendAttempt keeps the request id only when no response arrived and the content is the same',async()=>{
 const ids=[];let mode='offline';
 fetchImpl=async(url,init)=>{ids.push(JSON.parse(init.body).requestId);if(mode==='offline')throw new TypeError('offline');return reply(mode==='ok'?200:409,mode==='ok'?{ok:true,result:{}}:{error:'x'})};
 const payload={brandId:'fr-a',eventId:'re-1',code:null},key=JSON.stringify(['event_register',payload]);
 const first=await common.sendAttempt('event_register',payload,null);
 assert.equal(first.r.status,0);assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(first.next.id,ids[0]);assert.equal(first.next.key,key);
 mode='ok';const second=await common.sendAttempt('event_register',payload,first.next);
 assert.equal(second.r.status,200);assert.equal(ids[2],ids[0],'the same content after no response reuses the id');assert.equal(second.next,null);
 const third=await common.sendAttempt('event_register',payload,second.next);assert.notEqual(ids[3],ids[0],'after a response a new id');assert.equal(third.next,null);
 mode='offline';await common.sendAttempt('event_register',{...payload,code:'LKB728BT'},first.next);assert.notEqual(ids[4],ids[0],'changed content gets a new id');
 mode='conflict';const got=await common.sendAttempt('event_register',payload,{id:'rq-keep-000002',key});assert.equal(ids.at(-1),'rq-keep-000002');assert.equal(got.r.status,409);assert.equal(got.next,null,'a received error drops the attempt');
});
// 교차 검토 F4: 5xx도 받은 응답이다(명세 3절 3–4단계는 status 0만 같은 번호). JSON 500과 본문을 못 읽는 게이트웨이 502 모두 시도를 버리고 같은 내용의 다음 전송은 새 번호를 쓴다.
await acheck('U4: a received 5xx (JSON 500 or non-JSON 502) drops the attempt and the same content gets a new id',async()=>{
 const ids=[];let mode='json500';
 fetchImpl=async(url,init)=>{ids.push(JSON.parse(init.body).requestId);return mode==='json500'?reply(500,{error:'가상 서버 오류'}):{status:502,ok:false,json:async()=>{throw new SyntaxError('Unexpected token <')}}};
 const payload={brandId:'fr-a',eventId:'re-1',code:'LKB728BT'};
 const a=await common.sendAttempt('event_register',payload,null);assert.equal(a.r.status,500);assert.equal(ids.length,1,'a received 500 is not resent');assert.equal(a.next,null,'500 drops the attempt');
 mode='html502';const b=await common.sendAttempt('event_register',payload,a.next);assert.equal(b.r.status,502);assert.notEqual(ids[1],ids[0],'a new id after a 500');assert.equal(b.next,null,'502 drops the attempt');assert.match(b.r.body.error,/응답을 읽지 못했습니다/);
 const c=await common.sendAttempt('event_register',payload,b.next);assert.equal(ids.length,3);assert.notEqual(ids[2],ids[1],'a new id after a non-JSON 502');assert.equal(c.next,null);
});
check('U5: followUpOf maps responses to keep, status, close and reload',()=>{
 const E=lib.FRANCHISE_ERRORS,f=(status,body={})=>common.followUpOf({status,body});
 assert.deepEqual([f(0,{error:'네트워크 오류'}),f(400,{error:E.PII_IN_TEXT.text}),f(429,{error:'요청이 많습니다.'}),f(500,{error:'x'}),f(503,{error:E.KEY_MISSING.text})],['keep','keep','keep','keep','keep']);
 assert.equal(f(403,{error:E.ADMIN_ONLY.text}),'status');assert.equal(f(404,{error:E.ASSET_NOT_FOUND.text}),'close');assert.equal(f(404,{error:E.EVENT_NOT_FOUND.text}),'close');
 assert.equal(f(409,{error:E.OFF.text}),'status');assert.equal(f(409,{error:E.ASSET_BLOCKED.text,reasons:[{code:'switch_off',message:'m'}]}),'status');
 assert.deepEqual([f(409,{error:E.ASSET_STALE.text}),f(409,{error:'다른 작업을 저장하고 있습니다. 잠시 후 다시 시도하세요.'}),f(409,{error:E.REQUEST_REUSED.text}),f(409,{error:'x',reasons:[{code:'hash_mismatch',message:'m'}]})],['reload','reload','reload','reload']);
 assert.equal(common.errorIs({status:409,body:{error:E.ASSET_STALE.text}},'ASSET_STALE'),true);assert.equal(common.errorIs({status:409,body:{error:E.EVENT_STALE.text}},'ASSET_STALE'),false);
 assert.deepEqual(plain(common.reasonCodes({status:409,body:{reasons:[{code:'fact_changed',message:'m'},{code:'hash_mismatch',message:'n'}]}})),['fact_changed','hash_mismatch']);assert.deepEqual(plain(common.reasonCodes({status:409,body:{error:'x'}})),[]);
});

// ── 3c) 모집 자료 순수 도우미(서버 계약 지도 9절) ──
const CL_IDS=['no_wait_bypass','no_association_condition','no_captive_advisor','no_revenue_figures','h7_branch_a','endorsement_disclosure'];
const CHECKLIST={version:'fr-assets-checklist@test',items:CL_IDS.map(id=>({id,text:id+' 항목',ruleIds:[],warnings:[]})),h7Notice:null};
const OFF_NOTE='기능 스위치가 꺼져 있어 모집 자료를 저장·승인·내보내거나 게시 위치를 기록할 수 없습니다. 폐기는 할 수 있습니다.';
const H7='분기 B(문의 수집만)입니다. 가상 안내.',GONE='캠페인이 삭제돼 승인·내보내기를 할 수 없습니다. 게시 위치 기록과 폐기는 할 수 있습니다.',REVIEW='재검토가 필요합니다. 현재 사실로 새 판을 저장한 뒤 다시 승인하세요.',GATE='게이트 사유를 고친 새 판을 저장해야 합니다.',OUTDATED='체크리스트가 바뀌었습니다. 새 판으로 저장해 다시 승인해야 내보낼 수 있습니다.';
const EXP={at:'2026-10-01T15:30:00.000Z',by:'u-admin',role:'admin'},APPROVAL={by:'u-admin',role:'admin',at:'2026-10-01T15:00:00.000Z',bodyHash:'a'.repeat(64),checklist:{version:'fr-assets-checklist@test',checked:CL_IDS}};
const assetRec=(o={})=>({id:'ra-1',campaignId:'ca-a',type:'startup_page',version:3,body:'원문',bodyHash:'a'.repeat(64),factRefs:[],status:'draft',approval:null,placements:[],exports:[],review:{needed:false,reasons:[],at:null},source:null,savedBy:{id:'u-member',role:'member'},exportCount:0,updatedAt:'2026-10-05T03:00:00.000Z',...o});
const detailOf=(o={},a={})=>({asset:assetRec(a),latestVersion:3,versions:[{version:3,status:a.status??'draft'}],drift:[],resaveSuggested:false,gate:{status:200,reasons:[],message:null,warnings:[]},checklist:CHECKLIST,campaign:{id:'ca-a',title:'가상 가맹 모집 A'},branch:'A',h7Notice:null,enabled:true,disclaimer:'COLLECTIVE 휴리스틱 · 법률 자문 아님',...o});
const approved={status:'approved',approval:APPROVAL};
const G=(showApprove,canApprove,showExport,canExport,canPlace,canRetire,canEdit,canResave,blockers=[])=>({showApprove,canApprove,showExport,canExport,canPlace,canRetire,canEdit,canResave,blockers});
const GATE_CASES=[
 ['owner/admin, latest draft, gate 200, branch A',detailOf(),true,G(true,true,false,false,false,true,true,false)],
 ['member, latest draft',detailOf(),false,G(false,false,false,false,false,false,true,false)],
 ['owner/admin, latest approved, no export yet',detailOf({},approved),true,G(false,false,true,true,false,true,true,false)],
 ['owner/admin, latest approved and exported',detailOf({},{...approved,exports:[EXP]}),true,G(false,false,true,true,true,true,true,false)],
 ['owner/admin, 20 placements',detailOf({},{...approved,exports:[EXP],placements:Array.from({length:20},(_,i)=>({label:'위치 '+i,confirmedAt:'2026-10-02'}))}),true,G(false,false,true,true,false,true,true,false)],
 ['member, latest approved and exported',detailOf({},{...approved,exports:[EXP]}),false,G(false,false,false,false,false,false,true,false)],
 ['owner/admin, retired latest with a resave suggestion',detailOf({resaveSuggested:true},{status:'retired',retiredAt:'2026-10-04T00:00:00.000Z'}),true,G(false,false,false,false,false,false,false,false)],
 ['owner/admin, old draft version',detailOf({resaveSuggested:true},{version:2}),true,G(false,false,false,false,false,true,false,false)],
 ['owner/admin, old approved version with an export can still record a placement',detailOf({},{...approved,version:2,exports:[EXP]}),true,G(false,false,false,false,true,true,false,false)],
 ['owner/admin, switch off, latest draft',detailOf({enabled:false,resaveSuggested:true}),true,G(true,false,false,false,false,true,false,false,[OFF_NOTE])],
 ['owner/admin, switch off, approved and exported',detailOf({enabled:false},{...approved,exports:[EXP]}),true,G(false,false,true,false,false,true,false,false,[OFF_NOTE])],
 ['member, switch off',detailOf({enabled:false,resaveSuggested:true}),false,G(false,false,false,false,false,false,false,false)],
 ['owner/admin, branch B',detailOf({branch:'B',h7Notice:H7}),true,G(true,false,false,false,false,true,true,false,[H7])],
 ['owner/admin, campaign deleted: no edit (a save could only fail with campaign_other_brand)',detailOf({campaign:null}),true,G(true,false,false,false,false,true,false,false,[GONE])],
 ['member, campaign deleted: no edit either',detailOf({campaign:null}),false,G(false,false,false,false,false,false,false,false)],
 ['owner/admin, campaign deleted with a resave suggestion: no resave',detailOf({campaign:null,resaveSuggested:true}),true,G(true,false,false,false,false,true,false,false,[GONE])],
 ['owner/admin, review needed',detailOf({resaveSuggested:true},{review:{needed:true,reasons:['fact_changed'],at:'2026-10-04T00:00:00.000Z'}}),true,G(true,false,false,false,false,true,true,true,[REVIEW])],
 ['owner/admin, gate 409',detailOf({gate:{status:409,reasons:[{code:'hard_block',message:'막힘'}],message:'막힘',warnings:[]}}),true,G(true,false,false,false,false,true,true,false,[GATE])],
 ['owner/admin, approved under an older checklist',detailOf({},{...approved,approval:{...APPROVAL,checklist:{version:'fr-assets-checklist@old',checked:CL_IDS}}}),true,G(false,false,true,false,false,true,true,true,[OUTDATED])],
 ['member, approved under an older checklist can resave',detailOf({},{...approved,approval:{...APPROVAL,checklist:{version:'fr-assets-checklist@old',checked:CL_IDS}}}),false,G(false,false,false,false,false,false,true,true)],
 ['every blocker in order',detailOf({enabled:false,branch:'C',h7Notice:H7,campaign:null,gate:{status:409,reasons:[],message:null,warnings:[]}},{review:{needed:true,reasons:['version_changed'],at:null}}),true,G(true,false,false,false,false,true,false,false,[OFF_NOTE,H7,GONE,REVIEW,GATE])],
 ['owner/admin, approved latest, branch B: no export',detailOf({branch:'B',h7Notice:H7},approved),true,G(false,false,true,false,false,true,true,false,[H7])],
 ['owner/admin, approved and exported latest, campaign deleted: placement and retire only',detailOf({campaign:null},{...approved,exports:[EXP]}),true,G(false,false,true,false,true,true,false,false,[GONE])],
 ['owner/admin, approved latest, review needed: resave instead of export',detailOf({resaveSuggested:true},{...approved,review:{needed:true,reasons:['fact_changed'],at:null}}),true,G(false,false,true,false,false,true,true,true,[REVIEW])],
 ['owner/admin, approved latest, gate 409: no export',detailOf({gate:{status:409,reasons:[{code:'hard_block',message:'막힘'}],message:null,warnings:[]}},approved),true,G(false,false,true,false,false,true,true,false,[GATE])],
 ['owner/admin, retired latest with exports: no placement',detailOf({},{status:'retired',approval:APPROVAL,exports:[EXP]}),true,G(false,false,false,false,false,false,false,false)],
 ['owner/admin, unknown branch without a notice adds no empty blocker',detailOf({branch:null,h7Notice:null}),true,G(true,false,false,false,false,true,true,false,[])],
 ['gate warnings alone never block approval',detailOf({gate:{status:200,reasons:[],message:null,warnings:['권장 문장이 없습니다(권장).']}}),true,G(true,true,false,false,false,true,true,false)],
];
for(const [name,view,admin,want] of GATE_CASES)check('U7: assetGates '+name,()=>assert.deepEqual(plain(assetsUi.assetGates(view,admin)),want));
check('U7: latestOf and checklistOutdated',()=>{assert.equal(assetsUi.latestOf(detailOf()),true);assert.equal(assetsUi.latestOf(detailOf({},{version:2})),false);assert.equal(assetsUi.checklistOutdated(detailOf({},approved)),false);assert.equal(assetsUi.checklistOutdated(detailOf({},{...approved,approval:{...APPROVAL,checklist:{version:'x',checked:[]}}})),true);assert.equal(assetsUi.checklistOutdated(detailOf({checklist:{...CHECKLIST,version:'y'}})),false,'a draft has no approval to outdate');
 assert.equal(assetsUi.checklistOutdated(detailOf({},{status:'retired',approval:{...APPROVAL,checklist:{version:'x',checked:[]}}})),false,'a retired version is not outdated')});
const DRIFT=[{factId:'bf-1',refVersion:1,currentVersion:2,changed:true},{factId:'bf-2',refVersion:1,currentVersion:null,changed:true},{factId:'bf-3',refVersion:4,currentVersion:4,changed:false}];
check('U8: resaveInput maps drift to current fact versions, drops missing facts and sends the latest version as base',()=>{
 assert.equal(assetsUi.resaveInput(detailOf()),null,'no suggestion');assert.equal(assetsUi.resaveInput(detailOf({resaveSuggested:true,enabled:false,drift:DRIFT})),null,'switch off');assert.equal(assetsUi.resaveInput(detailOf({resaveSuggested:true,drift:DRIFT},{version:2})),null,'old version');assert.equal(assetsUi.resaveInput(detailOf({resaveSuggested:true,drift:DRIFT,campaign:null})),null,'campaign deleted');
 const x=plain(assetsUi.resaveInput(detailOf({resaveSuggested:true,drift:DRIFT},{factRefs:[{id:'bf-1',version:1},{id:'bf-2',version:1},{id:'bf-3',version:4}]})));
 assert.deepEqual(x,{payload:{assetId:'ra-1',baseVersion:3,type:'startup_page',body:'원문',factRefs:[{id:'bf-1',version:2},{id:'bf-3',version:4}]},dropped:['bf-2']});
 assert.ok(!('source' in x.payload),'the source is inherited, not resent');
});
check('U8: approveInput sends the checked ids in view order and the target version and hash when given',()=>{
 const v=detailOf();
 assert.deepEqual(plain(assetsUi.approveInput(v,new Set(['endorsement_disclosure','no_wait_bypass','unknown_id']))),{assetId:'ra-1',version:3,bodyHash:'a'.repeat(64),checklist:{version:'fr-assets-checklist@test',checked:['no_wait_bypass','endorsement_disclosure']}});
 assert.deepEqual(plain(assetsUi.approveInput(v,new Set(CL_IDS),{version:4,bodyHash:'c'.repeat(64)})),{assetId:'ra-1',version:4,bodyHash:'c'.repeat(64),checklist:{version:'fr-assets-checklist@test',checked:CL_IDS}});
});
check('U8: approveReady needs every checklist item and ignores gate warnings',()=>{
 assert.equal(assetsUi.approveReady(detailOf(),new Set(CL_IDS)),true);assert.equal(assetsUi.approveReady(detailOf(),new Set(CL_IDS.slice(1))),false);assert.equal(assetsUi.approveReady(detailOf(),new Set()),false);
 assert.equal(assetsUi.approveReady(detailOf({checklist:{...CHECKLIST,items:[]}}),new Set()),false,'an empty checklist is not ready');
 assert.equal(assetsUi.approveReady(detailOf({gate:{status:200,reasons:[],message:null,warnings:['권장 문장이 없습니다(권장).']}}),new Set(CL_IDS)),true);
});
check('U8: placementRange runs from the first export date (KST) to today (KST)',()=>{
 assert.equal(assetsUi.placementRange(detailOf({},approved),'2026-10-05T16:00:00.000Z'),null);
 assert.deepEqual(plain(assetsUi.placementRange(detailOf({},{...approved,exports:[EXP,{...EXP,at:'2026-10-04T01:00:00.000Z'}]}),'2026-10-05T16:00:00.000Z')),{min:'2026-10-02',max:'2026-10-06'});
});
check('U9: seedOptions keeps approved artifacts of the chosen campaign, newest first, with length and change flags',()=>{
 const art=(id,campaignId,status,createdAt,x={})=>({id,campaignId,status,createdAt,version:1,title:'작업물 '+id,content:'가나다',role:'cmo',origin:'manual',...x});
 const got=assetsUi.seedOptions([art('a1','ca-a','approved','2026-10-01T00:00:00.000Z',{version:2,content:'abc',factsChanged:true}),art('a2','ca-a','draft','2026-10-04T00:00:00.000Z'),art('a3','ca-a2','approved','2026-10-04T00:00:00.000Z'),art('a4','ca-a','approved','2026-10-03T00:00:00.000Z',{content:'가나',brandChanged:true,origin:'ai'}),art('a5','ca-a','approved','2026-10-02T00:00:00.000Z',{origin:'ai_edited'})],'ca-a');
 assert.deepEqual(plain(got),[{id:'a4',version:1,title:'작업물 a4',length:2,changed:true},{id:'a5',version:1,title:'작업물 a5',length:3,changed:false},{id:'a1',version:2,title:'작업물 a1',length:3,changed:true}]);
});
const LIST={facts:[{id:'bf-1',version:2,key:'startup_cost_total',label:'총 창업비용',line:'총 창업비용: 가상',hasSource:true},{id:'bf-2',version:1,key:'x',label:'x',line:'x',hasSource:false},{id:'bf-3',version:5,key:'y',label:'y',line:'y',hasSource:true}]};
check('U8: saveInput builds a new-asset save and an edit save with baseVersion and current fact versions',()=>{
 const form={type:'portal_intro',campaignId:'ca-a',body:'본문',picked:new Set(['bf-3','bf-1','bf-gone']),source:null,base:null};
 assert.deepEqual(plain(assetsUi.saveInput(LIST,null,form)),{campaignId:'ca-a',type:'portal_intro',body:'본문',factRefs:[{id:'bf-1',version:2},{id:'bf-3',version:5}]});
 assert.deepEqual(plain(assetsUi.saveInput(LIST,null,{...form,source:{artifactId:'art-1',version:2,title:'작업물'}})).source,{artifactId:'art-1',version:2});
 const d=detailOf({latestVersion:3},{type:'startup_page'});
 assert.deepEqual(plain(assetsUi.saveInput(LIST,d,form)),{assetId:'ra-1',baseVersion:3,type:'startup_page',body:'본문',factRefs:[{id:'bf-1',version:2},{id:'bf-3',version:5}]});
 assert.equal(assetsUi.saveInput(LIST,d,{...form,base:4}).baseVersion,4,'saving on top of a newer latest version sends that version');
 assert.ok(!('campaignId' in assetsUi.saveInput(LIST,d,form)),'an edit keeps the stored campaign');
});
check('insertAt inserts at the cursor and refuses to pass 20,000 characters',()=>{
 assert.equal(assetsUi.insertAt('가나다','X',1),'가X나다');assert.equal(assetsUi.insertAt('가나다','X',99),'가나다X');assert.equal(assetsUi.insertAt('가나다','X',null),'가나다X');
 assert.equal(assetsUi.insertAt('a'.repeat(19999),'bc',0),null);assert.equal(assetsUi.insertAt('a'.repeat(19998),'bc',0).length,20000);
});
await acheck('deliverExport writes only the returned body to the file or the clipboard, and falls back to a copy box',async()=>{
 const BODY='■ 반환 원문\r\n둘째 줄',made=[],clicks=[],written=[],origURL=context.URL;
 class StubURL extends URL{static createObjectURL(b){made.push(b);return 'blob:stub'}static revokeObjectURL(){}}
 context.URL=StubURL;context.Blob=Blob;context.document={createElement:()=>({click(){clicks.push(this.download)}})};
 try{
  const down=await assetsUi.deliverExport({ok:true,body:BODY,filename:'recruitment-portal_intro-fr-a-20261005-v1.txt'},'download');
  assert.deepEqual(plain(down),{message:'내려받았습니다. 내보내기 기록 1건을 남겼습니다.',fallback:null});assert.deepEqual(clicks,['recruitment-portal_intro-fr-a-20261005-v1.txt']);assert.equal(await made[0].text(),BODY);
  context.navigator={clipboard:{writeText:async t=>{written.push(t)}}};
  assert.deepEqual(plain(await assetsUi.deliverExport({ok:true,body:BODY,filename:'f.txt'},'copy')),{message:'복사했습니다. 내보내기 기록 1건을 남겼습니다.',fallback:null});assert.deepEqual(written,[BODY]);
  context.navigator={clipboard:{writeText:async()=>{throw new Error('denied')}}};
  assert.deepEqual(plain(await assetsUi.deliverExport({ok:true,body:BODY,filename:'f.txt'},'copy')),{message:'내보내기 기록 1건을 남겼습니다.',fallback:BODY});
  assert.equal((await assetsUi.deliverExport({ok:true,body:BODY,filename:'f.txt',replayed:true},'download')).message,'같은 요청을 다시 받았습니다(내보내기 기록은 늘지 않았습니다).');
  const n=made.length;assert.equal(await assetsUi.deliverExport({ok:true,filename:'f.txt'},'download'),null);assert.equal(await assetsUi.deliverExport({ok:true,body:BODY},'copy'),null);assert.equal(made.length,n,'nothing saved without a returned body');
 }finally{context.URL=origURL;delete context.document;delete context.navigator;delete context.Blob}
});

// ── 3d) 행사 순수 도우미 ──
const EVENT=(o={})=>({id:'re-1',campaignId:'ca-a',type:'tour',typeLabel:'견학',startsAt:'2026-10-07T05:00:00.000Z',placeLabel:'가상 직영점',capacity:10,counts:{applied:3,attended:0,noShow:0},codes:[{code:'LKB728BT',state:'applied'},{code:'LKC111AA',state:'attended'},{code:'LKD222BB',state:'no_show'}],assetRefs:[],status:'scheduled',version:4,createdBy:{id:'u-admin',role:'admin'},...o});
const NOW='2026-10-05T03:00:00.000Z';
const STARTED='시작한 행사입니다. 현장 참석은 참석 기록으로 남기세요.',FULL='정원이 찼습니다.',BEFORE='참석 기록은 행사일(KST)부터 할 수 있습니다.',BRANCH='가맹 준비도 분기 A(모집 가능) 브랜드만 신청을 기록합니다.';
const EG=(canEdit,canCancel,canRegister,canAttend,registerWhy,attendWhy)=>({canEdit,canCancel,canRegister,canAttend,registerWhy,attendWhy});
const EVENT_CASES=[
 ['owner/admin, future event',EVENT(),true,true,'A',NOW,EG(true,true,true,false,null,BEFORE)],
 ['member, future event',EVENT(),false,true,'A',NOW,EG(false,false,true,false,null,BEFORE)],
 ['switch off: only cancellation',EVENT(),true,false,'A',NOW,EG(false,true,false,false,null,null)],
 ['started event: attendance, no registration',EVENT({startsAt:'2026-10-05T02:00:00.000Z'}),false,true,'A',NOW,EG(false,false,false,true,STARTED,null)],
 ['full event',EVENT({counts:{applied:10,attended:0,noShow:0}}),false,true,'A',NOW,EG(false,false,false,false,FULL,BEFORE)],
 ['branch B: no edit or registration, cancel stays',EVENT(),true,true,'B',NOW,EG(false,true,false,false,BRANCH,BEFORE)],
 ['branch B past event: attendance does not check the branch',EVENT({startsAt:'2026-10-04T02:00:00.000Z'}),false,true,'B',NOW,EG(false,false,false,true,STARTED,null)],
 ['cancelled event: nothing',EVENT({status:'cancelled'}),true,true,'A',NOW,EG(false,false,false,false,null,null)],
 ['later the same KST day: registration and attendance',EVENT({startsAt:'2026-10-05T10:00:00.000Z'}),false,true,'A',NOW,EG(false,false,true,true,null,null)],
 ['one minute before the KST event day',EVENT({startsAt:'2026-10-05T15:00:00.000Z'}),false,true,'A','2026-10-05T14:59:00.000Z',EG(false,false,true,false,null,BEFORE)],
 ['at the KST event day start',EVENT({startsAt:'2026-10-05T15:00:00.000Z'}),false,true,'A','2026-10-05T15:00:00.000Z',EG(false,false,false,true,STARTED,null)],
];
for(const [name,e,admin,enabled,branch,now,want] of EVENT_CASES)check('U12: eventGates '+name,()=>assert.deepEqual(plain(eventsUi.eventGates(e,admin,enabled,branch,now)),want));
check('U12: the switch off closes attendance even on the event day, and a started full event says it started',()=>{
 assert.equal(eventsUi.eventGates(EVENT({startsAt:'2026-10-05T02:00:00.000Z'}),false,false,'A',NOW).canAttend,false);
 assert.equal(eventsUi.eventGates(EVENT({startsAt:'2026-10-05T02:00:00.000Z',counts:{applied:10,attended:0,noShow:0}}),false,true,'A',NOW).registerWhy,STARTED);
});
check('U10: codeProblem matches the server pseudonym rule at every boundary',()=>{
 const future=new Date(Date.now()+30*86400000).toISOString(),ev={id:'re-1',brandId:'fr-a',campaignId:'ca-a',type:'tour',startsAt:future,placeLabel:'가상',capacity:100,spendRef:null,counts:{applied:0,attended:0,noShow:0},codes:[],assetRefs:[],status:'scheduled',version:1,createdAt:NOW,updatedAt:NOW};
 const server=code=>fa.registerDecision(ev,{code:code===''?null:code},{enabled:true,brandId:'fr-a',branch:'A',now:new Date().toISOString()}).ok;
 const table=[['',true],['ABCDE',false],['ABCDEF',true],['A'.repeat(64),true],['A'.repeat(65),false],['LKB 728',false],['LK.B728',false],['가나다라마바',false],['B-123-4567',false],['_1234567',false],['A1234567B',false],['LKB728BT',true],['AB-123456',true],['LK_12-3456',true]];
 for(const [code,ok] of table){assert.equal(eventsUi.codeProblem(code)===null,ok,code);assert.equal(server(code),ok,'server '+code)}
 assert.equal(eventsUi.codeProblem('B-123-4567'),'가명 코드는 영문·숫자·-·_ 6~64자입니다. 숫자 7자리 이상(전화번호 형태)은 받지 않습니다.');
});
check('U11: kstLocal round-trips through timeOf to the same instant, across the KST midnight',()=>{
 for(const iso of ['2026-10-05T14:59:00.000Z','2026-10-05T15:00:00.000Z','2026-10-05T23:30:00.000Z','2026-10-05T00:00:00+09:00'])assert.equal(Date.parse(common.timeOf({now:false,local:eventsUi.kstLocal(iso)})),Date.parse(iso),iso);
 assert.equal(eventsUi.kstLocal('2026-10-05T15:00:00.000Z'),'2026-10-06T00:00');
});
check('U12: attendanceInput checks counts and code marks and sends only non-applied codes in code order',()=>{
 const e=EVENT(),marks={LKD222BB:'no_show',LKB728BT:'applied',LKC111AA:'attended'};
 assert.deepEqual(plain(eventsUi.attendanceInput(e,'1','1',marks)),{payload:{eventId:'re-1',version:4,attended:1,noShow:1,codes:[{code:'LKC111AA',state:'attended'},{code:'LKD222BB',state:'no_show'}]},problem:null});
 assert.equal(eventsUi.attendanceInput(e,' 10 ','3',{}).payload.attended,10,'up to the capacity');
 for(const [a,n] of [['-1','0'],['1.5','0'],['','0'],['abc','0'],['0','-2']]){const x=eventsUi.attendanceInput(e,a,n,{});assert.equal(x.payload,null,a+'/'+n);assert.match(x.problem,/0 이상의 정수/)}
 const over=eventsUi.attendanceInput(e,'11','0',{});assert.equal(over.payload,null);assert.match(over.problem,/정원/);
 const noShow=eventsUi.attendanceInput(e,'0','4',{});assert.equal(noShow.payload,null);assert.match(noShow.problem,/신청 수/);
 const marked=eventsUi.attendanceInput(e,'1','0',{LKB728BT:'attended',LKC111AA:'attended',LKD222BB:'applied'});assert.equal(marked.payload,null);assert.match(marked.problem,/참석으로 표시한 코드/);
 const marked2=eventsUi.attendanceInput(e,'0','0',{LKB728BT:'applied',LKC111AA:'applied'});assert.equal(marked2.payload,null,'a code left as no-show by default still counts');assert.match(marked2.problem,/불참으로 표시한 코드/);
 assert.deepEqual(plain(eventsUi.attendanceInput(e,'0','0',{LKB728BT:'applied',LKC111AA:'applied',LKD222BB:'applied'}).payload.codes),[],'codes left as applied go back to applied');
 const reversed=EVENT({codes:[{code:'LKD222BB',state:'no_show'},{code:'LKC111AA',state:'attended'},{code:'LKB728BT',state:'applied'}]});
 assert.deepEqual(plain(eventsUi.attendanceInput(reversed,'1','1',{}).payload.codes),[{code:'LKC111AA',state:'attended'},{code:'LKD222BB',state:'no_show'}],'codes are sent in code order whatever the view order');
});
check('eventInput builds new and changed event saves with spendRef null, a number capacity and the stored campaign',()=>{
 const form={type:'briefing',campaignId:'ca-a',start:{now:false,local:'2026-10-20T14:00'},place:'  가상 직영점 ',capacity:'12',refs:[{id:'ra-1',version:2}]};
 assert.deepEqual(plain(eventsUi.eventInput(form,null)),{campaignId:'ca-a',type:'briefing',startsAt:'2026-10-20T14:00:00+09:00',placeLabel:'가상 직영점',capacity:12,spendRef:null,assetRefs:[{id:'ra-1',version:2}]});
 assert.deepEqual(plain(eventsUi.eventInput({...form,campaignId:''},EVENT())),{eventId:'re-1',version:4,campaignId:'ca-a',type:'briefing',startsAt:'2026-10-20T14:00:00+09:00',placeLabel:'가상 직영점',capacity:12,spendRef:null,assetRefs:[{id:'ra-1',version:2}]});
});
check('registerInput trims the code, sends null without one and refuses a phone-like code before sending',()=>{
 assert.deepEqual(plain(eventsUi.registerInput(EVENT(),' LKB728BT ')),{payload:{eventId:'re-1',code:'LKB728BT'},problem:null});
 assert.deepEqual(plain(eventsUi.registerInput(EVENT(),'   ')),{payload:{eventId:'re-1',code:null},problem:null});
 const bad=eventsUi.registerInput(EVENT(),'B-123-4567');assert.equal(bad.payload,null);assert.match(bad.problem,/7자리/);
});

// ── 4) 원문 검사: 개인정보 취급·역할·스위치·면책 ──
const files=readdirSync('app').filter(x=>/^franchise.*\.tsx$/.test(x)).map(x=>'app/'+x),src=Object.fromEntries(files.map(f=>[f,readFileSync(f,'utf8')]));
const panel=src['app/franchise-panel.tsx'],lead=src['app/franchise-lead-detail.tsx'],settings=src['app/franchise-settings.tsx'],shared=src['app/franchise-common.tsx'];
check('the eleven franchise screen modules exist',()=>assert.deepEqual(files.sort(),['app/franchise-assets-panel.tsx','app/franchise-common.tsx','app/franchise-events-panel.tsx','app/franchise-experiment-panel.tsx','app/franchise-import-panel.tsx','app/franchise-inflow-panel.tsx','app/franchise-lead-detail.tsx','app/franchise-next-task.tsx','app/franchise-panel.tsx','app/franchise-report-panel.tsx','app/franchise-settings.tsx']));
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
check('to-do chips filter the board',()=>{assert.ok(panel.includes("onClick={()=>setFilters({...filters,todo:filters.todo===key?'':key})}"));assert.ok(panel.includes("for(const k of ['stage','assignee','source','q','todo','inflow','qualification'] as const)"))});
check('the requests tab hides a second erasure for an erased lead and words the result from the server',()=>{assert.ok(panel.includes("erased=row.leadContactState==='erased'"));assert.ok(panel.includes('삭제 완료로 기록'));assert.ok(!panel.includes("'연락처·메모·중복 키를 삭제하고 요청을 완료로 기록했습니다.'"))});
check('settings offer a reasoned correction for disclosure versions and templates and an inclusive end date',()=>{assert.ok(settings.includes("run('amend_disclosure_version'"));assert.ok(settings.includes("run('amend_contract_template'"));assert.ok(settings.includes('유효 기간 끝 (이날까지 유효)'));assert.ok(settings.includes('정정 사유'))});
check('revealed contacts are tappable links',()=>assert.ok(lead.includes('<a href={href}>{v}</a>')));
check('franchise screens make no legal-compliance claim',()=>{for(const [f,s] of Object.entries(src))for(const bad of ['법적으로 적합','준수 완료','합법'])assert.ok(!s.includes(bad),f+' '+bad)});
// ── 5) R15a-2b 원문 고정: 가져오기 경계·내보내기 원문·파일 저장·자동 완성·확인 문구·표시 문구 없음(대표 지시 2026-09-26)·탭 연결 ──
const assetsSrc=src['app/franchise-assets-panel.tsx'],eventsSrc=src['app/franchise-events-panel.tsx'],newScreens=[['app/franchise-assets-panel.tsx',assetsSrc],['app/franchise-events-panel.tsx',eventsSrc]];
const ALLOWED_IMPORTS=new Set(['react','lucide-react','@/components/ui/button','@/components/ui/input','@/components/ui/textarea','@/components/ui/native-select','@/components/ui/dialog','@/components/ui/sheet','@/lib/franchise-rules','@/lib/client','./franchise-common','./account-context']);
function importsOf(file,text){
 const sf=ts.createSourceFile(file,text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX),out=[];
 const visit=n=>{
  if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))out.push({spec:n.moduleSpecifier.text,typeOnly:ts.isImportDeclaration(n)?!!n.importClause?.isTypeOnly:n.isTypeOnly,names:ts.isImportDeclaration(n)&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)?n.importClause.namedBindings.elements.map(e=>(e.propertyName||e.name).text):[]});
  if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(n.expression)&&n.expression.text==='require')))out.push({spec:n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0])?n.arguments[0].text:'<dynamic>',typeOnly:false,names:[]});
  ts.forEachChild(n,visit);
 };
 visit(sf);return out;
}
check('S2: the new screens import only the allowed modules (no judge code, no disclosure module, no toast)',()=>{for(const [f,s] of newScreens){const imports=importsOf(f,s);assert.ok(imports.length>0);for(const i of imports){assert.ok(ALLOWED_IMPORTS.has(i.spec),f+' '+i.spec);assert.ok(!/franchise-assets|ai-disclosure|sonner|franchise-compliance|fact-catalog|graders|brand-facts|campaign-archive|server/.test(i.spec),f+' '+i.spec)}
 for(const i of imports.filter(x=>x.spec==='@/lib/client'))assert.ok(i.typeOnly,f+' @/lib/client is type-only');for(const i of imports.filter(x=>x.spec==='@/lib/franchise-rules'))assert.ok(i.names.every(n=>['toKstDate','kstDateOf'].includes(n)),f+' franchise-rules names')}});
check('S2: the import collector sees imports, re-exports, dynamic imports and require',()=>assert.deepEqual(importsOf('x.tsx',"import type {A} from '@/lib/client';\nexport {b} from './b';\nconst c=import('@/lib/ai-disclosure');const d=require('sonner');").map(i=>i.spec),['@/lib/client','./b','@/lib/ai-disclosure','sonner']));
check('S3: exports save or copy only the body returned by the server',()=>{
 assert.ok(assetsSrc.includes("typeof b.body==='string'&&typeof b.filename==='string'"));assert.ok(assetsSrc.includes('saveText(b.filename,b.body)'));assert.ok(assetsSrc.includes('copyText(b.body)'));
 assert.deepEqual([...assetsSrc.matchAll(/saveText\([^)]*\)/g)].map(m=>m[0]),['saveText(b.filename,b.body)']);assert.deepEqual([...assetsSrc.matchAll(/copyText\([^)]*\)/g)].map(m=>m[0]),['copyText(b.body)']);
 for(const [f,s] of newScreens)assert.ok(!/saveCsv|downloadText|navigator\.clipboard/.test(s),f);
});
check('S4: saveText writes a UTF-8 text Blob without a BOM or line-ending change',()=>{const line=shared.split('\n').find(l=>l.startsWith('export function saveText('));assert.ok(line&&line.includes("new Blob([body],{type:'text/plain;charset=utf-8'})"));for(const bad of ['\\uFEFF','\\ufeff','\uFEFF','replace('])assert.ok(!line.includes(bad),bad)});
check('S5: events send spendRef null, never the literal now, and show the code hint; every text input and form turns autofill off',()=>{
 assert.ok(eventsSrc.includes('spendRef:f.spendRef||null'));assert.ok(eventsSrc.includes('allowNow={false}'));assert.ok(eventsSrc.includes("export const CODE_HINT='리드 코드(L로 시작)나 명찰 번호만. 이름·전화번호는 적지 않습니다.'"));assert.ok(eventsSrc.includes('placeholder="예: LKB728BT"'));
 for(const [f,s] of newScreens){const inputs=[...s.matchAll(/<(?:Input|Textarea)\b[^>]*>/g)].map(m=>m[0]).filter(t=>!/type="(?:number|date|datetime-local)"/.test(t)&&!/readOnly/.test(t));assert.ok(inputs.length>0,f);for(const t of inputs)assert.ok(t.includes('autoComplete="off"'),f+' '+t);for(const form of s.match(/<form\b[^>]*>/g)||[])assert.ok(form.includes('autoComplete="off"'),f+' '+form)}
 assert.ok((eventsSrc.match(/<form\b/g)||[]).length>=3&&(assetsSrc.match(/<form\b/g)||[]).length>=3,'register, attendance, event, editor, approval and placement forms');
});
check('S6: retirement and cancellation are confirmed with the fixed text',()=>{assert.ok(assetsSrc.includes('window.confirm(RETIRE_CONFIRM)'));assert.ok(eventsSrc.includes('window.confirm(CANCEL_CONFIRM)'));
 assert.ok(assetsSrc.includes("export const RETIRE_CONFIRM='이 판을 폐기합니다. 폐기한 판은 내보내거나 행사에 새로 연결할 수 없고 되돌릴 수 없습니다. 승인·내보내기·게시 기록은 증빙으로 남습니다.'"));assert.ok(eventsSrc.includes("export const CANCEL_CONFIRM='행사를 취소합니다. 신청·참석 기록은 남고 되돌릴 수 없습니다.'"))});
check('S7: the new screens show no AI-generated disclosure line, prompt or badge (CEO 2026-09-26)',()=>{for(const [f,s] of newScreens)for(const bad of ['ai-disclosure','AI_DISCLOSURE','isAiGenerated','withDisclosure','needsDisclosure','aiGenerated','AI 도움','ai-disclosure"','name="ai-'])assert.ok(!s.includes(bad),f+' '+bad)});
check('S8: the recommended fixed sentences come only from the server template and never gate the screen',()=>{for(const [f,s] of newScreens){for(const line of [...fa.WAITING_NOTES,fa.REVENUE_QNA_NOTE])assert.ok(!s.includes(line),f+' '+line.slice(0,20));for(const code of ['waiting_note_missing','revenue_qna_note_missing'])assert.ok(!s.includes(code),f+' '+code)}
 assert.ok(assetsSrc.includes('list.templates[type]')||assetsSrc.includes('list.templates['),'templates come from the view');});
check('S9: every write goes through sendAttempt, and a failure goes through followUpOf',()=>{for(const [f,s] of newScreens){assert.ok(s.includes('sendAttempt('),f);assert.ok(s.includes('followUpOf(r)'),f);assert.ok(!/franchisePost\(/.test(s),f+' calls franchisePost directly');assert.ok(s.includes('stringWarnings(r)'),f)}});
check('S10: the panel wires the two tabs, wraps the tab row and keeps the settings trigger pinned',()=>{
 assert.ok(panel.includes("import {FranchiseAssets} from './franchise-assets-panel';"));assert.ok(panel.includes("import {FranchiseEvents} from './franchise-events-panel';"));
 assert.ok(panel.includes('<TabsList className="h-auto max-w-full flex-wrap"><TabsTrigger value="leads">리드</TabsTrigger><TabsTrigger value="requests">정보주체 요청</TabsTrigger><TabsTrigger value="assets">모집 자료</TabsTrigger><TabsTrigger value="events">행사</TabsTrigger><TabsTrigger value="inflow">유입·비용</TabsTrigger><TabsTrigger value="report">성과</TabsTrigger>{admin&&<TabsTrigger value="settings">설정</TabsTrigger>}</TabsList>'));
 assert.ok(panel.includes(":shown==='assets'?<FranchiseAssets key={brandId} brandId={brandId} admin={admin} artifacts={workspace.artifacts} onStatus={()=>void loadStatus()}/>"));
 assert.ok(panel.includes(":shown==='events'?<FranchiseEvents key={brandId} brandId={brandId} admin={admin} onStatus={()=>void loadStatus()}/>"));
 assert.ok(panel.indexOf(":shown==='requests'?")<panel.indexOf(":shown==='assets'?")&&panel.indexOf(":shown==='events'?")<panel.indexOf(":shown==='inflow'?")&&panel.indexOf(":shown==='inflow'?")<panel.indexOf(":shown==='report'?")&&panel.indexOf(":shown==='report'?")<panel.indexOf(':<FranchiseSettings'),'new branches sit between requests and settings');
 assert.ok(panel.includes("import {FranchiseInflow} from './franchise-inflow-panel';"));
});
check('S11: role and switch gates come from the pure helpers',()=>{assert.ok(assetsSrc.includes('assetGates(view,admin)'));assert.ok(eventsSrc.includes('eventGates(e,admin,view.enabled,view.branch,now)'));assert.ok(eventsSrc.includes('registerInput(event,code)'));assert.ok(eventsSrc.includes('attendanceInput(event,attended,noShow,marks)'));assert.ok(eventsSrc.includes('eventInput('));assert.ok(assetsSrc.includes('saveInput(list,detail,'));assert.ok(assetsSrc.includes('approveReady(view,checked)'))});
// ── 6) R5c 유입·비용 화면 원문 고정: 자동 완성 끔·쓰기는 sendAttempt·실패는 followUpOf·광고분담금 선택지 없음·AI 표시 없음 ──
const inflowSrc=src['app/franchise-inflow-panel.tsx'],importSrc=src['app/franchise-import-panel.tsx'],r5cScreens=[['app/franchise-inflow-panel.tsx',inflowSrc],['app/franchise-import-panel.tsx',importSrc]];
check('S12: every text input and form of the R5c screens turns autofill off',()=>{for(const [f,s] of r5cScreens){const inputs=[...s.matchAll(/<(?:Input|Textarea)\b[^>]*>/g)].map(m=>m[0]).filter(t=>!/type="(?:number|date|datetime-local)"/.test(t)&&!/readOnly/.test(t));assert.ok(inputs.length>0,f);for(const t of inputs)assert.ok(t.includes('autoComplete="off"'),f+' '+t);for(const form of s.match(/<form\b[^>]*>/g)||[])assert.ok(form.includes('autoComplete="off"'),f+' '+form)}});
check('S12: every R5c write goes through sendAttempt and a failure through followUpOf; no direct franchisePost, no AI disclosure',()=>{for(const [f,s] of r5cScreens){assert.ok(s.includes('sendAttempt('),f);assert.ok(s.includes('followUpOf(r)'),f);assert.ok(!/franchisePost\(/.test(s),f);for(const bad of ['ai-disclosure','AI_DISCLOSURE','AI 도움'])assert.ok(!s.includes(bad),f+' '+bad)}});
check('S12: the spend funding choices never offer the ad fund and the code retire is confirmed',()=>{assert.ok(!/ad_fund['"]?\s*:/.test(inflowSrc));assert.ok(inflowSrc.includes("export const FUNDING_LABELS={hq_budget:'본부 모집 예산'}"));assert.ok(inflowSrc.includes('window.confirm(RETIRE_CODE_CONFIRM)'))});
check('eventInput sends the chosen spend reference and null when none is chosen',()=>{
 const form={type:'expo',campaignId:'ca-a',start:{now:false,local:'2026-10-20T14:00'},place:'가상 박람회장',capacity:'12',refs:[]};
 assert.equal(eventsUi.eventInput({...form,spendRef:'rs-1'},null).spendRef,'rs-1');assert.equal(eventsUi.eventInput({...form,spendRef:''},null).spendRef,null);assert.equal(eventsUi.eventInput(form,null).spendRef,null)});
console.log(JSON.stringify({passed},null,2));
