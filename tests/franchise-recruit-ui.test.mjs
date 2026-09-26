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
const context=createContext({console,URL,URLSearchParams,Date:f.clock.ShiftDate,Intl,TextEncoder,crypto:globalThis.crypto,setTimeout,clearTimeout,fetch:(...a)=>screenFetch(...a)}),cache=new Map();
const transpile=file=>ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function importedNames(code){
 const names=new Map(),file=ts.createSourceFile('m.js',code,ts.ScriptTarget.ES2022,false,ts.ScriptKind.JS);
 for(const s of file.statements){if(!ts.isImportDeclaration(s))continue;const spec=s.moduleSpecifier.text,set=names.get(spec)||new Set(),clause=s.importClause;if(clause?.name)set.add('default');const bound=clause?.namedBindings;if(bound&&ts.isNamedImports(bound))for(const e of bound.elements)set.add((e.propertyName||e.name).text);names.set(spec,set)}
 return names;
}
function moduleFor(file){file=resolve(file);if(cache.has(file))return cache.get(file);const code=transpile(file),m=new SourceTextModule(code,{context,identifier:file});m.imports=importedNames(code);cache.set(file,m);return m}
const synthetic=(names,value)=>new SyntheticModule([...names],function(){for(const n of names)this.setExport(n,value(n))},{context});
const TAGS={Button:'button',Input:'input',Textarea:'textarea',NativeSelect:'select',NativeSelectOption:'option',DialogTitle:'h2',SheetTitle:'h2',DialogDescription:'p',SheetDescription:'p'};
const part=name=>{function Part({children,variant,size,asChild,onOpenChange,onValueChange,...props}){void variant;void size;void asChild;void onOpenChange;void onValueChange;return React.createElement(TAGS[name]||'div',{...props,'data-part':name},children)}Part.displayName=name;return Part};
const REAL_APP=new Set(['./franchise-common']);
function link(spec,ref){
 if(spec==='react')return synthetic(ref.imports.get(spec)||new Set(),n=>React[n]);
 if(spec==='react/jsx-runtime')return synthetic(ref.imports.get(spec)||new Set(),n=>jsxRuntime[n]);
 if(spec.startsWith('@/components/ui/'))return synthetic(ref.imports.get(spec)||new Set(),part);
 if(spec==='lucide-react')return synthetic(ref.imports.get(spec)||new Set(),()=>()=>null);
 if(spec==='./account-context')return synthetic(ref.imports.get(spec)||new Set(),n=>n==='useAccount'?()=>null:()=>false);
 if(spec.startsWith('@/lib/'))return moduleFor(resolve(spec.slice(2))+'.ts');
 if(spec.startsWith('.')&&(ref.identifier.includes('/lib/')||REAL_APP.has(spec))){const base=resolve(dirname(ref.identifier),spec);return moduleFor(existsSync(base+'.ts')?base+'.ts':base+'.tsx')}
 throw new Error('예상하지 못한 import: '+spec);
}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link(link);if(m.status!=='evaluated')await m.evaluate();return m.namespace}
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

console.log(JSON.stringify({passed:passed.length}));
