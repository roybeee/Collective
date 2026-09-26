// 트랙 R R15a-2b 계약 검사: 실제 경로(/api/franchise, 메모리 D1)로 만든 모집 자료·행사 기록의 GET 보기 응답을 그대로 화면(React SSR)에 넣어 그린다.
// 화면의 쓰기(sendAttempt·franchiseGet)는 같은 경로 핸들러로 보낸다(세션 쿠키를 붙여). 서버와 화면의 키 이름·요청 모양이 어긋나면 여기서 잡힌다.
// 대표 지시(2026-09-26 '표시하지마'): 모집 자료 화면에 AI 생성물 표시(문구·선택·배지)를 두지 않는다. AI 작업물에서 가져온 자료도 표시 문구 없이 승인·내보내기되고 내보낸 원문은 저장 원문과 같은 바이트다.
// 근거: mocked(메모리 SQLite node:sqlite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁, 시계 이동 Date를 서버·화면이 같이 쓴다, 화면은 react-dom/server). 실제 브라우저·실제 D1은 not_run.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';
import {franchiseFixture,captureConsole,HOUR,DISCLAIMER,plain,sha64} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture(),{sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
f.clock.set(Date.parse('2026-10-05T03:00:00Z')-Date.now());
const iso=(d=0)=>new Date(f.clock.now()+d).toISOString();

// ── 화면 링커(tests/franchise-ui-render.test.mjs와 같은 규칙). 화면 문맥의 Date는 서버와 같은 이동 시계다. ──
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),jsxRuntime=require('react/jsx-runtime');
let screenFetch=async()=>{throw new Error('화면 네트워크 호출이 준비되지 않았습니다.')};
const context=createContext({console,URL,URLSearchParams,Date:f.clock.ShiftDate,Intl,TextEncoder,crypto:globalThis.crypto,setTimeout,clearTimeout,fetch:(...a)=>screenFetch(...a)});
const transpile=file=>ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function importedNames(code){
 const names=new Map(),file=ts.createSourceFile('m.js',code,ts.ScriptTarget.ES2022,false,ts.ScriptKind.JS);
 for(const s of file.statements){if(!ts.isImportDeclaration(s))continue;const spec=s.moduleSpecifier.text,set=names.get(spec)||new Set(),clause=s.importClause;if(clause?.name)set.add('default');const bound=clause?.namedBindings;if(bound&&ts.isNamedImports(bound))for(const e of bound.elements)set.add((e.propertyName||e.name).text);names.set(spec,set)}
 return names;
}
const TAGS={Button:'button',Input:'input',Textarea:'textarea',NativeSelect:'select',NativeSelectOption:'option',DialogTitle:'h2',SheetTitle:'h2',DialogDescription:'p',SheetDescription:'p'};
const part=name=>{function Part({children,variant,size,asChild,onOpenChange,onValueChange,...props}){void variant;void size;void asChild;void onOpenChange;void onValueChange;return React.createElement(TAGS[name]||'div',{...props,'data-part':name},children)}Part.displayName=name;return Part};
const REAL_APP=new Set(['./franchise-common']);
// 문맥마다 모듈 캐시를 따로 둔다. react는 문맥이 고른다: SSR 렌더는 실제 React, 아래 X절 상호작용 검사는 훅 대역.
function loader(ctx,reactOf){
 const cache=new Map(),synthetic=(names,value)=>new SyntheticModule([...names],function(){for(const n of names)this.setExport(n,value(n))},{context:ctx});
 const moduleFor=file=>{file=resolve(file);if(cache.has(file))return cache.get(file);const code=transpile(file),m=new SourceTextModule(code,{context:ctx,identifier:file});m.imports=importedNames(code);cache.set(file,m);return m};
 function link(spec,ref){
  if(spec==='react')return synthetic(ref.imports.get(spec)||new Set(),reactOf);
  if(spec==='react/jsx-runtime')return synthetic(ref.imports.get(spec)||new Set(),n=>jsxRuntime[n]);
  if(spec.startsWith('@/components/ui/'))return synthetic(ref.imports.get(spec)||new Set(),part);
  if(spec==='lucide-react')return synthetic(ref.imports.get(spec)||new Set(),()=>()=>null);
  if(spec==='./account-context')return synthetic(ref.imports.get(spec)||new Set(),n=>n==='useAccount'?()=>null:()=>false);
  if(spec.startsWith('@/lib/'))return moduleFor(resolve(spec.slice(2))+'.ts');
  if(spec.startsWith('.')&&(ref.identifier.includes('/lib/')||REAL_APP.has(spec))){const base=resolve(dirname(ref.identifier),spec);return moduleFor(existsSync(base+'.ts')?base+'.ts':base+'.tsx')}
  throw new Error('예상하지 못한 import: '+spec);
 }
 return async file=>{const m=moduleFor(file);if(m.status==='unlinked')await m.link(link);if(m.status!=='evaluated')await m.evaluate();return m.namespace};
}
const load=loader(context,n=>React[n]);
const assetsUi=await load('app/franchise-assets-panel.tsx'),eventsUi=await load('app/franchise-events-panel.tsx'),common=await load('app/franchise-common.tsx'),disclosure=await load('lib/ai-disclosure.ts');
const fa=await f.load('lib/franchise-assets.ts'),factsRoute=await f.load('app/api/brand-facts/route.ts');
const render=(C,p)=>renderToStaticMarkup(React.createElement(C,p)),noop=()=>{},button=(html,label)=>html.includes(`>${label}</button>`),count=(h,t)=>h.split(t).length-1;
const submitDisabled=(html,label)=>new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`).test(html);
const noDisclosure=html=>!html.includes(disclosure.AI_DISCLOSURE_LINE)&&!html.includes('AI 도움')&&!html.includes('type="radio"')&&!html.includes('표시 문구');

// 화면의 fetch를 경로 핸들러로: 세션 쿠키·출처를 붙이고, 요청 제한 창은 매번 비운다. drop이면 서버가 처리한 뒤 응답을 잃는다(네트워크 끊김 재현).
const asUser=(session,drop=false)=>async(url,init={})=>{
 sql.prepare("DELETE FROM records WHERE kind='execution_rate'").run();
 const headers={...(init.headers||{}),cookie:session.cookie,origin:session.origin};
 const res=init.method==='POST'?await f.route.POST(new Request('https://agency.test'+url,{...init,headers})):await f.route.GET(new Request('https://agency.test'+url,{headers}));
 if(drop)throw new TypeError('network dropped after the server answered');
 return res;
};
const as=session=>{screenFetch=asUser(session)};
const write=async(session,action,payload,last=null)=>{as(session);return common.sendAttempt(action,{brandId:'fr-a',...payload},last)};
const view=async(session,params)=>{as(session);return common.franchiseGet({brandId:'fr-a',...params})};
const eventRow=id=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='recruitment_event' AND json_extract(data,'$.id')=?").get(id).data);
const assetRow=(id,v)=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='recruitment_asset' AND json_extract(data,'$.id')=? AND json_extract(data,'$.version')=?").get(id,v).data);

// ── 준비: 스위치·프로필(분기 A)·정보공개서 버전·총 창업비용 사실·모집 캠페인·작업물 ──
const WS='ru-owner',boss=f.signIn('ru-boss','admin',1000,WS),member=f.signIn('ru-member','member',2000,WS);
await f.brand(WS,'fr-a');
check('owner turns the franchise switch on',(await f.setFlag(boss,true)).status===200);
const LABEL='가상 보관함';
check('the brand profile is branch A',(await f.profile(boss,'fr-a',{forecastInputs:{sme:true,storesAtFyEnd:3,fiscalYearEnd:'2025-12-31'},storageLabels:[LABEL],branch:'A'},0)).status===200);
let r=await f.post(boss,{action:'register_disclosure_version',brandId:'fr-a',label:'가상 정보공개서 A',sha256:sha64('ru dvA'),storageLabel:LABEL,registeredAt:'2026-03-15T10:00:00+09:00',validFrom:'2026-03-15',validUntil:'2027-06-30'});
const dv=r.body.result?.id;check('a disclosure version is registered',r.status===200&&typeof dv==='string');
sql.prepare("DELETE FROM records WHERE kind='execution_rate'").run();
const factRes=await factsRoute.POST(new Request('https://agency.test/api/brand-facts',{method:'POST',headers:{'content-type':'application/json',cookie:boss.cookie,origin:boss.origin},body:JSON.stringify({action:'save_fact',confirmed:true,data:{brandId:'fr-a',status:'confirmed',source:'가상 정보공개서',verifiedAt:'2026-09-25T10:00:00+09:00',key:'startup_cost_total',value:'4,500만원',validUntil:'2026-10-30T12:00:00+09:00',sourceRef:{disclosureVersionId:dv,fiscalYear:2025,page:12},cost:{storeType:'소형 매장',includes:['가맹비','교육비','인테리어'],excludes:['임차보증금','권리금'],areaM2:33}}})}));
check('the total startup cost fact is saved',factRes.status===200);
const campaign=(id,title)=>server.recordStatement(WS,'campaign',id,{id,brandId:'fr-a',title,goal:'가상 목표',audience:'',channels:'',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'approved',version:1,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',objective:'franchise_recruitment'}).run();
await campaign('ca-a','가상 가맹 모집 A');await campaign('ca-a2','가상 가맹 모집 A2');
const ARTIFACTS=[{id:'art-ai',campaignId:'ca-a',role:'cmo',title:'가상 AI 작업물',content:'가상 작업물 본문',status:'approved',version:2,origin:'ai',createdAt:'2026-10-02T00:00:00.000Z'},{id:'art-draft',campaignId:'ca-a',role:'cmo',title:'가상 초안 작업물',content:'초안',status:'draft',version:1,origin:'ai',createdAt:'2026-10-03T00:00:00.000Z'},{id:'art-other',campaignId:'ca-a2',role:'cmo',title:'다른 캠페인 작업물',content:'다른',status:'approved',version:1,origin:'manual',createdAt:'2026-10-03T00:00:00.000Z'}];
for(const a of ARTIFACTS)await server.recordStatement(WS,'artifact',a.id,a,a.campaignId).run();

// ── 화면이 만든 요청으로 실제 기록을 만든다 ──
const list0=await view(member,{view:'assets'});
check('the assets view gives the screen its types, campaigns, template, template refs and facts',list0.types.length===7&&list0.types[0].type==='startup_page'&&list0.campaigns.map(c=>c.id).join()==='ca-a,ca-a2'&&list0.templates.startup_page.includes('총 창업비용 · 소형 매장: 4,500만원')&&list0.templateFactRefs.length===1&&list0.costFactsMissing===false&&list0.facts.length===1&&list0.enabled===true&&list0.branch==='A');
check('seed options from the workspace artifacts are the approved artifacts of the campaign',JSON.stringify(plain(assetsUi.seedOptions(ARTIFACTS,'ca-a')).map(o=>o.id))==='["art-ai"]');
const SEC=Object.fromEntries(fa.STARTUP_PAGE_SECTIONS.map(s=>[s.id,s.heading])),after=(text,heading,lines)=>text.replace(heading,()=>[heading,...lines].join('\n'));
const FILL_WHY='매일 아침 굽는 도넛으로 동네 손님과 가까워진 브랜드입니다.';
const PAGE=[['why',[FILL_WHY]],['support',['오픈 첫 달 운영 교육을 지원합니다(계약 체결 가맹점, 개점일부터 30일간).']],['faq',['Q. 가맹 상담은 어떻게 하나요? A. 문의 경로로 신청해 주세요.']],['contact',['창업 상담 신청서로 문의해 주세요.']]].reduce((t,[id,ls])=>after(t,SEC[id],ls),list0.templates.startup_page);
const saveForm=(x)=>({type:'startup_page',campaignId:'ca-a',body:PAGE,picked:new Set(list0.templateFactRefs.map(t=>t.id)),source:null,base:null,...x});
let w=await write(member,'asset_save',assetsUi.saveInput(list0,null,saveForm({source:{artifactId:'art-ai',version:2,title:'가상 AI 작업물'}})));
const P=w.r.body.result;
check('a member saves a startup page from an AI artifact with the screen payload',w.r.status===200&&P.version===1&&w.next===null&&assetRow(P.assetId,1).source.origin==='ai'&&assetRow(P.assetId,1).aiGenerated===true);
check('the save answer carries string warnings for WarningLines',Array.isArray(common.stringWarnings(w.r)));
w=await write(member,'asset_save',assetsUi.saveInput(list0,null,saveForm({type:'portal_intro',body:FILL_WHY+' 포털 소개문입니다.',picked:new Set()})));
const Q=w.r.body.result;check('a member saves a portal intro',w.r.status===200);
w=await write(member,'asset_save',assetsUi.saveInput(list0,null,saveForm({type:'portal_intro',body:FILL_WHY+' 승인 단계 확인용 초안입니다.',picked:new Set()})));
const D=w.r.body.result;check('a member saves a third draft',w.r.status===200);
const detailQ=await view(boss,{view:'asset',assetId:Q.assetId});
const gq=assetsUi.assetGates(detailQ,true);
check('the detail view drives the owner/admin gates for a fresh draft',gq.showApprove&&gq.canApprove&&!gq.showExport&&gq.canEdit&&gq.canRetire&&gq.blockers.length===0&&detailQ.checklist.items.length===6);
w=await write(boss,'asset_approve',assetsUi.approveInput(detailQ,new Set(detailQ.checklist.items.map(i=>i.id))));
check('owner/admin approve with the screen payload (every checklist item, the viewed hash)',w.r.status===200&&w.r.body.result.status==='approved'&&Array.isArray(common.stringWarnings(w.r)));
const memberDetailQ=await view(member,{view:'asset',assetId:Q.assetId});
w=await write(member,'asset_approve',assetsUi.approveInput(memberDetailQ,new Set(memberDetailQ.checklist.items.map(i=>i.id))));
check('a member approval is refused by the server with status follow-up (the screen hides the button)',w.r.status===403&&common.followUpOf(w.r)==='status');
const detailP=await view(boss,{view:'asset',assetId:P.assetId}),gp=assetsUi.assetGates(detailP,true);
check('the AI-sourced startup page passes the gate and can be approved without any disclosure step',detailP.gate.status===200&&gp.canApprove&&detailP.asset.source.origin==='ai');
w=await write(boss,'asset_approve',assetsUi.approveInput(detailP,new Set(detailP.checklist.items.map(i=>i.id))));
check('the AI-sourced page is approved as saved (no disclosure version in between)',w.r.status===200&&w.r.body.result.version===1&&w.r.body.aiGenerated===true&&(await view(boss,{view:'asset',assetId:P.assetId})).versions.length===1);
w=await write(boss,'asset_export',{assetId:P.assetId,version:1,mode:'copy'});
const exported=w.r.body;
check('the export body is the stored body byte for byte, with no disclosure line added',w.r.status===200&&exported.body===assetRow(P.assetId,1).body&&sha64(exported.body)===assetRow(P.assetId,1).bodyHash&&!exported.body.includes(disclosure.AI_DISCLOSURE_LINE)&&exported.body.startsWith('■ '));
const copied=await assetsUi.deliverExport(exported,'copy');
check('without a clipboard the copy box gets exactly the returned body',copied.fallback===exported.body&&copied.message==='내보내기 기록 1건을 남겼습니다.');
const made=[];
class StubURL extends URL{static createObjectURL(b){made.push(b);return 'blob:stub'}static revokeObjectURL(){}}
context.URL=StubURL;context.Blob=Blob;context.document={createElement:()=>({click(){}})};
w=await write(boss,'asset_export',{assetId:Q.assetId,version:1,mode:'download'});
const downloaded=await assetsUi.deliverExport(w.r.body,'download');
check('a download saves exactly the returned body under the server file name',w.r.status===200&&downloaded.fallback===null&&made.length===1&&(await made[0].text())===assetRow(Q.assetId,1).body&&/^recruitment-portal_intro-fr-a-\d{8}-v1\.txt$/.test(w.r.body.filename));
context.URL=URL;delete context.Blob;delete context.document;

// ── 행사: 화면 요청 모양(eventInput·registerInput·attendanceInput)을 실제 경로로 ──
const events0=await view(boss,{view:'events'});
check('S1: the events view carries event types and asset types for the editor',JSON.stringify(events0.types.map(t=>t.label))==='["설명회","견학","박람회"]'&&events0.assetTypes.length===7&&events0.approvedAssets.some(a=>a.id===Q.assetId&&a.version===1&&a.latest));
const kstLocalOf=d=>eventsUi.kstLocal(iso(d));
w=await write(boss,'event_save',eventsUi.eventInput({type:'tour',campaignId:'ca-a',start:{now:false,local:kstLocalOf(3*24*HOUR)},place:' 가상 직영점 ',capacity:'1000',refs:[{id:Q.assetId,version:1}]},null));
const E1=w.r.body.result?.eventId;check('owner/admin create a future tour with the screen payload',w.r.status===200&&eventRow(E1).placeLabel==='가상 직영점'&&eventRow(E1).capacity===1000&&eventRow(E1).spendRef===null);
w=await write(boss,'event_save',eventsUi.eventInput({type:'briefing',campaignId:'ca-a',start:{now:false,local:kstLocalOf(-HOUR)},place:'가상 설명회장',capacity:'5',refs:[]},null));
const E2=w.r.body.result?.eventId,briefingWarnings=common.stringWarnings(w.r);
check('a briefing without a deck saves with a string warning the screen shows without blocking',w.r.status===200&&briefingWarnings.length===1&&render(common.WarningLines,{items:briefingWarnings}).includes('주의: '+briefingWarnings[0]));
const events1=await view(member,{view:'events'}),future=events1.events.find(e=>e.id===E1);
// 응답을 잃은 신청: 서버는 한 번 반영했고, 같은 내용으로 다시 누르면 같은 요청 번호라 두 번 반영되지 않는다.
screenFetch=asUser(member,true);
const lost=await common.sendAttempt('event_register',{brandId:'fr-a',...eventsUi.registerInput(future,'LKR100AA').payload},null);
check('a registration whose answer was lost keeps the attempt and was recorded once',lost.r.status===0&&lost.next!==null&&eventRow(E1).counts.applied===1);
w=await write(member,'event_register',eventsUi.registerInput(future,'LKR100AA').payload,lost.next);
check('retrying the same registration reuses the request id and the server replays it (no double count)',w.r.status===200&&w.r.body.replayed===true&&eventRow(E1).counts.applied===1&&w.next===null);
w=await write(member,'event_register',eventsUi.registerInput(future,'').payload,w.next);
check('a new registration without a code gets a new id and counts once more',w.r.status===200&&!w.r.body.replayed&&eventRow(E1).counts.applied===2);
w=await write(member,'event_register',eventsUi.registerInput(future,'LKR100AA').payload);
check('a duplicate code is a 409 the screen reloads after, keeping the input',w.r.status===409&&common.reasonCodes(w.r).includes('code_duplicate')&&common.followUpOf(w.r)==='reload');
for(const [code,ok] of [['ABCDE',false],['LKR200BB',true],['B-123-4567',false],['_1234567',false],['A'.repeat(65),false],['LK_12-3456',true],['LK.B728',false]]){
 check(`U10 real: codeProblem and the server agree on '${code.slice(0,12)}'`,(eventsUi.codeProblem(code)===null)===ok);
 const res=await write(member,'event_register',{eventId:E1,code});
 check(`U10 real: the server ${ok?'accepts':'refuses'} '${code.slice(0,12)}'`,ok?res.r.status===200:res.r.status===400&&common.reasonCodes(res.r).includes('invalid_code'));
}
const past=(await view(member,{view:'events'})).events.find(e=>e.id===E2);
const att=eventsUi.attendanceInput(past,'0','0',{});
w=await write(member,'event_attendance',att.payload);
check('a member records attendance on the started briefing with the screen payload',att.problem===null&&w.r.status===200&&eventRow(E2).version===past.version+1);

// ── 실제 보기 응답을 그대로 그린다 ──
const bossList=await view(boss,{view:'assets'}),listHtml=render(assetsUi.FranchiseAssets,{brandId:'fr-a',admin:true,artifacts:ARTIFACTS,onStatus:noop,initial:bossList});
check('R2 real: the list shows types, states, the approver role and exports from the real view',['<b>창업 페이지 문안</b>','<b>포털 소개문</b>','승인됨','초안','승인 대표 · ','내보내기 1회 · 마지막 ','가상 가맹 모집 A · 수정 '].every(t=>listHtml.includes(t))&&button(listHtml,'새 모집 자료')&&noDisclosure(listHtml));
const memberP=await view(member,{view:'asset',assetId:P.assetId}),memberHtml=render(assetsUi.AssetSheet,{brandId:'fr-a',assetId:P.assetId,list:list0,admin:false,artifacts:ARTIFACTS,onClose:noop,onChanged:noop,onStatus:noop,initial:memberP});
check('R5 real: a member reads the six checklist texts without checkboxes and no admin buttons',memberP.checklist.items.every(i=>memberHtml.includes(i.text.replace(/'/g,'&#x27;').replace(/&(?!#)/g,'&amp;')))&&count(memberHtml,'type="checkbox"')===0&&!['승인하기','복사','폐기','게시 위치 기록'].some(t=>button(memberHtml,t)));
check('R11 real: the AI-sourced asset shows only the neutral source line',memberHtml.includes('출처 작업물 가상 AI 작업물 v2')&&noDisclosure(memberHtml));
const bossD=await view(boss,{view:'asset',assetId:D.assetId}),approveHtml=render(assetsUi.AssetSheet,{brandId:'fr-a',assetId:D.assetId,list:list0,admin:true,artifacts:ARTIFACTS,onClose:noop,onChanged:noop,onStatus:noop,initial:bossD,initialMode:'approve'});
check('R10 real: the approval step shows six unchecked items, a disabled approve and no disclosure choice',count(approveHtml,'type="checkbox"')===6&&!approveHtml.includes('checked=""')&&submitDisabled(approveHtml,'승인')&&noDisclosure(approveHtml));
const bossQ=await view(boss,{view:'asset',assetId:Q.assetId}),exportHtml=render(assetsUi.AssetSheet,{brandId:'fr-a',assetId:Q.assetId,list:list0,admin:true,artifacts:ARTIFACTS,onClose:noop,onChanged:noop,onStatus:noop,initial:bossQ});
check('R6 real: an exported approved asset offers copy, download and a dated placement form',button(exportHtml,'복사')&&button(exportHtml,'내려받기(.txt)')&&exportHtml.includes('type="date"')&&exportHtml.includes('min="2026-10-05"')&&exportHtml.includes('max="2026-10-05"'));
w=await write(boss,'asset_place',{assetId:Q.assetId,version:1,label:'창업 포털 소개 글',confirmedAt:'2026-10-05'});
check('a placement with the screen date range is recorded',w.r.status===200&&w.r.body.result.placements===1);
const bossEvents=await view(boss,{view:'events'}),memberEvents=await view(member,{view:'events'});
const bossEventsHtml=render(eventsUi.FranchiseEvents,{brandId:'fr-a',admin:true,onStatus:noop,initial:bossEvents}),memberEventsHtml=render(eventsUi.FranchiseEvents,{brandId:'fr-a',admin:false,onStatus:noop,initial:memberEvents});
check('R15 real: owner/admin see new event, edit, cancel and the follow-up chip',button(bossEventsHtml,'새 행사')&&count(bossEventsHtml,'>수정</button>')===2&&count(bossEventsHtml,'>행사 취소</button>')===2&&bossEventsHtml.includes('행사 뒤 48시간 연락: 행사 1건')&&bossEventsHtml.includes('포털 소개문 v1 (승인)'));
check('R16 real: a member registers on the future tour and records attendance on the started briefing',!button(memberEventsHtml,'새 행사')&&count(memberEventsHtml,'>신청 기록하기</button>')===1&&count(memberEventsHtml,'>참석 저장</button>')===1&&memberEventsHtml.includes('placeholder="예: LKB728BT"'));
const editorHtml=render(eventsUi.EventEditor,{view:bossEvents,event:bossEvents.events.find(e=>e.id===E1),busy:false,problem:null,onSave:async()=>true,onCancel:noop});
check('R18 real: the editor offers the three server event types and the stored applications as the capacity floor',count(editorHtml,'<option value="briefing"')===1&&count(editorHtml,'<option value="tour"')===1&&count(editorHtml,'<option value="expo"')===1&&editorHtml.includes(`min="${eventRow(E1).counts.applied}"`));

// ── 스위치 꺼짐: 보기를 다시 읽어 그린다. 폐기·취소만 남는다 ──
check('owner turns the switch off',(await f.setFlag(boss,false)).status===200);
const offList=await view(member,{view:'assets'}),offListHtml=render(assetsUi.FranchiseAssets,{brandId:'fr-a',admin:false,artifacts:ARTIFACTS,onStatus:noop,initial:offList});
check('switch off: no new asset button, the off note is shown',offList.enabled===false&&!button(offListHtml,'새 모집 자료')&&offListHtml.includes(assetsUi.ASSETS_OFF_NOTE));
const offMember=await view(member,{view:'asset',assetId:D.assetId}),offMemberHtml=render(assetsUi.AssetSheet,{brandId:'fr-a',assetId:D.assetId,list:offList,admin:false,artifacts:ARTIFACTS,onClose:noop,onChanged:noop,onStatus:noop,initial:offMember});
check('switch off: a member has no edit or draft save',!button(offMemberHtml,'편집')&&!button(offMemberHtml,'초안 저장'));
const offQ=await view(boss,{view:'asset',assetId:Q.assetId}),offQHtml=render(assetsUi.AssetSheet,{brandId:'fr-a',assetId:Q.assetId,list:offList,admin:true,artifacts:ARTIFACTS,onClose:noop,onChanged:noop,onStatus:noop,initial:offQ});
check('switch off: owner/admin keep retire and lose export and placement',button(offQHtml,'폐기')&&!button(offQHtml,'복사')&&!offQHtml.includes('type="date"'));
const offEvents=await view(boss,{view:'events'}),offEventsHtml=render(eventsUi.FranchiseEvents,{brandId:'fr-a',admin:true,onStatus:noop,initial:offEvents});
check('switch off: owner/admin keep event cancellation only',count(offEventsHtml,'>행사 취소</button>')===2&&!button(offEventsHtml,'새 행사')&&!button(offEventsHtml,'신청 기록하기')&&!button(offEventsHtml,'참석 저장'));
w=await write(member,'asset_save',assetsUi.saveInput(offList,offMember,{type:'portal_intro',campaignId:'',body:'꺼짐 저장 시도',picked:new Set(),source:null,base:null}));
check('switch off: a save that slips through is 409 OFF and the screen re-reads the status',w.r.status===409&&common.followUpOf(w.r)==='status');
w=await write(boss,'asset_retire',{assetId:Q.assetId,version:1});
check('switch off: retirement still works',w.r.status===200&&w.r.body.result.status==='retired');
w=await write(boss,'event_cancel',{eventId:E1,version:eventRow(E1).version});
check('switch off: event cancellation still works',w.r.status===200&&eventRow(E1).status==='cancelled');
as(boss);const status=await common.franchiseGet({view:'status'});
check('S2 real: with the switch off and no leads the recruitment records keep hasRecords true',status.enabled===false&&status.hasRecords===true);
check('no disclosure text reached any rendered screen and no external call was made',[listHtml,memberHtml,approveHtml,exportHtml,bossEventsHtml,memberEventsHtml,editorHtml,offListHtml,offMemberHtml,offQHtml,offEventsHtml].every(noDisclosure)&&f.calls.length===0&&!logged.some(l=>/franchise_request_failed|agency_request_failed/.test(l)));
check('rendered screens make no legal-compliance claim',[listHtml,memberHtml,approveHtml,exportHtml,bossEventsHtml,memberEventsHtml,editorHtml].every(h=>!['법적으로 적합','준수 완료','합법'].some(t=>h.includes(t))));
check('the fixture disclaimer reaches the screen',listHtml.includes(DISCLAIMER));

// ════ X. 상호작용(R15a-2b 교차 검토): 쓰기 처리기·실패 뒤 할 일(명세 6.7–6.9·7.3–7.5·9.2)을 실제로 눌러 본다 ════
// 훅 대역(useState·useEffect·useCallback·useRef·useId)으로 실제 화면 부품을 부르고 버튼을 누르고 칸에 적는다. 부품 경로와 key가 같으면 상태가 남고, key가 바뀌면 새로 시작한다(React와 같은 규칙).
// 쓰기·읽기는 실제 경로로 보낸다. 실제로 만들기 어려운 응답(체크리스트 변경·404·꺼짐·재생·알 수 없는 코드 등)만 'stub' 표시한 곳에서 응답 대역을 쓴다. 근거: mocked(훅 대역·메모리 SQLite·응답 대역).
const E=f.lib.FRANCHISE_ERRORS;
const S={inst:new Map(),seen:new Set(),effects:[],dirty:false,cur:null,root:null,tree:[],ids:0,inflight:0,focus:[]};
const sameDeps=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i])),slot=()=>[S.cur,S.cur.i++];
const hooks={
 useState(init){const [c,i]=slot();if(!(i in c.s)){const s={v:typeof init==='function'?init():init};s.set=v=>{const n=typeof v==='function'?v(s.v):v;if(!Object.is(n,s.v)){s.v=n;S.dirty=true}};c.s[i]=s}return [c.s[i].v,c.s[i].set]},
 useRef(init){const [c,i]=slot();if(!(i in c.s))c.s[i]={current:init};return c.s[i]},
 useCallback(fn,deps){const [c,i]=slot(),s=c.s[i];if(s&&sameDeps(s.deps,deps))return s.v;c.s[i]={v:fn,deps};return fn},
 useEffect(fn,deps){const [c,i]=slot(),s=c.s[i];if(s&&sameDeps(s.deps,deps))return;const prev=s?.cleanup,n={deps};c.s[i]=n;S.effects.push(()=>{if(typeof prev==='function')prev();n.cleanup=fn()})},
 useId(){const [c,i]=slot();if(!(i in c.s))c.s[i]={v:':x'+(++S.ids)+':'};return c.s[i].v},
};
function draw(node,path,out){
 if(node==null||typeof node==='boolean')return;
 if(typeof node==='string'||typeof node==='number'){out.push(String(node));return}
 if(Array.isArray(node)){node.forEach((c,i)=>draw(c,path+'['+(c&&typeof c==='object'&&c.key!=null?'k'+c.key:i)+']',out));return}
 const {type,props,key}=node;
 if(type===React.Fragment){draw(props.children,path+'/F'+(key??''),out);return}
 if(typeof type==='function'){
  const p=path+'/'+(type.displayName||type.name)+(key!=null?'#'+key:'');let c=S.inst.get(p);if(!c){c={s:[],i:0};S.inst.set(p,c)}
  S.seen.add(p);c.i=0;const prev=S.cur;S.cur=c;let res;try{res=type(props)}finally{S.cur=prev}draw(res,p,out);return;
 }
 const el={type,props,children:[]};draw(props.children,path+'/'+type,el.children);
 if(props.ref&&typeof props.ref==='object')props.ref.current={focus(){S.focus.push(props['aria-label']??props.placeholder??type)}};
 out.push(el);
}
function redraw(){S.seen=new Set();const out=[];draw(S.root,'',out);S.tree=out;for(const [p,c] of S.inst)if(!S.seen.has(p)){for(const s of c.s)if(typeof s?.cleanup==='function')s.cleanup();S.inst.delete(p)}}
// 그리기·효과·요청이 모두 멈출 때까지 기다린다(요청 중에는 타이머로 쉬고, 15초를 넘으면 실패).
async function settle(){
 const end=Date.now()+15000;
 for(let quiet=0;;){
  if(S.dirty||S.effects.length){S.dirty=false;redraw();for(const e of S.effects.splice(0))e();quiet=0}else if(S.inflight>0)quiet=0;else if(++quiet>=30)return;
  if(Date.now()>end)throw new Error('settle timeout');
  await new Promise(r=>S.inflight>0?setTimeout(r,1):setImmediate(r));
 }
}
async function mount(C,props){S.inst=new Map();S.root=React.createElement(C,props);S.dirty=true;await settle()}
const textOf=n=>typeof n==='string'?n:n.children.map(textOf).join(''),screenText=()=>S.tree.map(textOf).join('');
function find(pred){const hits=[],walk=(nodes,anc)=>{for(const n of nodes)if(typeof n!=='string'){if(pred(n))hits.push({n,anc});walk(n.children,[...anc,n])}};walk(S.tree,[]);return hits}
const within=partName=>{const h=find(n=>n.props['data-part']===partName)[0];return h?textOf(h.n):''};
const btns=label=>find(n=>n.type==='button'&&textOf(n)===label),inert=h=>!!h.n.props.disabled||h.anc.some(a=>a.type==='fieldset'&&a.props.disabled);
const locked=(label,i=0)=>{const b=btns(label)[i];assert.ok(b,'no button '+label);return inert(b)};
async function press(label,i=0){
 const b=btns(label)[i];assert.ok(b,'no button '+label+' in: '+screenText().slice(0,300));assert.ok(!inert(b),'disabled: '+label);
 if(b.n.props.type==='submit')[...b.anc].reverse().find(a=>a.type==='form').props.onSubmit({preventDefault(){}});else b.n.props.onClick({preventDefault(){},stopPropagation(){}});
 await settle();
}
const field=label=>n=>['input','textarea','select'].includes(n.type)&&(n.props['aria-label']===label||n.props.placeholder===label);
const selectWith=first=>n=>n.type==='select'&&n.children.some(o=>typeof o!=='string'&&textOf(o)===first);
const valueOf=pred=>{const h=find(pred)[0];assert.ok(h,'no field');return h.n.props.value};
async function put(pred,value){const h=find(pred)[0];assert.ok(h,'no field');h.n.props.onChange({target:{value,checked:value},currentTarget:{value,checked:value,select(){}}});await settle()}
const boxes=()=>find(n=>n.type==='input'&&n.props.type==='checkbox'),ticked=()=>boxes().filter(h=>h.n.props.checked).length;
const boxBy=label=>boxes().find(h=>textOf(h.anc.at(-1)).includes(label));
async function tick(label,on){const h=boxBy(label);assert.ok(h,'no checkbox '+label);h.n.props.onChange({target:{checked:on}});await settle()}
async function tickAll(){for(let i=0;i<boxes().length;i++){const h=boxes()[i];if(!h.n.props.checked){h.n.props.onChange({target:{checked:true}});await settle()}}}
const preText=label=>{const h=find(n=>n.type==='pre'&&n.props['aria-label']===label)[0];return h?textOf(h.n):null};
// 화면 쓰기 기록(실제 경로·응답 대역 모두)과 응답 대역. window.confirm은 답을 정해 두고 물은 문구를 남긴다.
const sent=[],win={answer:true,asked:[]},reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const stub=(get,post)=>{screenFetch=async(url,init={})=>init.method==='POST'?post(JSON.parse(init.body)):get(String(url))};
const shimContext=createContext({console,AbortController,URL,URLSearchParams,Date:f.clock.ShiftDate,Intl,TextEncoder,crypto:globalThis.crypto,setTimeout,clearTimeout,
 window:{confirm:m=>{win.asked.push(m);return win.answer}},
 fetch:(url,init={})=>{if(init.method==='POST')sent.push(JSON.parse(init.body));S.inflight++;return Promise.resolve().then(()=>screenFetch(url,init)).then(async res=>{const text=await res.text();return {status:res.status,ok:res.ok,json:async()=>JSON.parse(text)}}).finally(()=>{S.inflight--})}});
const X=loader(shimContext,n=>hooks[n]??React[n]),ui=await X('app/franchise-assets-panel.tsx'),evUi=await X('app/franchise-events-panel.tsx');
const rowOf=(id,v)=>{const r=sql.prepare("SELECT data FROM records WHERE kind='recruitment_asset' AND json_extract(data,'$.id')=? AND json_extract(data,'$.version')=?").get(id,v);return r?JSON.parse(r.data):null};
const sheet=(assetId,admin,props={})=>mount(ui.AssetSheet,{brandId:'fr-a',assetId,list:listX,admin,artifacts:ARTIFACTS,onClose:noop,onChanged:noop,onStatus:noop,...props});
check('X0: owner turns the switch back on for the interaction checks',(await f.setFlag(boss,true)).status===200);
const listX=await view(member,{view:'assets'}),portalSave=body=>write(member,'asset_save',assetsUi.saveInput(listX,null,saveForm({type:'portal_intro',body,picked:new Set()})));

// X1 (F1): 승인 단계에서 모두 체크한 뒤 다른 사용자가 초안을 바꿔 ASSET_STALE로 다시 읽으면, 새 원문에는 체크가 없어야 한다.
const A1=(await portalSave(FILL_WHY+' 교차 검토 승인 단계 초안입니다.')).r.body.result;
as(boss);await sheet(A1.assetId,true);await press('승인하기');await tickAll();
check('X1: the admin ticks all six items on v1',ticked()===6&&!locked('승인')&&preText('승인할 원문').includes('교차 검토 승인 단계 초안입니다.'));
w=await write(member,'asset_save',assetsUi.saveInput(listX,await view(member,{view:'asset',assetId:A1.assetId}),{type:'portal_intro',campaignId:'',body:FILL_WHY+' 다른 사용자가 바꾼 원문입니다.',picked:new Set(),source:null,base:1}));
check('X1: a member replaces the v1 draft with v2 meanwhile',w.r.status===200&&w.r.body.result.version===2&&rowOf(A1.assetId,1)===null);
as(boss);await press('승인');
check('X1 (F1): after ASSET_STALE the approval step shows v2 with every tick cleared and approve locked',screenText().includes(E.ASSET_STALE.text)&&preText('승인할 원문').includes('다른 사용자가 바꾼 원문입니다.')&&ticked()===0&&locked('승인')&&rowOf(A1.assetId,2).status==='draft');
await tickAll();await press('승인');
check('X1: ticking again against v2 approves v2',screenText().includes('v2을 승인했습니다.')&&rowOf(A1.assetId,2).status==='approved');

// X2 (stub): 같은 원문이어도 checklist_outdated·hash_mismatch로 막히면 체크를 지운다.
for(const code of ['checklist_outdated','hash_mismatch']){
 stub(()=>reply(200,bossD),()=>reply(409,{error:E.ASSET_BLOCKED.text,reasons:[{code,message:fa.ASSET_MESSAGES[code]}]}));
 await sheet(D.assetId,true);await press('승인하기');await tickAll();const before=ticked();await press('승인');
 check(`X2: ${code} on approve clears the ticks of the same body`,before===6&&sent.at(-1).action==='asset_approve'&&ticked()===0&&locked('승인')&&screenText().includes(fa.ASSET_MESSAGES[code]));
}

// X3: 편집 중 다른 사용자가 먼저 저장하면(ASSET_STALE) 충돌 상자와 최신 원문을 보이고 내 입력은 남는다. '최신 판 위에 저장'은 최신 판 번호로 다시 보낸다.
const C1=(await portalSave(FILL_WHY+' 충돌 확인용 초안입니다.')).r.body.result,MINE=FILL_WHY+' 내가 고친 원문입니다.';
as(member);await sheet(C1.assetId,false);await press('편집');await put(field('원문'),MINE);
w=await write(boss,'asset_save',assetsUi.saveInput(listX,await view(boss,{view:'asset',assetId:C1.assetId}),{type:'portal_intro',campaignId:'',body:FILL_WHY+' 대표가 먼저 저장한 원문입니다.',picked:new Set(),source:null,base:1}));
as(member);await press('초안 저장');
check('X3: ASSET_STALE on save shows the conflict box with the newer body and keeps my text',w.r.status===200&&screenText().includes('다른 사용자가 v2을 저장했습니다.')&&preText('최신 판 원문').includes('대표가 먼저 저장한 원문입니다.')&&valueOf(field('원문'))===MINE&&sent.at(-1).baseVersion===1);
await press('최신 판 위에 저장');
check('X3: saving on top of the latest version sends that version and stores my text as v3',sent.at(-1).baseVersion===2&&screenText().includes('v3 초안을 저장했습니다.')&&rowOf(C1.assetId,3)?.body===MINE);

// X4 (F2·SOURCE_INVALID): 새 자료. 자유 유형으로 바꾸면 템플릿이 넣은 사실 참조도 빠진다(손으로 고른 사실은 남는다). 오래된 작업물을 고르면 서버가 400을 주고 화면은 출처를 풀고 새로고침을 안내한다.
const STALE_ART={id:'art-stale',campaignId:'ca-a',role:'cmo',title:'목록이 오래된 작업물',content:'오래된 작업물 본문',status:'approved',version:1,origin:'manual',createdAt:'2026-10-04T00:00:00.000Z'};
as(member);await sheet(null,false,{artifacts:[...ARTIFACTS,STALE_ART]});
check('X4: a new asset opens as a startup page with the template and its cost fact ticked',valueOf(field('자료 유형'))==='startup_page'&&valueOf(field('원문'))===listX.templates.startup_page&&boxBy('총 창업비용').n.props.checked===true);
await put(field('자료 유형'),'portal_intro');
check('X4 (F2): switching to a free type empties the body and drops the template cost fact',valueOf(field('원문'))===''&&boxBy('총 창업비용').n.props.checked===false);
await tick('총 창업비용',true);await put(field('자료 유형'),'naver_search');
check('X4: a fact ticked by hand survives the next type switch',boxBy('총 창업비용').n.props.checked===true);
await tick('총 창업비용',false);await put(field('자료 유형'),'portal_intro');
await put(selectWith('캠페인 선택'),'ca-a');await put(field('가져올 작업물'),'art-stale');await press('가져오기');
check('X4: importing an artifact sets the source and inserts its text',screenText().includes('출처: 목록이 오래된 작업물 v1')&&valueOf(field('원문'))==='오래된 작업물 본문');
await put(field('원문'),FILL_WHY+' 새 포털 소개문입니다.');await press('초안 저장');
check('X4: SOURCE_INVALID releases the chosen source and asks for a refresh, keeping the text',sent.at(-1).source?.artifactId==='art-stale'&&screenText().includes(E.SOURCE_INVALID.text)&&screenText().includes('워크스페이스 작업물 목록이 오래됐을 수 있습니다.')&&!screenText().includes('출처: 목록이 오래된 작업물')&&btns('출처 연결 해제').length===0&&valueOf(field('원문'))===FILL_WHY+' 새 포털 소개문입니다.');
await press('초안 저장');
const N1=sent.at(-1);
check('X4: the retry sends no source and no template fact, and the sheet opens the saved v1',!('source' in N1)&&JSON.stringify(N1.factRefs)==='[]'&&N1.type==='portal_intro'&&screenText().includes('포털 소개문 · v1')&&screenText().includes('v1 초안을 저장했습니다.'));
const N1id=JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='recruitment_asset' AND json_extract(data,'$.body')=?").get(N1.body).data).id,N1view=await view(boss,{view:'asset',assetId:N1id});
check('X4 (F2): that draft passes the gate for owner/admin (no stray cost fact, no footnote_missing)',N1view.gate.status===200&&assetsUi.assetGates(N1view,true).canApprove);

// X5 (stub): 현재 사실로 새 판 저장이 사실을 빼면 먼저 묻는다. 거절하면 보내지 않고, 수락하면 뺀 사실 없이 최신 판 기준으로 보낸다.
const pD=await view(boss,{view:'asset',assetId:P.assetId}),pDrop={...pD,resaveSuggested:true,drift:[...pD.drift,{factId:'bf-deleted',refVersion:1,currentVersion:null,changed:true}]};
stub(()=>reply(200,pDrop),b=>reply(200,{ok:true,result:{assetId:b.assetId,version:pD.latestVersion+1}}));
win.answer=false;win.asked.length=0;await sheet(P.assetId,true);let before=sent.length;await press('현재 사실로 새 판 저장');
check('X5: a resave that drops a fact asks first and sends nothing when declined',win.asked.length===1&&win.asked[0].includes('근거에서 뺄 사실 1개')&&sent.length===before);
win.answer=true;await press('현재 사실로 새 판 저장');
check('X5: once confirmed it sends the current fact versions without the dropped fact on the latest version',sent.length===before+1&&sent.at(-1).action==='asset_save'&&sent.at(-1).baseVersion===pD.latestVersion&&!JSON.stringify(sent.at(-1).factRefs).includes('bf-deleted')&&screenText().includes('다시 승인해야 내보낼 수 있습니다.'));

// X6: 게시 위치. 연락처가 든 라벨은 서버가 거절하고 화면은 입력을 두고 그 칸에 포커스한다. 성공하면 앞뒤 공백을 뺀 라벨을 보내고 칸을 비운다.
const PLACE='예: 창업 포털 소개 글';
as(boss);await sheet(P.assetId,true);S.focus.length=0;await put(field(PLACE),'담당 lead.x@example.com 게시');await press('게시 위치 기록');
check('X6: a placement label with a contact is refused, kept and focused',screenText().includes(E.PII_IN_TEXT.text)&&valueOf(field(PLACE))==='담당 lead.x@example.com 게시'&&S.focus.includes(PLACE));
await put(field(PLACE),'  가상 창업 포털 게시 글  ');await press('게시 위치 기록');
check('X6: a recorded placement sends the trimmed label and clears the field',sent.at(-1).label==='가상 창업 포털 게시 글'&&valueOf(field(PLACE))===''&&screenText().includes('게시 위치를 기록했습니다(모두 1곳).'));

// X7 (stub): 상세 읽기 실패는 다시 불러오기로 풀리고 오류 줄이 사라진다.
let readFails=true;stub(()=>readFails?reply(500,{error:'잠시 불러오지 못했습니다.'}):reply(200,bossD),()=>reply(500,{}));
await sheet(D.assetId,true);
check('X7: a failed detail read shows the error and a retry',screenText().includes('잠시 불러오지 못했습니다.')&&btns('다시 불러오기').length===1);
readFails=false;await press('다시 불러오기');
check('X7: a successful retry clears the error',!screenText().includes('잠시 불러오지 못했습니다.')&&btns('다시 불러오기').length===0&&screenText().includes('포털 소개문 · v1'));

// X8 (stub): 404는 시트를 닫고 목록을 다시 읽는다. 409 OFF는 패널 상태를 다시 읽는다.
const spy={close:0,changed:0,status:0},spyProps={onClose:()=>{spy.close++},onChanged:()=>{spy.changed++},onStatus:()=>{spy.status++}};
stub(()=>reply(200,bossD),b=>b.action==='asset_retire'?reply(404,{error:E.ASSET_NOT_FOUND.text}):reply(409,{error:E.OFF.text}));
win.answer=true;await sheet(D.assetId,true,spyProps);await press('폐기');
check('X8: a 404 closes the sheet and reloads the list',spy.close===1&&spy.changed===1&&spy.status===0);
await press('승인하기');await tickAll();await press('승인');
check('X8: 409 OFF re-reads the panel status',spy.status===1&&screenText().includes(E.OFF.text));

// X9 (stub): 거절된 내보내기는 서버 문제만 보이고 아무것도 쓰지 않는다. 복사 대체 상자는 응답 body만 담는다. 재생 응답은 '이미 처리된 요청' 문구를 붙인다.
let exportReply=()=>reply(409,{error:E.ASSET_STALE.text});
stub(()=>reply(200,pD),b=>b.action==='asset_export'?exportReply():reply(200,{ok:true,replayed:true,result:{version:pD.asset.version,status:'retired'}}));
await sheet(P.assetId,true);await press('복사');
check('X9: a refused export shows the server problem and no copy box',screenText().includes(E.ASSET_STALE.text)&&!screenText().includes('내보낸 원문을 받지 못했습니다')&&!screenText().includes(assetsUi.COPY_FALLBACK));
exportReply=()=>reply(200,{ok:true,body:'■ 서버가 돌려준 원문',filename:'f.txt',replayed:true});await press('복사');
check('X9: without a clipboard the copy box holds the returned body, not the screen body',valueOf(field('내보낸 원문 (직접 복사)'))==='■ 서버가 돌려준 원문'&&screenText().includes('같은 요청을 다시 받았습니다'));
win.answer=true;await press('폐기');
check('X9: a replayed write says it was already handled',screenText().includes(`이미 처리된 요청입니다. v${pD.asset.version}을 폐기했습니다.`));

// X10: 신청. 전화번호 모양 코드는 보내지 않는다. 기록되면 칸을 비우고, 중복 코드(409)면 칸을 둔다.
w=await write(boss,'event_save',eventsUi.eventInput({type:'tour',campaignId:'ca-a',start:{now:false,local:kstLocalOf(5*24*HOUR)},place:'가상 견학장',capacity:'10',refs:[{id:A1.assetId,version:2}]},null));
const E3=w.r.body.result?.eventId,CODE='예: LKB728BT';
check('X10: owner/admin create a tour linked to the approved v2',w.r.status===200&&typeof E3==='string');
as(member);await mount(evUi.FranchiseEvents,{brandId:'fr-a',admin:false,onStatus:noop});
await put(field(CODE),'B-123-4567');before=sent.length;await press('신청 기록하기');
check('X10: a phone-like code is refused on screen and not sent',sent.length===before&&screenText().includes('숫자 7자리 이상(전화번호 형태)은 받지 않습니다.'));
await put(field(CODE),'LKX100AA');await press('신청 기록하기');
check('X10: a recorded registration clears the code',sent.at(-1).action==='event_register'&&sent.at(-1).code==='LKX100AA'&&valueOf(field(CODE))===''&&screenText().includes('신청을 기록했습니다(신청 1/10).'));
await put(field(CODE),'LKX100AA');await press('신청 기록하기');
check('X10: a duplicate code keeps the input',sent.at(-1).code==='LKX100AA'&&valueOf(field(CODE))==='LKX100AA'&&screenText().includes(fa.ASSET_MESSAGES.code_duplicate)&&eventRow(E3).counts.applied===1);

// X11–X13: 행사 변경 대화상자. 개인정보가 든 장소는 그 칸에 포커스, 그새 폐기된 연결 자료는 다시 읽은 뒤 빼고 저장, 꺼짐은 패널 상태를 다시 읽고 저장을 잠근다, 삭제된 행사는 닫는다.
const spyE={status:0},PLACE_E='예: 가상 직영점 2층';
as(boss);await mount(evUi.FranchiseEvents,{brandId:'fr-a',admin:true,onStatus:()=>{spyE.status++}});await press('수정',0);
check('X11: the edit dialog opens on the new tour',within('DialogContent').includes('행사 변경')&&valueOf(field(PLACE_E))==='가상 견학장');
await put(field(PLACE_E),'가상 견학장 lead.x@example.com');S.focus.length=0;await press('행사 저장');
check('X11 (F6): a place with a contact is refused, the dialog stays and the place field gets focus',screenText().includes(E.PII_IN_TEXT.text)&&within('DialogContent').includes('행사 변경')&&S.focus.includes(PLACE_E));
await put(field(PLACE_E),'가상 견학장 2층');w=await write(boss,'asset_retire',{assetId:A1.assetId,version:2});as(boss);await press('행사 저장');
check('X11: a linked asset retired meanwhile is refused and the reloaded dialog says it drops out',w.r.status===200&&JSON.stringify(sent.at(-1).assetRefs)===JSON.stringify([{id:A1.assetId,version:2}])&&within('DialogContent').includes('승인 판이 아니라 연결에서 빠집니다')&&valueOf(field(PLACE_E))==='가상 견학장 2층');
await press('행사 저장');
check('X11: saving again sends only approved links and closes the dialog',JSON.stringify(sent.at(-1).assetRefs)==='[]'&&within('DialogContent')===''&&screenText().includes('행사를 저장했습니다.')&&eventRow(E3).placeLabel==='가상 견학장 2층');
await press('수정',0);await put(field(PLACE_E),'가상 견학장 3층');
check('X12: owner turns the switch off while the dialog is open',(await f.setFlag(boss,false)).status===200);as(boss);await press('행사 저장');
check('X12 (F6): 409 OFF re-reads the panel status and the open dialog locks its save with the off note, keeping the input',spyE.status===1&&locked('행사 저장')&&within('DialogContent').includes(eventsUi.EVENTS_OFF_NOTE)&&valueOf(field(PLACE_E))==='가상 견학장 3층');
await press('취소');check('X12: owner turns the switch back on',(await f.setFlag(boss,true)).status===200);
as(boss);await mount(evUi.FranchiseEvents,{brandId:'fr-a',admin:true,onStatus:noop});await press('수정',0);
sql.prepare("DELETE FROM records WHERE kind='recruitment_event' AND json_extract(data,'$.id')=?").run(E3);await press('행사 저장');
check('X13: a deleted event closes the dialog and shows the server message',within('DialogContent')===''&&screenText().includes(E.EVENT_NOT_FOUND.text));

// X14 (stub): 참석 기록이 모르는 코드(code_unknown)로 400이면 행사를 다시 읽는다.
const evView=await view(member,{view:'events'});let reads=0;
stub(()=>{reads++;return reply(200,evView)},()=>reply(400,{error:'입력을 확인해 주세요.',reasons:[{code:'code_unknown',message:fa.ASSET_MESSAGES.code_unknown}]}));
await mount(evUi.FranchiseEvents,{brandId:'fr-a',admin:false,onStatus:noop});const reads0=reads;await press('참석 저장');
check('X14 (F6): code_unknown on attendance reloads the events and shows the reason',sent.at(-1).action==='event_attendance'&&reads===reads0+1&&screenText().includes(fa.ASSET_MESSAGES.code_unknown));

// O2 (대표 결정 (2) "3번"): 대기기간·수익 질의응답 권장 문장이 없어도 서버는 막지 않고 경고만 한다. 화면은 서버 게이트만 따르고 스스로 막지 않으며, 경고를 경고 줄로 보인다.
// 권장 전환(lib/franchise-assets.ts, 사유 코드 51 → 49)이 이 브랜치에 들어와 있으므로 조건 없이 저장·승인·내보내기 200과 경고 문구를 확인한다.
const RECOMMENDED=new Set([...fa.WAITING_NOTES,fa.REVENUE_QNA_NOTE]),strip=t=>t.split('\n').filter(l=>!RECOMMENDED.has(l)).join('\n');
const DSEC=Object.fromEntries(fa.EVENT_DECK_SECTIONS.map(s=>[s.id,s.heading]));
const DECK=[['story',[FILL_WHY]],['demo',['직영 공간에서 대표 메뉴를 시식합니다.']],['support',['오픈 첫 달 운영 교육을 지원합니다(계약 체결 가맹점, 개점일부터 30일간).']]].reduce((t,[id,ls])=>after(t,DSEC[id],ls),list0.templates.event_deck);
as(boss);for(const [type,full] of [['startup_page',PAGE],['event_deck',DECK]]){
 const body=strip(full);w=await write(member,'asset_save',assetsUi.saveInput(listX,null,saveForm({type,body})));
 const id=w.r.body.result?.assetId,d=w.r.status===200?await view(boss,{view:'asset',assetId:id}):null,g=d&&assetsUi.assetGates(d,true),codes=d?d.gate.reasons.map(r=>r.code):[];
 check(`O2: a ${type} without the recommended sentences saves (200) and the body really lacks them`,w.r.status===200&&body!==full&&[...RECOMMENDED].every(l=>!body.includes(l)));
 check(`O2: ${type} gate has no reason code for the missing recommended sentences`,!codes.some(c=>c==='waiting_note_missing'||c==='revenue_qna_note_missing'));
 const expected=type==='event_deck'?[fa.ASSET_WARNING_MESSAGES.waitingNoteMissing,fa.ASSET_WARNING_MESSAGES.revenueQnaNoteMissing]:[fa.ASSET_WARNING_MESSAGES.waitingNoteMissing];
 check(`O2: ${type} gate warns about exactly the missing recommended sentences`,expected.every(m=>d.gate.warnings.includes(m))&&(type==='event_deck'||!d.gate.warnings.includes(fa.ASSET_WARNING_MESSAGES.revenueQnaNoteMissing)));
 check(`O2: ${type} detail renders the recommended-sentence warning as a warning line`,expected.every(m=>render(common.WarningLines,{items:d.gate.warnings}).includes(m)));
 check(`O2: ${type} gate 200 and approvable without the sentences`,d.gate.status===200&&g.canApprove&&g.blockers.length===0);
 w=await write(boss,'asset_approve',assetsUi.approveInput(d,new Set(d.checklist.items.map(i=>i.id))));
 const ex=w.r.status===200?await write(boss,'asset_export',{assetId:id,version:d.asset.version,mode:'copy'}):null;
 check(`O2: ${type} approves and exports (200) with the stored body`,w.r.status===200&&ex?.r.status===200&&ex.r.body.body===d.asset.body);
 const shown=[...d.gate.warnings,...common.stringWarnings(w.r),...common.stringWarnings(ex.r)];
 check(`O2: ${type} server warnings, if any, render as warning lines`,shown.every(x=>render(common.WarningLines,{items:[x]}).includes('주의: ')));
}
check('X: the interaction checks made no external call and logged no request failure',f.calls.length===0&&!logged.some(l=>/franchise_request_failed|agency_request_failed/.test(l)));

console.log(JSON.stringify({passed:passed.length}));
