// 트랙 R 가맹 화면 렌더 확인: 실제 React(react-dom/server)로 리드 상세·리드 등록 대화상자를 그려 역할별 노출(대표·관리자 전용 계약 가능 시각·증빙·삭제 실행,
// 직원의 담당 리드 조작), 가린 값만 표시, 면책 문구, 광고성 정보 동의 기본 해제를 확인한다. 버튼 목록은 서버와 같은 lib/franchise.ts leadActions로 만든다.
// 근거: mocked(화면 부품은 같은 이름의 기본 HTML 요소 대역, 효과·네트워크 없음 — 서버 렌더는 useEffect를 돌리지 않는다). 실제 브라우저는 not_run.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),jsxRuntime=require('react/jsx-runtime');
const context=createContext({console,URL,URLSearchParams,Date,Intl,TextEncoder,crypto:globalThis.crypto,setTimeout,clearTimeout,fetch:()=>{throw new Error('렌더 중 네트워크 호출 금지')}}),cache=new Map();
const transpile=file=>ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function importedNames(code){
 const names=new Map(),file=ts.createSourceFile('m.js',code,ts.ScriptTarget.ES2022,false,ts.ScriptKind.JS);
 for(const s of file.statements){if(!ts.isImportDeclaration(s))continue;const spec=s.moduleSpecifier.text,set=names.get(spec)||new Set(),clause=s.importClause;if(clause?.name)set.add('default');const bound=clause?.namedBindings;if(bound&&ts.isNamedImports(bound))for(const e of bound.elements)set.add((e.propertyName||e.name).text);names.set(spec,set)}
 return names;
}
function moduleFor(file){file=resolve(file);if(cache.has(file))return cache.get(file);const code=transpile(file),m=new SourceTextModule(code,{context,identifier:file});m.imports=importedNames(code);cache.set(file,m);return m}
const synthetic=(names,value)=>new SyntheticModule([...names],function(){for(const n of names)this.setExport(n,value(n))},{context});
// 화면 부품 대역: 이름에 맞는 기본 HTML 요소로 children과 속성을 그대로 그린다(asChild·variant 같은 부품 전용 속성은 버린다).
const TAGS={Button:'button',Input:'input',Textarea:'textarea',NativeSelect:'select',NativeSelectOption:'option',DialogTitle:'h2',SheetTitle:'h2',DialogDescription:'p',SheetDescription:'p'};
const part=name=>{function Part({children,variant,size,asChild,onOpenChange,onValueChange,...props}){void variant;void size;void asChild;void onOpenChange;void onValueChange;return React.createElement(TAGS[name]||'div',{...props,'data-part':name},children)}Part.displayName=name;return Part};
const REAL_APP=new Set(['./franchise-common','./franchise-lead-detail','./franchise-settings','./franchise-assets-panel','./franchise-events-panel','./franchise-inflow-panel','./franchise-import-panel','./franchise-report-panel','./franchise-experiment-panel','./franchise-benchmark-panel','./franchise-nurture-panel','./franchise-lead-nurture','./franchise-media-box']);
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
const detail=await load('app/franchise-lead-detail.tsx'),panel=await load('app/franchise-panel.tsx'),lib=await load('lib/franchise.ts');
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const DISCLAIMER='COLLECTIVE 휴리스틱 · 법률 자문 아님',noop=()=>{};
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));

// 합성 리드(가린 값만). 버튼 목록은 서버와 같은 판정(lib/franchise.ts)으로 만든다.
const ADMIN={id:'u-admin',role:'admin'},MEMBER={id:'u-member',role:'member'};
const base={id:'lead-1',systemCode:'LKB728BT',stage:'draft_provided',closeReason:null,assigneeId:'u-member',contactState:'present',contact:{name:'김*상',phone:'***-****-0101',email:'l***@example.com',hasPhone:true,hasEmail:true},
 task:{region:'가상시 가상구',budgetBand:'lt_50m',timingBand:'3m_6m',sourceChannel:'referral',campaignId:null},basisType:'referral',sourceNoticePending:true,marketingStatus:'given',eligibility:{met:3,total:4},
 lastActivityAt:'2026-09-25T05:00:13.235Z',retentionUntil:'2027-03-24T05:00:13.235Z',retentionLabel:lib.RETENTION_LABEL,version:13,createdAt:'2026-09-25T05:00:13.172Z',hasMemo:true,
 basis:{type:'referral',referralFrom:'franchisee',sourceNoticedAt:null},marketing:{status:'given',method:'recorded_call',at:'2026-09-25T05:00:13.209Z',noticeId:'pn-1'},marketingRecheck:false,
 firstContactAt:'2026-09-25T05:00:13.199Z',contractedAt:null,closedAt:null,closedFrom:null,disclaimer:DISCLAIMER,
 events:[{id:'ev-3',type:'evidence_voided',at:'2026-09-25T05:00:13.242Z',actor:{id:'u-admin',role:'admin'},evidenceType:'delivery',voided:true},
  {id:'ev-2',type:'transition_blocked',at:'2026-09-25T05:00:13.240Z',actor:{id:'u-admin',role:'admin'},to:'fee_escrowed',reasons:[{code:'escrow_unproven',message:'가맹금 예치 또는 피해보상보험 증빙이 부족합니다.'}]},
  {id:'ev-1',type:'created',at:'2026-09-25T05:00:13.172Z',actor:{id:'u-member',role:'member'},basis:{type:'referral',referralFrom:'franchisee'}}]};
const withActions=(lead,who)=>({...lead,assignedToMe:lead.assigneeId===who.id,allowedActions:lib.leadActions(who,lead,true),allowedMoves:lib.allowedMoves(who,lead,true),marketingOptions:lib.marketingOptions(who,lead,true)});
const evidence=[
 {id:'fd-1',evidenceType:'delivery',recordedAt:'2026-09-25T05:00:13.211Z',recordedBy:{id:'u-admin',role:'admin'},backdateApproval:{role:'admin',reasonCode:'after_the_fact_entry'},supersedes:null,correctionReason:null,docSha256:'f'.repeat(64),storageLabel:'본사 문서함',
  payload:{doc:'disclosure',method:'electronic',deliveredAt:'2026-08-26T05:00:13.210Z',versionId:'dv-1',evidence:{electronic:{channel:'email',receivedAt:'2026-08-26T05:00:13.210Z',printable:true}}},superseded:true,assessment:{accepted:true,counted:true,reasons:[]}},
 {id:'fd-2',evidenceType:'fee',recordedAt:'2026-09-25T05:00:13.230Z',recordedBy:{id:'u-admin',role:'admin'},backdateApproval:null,supersedes:null,correctionReason:null,docSha256:null,storageLabel:null,payload:{category:'d_periodic',paidAt:'2026-09-25T05:00:13.230Z'},superseded:false},
 {id:'fd-3',evidenceType:'delivery',recordedAt:'2026-09-25T05:00:13.242Z',recordedBy:{id:'u-admin',role:'admin'},backdateApproval:null,supersedes:'fd-1',correctionReason:'wrong_lead',docSha256:null,storageLabel:null,payload:null,voided:true,superseded:false}];
