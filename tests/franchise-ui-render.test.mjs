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
const REAL_APP=new Set(['./franchise-common','./franchise-lead-detail','./franchise-settings']);
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
check('lead registration asks only the minimum and turns autofill off',()=>{assert.ok(has(createMember,'이름 *'));assert.ok(has(createMember,'전화·이메일 중 하나 이상'));assert.equal((createMember.match(/autoComplete="off"|autocomplete="off"/gi)||[]).length,5,'form + name, phone, email, memo');for(const t of ['주소 입력','생년월일 입력','주민등록번호 입력'])assert.ok(!has(createMember,t))});
check('marketing consent is unchecked by default and owner/admin only',()=>{assert.ok(has(createAdmin,'광고성 정보 수신 동의를 따로 받았습니다'));assert.ok(!/type="checkbox" checked=""[^>]*\/?> 광고성/.test(createAdmin));assert.ok(!has(createMember,'광고성 정보 수신 동의를 따로 받았습니다'));assert.ok(has(createMember,'광고성 정보 동의는 기본으로 ‘동의 없음’입니다.'))});
check('the default basis is an inquiry response and the assignee choice is owner/admin only',()=>{assert.match(createMember,/checked=""[^>]*\/> 문의 응대\(제15조①4호\)/);assert.ok(has(createAdmin,'담당자'));assert.ok(has(createAdmin,'담당 없음'));assert.ok(!has(createMember,'>담당 없음<'))});
check('rendered screens make no legal-compliance claim',()=>{for(const html of [adminHtml,memberHtml,createAdmin,createMember])for(const bad of ['법적으로 적합','준수 완료','합법'])assert.ok(!html.includes(bad))});
console.log(JSON.stringify({passed},null,2));