const gate={window:{at:null,atKst:null,disclosureSide:{startDate:null,days:null,periodEnd:null,shortened:false,extended:false},draftSide:{startDate:'2026-09-25',days:14,periodEnd:'2026-10-12',shortened:false,extended:true},
 blockers:[{code:'disclosure_missing',message:'기산에 쓸 정보공개서 제공 기록이 없습니다.'}],notes:[],warnings:[],ruleVersion:'fr-gates@test',disclaimer:DISCLAIMER},forecastDuty:'unknown',stageChecks:{opened:null},disclaimer:DISCLAIMER};
const intake={enabled:true,notices:[{id:'pn-1',versionLabel:'2026-1',sha256:'1'.repeat(64),createdAt:'2026-09-25T05:00:13.164Z'}],profileBranch:'A',storageLabels:['본사 문서함'],memoHint:lib.MEMO_HINT,contactNote:lib.CONTACT_NOTE,disclaimer:DISCLAIMER};
const assignees=[{id:'u-admin',label:'나'},{id:'u-member',label:'staff@test.invalid'}];
const props=(initial,admin)=>({brandId:'fr-a',leadId:initial.id,initial,admin,intake,assignees,campaigns:[],onClose:noop,onChanged:noop});
const adminLead=withActions({...base,evidence,gate},ADMIN),adminHtml=render(detail.FranchiseLeadDetail,props(adminLead,true));
const memberLead=withActions({...base,stage:'contacted',marketingStatus:'none',marketing:{status:'none'}},MEMBER),memberHtml=render(detail.FranchiseLeadDetail,props(memberLead,false));
const has=(html,text)=>html.includes(text);

check('admin detail shows the contract window card with the disclaimer',()=>{assert.ok(has(adminHtml,'계약 가능 시각'));assert.ok(has(adminHtml,'아직 계산할 수 없습니다'));assert.ok(has(adminHtml,'기산에 쓸 정보공개서 제공 기록이 없습니다.'));assert.ok(has(adminHtml,'예상매출액 산정서: 미확인(필요로 처리)'));assert.ok(has(adminHtml,DISCLAIMER))});
check('admin detail shows evidence forms, the append-only list and void actions',()=>{assert.ok(has(adminHtml,'증빙 기록'));assert.ok(has(adminHtml,'증빙 목록'));assert.ok(has(adminHtml,'정정됨'));assert.ok(has(adminHtml,'무효'));assert.ok(has(adminHtml,'다른 리드 기록 무효화'));assert.ok(has(adminHtml,'정기 대가'));assert.ok(!has(adminHtml,'ftc_link'),'the FTC link is not offered as a delivery method')});
check('admin detail offers reveal, reassignment, erasure and marketing withdrawal',()=>{for(const t of ['연락처 보기','열람 목적과 항목이 기록에 남습니다.','담당 지정','삭제 실행',detail.ERASE_CONFIRM,'수신 철회','종결'])assert.ok(has(adminHtml,t),t)});
check('the detail shows masked contacts, the retention label and the source-notice to-do',()=>{assert.ok(has(adminHtml,'김*상 · ***-****-0101 · l***@example.com'));assert.ok(has(adminHtml,lib.RETENTION_LABEL));assert.ok(has(adminHtml,'출처 고지 필요'));assert.ok(has(adminHtml,lib.CONTACT_NOTE))});
check('the timeline shows types, blocked reasons and roles without values',()=>{assert.ok(has(adminHtml,'증빙 무효화'));assert.ok(has(adminHtml,'진행 차단'));assert.ok(has(adminHtml,'가맹금 예치 또는 피해보상보험 증빙이 부족합니다.'));assert.ok(has(adminHtml,'근거 제3자 소개(출처 고지 필요)'))});
check('member detail hides owner/admin sections',()=>{for(const t of ['<h3>계약 가능 시각</h3>','<h3>증빙 기록</h3>','<h3>증빙 목록</h3>','<h3>연락처 삭제 실행','>삭제 실행<','>담당 지정<','동의 기록 (대표·관리자)','>다시 열기<'])assert.ok(!has(memberHtml,t),t);assert.ok(has(adminHtml,'<h3>증빙 기록</h3>')&&has(adminHtml,'>담당 지정<'),'the same markers exist for admin')});
check('member detail lets the sales rep work an own lead',()=>{for(const t of ['연락처 보기','문의 조건','문의 조건 저장','연락처 수정','문의 단계로','상담 단계로','종결','고지함','정보주체 요청 접수',DISCLAIMER])assert.ok(has(memberHtml,t),t)});
const unassigned=withActions({...base,stage:'inquiry',assigneeId:null},MEMBER),unassignedHtml=render(detail.FranchiseLeadDetail,props(unassigned,false));
check('a member sees a claim button but no reveal or edit on an unassigned lead',()=>{assert.ok(has(unassignedHtml,'내가 담당하기'));for(const t of ['열람 목적','과업 저장','연락처 저장'])assert.ok(!has(unassignedHtml,t),t)});
const erased=withActions({...base,contactState:'erased',contact:null,hasMemo:false,sourceNoticePending:false},ADMIN),erasedHtml=render(detail.FranchiseLeadDetail,props({...erased,evidence:[],gate},true));
check('an erased lead shows the state and no reveal, contact edit or source-notice prompt',()=>{assert.ok(has(erasedHtml,'삭제됨'));assert.ok(has(erasedHtml,'연락처 없음'));assert.ok(has(erasedHtml,'출처 고지 기록 없음'));for(const t of ['열람 목적','연락처 저장','>삭제 실행<','고지함','· 출처 고지 필요'])assert.ok(!has(erasedHtml,t),t)});
check('a side with no delivery says so instead of blank dates',()=>assert.ok(has(adminHtml,'정보공개서 쪽: 기산할 제공 기록 없음')));
check('before a contract the opening line says it is judged after the contract, not a record-format error',()=>{assert.ok(has(adminHtml,'개점 판정: 계약 기록 뒤에 판정합니다.'));assert.ok(!has(adminHtml,'기록 형식을 확인해 주세요.'))});
const contractedHtml=render(detail.FranchiseLeadDetail,props({...withActions({...base,stage:'contracted',contractedAt:'2026-09-25T05:00:13.300Z'},ADMIN),evidence,gate:{...gate,stageChecks:{opened:{ok:false,reasons:[{code:'forecast_statement_missing',message:'예상매출액 산정서 서면 제공 기록이 필요합니다.'}],warnings:[]}}}},true));
check('a contracted lead shows the opening check and its reasons',()=>{assert.ok(has(contractedHtml,'개점 판정: 막힘'));assert.ok(has(contractedHtml,'예상매출액 산정서 서면 제공 기록이 필요합니다.'))});
check('history and evidence name the staff account instead of only the role',()=>{assert.ok(has(adminHtml,'KST · staff@test.invalid</p>'),'member-created event');assert.ok(has(adminHtml,'KST · 나</p>'),'own admin event');assert.ok(has(adminHtml,'KST · 나 · 이른 시각 사유'),'evidence recorder')});
check('a lead with a memo offers append by default and says replace overwrites',()=>{assert.ok(has(memberHtml,'메모 덧붙이기 (기존 메모 뒤에 붙입니다 · 합쳐서 1000자)'));assert.ok(has(memberHtml,'> 바꾸기'));assert.ok(!has(memberHtml,'메모 바꾸기 (저장하면'))});
check('the erasure section says open erasure requests are closed',()=>assert.ok(has(adminHtml,'이 리드에 접수된 삭제 요청은 완료로 기록합니다.')));
const createProps=admin=>({brandId:'fr-a',admin,intake,assignees,campaigns:[{id:'c-1',title:'가상 캠페인'}],onClose:noop,onCreated:noop});
const createAdmin=render(panel.CreateLeadDialog,createProps(true)),createMember=render(panel.CreateLeadDialog,createProps(false));
check('lead registration asks only the minimum and turns autofill off',()=>{assert.ok(has(createMember,'이름 *'));assert.ok(has(createMember,'전화·이메일 중 하나 이상'));assert.equal((createMember.match(/autoComplete="off"|autocomplete="off"/gi)||[]).length,6,'form + name, phone, email, memo, recruitment codes (R5c)');assert.ok(has(createMember,'모집 코드 (선택, 쉼표로 여러 개)'));for(const t of ['주소 입력','생년월일 입력','주민등록번호 입력'])assert.ok(!has(createMember,t))});
check('marketing consent is unchecked by default and owner/admin only',()=>{assert.ok(has(createAdmin,'광고성 정보 수신 동의를 따로 받았습니다'));assert.ok(!/type="checkbox" checked=""[^>]*\/?> 광고성/.test(createAdmin));assert.ok(!has(createMember,'광고성 정보 수신 동의를 따로 받았습니다'));assert.ok(has(createMember,'광고성 정보 동의는 기본으로 ‘동의 없음’입니다.'))});
check('the default basis is an inquiry response and the assignee choice is owner/admin only',()=>{assert.match(createMember,/checked=""[^>]*\/> 문의 응대\(제15조①4호\)/);assert.ok(has(createAdmin,'담당자'));assert.ok(has(createAdmin,'담당 없음'));assert.ok(!has(createMember,'>담당 없음<'))});
check('rendered screens make no legal-compliance claim',()=>{for(const html of [adminHtml,memberHtml,createAdmin,createMember])for(const bad of ['법적으로 적합','준수 완료','합법'])assert.ok(!html.includes(bad))});
// ── R15a-2b 모집 자료·행사 탭: 합성 보기 응답(지도 6절 모양, 시각은 지금 기준 상대값)으로 렌더한다. 근거: mocked(SSR, 효과·네트워크 없음) ──
const assetsUi=await load('app/franchise-assets-panel.tsx'),eventsUi=await load('app/franchise-events-panel.tsx'),common=await load('app/franchise-common.tsx'),rules=await load('lib/franchise-rules.ts'),disclosure=await load('lib/ai-disclosure.ts');
const HOUR_MS=3600000,DAY_MS=86400000,at=d=>new Date(Date.now()+d).toISOString(),count=(html,text)=>html.split(text).length-1;
const TYPES=[['startup_page','창업 페이지 문안'],['portal_intro','포털 소개문'],['naver_search','네이버 검색 문안'],['meta_lead_ad','메타 리드광고 문안'],['expo_banner','박람회 배너·리플렛 문안'],['event_deck','설명회 덱 개요·원고'],['first_call_script','첫 통화 스크립트']].map(([type,label])=>({type,label}));
const TEMPLATE='■ 왜 이 브랜드인가 [의견]\n\n■ 창업비용 표 [사실]\n총 창업비용 · 소형 매장: 4,500만원\n\n■ 문의 경로';
const FACTS=[{id:'bf-total',version:2,key:'startup_cost_total',label:'총 창업비용',line:'총 창업비용 · 소형 매장: 4,500만원',hasSource:true},{id:'bf-count',version:1,key:'franchise_store_count',label:'가맹점 수',line:'가맹점 수: 12개',hasSource:false}];
const CAMPAIGNS=[{id:'ca-a',title:'가상 가맹 모집 A'}];
const assetsViewOf=(o={})=>({assets:[],campaigns:CAMPAIGNS,types:TYPES,templates:{startup_page:TEMPLATE,event_deck:'■ 브랜드 이야기 [의견]'},templateFactRefs:[{id:'bf-total',version:2}],costFactsMissing:false,facts:FACTS,branch:'A',h7Notice:null,enabled:true,role:'admin',rules:{checklistVersion:'fr-assets-checklist@test'},disclaimer:DISCLAIMER,...o});
const summaryOf=(o={},latest={})=>({assetId:'ra-1',type:'startup_page',typeLabel:'창업 페이지 문안',campaignId:'ca-a',campaignTitle:'가상 가맹 모집 A',campaignMissing:false,latest:{version:2,status:'draft',bodyHash:'b'.repeat(64),review:{needed:false,reasons:[],at:null},approval:null,exportCount:0,lastExportAt:null,placements:[],updatedAt:at(-HOUR_MS),...latest},versions:[{version:2,status:'draft',exportCount:0}],...o});
const CL=['no_wait_bypass','no_association_condition','no_captive_advisor','no_revenue_figures','h7_branch_a','endorsement_disclosure'];
const CHECKLIST={version:'fr-assets-checklist@test',items:CL.map((id,i)=>({id,text:`확인 항목 ${i+1}: ${id}`,ruleIds:[],warnings:i===0?['판정기가 대기기간 표현을 확인하라고 알렸습니다.']:[]})),h7Notice:null};
const EXPORTED={at:at(-2*DAY_MS),by:'u-admin',role:'admin'},APPROVAL={by:'u-admin',role:'admin',at:at(-3*DAY_MS),bodyHash:'b'.repeat(64),checklist:{version:'fr-assets-checklist@test',checked:CL}};
const detailOf=(o={},a={})=>({asset:{id:'ra-1',campaignId:'ca-a',type:'startup_page',version:2,body:'■ 왜 이 브랜드인가 [의견]\n가상 원문 첫 줄',bodyHash:'b'.repeat(64),factRefs:[{id:'bf-total',version:2}],status:'draft',approval:null,placements:[],exports:[],review:{needed:false,reasons:[],at:null},source:null,savedBy:{id:'u-member',role:'member'},exportCount:0,updatedAt:at(-HOUR_MS),...a},
 latestVersion:2,versions:[{version:2,status:a.status??'draft'},{version:1,status:'approved'}],drift:[{factId:'bf-total',refVersion:2,currentVersion:2,changed:false}],resaveSuggested:false,gate:{status:200,reasons:[],message:null,warnings:[]},checklist:CHECKLIST,campaign:{id:'ca-a',title:'가상 가맹 모집 A'},branch:'A',h7Notice:null,enabled:true,disclaimer:DISCLAIMER,...o});
const ART=[{id:'art-ai',campaignId:'ca-a',status:'approved',version:2,title:'가상 AI 작업물',content:'가상 작업물 본문',role:'cmo',origin:'ai',createdAt:at(-DAY_MS),factsChanged:true},{id:'art-draft',campaignId:'ca-a',status:'draft',version:1,title:'가상 초안 작업물',content:'초안',role:'cmo',origin:'manual',createdAt:at(-HOUR_MS)},{id:'art-other',campaignId:'ca-a2',status:'approved',version:1,title:'다른 캠페인 작업물',content:'다른',role:'cmo',origin:'manual',createdAt:at(-HOUR_MS)}];
const listHtml=(view,admin)=>render(assetsUi.FranchiseAssets,{brandId:'fr-a',admin,artifacts:ART,onStatus:noop,initial:view});
const sheetHtml=(view,admin,initialMode='view',list=assetsViewOf())=>render(assetsUi.AssetSheet,{brandId:'fr-a',assetId:view.asset.id,list,admin,artifacts:ART,onClose:noop,onChanged:noop,onStatus:noop,initial:view,initialMode});
const editorHtml=(props)=>render(assetsUi.AssetEditor,{list:assetsViewOf(),artifacts:ART,detail:null,busy:false,enabled:true,conflict:false,onSave:async()=>'ok',onCancel:noop,onRestart:noop,...props});
const approveHtml=(view,initialChecked,blockers=[],initialWaitConfirmed=true)=>render(assetsUi.ApprovalStep,{view,busy:false,blockers,onApprove:noop,onCancel:noop,initialChecked,initialWaitConfirmed});
const newHtml=[];const keep=html=>{newHtml.push(html);return html};
const submitDisabled=(html,label)=>new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`).test(html),button=(html,label)=>html.includes(`>${label}</button>`);

check('R1: the panel shows the recruitment assets and events tabs, and no settings tab before the role is known',()=>{const html=keep(render(panel.FranchisePanel,{workspace:{brands:[{id:'fr-a',name:'가상 브랜드'}],campaigns:[],artifacts:[]}}));assert.ok(html.includes('>모집 자료</div>'));assert.ok(html.includes('>행사</div>'));assert.ok(html.includes('>유입·비용</div>'));assert.ok(html.indexOf('>행사</div>')<html.indexOf('>유입·비용</div>'));assert.ok(!html.includes('>설정</div>'));assert.ok(html.includes('h-auto max-w-full flex-wrap'))});
const LIST=assetsViewOf({assets:[
 summaryOf({},{review:{needed:true,reasons:['fact_changed','version_changed'],at:at(-HOUR_MS)}}),
 summaryOf({assetId:'ra-2',type:'portal_intro',typeLabel:'포털 소개문',versions:[{version:3,status:'approved',exportCount:2},{version:2,status:'approved',exportCount:0},{version:1,status:'retired',exportCount:0}]},{version:3,status:'approved',approval:{by:'u-owner',role:'owner',at:at(-2*DAY_MS)},exportCount:2,lastExportAt:at(-DAY_MS),placements:[{label:'창업 포털 소개 글',confirmedAt:'2026-10-04'}]}),
 summaryOf({assetId:'ra-3',type:'naver_search',typeLabel:'네이버 검색 문안',campaignId:'ca-gone',campaignTitle:null,campaignMissing:true},{status:'retired'}),
]});
check('R2: the list shows state, review, approver role, exports, placements and a deleted campaign',()=>{const html=keep(listHtml(LIST,true));
 for(const t of ['<b>창업 페이지 문안</b>','v2','초안','재검토 필요 · 근거 사실 변경 · 정보공개서 버전 변경','<b>포털 소개문</b>','승인됨','승인 대표 · ','내보내기 2회 · 마지막 ','게시 위치 1곳: 창업 포털 소개 글 (2026-10-04)','판 3개','폐기','캠페인 삭제됨','가상 가맹 모집 A · 수정 '])assert.ok(html.includes(t),t);
 assert.equal(count(html,'>열기</button>'),3);assert.ok(html.includes('aria-label="모집 자료 목록"'))});
check('R3: with the switch on every role can start a new asset; off shows the note and no button',()=>{
 for(const admin of [true,false])assert.ok(button(keep(listHtml(LIST,admin)),'새 모집 자료'),String(admin));
 const off=keep(listHtml(assetsViewOf({...LIST,enabled:false}),true));assert.ok(!off.includes('새 모집 자료'));assert.ok(off.includes(assetsUi.ASSETS_OFF_NOTE));
 const empty=keep(listHtml(assetsViewOf(),false));assert.ok(empty.includes('아직 모집 자료가 없습니다.'));
 const noCampaign=keep(listHtml(assetsViewOf({campaigns:[]}),true));assert.ok(!noCampaign.includes('새 모집 자료'));assert.ok(noCampaign.includes('가맹 모집 목적 캠페인이 없어 새 자료를 만들 수 없습니다.'));
 const noCost=keep(listHtml(assetsViewOf({costFactsMissing:true}),true));assert.ok(noCost.includes('총 창업비용 사실이 없어 창업 페이지·설명회 덱 템플릿의 창업비용 표가 비어 있습니다.'));
 const branchB=keep(listHtml(assetsViewOf({branch:'B',h7Notice:'분기 B(문의 수집만)입니다. 가상 안내.'}),true));assert.ok(branchB.includes('분기 B(문의 수집만)입니다. 가상 안내.'));assert.ok(button(branchB,'새 모집 자료'),'drafts do not depend on the branch');
 const loading=keep(render(assetsUi.FranchiseAssets,{brandId:'fr-a',admin:true,artifacts:[],onStatus:noop}));assert.ok(loading.includes('모집 자료를 불러오고 있습니다.'));
});
check('R4: owner/admin on the latest draft sees approve, edit and retire but no export',()=>{const html=keep(sheetHtml(detailOf(),true));for(const t of ['승인하기','편집','폐기'])assert.ok(button(html,t),t);assert.ok(!button(html,'복사'));assert.ok(html.includes('현재 사실 기준으로 막는 사유가 없습니다.'));assert.ok(html.includes('aria-current="true"'));assert.ok(html.includes('창업 페이지 문안 · v2'));assert.ok(html.includes('초안 · 가상 가맹 모집 A · 저장 '))});
check('R5: a member reads the checklist without checkboxes and sees no approve, export, retire or placement',()=>{const html=keep(sheetHtml(detailOf({},{...detailOf().asset,status:'approved',approval:APPROVAL,exports:[EXPORTED],exportCount:1}),false));
 for(const t of ['승인하기','복사','내려받기(.txt)','폐기','게시 위치 기록'])assert.ok(!button(html,t),t);for(const i of CHECKLIST.items)assert.ok(html.includes(i.text),i.id);
 assert.equal(count(html,'type="checkbox"'),0);assert.ok(html.includes('승인 전 확인 항목(대표·관리자가 확인)'));assert.ok(button(html,'편집'),'members still draft');assert.ok(html.includes('내보내기 1회'))});
check('R6: the approved latest version offers copy and download; placement needs a first export and uses its KST date range',()=>{
 const noExport=keep(sheetHtml(detailOf({},{status:'approved',approval:APPROVAL}),true));assert.ok(button(noExport,'복사')&&button(noExport,'내려받기(.txt)'));assert.ok(noExport.includes(assetsUi.EXPORT_NOTE));assert.ok(!noExport.includes('type="date"'));
 const exported=keep(sheetHtml(detailOf({},{status:'approved',approval:APPROVAL,exports:[EXPORTED],exportCount:1}),true));
 assert.ok(exported.includes(`type="date"`)&&exported.includes(`min="${rules.kstDateOf(EXPORTED.at)}"`)&&exported.includes(`max="${rules.toKstDate(new Date().toISOString())}"`));assert.ok(button(exported,'게시 위치 기록'));assert.ok(exported.includes('placeholder="예: 창업 포털 소개 글"'));
});
check('R7: an old version is evidence only: no edit, approve or export',()=>{const html=keep(sheetHtml(detailOf({latestVersion:3,versions:[{version:3,status:'draft'},{version:2,status:'approved'}]},{status:'approved',approval:APPROVAL}),true));assert.ok(html.includes('최신 판 아님. 옛 판은 증빙·행사 연결·게시 위치 기록용입니다.'));for(const t of ['편집','승인하기','복사'])assert.ok(!button(html,t),t);assert.ok(button(html,'폐기'))});
const DRIFT=[{factId:'bf-total',refVersion:1,currentVersion:2,changed:true},{factId:'bf-gone',refVersion:1,currentVersion:null,changed:true}];
check('R8: a resave suggestion lists the drift and offers a new version from current facts only with the switch on',()=>{const html=keep(sheetHtml(detailOf({resaveSuggested:true,drift:DRIFT},{review:{needed:true,reasons:['fact_changed'],at:at(-HOUR_MS)}}),false));
 assert.ok(html.includes('bf-total: v1 → v2'));assert.ok(html.includes('bf-gone: v1 → 사실 없음(근거에서 뺍니다)'));assert.ok(button(html,'현재 사실로 새 판 저장'));assert.ok(html.includes('재검토 필요 · 근거 사실 변경'));
 const off=keep(sheetHtml(detailOf({resaveSuggested:true,drift:DRIFT,enabled:false}),true));assert.ok(!button(off,'현재 사실로 새 판 저장'))});
check('R9: branch B shows the H7 notice and no approve button',()=>{const html=keep(sheetHtml(detailOf({branch:'B',h7Notice:'분기 B(문의 수집만)입니다. 가상 안내.'}),true));assert.ok(html.includes('분기 B(문의 수집만)입니다. 가상 안내.'));assert.ok(!button(html,'승인하기'));assert.ok(button(html,'편집'))});
// 결정 34: 체크리스트 6항목에 더해 '대기기간 우회 문장 없음' 확인란 1개가 있다(모두 7개).
check('R10: the approval step has seven unchecked boxes (six items and the wait-review confirmation), item warnings, gate warnings and a disabled approve button',()=>{
 const view=detailOf({gate:{status:200,reasons:[],message:null,warnings:['권장 문장이 없습니다(권장).']}}),html=keep(sheetHtml(view,true,'approve'));
 assert.ok(html.includes('승인 확인'));assert.equal(count(html,'type="checkbox"'),7);assert.ok(html.includes('id="approve-wait-confirm"'));assert.ok(!/type="checkbox"[^>]*checked=""/.test(html));assert.ok(html.includes('id="chk-no_wait_bypass-w"'));assert.ok(html.includes('aria-describedby="chk-no_wait_bypass-w"'));
 assert.ok(html.includes('주의: 판정기가 대기기간 표현을 확인하라고 알렸습니다.'));assert.ok(html.includes('주의: 권장 문장이 없습니다(권장).'));assert.ok(submitDisabled(html,'승인'));assert.ok(html.includes('aria-label="승인할 원문"'));assert.ok(button(html,'돌아가기'));
});
check('R10: approve enables only with every item checked; warnings alone never block it',()=>{
 const view=detailOf({gate:{status:200,reasons:[],message:null,warnings:['권장 문장이 없습니다(권장).']}});
 const all=keep(approveHtml(view,CL));assert.ok(button(all,'승인')&&!submitDisabled(all,'승인'));assert.equal(count(all,'checked=""'),7);
 assert.ok(submitDisabled(keep(approveHtml(view,CL,[],false)),'승인'),'every item without the wait-review confirmation keeps it disabled');
 assert.ok(submitDisabled(keep(approveHtml(view,CL.slice(0,5))),'승인'));
 assert.ok(submitDisabled(keep(approveHtml(view,CL,['게이트 사유를 고친 새 판을 저장해야 합니다.'])),'승인'),'a blocker keeps it disabled');
});
// 결정 34: 강조 조각을 이으면 원문 그대로이고, 강조된 조각은 후보 문장이다. 겹치거나 범위를 벗어난 후보는 버린다. 승인 단계 원문에 <mark>로 보인다.
check('R10w: highlight segments rebuild the body exactly and mark only valid candidates, the approval body shows them as <mark>',()=>{
 const body='첫 문장입니다. 정보공개서는 미리 드립니다.\n가맹비 안내',segs=assetsUi.highlightSegments(body,[{line:0,start:9,end:24},{line:0,start:10,end:12},{line:1,start:25,end:31},{line:9,start:30,end:99}]);
 assert.equal(segs.map(x=>x.text).join(''),body);assert.equal(JSON.stringify(segs.filter(x=>x.mark).map(x=>x.text)),JSON.stringify([body.slice(9,24),body.slice(25,31)]));
 const view=detailOf({waitReview:{version:'fr-wait-review@2026-09-27.1',candidates:[{line:0,start:0,end:5}]}}),html=keep(approveHtml(view,CL,[],false));
 assert.ok(html.includes('<mark class="franchise-wait-mark">'));assert.ok(html.includes('문장 1개를 읽었고'));
});
check('R11: an asset sourced from an AI artifact shows only the neutral source line, with no disclosure prompt, line or badge',()=>{
 const view={...detailOf({},{source:{artifactId:'art-ai',version:2,origin:'ai'},aiGenerated:true}),source:{artifactId:'art-ai',version:2,origin:'ai'},aiGenerated:true};
 const seen=keep(sheetHtml(view,true)),step=keep(sheetHtml(view,true,'approve'));
 assert.ok(seen.includes('출처 작업물 가상 AI 작업물 v2'));
 for(const html of [seen,step]){assert.ok(!html.includes(disclosure.AI_DISCLOSURE_LINE));for(const t of ['AI 도움','표시 문구','type="radio"','name="ai-disclosure"'])assert.ok(!html.includes(t),t)}
 assert.ok(keep(sheetHtml({...view,asset:{...view.asset,source:{artifactId:'art-missing',version:4,origin:null}}},true)).includes('출처 작업물 art-missing v4'));
});
check('R12: a new asset editor lists the seven types in order, the campaigns, the prefilled template and its fact refs',()=>{
 const html=keep(editorHtml({}));
 const select=html.slice(html.indexOf('aria-label="자료 유형"'));assert.deepEqual([...select.slice(0,select.indexOf('</select>')).matchAll(/<option value="([a-z_]+)"/g)].map(m=>m[1]),TYPES.map(t=>t.type));
 assert.ok(html.includes('>캠페인 선택</option>')&&html.includes('>가상 가맹 모집 A</option>'));assert.ok(html.includes('■ 창업비용 표 [사실]\n총 창업비용 · 소형 매장: 4,500만원'));
 assert.ok(/<input type="checkbox" checked=""[^>]*> 총 창업비용/.test(html),'template fact ref checked');assert.ok(/<input type="checkbox"(?![^>]*checked="")[^>]*> 가맹점 수/.test(html));assert.ok(html.includes('정보공개서 근거 없음'));
 assert.ok(button(html,'원문에 넣기')&&button(html,'템플릿 넣기'));assert.ok(html.includes('maxLength="20000"')||html.includes('maxlength="20000"'));assert.ok(html.includes('/ 20,000자'));assert.ok(submitDisabled(html,'초안 저장'),'no campaign chosen yet');
 assert.ok(!html.includes('승인된 작업물에서 가져오기'),'seeding waits for a campaign');
 assert.ok(keep(editorHtml({list:assetsViewOf({costFactsMissing:true})})).includes('총 창업비용 사실이 없어'));
 const off=keep(editorHtml({enabled:false}));assert.ok(off.includes(assetsUi.ASSETS_OFF_NOTE));assert.ok(submitDisabled(off,'초안 저장'));
});
check('R13: the edit editor locks the type and campaign, warns about draft replacement and seeds only approved artifacts of the campaign',()=>{
 const view=detailOf({},{factRefs:[{id:'bf-total',version:2},{id:'bf-gone',version:1}],source:{artifactId:'art-ai',version:2,origin:'ai'}});
 const html=keep(editorHtml({detail:view}));
 assert.ok(/<select[^>]*aria-label="자료 유형"[^>]*disabled=""|<select[^>]*disabled=""[^>]*aria-label="자료 유형"/.test(html));assert.ok(html.includes('모집 캠페인: 가상 가맹 모집 A'));assert.ok(html.includes(assetsUi.DRAFT_REPLACE_NOTE));
 assert.ok(html.includes('가상 AI 작업물 · v2 · 작성 뒤 사실·브랜드 정보 변경'));for(const t of ['가상 초안 작업물','다른 캠페인 작업물','AI 도움','직접 작성'])assert.ok(!html.includes(t),t);
 const offEdit=keep(editorHtml({detail:view,enabled:false}));assert.ok(offEdit.includes(assetsUi.ASSETS_OFF_NOTE));assert.ok(submitDisabled(offEdit,'초안 저장'),'the switch off locks a complete edit');
 assert.ok(html.includes('출처(이어받음): 가상 AI 작업물 v2'));assert.ok(html.includes('더 이상 쓸 수 없는 사실 bf-gone: 저장하면 근거에서 빠집니다'));assert.ok(!submitDisabled(html,'초안 저장'));
 const conflict=keep(editorHtml({detail:{...view,latestVersion:3,asset:{...view.asset,version:3,body:'다른 사용자의 최신 원문'}},conflict:true}));
 assert.ok(conflict.includes('다른 사용자가 v3을 저장했습니다.'));assert.ok(conflict.includes('다른 사용자의 최신 원문'));assert.ok(button(conflict,'최신 판 위에 저장')&&button(conflict,'최신 판으로 다시 시작'));
});
check('R14: with the switch off owner/admin keep only retire on an approved asset',()=>{const html=keep(sheetHtml(detailOf({enabled:false},{status:'approved',approval:APPROVAL,exports:[EXPORTED]}),true));for(const t of ['편집','승인하기','복사','게시 위치 기록'])assert.ok(!button(html,t),t);assert.ok(!html.includes('type="date"'));assert.ok(button(html,'폐기'));assert.ok(html.includes(assetsUi.ASSETS_OFF_NOTE))});
check('R14: a retired latest version has no edit and no retire button',()=>{const html=keep(sheetHtml(detailOf({},{status:'retired',retiredAt:at(-HOUR_MS),retiredBy:{id:'u-admin',role:'admin'}}),true));assert.ok(!button(html,'편집')&&!button(html,'폐기'));assert.ok(html.includes('폐기 ')&&html.includes(' · 관리자'))});
check('WarningLines renders string warnings and nothing when empty',()=>{assert.equal(renderToStaticMarkup(React.createElement(common.WarningLines,{items:['가','나']})),'<ul class="franchise-warnings"><li>주의: 가</li><li>주의: 나</li></ul>');assert.equal(renderToStaticMarkup(React.createElement(common.WarningLines,{items:[]})),'')});

const eventOf=(o={})=>({id:'re-f',campaignId:'ca-a',type:'tour',typeLabel:'견학',startsAt:at(3*DAY_MS),placeLabel:'가상 직영점',capacity:10,counts:{applied:3,attended:0,noShow:0},codes:[{code:'LKB728BT',state:'applied'}],assetRefs:[],status:'scheduled',version:2,createdBy:{id:'u-admin',role:'admin'},...o});
const EVENTS=[eventOf({assetRefs:[{id:'ra-9',version:1,type:'portal_intro',status:'retired'},{id:'ra-1',version:2,type:'event_deck',status:'approved'},{id:'ra-x',version:1,type:null,status:null}]}),
 eventOf({id:'re-p',type:'briefing',typeLabel:'설명회',startsAt:at(-HOUR_MS),counts:{applied:5,attended:2,noShow:1},codes:[{code:'LKC111AA',state:'attended'},{code:'LKD222BB',state:'applied'}]}),
 eventOf({id:'re-c',type:'expo',typeLabel:'박람회',startsAt:at(-5*DAY_MS),status:'cancelled',cancelledAt:at(-6*DAY_MS),cancelledBy:{id:'u-admin',role:'admin'}})];
const eventsViewOf=(o={})=>({events:EVENTS,followUps:{count:1,attended:2,noShow:1},approvedAssets:[{id:'ra-1',version:2,type:'event_deck',typeLabel:'설명회 덱 개요·원고',latest:true},{id:'ra-1',version:1,type:'event_deck',typeLabel:'설명회 덱 개요·원고',latest:false}],campaigns:CAMPAIGNS,types:[{type:'briefing',label:'설명회'},{type:'tour',label:'견학'},{type:'expo',label:'박람회'}],assetTypes:TYPES,branch:'A',h7Notice:null,enabled:true,disclaimer:DISCLAIMER,...o});
const eventsHtml=(view,admin)=>render(eventsUi.FranchiseEvents,{brandId:'fr-a',admin,onStatus:noop,initial:view});
check('R15: owner/admin see new event, edit and cancel on scheduled rows, the follow-up chip and a cancelled row without forms',()=>{const html=keep(eventsHtml(eventsViewOf(),true));
 assert.ok(button(html,'새 행사'));assert.equal(count(html,'>수정</button>'),2);assert.equal(count(html,'>행사 취소</button>'),2);assert.ok(html.includes('행사 뒤 48시간 연락: 행사 1건 · 참석 2 · 불참 1'));assert.ok(html.includes('리드 탭에서 리드 코드로 찾아 연락 기록을 남기세요.'));
 assert.ok(html.includes('<b>박람회</b>')&&html.includes('취소 ')&&html.includes(' · 관리자'));assert.equal(count(html,'>신청 기록</summary>'),2,'no forms on the cancelled row');assert.ok(html.includes('<h3>설명회·견학·박람회</h3>'));
 assert.ok(html.includes('연결 자료: 포털 소개문 v1 (폐기) · 설명회 덱 개요·원고 v2 (승인) · 자료 v1 (확인 불가)'));assert.ok(html.includes('가상 직영점 · 정원 10 · 신청 5 · 참석 2 · 불참 1'));
});
check('R16: a member registers on a future event and records attendance only from the event day',()=>{const html=keep(eventsHtml(eventsViewOf(),false));
 for(const t of ['새 행사','수정','행사 취소'])assert.ok(!button(html,t),t);assert.equal(count(html,'>신청 기록하기</button>'),1);assert.equal(count(html,'>참석 저장</button>'),1);
 const codeInput=(html.match(/<input[^>]*placeholder="예: LKB728BT"[^>]*>/)||[''])[0];assert.match(codeInput,/autocomplete="off"/i);assert.match(codeInput,/maxlength="64"/i);assert.ok(html.includes(eventsUi.CODE_HINT));
 assert.ok(html.includes('참석 기록은 행사일(KST)부터 할 수 있습니다.'));assert.ok(html.includes('시작한 행사입니다. 현장 참석은 참석 기록으로 남기세요.'));
 assert.ok(html.includes('aria-label="LKC111AA 상태"'));assert.ok(html.includes('value="2"')&&html.includes('value="1"'),'attendance starts from the recorded counts');
 const full=keep(eventsHtml(eventsViewOf({events:[eventOf({counts:{applied:10,attended:0,noShow:0}})]}),false));assert.ok(full.includes('정원이 찼습니다.'));assert.equal(count(full,'>신청 기록하기</button>'),0);
 const branchB=keep(eventsHtml(eventsViewOf({branch:'B',h7Notice:'분기 B(문의 수집만)입니다. 가상 안내.'}),true));assert.ok(!button(branchB,'새 행사')&&!button(branchB,'수정'));assert.equal(count(branchB,'>신청 기록하기</button>'),0);assert.equal(count(branchB,'>참석 저장</button>'),1,'attendance does not check the branch');assert.ok(branchB.includes('분기 B(문의 수집만)입니다. 가상 안내.'));
});
check('R17: with the switch off only owner/admin cancellation remains',()=>{const off=eventsViewOf({enabled:false});const admin=keep(eventsHtml(off,true)),member=keep(eventsHtml(off,false));
 for(const html of [admin,member]){for(const t of ['새 행사','수정','신청 기록하기','참석 저장'])assert.ok(!button(html,t),t);assert.ok(html.includes(eventsUi.EVENTS_OFF_NOTE));assert.equal(count(html,'<summary'),0,'no registration or attendance sections at all')}
 assert.equal(count(admin,'>행사 취소</button>'),2);assert.ok(!button(member,'행사 취소'));
 const loading=keep(render(eventsUi.FranchiseEvents,{brandId:'fr-a',admin:true,onStatus:noop}));assert.ok(loading.includes('행사를 불러오고 있습니다.'));
 const empty=keep(eventsHtml(eventsViewOf({events:[],followUps:{count:0,attended:0,noShow:0}}),true));assert.ok(empty.includes('등록된 설명회·견학·박람회가 없습니다.'));assert.ok(!empty.includes('행사 뒤 48시간 연락'));
});
check('R18: the event editor offers three types, a KST start without now, a 100-character place, a bounded capacity and approved versions only',()=>{
 const html=keep(render(eventsUi.EventEditor,{view:eventsViewOf(),event:null,busy:false,problem:null,onSave:async()=>true,onCancel:noop}));
 assert.deepEqual([...html.matchAll(/<option value="(briefing|tour|expo)"[^>]*>([^<]+)</g)].map(m=>m[2]),['설명회','견학','박람회']);assert.equal(count(html,'type="datetime-local"'),1);assert.ok(!html.includes('지금(서버 시각)'));
 assert.ok(/maxLength="100"|maxlength="100"/.test(html));assert.ok(/type="number"[^>]*min="1"[^>]*max="1000"|min="1"[^>]*max="1000"[^>]*type="number"/.test(html)||(html.includes('min="1"')&&html.includes('max="1000"')));
 assert.ok(html.includes('설명회 덱 개요·원고 v2')&&html.includes('설명회 덱 개요·원고 v1 (이전 판)'));assert.ok(!html.includes('R5 뒤'));assert.ok(html.includes('모집 비용 연결'));assert.ok(html.includes('>연결 없음</option>'));assert.ok(!/spendRef/.test(html));
 assert.ok(html.includes('행사장·건물 이름만 적습니다. 연락처·주민등록번호 같은 개인정보는 받지 않습니다.'));assert.ok(html.includes('>캠페인 선택</option>'));assert.ok(submitDisabled(html,'행사 저장'));
 const edit=keep(render(eventsUi.EventEditor,{view:eventsViewOf(),event:eventOf({assetRefs:[{id:'ra-9',version:1,type:'portal_intro',status:'retired'}]}),busy:false,problem:null,onSave:async()=>true,onCancel:noop}));
 assert.ok(edit.includes('min="3"'),'capacity cannot go below the applications');assert.ok(edit.includes('이미 받은 신청 3명보다 줄일 수 없습니다.'));assert.ok(edit.includes('포털 소개문 v1: 승인 판이 아니라 연결에서 빠집니다'));assert.ok(edit.includes(`value="${eventsUi.kstLocal(eventOf().startsAt)}"`));assert.ok(edit.includes('모집 캠페인: 가상 가맹 모집 A'));assert.ok(!submitDisabled(edit,'행사 저장'));
});
// ── 교차 검토(R15a-2b): 게이트 409·여러 사유·체크리스트 재검토·캠페인 삭제·승인 단계 가드·편집기 잠금·행사 편집기 사전 검사·반복 컨트롤 이름 ──
check('R20: a gate 409 lists the server reasons and never says nothing blocks',()=>{
 const html=keep(sheetHtml(detailOf({gate:{status:409,reasons:[{code:'footnote_missing',message:'가맹 사실의 정보공개서 각주 줄이 원문에 없습니다.'},{code:'h8_label_missing',message:'가상 표지 사유.'}],message:'가상 게이트 문구.',warnings:['가상 권장 경고.']}}),true));
 for(const t of ['가맹 사실의 정보공개서 각주 줄이 원문에 없습니다.','가상 표지 사유.','가상 게이트 문구.','주의: 가상 권장 경고.','게이트 사유를 고친 새 판을 저장해야 합니다.'])assert.ok(html.includes(t),t);
 assert.ok(!html.includes('현재 사실 기준으로 막는 사유가 없습니다.'));assert.ok(!button(html,'승인하기'));
});
check('R21: every blocker is shown, not only the first',()=>{const html=keep(sheetHtml(detailOf({branch:'B',h7Notice:'분기 B(문의 수집만)입니다. 가상 안내.',gate:{status:409,reasons:[],message:null,warnings:[]}},{review:{needed:true,reasons:['fact_changed'],at:null}}),true));
 for(const t of ['분기 B(문의 수집만)입니다. 가상 안내.','재검토가 필요합니다. 현재 사실로 새 판을 저장한 뒤 다시 승인하세요.','게이트 사유를 고친 새 판을 저장해야 합니다.'])assert.ok(html.includes(t),t)});
check('R22: an approval under an older checklist offers the resave in the review section without a server suggestion',()=>{
 const html=keep(sheetHtml(detailOf({},{status:'approved',approval:{...APPROVAL,checklist:{version:'fr-assets-checklist@old',checked:CL}}}),true));
 assert.ok(html.includes('<h3>재검토</h3>'));assert.ok(html.includes('근거 사실·정보공개서 버전이나 체크리스트가 바뀌었습니다.'));assert.ok(button(html,'현재 사실로 새 판 저장'));assert.ok(!button(html,'복사'));
});
check('R23: a deleted campaign hides edit and resave with a note and keeps retire',()=>{
 const view=detailOf({campaign:null,resaveSuggested:true,drift:DRIFT},{review:{needed:true,reasons:['fact_changed'],at:null}});
 for(const [admin,html] of [[true,keep(sheetHtml(view,true))],[false,keep(sheetHtml(view,false))]]){for(const t of ['편집','현재 사실로 새 판 저장','승인하기'])assert.ok(!button(html,t),t);assert.ok(html.includes(assetsUi.CAMPAIGN_GONE_EDIT),String(admin));assert.equal(button(html,'폐기'),admin)}
 const editor=keep(editorHtml({detail:view}));assert.ok(submitDisabled(editor,'초안 저장'));assert.ok(editor.includes(assetsUi.CAMPAIGN_GONE_EDIT));
});
check('R24: the approval step renders only for owner/admin on the latest draft',()=>{
 assert.ok(!keep(sheetHtml(detailOf(),false,'approve')).includes('id="approve-title"'),'member');
 const approvedView=keep(sheetHtml(detailOf({},{status:'approved',approval:APPROVAL}),true,'approve'));assert.ok(!approvedView.includes('id="approve-title"'));assert.ok(button(approvedView,'복사'),'the sheet falls back to the body');
 assert.ok(!keep(sheetHtml(detailOf({},{status:'retired',retiredAt:at(-HOUR_MS)}),true,'approve')).includes('id="approve-title"'),'retired');
 assert.ok(keep(sheetHtml(detailOf(),true,'approve')).includes('id="approve-title"'),'the draft still gets the step');
});
check('R25: the sheet editor follows the detail switch, not a stale list',()=>assert.ok(submitDisabled(keep(sheetHtml(detailOf({enabled:false}),true,'edit',assetsViewOf({enabled:true}))),'초안 저장')));
check('R26: the editor locks the draft save for an empty body and stops at 20 facts',()=>{
 assert.ok(submitDisabled(keep(editorHtml({detail:detailOf({},{body:''})})),'초안 저장'));
 const facts=Array.from({length:21},(_,i)=>({id:'bf-'+i,version:1,key:'k'+i,label:'사실 '+i,line:'줄 '+i,hasSource:true}));
 const html=keep(editorHtml({list:assetsViewOf({facts}),detail:detailOf({},{factRefs:facts.slice(0,20).map(x=>({id:x.id,version:1}))})}));
 assert.equal((html.match(/<input type="checkbox"[^>]*disabled=""/g)||[]).length,1,'only the 21st fact is locked');
});
const eventEditorHtml=(view,event)=>render(eventsUi.EventEditor,{view,event,busy:false,problem:null,onSave:async()=>'ok',onCancel:noop});
check('R27: the events tab offers a new event only with a recruitment campaign',()=>{assert.ok(!button(keep(eventsHtml(eventsViewOf({campaigns:[]}),true)),'새 행사'));assert.ok(button(keep(eventsHtml(eventsViewOf(),true)),'새 행사'))});
check('R28: attendance save stays locked while the pre-check has a problem',()=>{
 const html=keep(eventsHtml(eventsViewOf({events:[eventOf({startsAt:at(-HOUR_MS),counts:{applied:1,attended:0,noShow:0},codes:[{code:'LKB728BT',state:'attended'}]})]}),false));
 assert.ok(submitDisabled(html,'참석 저장'));assert.ok(html.includes('참석으로 표시한 코드가 참석 수보다 많습니다.'));
});
check('R29: the event editor locks save below the applications or above 1,000 and allows ten linked assets',()=>{
 assert.ok(submitDisabled(keep(eventEditorHtml(eventsViewOf(),eventOf({capacity:2,counts:{applied:3,attended:0,noShow:0}}))),'행사 저장'),'below the applications');
 assert.ok(submitDisabled(keep(eventEditorHtml(eventsViewOf(),eventOf({capacity:1001}))),'행사 저장'),'above 1,000');
 assert.ok(!submitDisabled(keep(eventEditorHtml(eventsViewOf(),eventOf({capacity:3,counts:{applied:3,attended:0,noShow:0}}))),'행사 저장'),'equal to the applications');
 const assets=Array.from({length:11},(_,i)=>({id:'ra-'+i,version:1,type:'event_deck',typeLabel:'설명회 덱 개요·원고',latest:true})),ev=eventOf({assetRefs:assets.slice(0,10).map(a=>({id:a.id,version:1,type:'event_deck',status:'approved'}))});
 assert.equal((keep(eventEditorHtml(eventsViewOf({approvedAssets:assets}),ev)).match(/<input type="checkbox"[^>]*disabled=""/g)||[]).length,1,'only the 11th asset is locked');
});
check('R30: a new briefing suggests the approved deck',()=>assert.ok(keep(eventEditorHtml(eventsViewOf(),null)).includes('설명회에는 승인된 설명회 덱(표준 순서)을 연결하기를 권합니다.')));
check('R31: the event editor locks save and says why when the switch is off or the brand is not branch A',()=>{
 const off=keep(eventEditorHtml(eventsViewOf({enabled:false}),eventOf()));assert.ok(submitDisabled(off,'행사 저장'));assert.ok(off.includes(eventsUi.EVENTS_OFF_NOTE));
 const b=keep(eventEditorHtml(eventsViewOf({branch:'B',h7Notice:'분기 B(문의 수집만)입니다. 가상 안내.'}),eventOf()));assert.ok(submitDisabled(b,'행사 저장'));assert.ok(b.includes('분기 B(문의 수집만)입니다. 가상 안내.'));
 const none=keep(eventEditorHtml(eventsViewOf({branch:null,h7Notice:null}),eventOf()));assert.ok(submitDisabled(none,'행사 저장'));assert.ok(none.includes(eventsUi.EDIT_BRANCH_NOTE));
});
check('R32: repeated controls carry their row context for screen readers',()=>{
 const ed=keep(editorHtml({}));for(const f of FACTS)assert.ok(ed.includes(`aria-label="${f.label} 원문에 넣기"`),f.label);
 const ev=keep(eventsHtml(eventsViewOf(),true)),row=`견학 ${common.kst(EVENTS[0].startsAt)}`;
 for(const t of ['수정','행사 취소','신청 기록','참석 기록'])assert.ok(ev.includes(`aria-label="${row} ${t}"`),t);
 assert.equal(count(ev,'aria-label="'+row+' 수정"'),1,'each row names itself');
});
check('R19: the new screens make no legal-compliance claim and show no AI disclosure',()=>{assert.ok(newHtml.length>=30);for(const html of newHtml){for(const bad of ['법적으로 적합','준수 완료','합법','AI 도움','name="ai-disclosure"'])assert.ok(!html.includes(bad),bad);assert.ok(!html.includes(disclosure.AI_DISCLOSURE_LINE))}});
console.log(JSON.stringify({passed},null,2));
