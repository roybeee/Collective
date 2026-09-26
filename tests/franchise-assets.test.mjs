// R15a-1 모집 자료 키트 순수 판정 모듈(lib/franchise-assets.ts) 회귀: 자료 유형·고정 절, 원문 SHA-256(정규화 없음), 입력 검사, 초안 버전, 절 구조, 승인·내보내기(R2 모집 범위 전체 판정·H8·각주·근거 사실·말로 쓰는 원고 수익 안전망),
// 승인 체크리스트(near-miss 세 유형·H7 안내), 재검토 표시, 설명회·견학·박람회(정원·신청·참석 KST 날짜), 게시 위치, 던지지 않음, 사유 코드 51개와 상태 코드 불변식, 순수성·가드 컨텍스트 재실행.
// 근거: mocked(순수 함수, 합성 픽스처, 외부 호출 0회). 법률 적합성은 not_run(LR-1 대상). HTTP 403·409 연결, 실제 D1, 잠금·요청 제한은 R15a-2 몫이다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';
import {sha64,plain,DISCLAIMER} from './helpers/franchise-fixture.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const fa=await rt.load('lib/franchise-assets.ts'),ff=await rt.load('lib/franchise-facts.ts'),fr=await rt.load('lib/franchise-rules.ts'),bf=await rt.load('lib/brand-facts.ts'),jc=await rt.load('lib/franchise-compliance.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
const asc=(a,b)=>a<b?-1:a>b?1:0;
// 기대값으로 쓴 사유 코드(seen)와 실제로 나온 사유 코드(produced)를 모아 마지막에 51개가 모두 나왔는지 본다.
const seen=new Set(),produced=new Set();const E=(...codes)=>{codes.forEach(c=>seen.add(c));return codes};
let failCount=0;
// 모든 실패 결과는 D를 거친다: 사유는 정렬·중복 없음, 모든 사유의 상태 코드가 결과 상태와 같다(단계 불변식), 문구·버전·면책이 있다.
const D=r=>{
 assert.equal(r?.ok,false,'실패 결과여야 합니다: '+JSON.stringify(plain(r)));
 assert.ok(Array.isArray(r.reasons)&&r.reasons.length>0,'사유가 있어야 합니다');
 assert.ok(r.reasons.every(c=>fa.ASSET_CODE_STATUS[c]===r.status),'상태 코드 불변식: '+r.status+' '+r.reasons.join(','));
 assert.deepEqual(plain(r.reasons),[...new Set(plain(r.reasons))].sort(asc));
 assert.ok(typeof r.message==='string'&&r.message.length>0);
 assert.equal(r.ruleVersion,fa.ASSETS_VERSION);assert.equal(r.disclaimer,DISCLAIMER);
 failCount++;r.reasons.forEach(c=>produced.add(c));return r;
};
const is=(r,...codes)=>{D(r);return same(r.reasons,E(...codes))};
const OK=r=>r?.ok===true&&r.status===200&&r.ruleVersion===fa.ASSETS_VERSION&&r.disclaimer===DISCLAIMER&&Array.isArray(r.warnings);

// ── 합성 픽스처(명세 4.1) ──
const NOW='2026-10-10T09:00:00+09:00',LATER='2026-10-20T14:00:00+09:00';
const V=[{id:'dvA',brandId:'b1',label:'2026-1',registeredAt:'2026-03-02T09:00:00+09:00',validFrom:'2026-03-02T00:00:00+09:00',validUntil:'2027-04-30T00:00:00+09:00',status:'active'},
 {id:'dvX',brandId:'b2',label:'2026-1',registeredAt:'2026-03-02T09:00:00+09:00',validFrom:'2026-03-02T00:00:00+09:00',validUntil:'2027-04-30T00:00:00+09:00',status:'active'}];
const V_NEW=[...V,{id:'dvB',brandId:'b1',label:'2026-2',registeredAt:'2026-10-05T09:00:00+09:00',validFrom:'2026-10-05T00:00:00+09:00',validUntil:'2027-10-30T00:00:00+09:00',status:'active'}];
const base={brandId:'b1',status:'confirmed',source:'정보공개서',verifiedAt:'2026-09-20T00:00:00.000Z',validUntil:'2027-04-01T00:00:00.000Z',version:1,updatedAt:'2026-09-20T00:00:00.000Z'};
const SRC=(page,x={})=>({disclosureVersionId:'dvA',fiscalYear:2025,page,...x});
const F={
 total:{...base,id:'f-total',key:'startup_cost_total',value:'4,500만원',sourceRef:SRC(12),cost:{storeType:'소형 매장',includes:['가맹비','교육비','인테리어'],excludes:['임차보증금','권리금'],areaM2:33}},
 count:{...base,id:'f-count',key:'franchise_store_count',value:'12개',sourceRef:SRC(3,{asOf:'2025-12-31'})},
 prod:{...base,id:'f-prod',key:'production_method',value:'매장에서 수제로 생산',sourceRef:SRC(30)},
 claim:{...base,id:'f-claim',key:'claim_basis',value:'가상연구소 2026 도넛 조사'},
 rev:{...base,id:'f-rev',key:'monthly_sales',value:'3,200만원',sourceRef:SRC(20)},
 nosrc:{...base,id:'f-nosrc',key:'franchise_fee',value:'500만원'},
 menu:{...base,id:'f-menu',key:'signature_menu',value:'우유 도넛'},
 other:{...base,id:'f-other',brandId:'b2',key:'franchise_store_count',value:'40개',sourceRef:{disclosureVersionId:'dvX',fiscalYear:2025,page:3,asOf:'2025-12-31'}},
 store:{...base,id:'f-store',storeId:'s1',key:'parking',value:'매장 앞 2대'},
 cand:{...base,id:'f-cand',status:'candidate',key:'promotion',value:'오픈 이벤트'},
 exp:{...base,id:'f-exp',key:'hours',value:'매일 영업',validUntil:'2026-10-10T00:00:00.000Z'},
 future:{...base,id:'f-future',key:'official_account',value:'도넛 공식 계정',verifiedAt:'2026-10-11T00:00:00.000Z'},
 blank:{...base,id:'f-blank',key:'delivery',value:'포장 가능',source:'  '},
};
const FOOT='※ 정보공개서 등록 버전 2026-1(등록일 2026-03-02) · 기준 사업연도 2025년 · 확인일 2026-09-20';
const CAMP={id:'c1',brandId:'b1',objective:'franchise_recruitment'},CONSUMER={id:'c2',brandId:'b1'},CAMP_B2={id:'c3',brandId:'b2',objective:'franchise_recruitment'};
const OWNER={id:'u-owner',role:'owner'},ADMIN={id:'u-admin',role:'admin'},MEMBER={id:'u-member',role:'member'};
const CTX={enabled:true,brandId:'b1',branch:'A',campaign:CAMP,facts:Object.values(F),versions:V,now:NOW};
const BF=Object.values(F).filter(f=>f.brandId==='b1');

// 문서 조립: 모듈이 내보낸 절 명세·고정 문장과 사실 줄·각주로 만든다.
const FILL_WHY='매일 아침 굽는 도넛으로 동네 손님과 가까워진 브랜드입니다.',FILL_SUPPORT='오픈 첫 달 운영 교육을 지원합니다(계약 체결 가맹점, 개점일부터 30일간).';
const PAGE_FILL={why:[FILL_WHY],cost:[ff.factLine(F.total),FOOT],support:[FILL_SUPPORT],process:[...fa.WAITING_NOTES],faq:['Q. 가맹 상담은 어떻게 하나요? A. 문의 경로로 신청해 주세요.'],contact:['창업 상담 신청서로 문의해 주세요.']};
const DECK_FILL={story:[FILL_WHY],demo:['우유 도넛을 함께 맛보는 시간입니다.'],cost:[ff.factLine(F.total),FOOT],support:[FILL_SUPPORT],process:[...fa.WAITING_NOTES],qna:[fa.REVENUE_QNA_NOTE]};
const blocksOf=(sections,fill)=>sections.map(s=>({id:s.id,heading:s.heading,lines:[...fill[s.id]]}));
const joinBlocks=bs=>bs.map(b=>[...(b.heading===null?[]:[b.heading]),...b.lines].join('\n')).join('\n\n');
const PAGE=(edit=bs=>bs)=>joinBlocks(edit(blocksOf(fa.STARTUP_PAGE_SECTIONS,PAGE_FILL)));
const DECK=(edit=bs=>bs)=>joinBlocks(edit(blocksOf(fa.EVENT_DECK_SECTIONS,DECK_FILL)));
const lines=(id,f)=>bs=>bs.map(b=>b.id===id?{...b,lines:f(b.lines)}:b);
const heading=(id,h)=>bs=>bs.map(b=>b.id===id?{...b,heading:h}:b);
const inputOf=(body,refs=['f-total'],type='startup_page',x={})=>({type,body,factRefs:refs.map(id=>({id,version:1})),...x});
const VAL=(body,refs,type,ctx=CTX)=>fa.validateAssetInput(inputOf(body,refs,type),ctx);
const META={id:'a-page',brandId:'b1',campaignId:'c1',now:NOW};
const DRAFT=async(body,refs=['f-total'],type='startup_page',ctx=CTX,id='a-'+type)=>{const v=VAL(body,refs,type,ctx);assert.ok(v.ok,'초안 입력: '+JSON.stringify(plain(v.reasons??[])));return fa.draftAsset(null,v.value,{...META,id,now:ctx.now})};
const APPROVE_IN=a=>({bodyHash:a.bodyHash,checklist:{version:fa.CHECKLIST_VERSION,checked:[...fa.CHECKLIST_IDS]}});
const ACTX={...CTX,actor:OWNER},XCTX={...CTX,actor:ADMIN};
const APPROVED=async(body,refs=['f-total'],type='startup_page',ctx=CTX,id)=>{const d=await DRAFT(body,refs,type,ctx,id);const r=await fa.approveDecision(d,APPROVE_IN(d),{...ctx,actor:OWNER});assert.ok(r.ok,'승인: '+JSON.stringify(plain(r.reasons??[]))+' '+r.message);return {...plain(d),status:'approved',approval:plain(r.value.approval)}};
const FORGE=(body,refs=[],type='portal_intro',x={})=>{const h=sha64(body);return {id:'a-forge',brandId:'b1',campaignId:'c1',type,version:1,body,bodyHash:h,factRefs:refs.map(id=>({id,version:1})).sort((a,b)=>asc(a.id,b.id)),disclosureVersionId:'dvA',status:'approved',approval:{by:'u-owner',role:'owner',at:NOW,bodyHash:h,checklist:{version:fa.CHECKLIST_VERSION,checked:[...fa.CHECKLIST_IDS]}},placements:[],exports:[],review:{needed:false,reasons:[],at:null},createdAt:NOW,updatedAt:NOW,...x}};
const EXP=(a,ctx=XCTX)=>fa.exportDecision(a,ctx);
const APP=(a,input=APPROVE_IN(a),ctx=ACTX)=>fa.approveDecision(a,input,ctx);

// ════ 순수성·경계 ════
const src=readFileSync('lib/franchise-assets.ts','utf8');
const IMPORTS=["import {FRANCHISE_RULES_VERSION,FRANCHISE_REVIEW_NET,isInstant,parseInstant,isDate,toKstDate,kstDateOf} from './franchise-rules';",
 "import {judgeFranchiseText,franchiseGateError,franchiseIssueLabels,mentionedFranchiseFacts,type FranchiseJudgement} from './franchise-compliance';",
 "import {factLine,footnoteIssues,franchiseFactUseIssue,versionStates,currentDisclosureVersion,FRANCHISE_FACT_MESSAGES,type VersionLite} from './franchise-facts';",
 "import {GATE_DISCLAIMER} from './franchise-gates';","import {franchiseItem} from './fact-catalog';","import {isRecruitmentObjective} from './agency';","import type {BrandFact} from './brand-facts';"];
const importLines=(src.match(/^\s*import\s.*$/gm)||[]).map(x=>x.trim());
check('1: the module has exactly the seven specified import lines',same(importLines,IMPORTS));
const specs=[...src.matchAll(/\bfrom\s*'([^']+)'|\bimport\s*\(\s*['"`]([^'"`]+)|\brequire\s*\(\s*['"`]([^'"`]+)/g)].map(m=>m[1]??m[2]??m[3]);
const FORBIDDEN=['./server','./execution-server','./brand-facts-server','./franchise-facts-server','./franchise','./franchise-server','./franchise-crypto','./feature-flags','./prompt-registry','./execution-media'];
check('1: brand-facts is a type-only import, no .ts extension, no @/ path, no forbidden module, no dynamic import',importLines.find(l=>l.includes("'./brand-facts'")).startsWith('import type ')&&specs.length===7&&specs.every(s=>s.startsWith('./')&&!s.endsWith('.ts')&&!FORBIDDEN.includes(s))&&!/\bimport\s*\(|\brequire\s*\(/.test(src)&&!src.includes("'@/"));
// 모듈 참조를 TypeScript 구문 트리로도 모은다(tests/franchise-model-boundary.test.mjs parseImports와 같은 노드): 따옴표 종류, export from, 한 줄의 여러 문장, import(), require, import 타입, import =.
const moduleRefs=text=>{
 const out=[],sf=ts.createSourceFile('m.ts',text,ts.ScriptTarget.Latest,false,ts.ScriptKind.TS),lit=n=>n&&(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))?n.text:'(opaque)';
 const visit=n=>{
  if(ts.isImportDeclaration(n))out.push({kind:n.importClause?.isTypeOnly?'import type':'import',spec:lit(n.moduleSpecifier)});
  else if(ts.isExportDeclaration(n)&&n.moduleSpecifier)out.push({kind:'export',spec:lit(n.moduleSpecifier)});
  else if(ts.isImportEqualsDeclaration(n)&&ts.isExternalModuleReference(n.moduleReference))out.push({kind:'import=',spec:lit(n.moduleReference.expression)});
  else if(ts.isImportTypeNode(n))out.push({kind:'import type()',spec:ts.isLiteralTypeNode(n.argument)?lit(n.argument.literal):'(opaque)'});
  else if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(n.expression)&&n.expression.text==='require')))out.push({kind:'call',spec:lit(n.arguments[0])});
  ts.forEachChild(n,visit);
 };
 visit(sf);return out;
};
const SPECS=['./franchise-rules','./franchise-compliance','./franchise-facts','./franchise-gates','./fact-catalog','./agency','./brand-facts'],srcRefs=moduleRefs(src);
check('1: the syntax tree holds exactly the seven module references, all static imports and brand-facts type-only',same(srcRefs,SPECS.map(spec=>({kind:spec==='./brand-facts'?'import type':'import',spec}))));
const SNEAK=['export {} from "./franchise";','const a=0;import {x} from "./franchise";','import * as s from "./server";','const m=import("./feature-flags");','const r=require("./franchise-crypto");','type T=typeof import("./franchise-server");','import fs = require("./execution-server");','export * from \'./prompt-registry\';'];
check('1: the syntax-tree check catches double quotes, export-from, mid-line imports, import(), require, import types and import =',SNEAK.every(t=>{const refs=moduleRefs(src+'\n'+t);return refs.length===8&&FORBIDDEN.includes(refs[7].spec)&&!same(refs,plain(srcRefs))}));
const code=src.replace(/^\s*\/\/.*$/gm,'');
const CLOCK=/(?<!new\s+)\bDate\s*\(|new\s+Date\b(?!\s*\(\s*[^)\s])|\bDate\s*\[|\bDate\.(now|parse)\b|Reflect\.construct|performance\.|Math\.random|\bprocess\.|\bcrypto\.(?!subtle\.digest\()|globalThis|\beval\s*\(|\bFunction\s*\(/;
check('2: the clock pattern catches bypass forms and allows only crypto.subtle.digest',['new Date;','new Date ()','Date()','Date["now"]()','Date.parse(x)','Reflect.construct(Date,[])','Math.random()','process.env.X','crypto.randomUUID()','crypto.getRandomValues(a)','crypto.subtle.encrypt(a)','globalThis.fetch'].every(x=>CLOCK.test(x))&&!CLOCK.test("crypto.subtle.digest('SHA-256',b)")&&!CLOCK.test('new Date(ms).getUTCDay()'));
check('2: the module reads no clock, randomness or environment and digests exactly once',!CLOCK.test(code)&&(code.match(/crypto\.subtle\.digest\(/g)||[]).length===1&&(src.match(/crypto\.subtle\.digest\(/g)||[]).length===1&&src.includes("Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('')"));
check('3: no fetch call, URL or any',!/\bfetch\s*\(/.test(src)&&!/\bURL\b/.test(code)&&!/\bany\b/.test(code));
check('4: no record-kind literal forms the scanner would register',!/kind\s*=\s*'/.test(src)&&!/recordStatement|readRecord|listRecords|optionalRecord/.test(src)&&!/:recruitment_(asset|event):/.test(src)&&!/\$\{owner\}:/.test(src));
const walk=d=>readdirSync(d).flatMap(x=>{const p=join(d,x);return statSync(p).isDirectory()?(x==='node_modules'||x.startsWith('.')?[]:walk(p)):/\.(ts|tsx|mjs|js)$/.test(x)?[p]:[]});
const importers=['app','lib','components','hooks'].flatMap(walk).filter(p=>p!==join('lib','franchise-assets.ts')&&readFileSync(p,'utf8').includes('franchise-assets'));
check('5: no app, lib, component or hook source imports the module yet (R15a-1)',importers.length===0);

// ════ 상수 ════
check('7: seven asset types sorted with fixed labels and a permutation for screen order',same(fa.ASSET_TYPES,['event_deck','expo_banner','first_call_script','meta_lead_ad','naver_search','portal_intro','startup_page'])&&same(fa.ASSET_TYPE_ORDER,['startup_page','portal_intro','naver_search','meta_lead_ad','expo_banner','event_deck','first_call_script'])&&same([...fa.ASSET_TYPE_ORDER].sort(asc),plain(fa.ASSET_TYPES))
 &&same(fa.ASSET_TYPE_LABELS,{startup_page:'창업 페이지 문안',portal_intro:'포털 소개문',naver_search:'네이버 검색 문안',meta_lead_ad:'메타 리드광고 문안',expo_banner:'박람회 배너·리플렛 문안',event_deck:'설명회 덱 개요·원고',first_call_script:'첫 통화 스크립트'})&&same(fa.SPOKEN_ASSET_TYPES,['event_deck','first_call_script']));
const PAGE_HEADINGS=['■ 왜 이 브랜드인가 [의견]','■ 창업비용 표 [사실]','■ 지원 내용 [조건·기간 병기]','■ 가맹 절차와 정보공개서 제공 뒤 대기기간 [COLLECTIVE 휴리스틱 · 법률 자문 아님]','■ 자주 묻는 질문','■ 문의 경로'];
const DECK_HEADINGS=['■ 브랜드 이야기 [의견]','■ 메뉴 시연 또는 직영 공간 견학·시식','■ 창업비용 표 [사실]','■ 지원 [조건·기간 병기]','■ 가맹 절차와 두 대기기간 [COLLECTIVE 휴리스틱 · 법률 자문 아님]','■ 질의응답'];
const WAIT=['정보공개서를 받은 날부터 14일(변호사·가맹거래사에게 정보공개서 자문을 받았다면 7일)이 지나기 전에는 가맹계약을 체결하거나 가맹금을 받지 않습니다.','가맹계약서안을 받은 날부터 14일(계약서 자문을 받았다면 7일)이 지나기 전에도 가맹계약을 체결하거나 가맹금을 받지 않습니다.'];
const QNA='수익에 관한 질문은 정보공개서와 서면 자료로 안내합니다.';
const allSections=[...fa.STARTUP_PAGE_SECTIONS,...fa.EVENT_DECK_SECTIONS];
check('8: the twelve headings, section ids and four labels are fixed',same(fa.STARTUP_PAGE_SECTIONS.map(s=>s.heading),PAGE_HEADINGS)&&same(fa.EVENT_DECK_SECTIONS.map(s=>s.heading),DECK_HEADINGS)&&fa.SECTION_MARK==='■ '
 &&same(fa.STARTUP_PAGE_SECTIONS.map(s=>s.id),['why','cost','support','process','faq','contact'])&&same(fa.EVENT_DECK_SECTIONS.map(s=>s.id),['story','demo','cost','support','process','qna'])
 &&allSections.every(s=>s.heading===fa.SECTION_MARK+s.title+(s.label?' '+s.label:''))&&['[의견]','[사실]','[조건·기간 병기]',`[${DISCLAIMER}]`].every(l=>allSections.some(s=>s.label===l)));
check('8: waiting notes, the revenue note and fixed lines are pinned',same(fa.WAITING_NOTES,WAIT)&&fa.REVENUE_QNA_NOTE===QNA&&allSections.every(s=>same(s.fixedLines,s.id==='process'?WAIT:s.id==='qna'?[QNA]:[])&&s.costLines===(s.id==='cost')));
const ruleIds=new Set(fr.FRANCHISE_RULES.map(r=>r.id));
const ITEMS=[
 ['no_wait_bypass',"대기기간 우회 없음: 가계약금·예약금·선점금·홀딩비, 입금 순서로 자리 확정, '바로 계약·대기 없이' 같은 표현이 없고, 정보공개서·계약서안을 받은 날부터 14일(자문 시 7일)이 지나기 전에는 계약하거나 가맹금을 받지 않는다고 안내합니다.",['h.wait_bypass_solicitation','kr.fr.disclosure_wait','kr.fr.draft_wait']],
 ['no_association_condition','단체 가입 조건 없음: 가맹점사업자단체 가입·미가입을 계약 조건이나 지원·불이익의 조건으로 적지 않았습니다.',['kr.fr.association_condition','kr.fr.association_condition_2026']],
 ['no_captive_advisor','본사 연계 자문 없음: 본부가 변호사·가맹거래사·행정사 같은 자문자를 지정·소개하거나 비용을 대는 것처럼, 본부 연계 자문으로 계약이 빨라지는 것처럼 쓰지 않았습니다.',['h.advice_shortening_evidence','h.captive_advisor_phrase']],
 ['no_revenue_figures','수익 수치 없음: 평균매출·월 매출·순수익·수익률·투자금 회수 기간을 예시 점주·돌려 말하기·질문 답변 형태로도 쓰지 않았고, 수익 질문은 서면 절차 안내로만 답합니다(H6).',['h.net_profit_payback_claims','h.revenue_figures_no_ad','kr.fr.revenue_guarantee']],
 ['h7_branch_a','분기 A 확인: 가맹 준비도 분기 A(모집 가능)와 현재 정보공개서 등록 버전을 확인했습니다. 분기 B·C·판정 불가가 되면 유료 모집 광고·박람회·설명회·가맹 조건 제시를 멈춥니다(H7).',['h.pre_registration_recruiting']],
 ['endorsement_disclosure',"추천·보증 표시: 점주·대표 후기·인터뷰나 AI 가상인물이 있으면 경제적 이해관계와 '가상인물' 표시를 첫머리에 적었습니다(없으면 해당 없음으로 확인).",['kr.ad.endorsement_disclosure','kr.ad.virtual_human_label']]];
check('9: the checklist has six fixed items in screen order and sorted ids',same(fa.CHECKLIST_ITEMS,ITEMS.map(([id,text,ruleIds])=>({id,text,ruleIds})))&&same(fa.CHECKLIST_IDS,ITEMS.map(x=>x[0]).sort(asc)));
check('9: every checklist rule exists, including the three near-miss families, H6 and H7',fa.CHECKLIST_ITEMS.every(i=>i.ruleIds.length>0&&i.ruleIds.every(id=>ruleIds.has(id)))&&['h.wait_bypass_solicitation','kr.fr.association_condition','kr.fr.association_condition_2026','h.captive_advisor_phrase','h.revenue_figures_no_ad','h.pre_registration_recruiting'].every(id=>fa.CHECKLIST_ITEMS.some(i=>i.ruleIds.includes(id))));
const H7={B:`분기 B(문의 수집만)입니다. 정보공개서 등록·변경등록이나 보완이 끝나기 전에는 유료 모집 광고·박람회·설명회·가맹 조건 제시와 가맹금·예약금 수령을 하지 않고, 브랜드 자체 채널에는 가맹 조건과 문의 유도 없이 브랜드 이야기만 씁니다(H7). 이 자료는 승인·내보내기할 수 없습니다. ${DISCLAIMER}`,
 C:`분기 C(모집 불가)입니다. 모집 광고와 가맹 상담을 하지 않습니다(H7). 이 자료는 승인·내보내기할 수 없습니다. ${DISCLAIMER}`,
 undetermined:`가맹 준비도 분기가 판정되지 않았습니다. 분기 A(모집 가능)로 기록되기 전에는 모집 자료를 승인·내보내지 않고 설명회·견학·박람회를 열지 않습니다(H7). ${DISCLAIMER}`};
check('9: the H7 notices are pinned with the disclaimer',same(fa.H7_NOTICES,H7));
const unionIds=[...new Set([...ITEMS.flatMap(x=>x[2]),'h.fact_opinion_labels'])].sort(asc);
check('10: asset rules carry versions, disclaimer, KST and registry rule ids',fa.ASSETS_VERSION==='fr-assets@2026-09-26.1'&&fa.CHECKLIST_VERSION==='fr-assets-checklist@2026-09-26.1'&&same(fa.ASSET_RULES,{assetsVersion:'fr-assets@2026-09-26.1',checklistVersion:'fr-assets-checklist@2026-09-26.1',rulesVersion:fr.FRANCHISE_RULES_VERSION,ruleIds:unionIds,disclaimer:DISCLAIMER,timezone:'+09:00'})&&fa.ASSET_RULES.ruleIds.every(id=>ruleIds.has(id)));
const STATUS={asset_not_approved:409,attendance_before_event:400,block_unresolved:409,branch_not_a:409,campaign_not_recruitment:409,campaign_other_brand:400,capacity_below_applied:409,capacity_full:409,checklist_incomplete:400,checklist_outdated:409,code_duplicate:409,code_unknown:400,cost_table_missing:409,event_cancelled:409,event_started:409,fact_changed:409,fact_other_brand:400,fact_ref_missing:409,fact_revenue:409,fact_source_missing:409,fact_stale:409,fact_store_scoped:400,footnote_missing:409,h8_label_missing:409,hard_block:409,hash_mismatch:409,invalid_body:400,invalid_code:400,invalid_counts:400,invalid_event:400,invalid_fact_refs:400,invalid_input:400,invalid_placement:400,invalid_record:400,invalid_timestamp:400,invalid_type:400,not_approved:409,not_draft:409,not_exported:409,record_other_brand:400,revenue_qna_note_missing:409,review_needed:409,role_forbidden:403,section_duplicate:409,section_missing:409,section_order:409,section_unknown:409,spoken_revenue_figure:409,switch_off:409,version_not_current:409,waiting_note_missing:409};
const FM=plain(ff.FRANCHISE_FACT_MESSAGES);
const MESSAGES={asset_not_approved:'승인된 모집 자료 버전만 행사에 연결할 수 있습니다.',attendance_before_event:'행사일(KST) 전에는 참석·불참을 기록할 수 없습니다.',block_unresolved:'가맹 모집 규칙상 근거 사실이 필요한 표현이 남아 있습니다.',
 branch_not_a:`가맹 준비도 분기가 A(모집 가능)로 기록된 브랜드만 모집 자료를 승인·내보내고 설명회·견학·박람회를 열 수 있습니다(H7). ${DISCLAIMER}`,campaign_not_recruitment:'가맹 모집 목적 캠페인에서만 모집 자료와 행사를 만들 수 있습니다.',campaign_other_brand:'이 브랜드의 캠페인이 아닙니다.',
 capacity_below_applied:'정원은 이미 받은 신청 수보다 작게 줄일 수 없습니다.',capacity_full:'정원이 찼습니다. 신청을 더 받을 수 없습니다.',checklist_incomplete:'승인 체크리스트의 모든 항목을 확인해야 승인할 수 있습니다.',checklist_outdated:'승인 체크리스트가 바뀌었습니다. 새로고침하고 새 체크리스트로 다시 확인하세요.',
 code_duplicate:'이미 신청 기록이 있는 가명 코드입니다.',code_unknown:'신청 기록에 없는 가명 코드입니다.',cost_table_missing:'창업비용 표 절에 매장 유형별 총 창업비용과 선택한 창업비용 사실의 사실 줄(유형·금액·포함·불포함)을 그대로 넣으세요.',event_cancelled:'취소된 행사입니다.',
 event_started:'시작한 행사에는 신청을 받을 수 없습니다. 현장 참석은 참석 기록으로 남기세요.',fact_changed:'선택한 사실이 변경됐거나 확정·유효 상태가 아닙니다. 새로고침 후 다시 선택하세요.',fact_other_brand:'다른 브랜드의 사실은 이 브랜드 모집 자료의 근거로 쓸 수 없습니다.',
 fact_ref_missing:'원문에 값이 나온 가맹 사실을 근거 사실로 선택하세요. 사실이 바뀌면 이 자료를 재검토하기 위해 필요합니다.',fact_revenue:FM.revenueNoAd,fact_source_missing:FM.sourceMissingInUse,fact_stale:FM.staleFact,fact_store_scoped:'지점 사실은 브랜드 모집 자료의 근거로 쓸 수 없습니다.',
 footnote_missing:'가맹 사실의 정보공개서 각주 줄이 원문에 없습니다. 각주 줄을 바꾸지 말고 그대로 넣으세요.',h8_label_missing:'가맹 수치 문장에 [사실] 표지나 정보공개서 각주가 없습니다(H8).',hard_block:'가맹 모집 규칙상 쓸 수 없는 표현이 남아 있습니다(승인으로 풀 수 없음).',
 hash_mismatch:'원문이 확인·승인한 내용과 다릅니다. 새로고침하고 다시 승인하세요.',invalid_body:'원문은 1~20,000자이고 줄바꿈·탭 밖의 제어 문자를 넣을 수 없습니다.',invalid_code:'가명 코드 형식을 확인하세요.',invalid_counts:'참석·불참 건수를 확인하세요.',
 invalid_event:'행사 유형·장소 라벨·정원·비용 참조·연결 자료를 확인하세요.',invalid_fact_refs:'근거 사실 선택을 확인하세요(최대 20개, 중복 불가).',invalid_input:'입력 형식을 확인하세요.',invalid_placement:'게시 위치 라벨(1~100자)과 게시 확인일(내보낸 날부터 오늘까지의 날짜)을 확인하세요. 게시 위치는 20곳까지입니다.',
 invalid_record:'저장된 기록의 형식이 올바르지 않습니다.',invalid_timestamp:'시각은 시간대가 있는 ISO 8601이어야 합니다.',invalid_type:'자료 유형을 확인하세요.',not_approved:'승인된 자료만 내보낼 수 있습니다.',not_draft:'초안 상태의 자료만 승인할 수 있습니다.',
 not_exported:'내보낸 자료만 게시 위치를 기록할 수 있습니다.',record_other_brand:'이 브랜드의 기록이 아닙니다.',revenue_qna_note_missing:'질의응답 절에 수익 질문 안내 문장을 그대로 넣으세요(H6).',
 review_needed:'근거 사실이나 정보공개서 버전이 바뀌어 재검토가 필요합니다. 현재 사실로 새 버전을 저장하고 다시 승인하세요.',role_forbidden:'모집 자료 승인·내보내기·게시 기록과 행사 등록·변경은 대표·관리자만 할 수 있습니다.',
 section_duplicate:'고정 절 제목이 두 번 이상 있습니다.',section_missing:'고정 절 제목이 빠졌습니다. 제목 줄을 템플릿 그대로 두세요.',section_order:'고정 절 순서가 템플릿과 다릅니다.',section_unknown:'템플릿에 없는 절 제목(■)이 있습니다.',
 spoken_revenue_figure:`설명회 원고·첫 통화 스크립트에 수익처럼 보이는 수치가 있습니다. 수익 질문은 서면 절차 안내 문장으로만 답합니다(H6). ${DISCLAIMER}`,switch_off:'가맹 모집 기능이 꺼져 있어 모집 자료·행사를 저장·승인·내보낼 수 없습니다.',
 version_not_current:'자료를 저장할 때의 정보공개서 버전이 현재 등록 버전이 아닙니다. 현재 버전의 사실로 새 버전을 저장하세요.',waiting_note_missing:'가맹 절차 절에 두 대기기간 안내 문장을 그대로 넣으세요.'};
check('11: 51 sorted unique codes with the fixed status table',fa.ASSET_CODES.length===51&&fa.ASSET_CODES.every((c,i)=>i===0||fa.ASSET_CODES[i-1]<c)&&same(fa.ASSET_CODES,Object.keys(STATUS).sort(asc))&&same(fa.ASSET_CODE_STATUS,STATUS));
check('11: every code has its fixed non-empty message',same(fa.ASSET_MESSAGES,MESSAGES)&&Object.values(MESSAGES).every(m=>m.length>0)&&same(fa.ASSET_WARNING_MESSAGES,{briefingDeckMissing:'설명회에 승인된 설명회 덱(표준 순서)을 연결하지 않았습니다.'}));
const odd=fa.validateAssetInput({type:'blog-ZZTOP',body:'\u0000비밀X',factRefs:[]},CTX);
check('11: odd input values never reach the message',is(odd,'invalid_body','invalid_type')&&!odd.message.includes('ZZTOP')&&!odd.message.includes('비밀X')&&odd.message===MESSAGES.invalid_body+' '+MESSAGES.invalid_type);
const deepFrozen=(o,memo=new Set())=>{if(!o||typeof o!=='object'||memo.has(o))return true;memo.add(o);return Object.isFrozen(o)&&Object.values(o).every(v=>deepFrozen(v,memo))};
const exportedObjects=Object.entries(fa).filter(([,v])=>v&&typeof v==='object');
check('12: every exported constant is deeply frozen, patterns and limits are fixed',exportedObjects.length>=20&&exportedObjects.every(([,v])=>deepFrozen(v))&&fa.ID_PATTERN.source==='^[A-Za-z0-9._:-]{1,128}$'&&fa.PSEUDONYM_PATTERN.source==='^[A-Za-z0-9_-]{6,64}$'
 &&same(fa.LIMITS,{bodyChars:20000,factRefs:20,placements:20,labelChars:100,capacity:1000,assetRefs:10,codes:1000})&&same(fa.REVIEW_REASONS,['fact_changed','version_changed'])&&same(fa.EVENT_TYPES,['briefing','expo','tour'])&&same(fa.EVENT_TYPE_LABELS,{briefing:'설명회',tour:'견학',expo:'박람회'}));

// ════ 해시 ════
const TEXTS=['abc','가나다 도넛','🍩 도넛 ✨','첫 줄\n둘째 줄\n','\t탭'];
const hashes=await Promise.all(TEXTS.map(t=>fa.assetBodyHash(t)));
check('13: the body hash is the lower-case SHA-256 hex of the raw UTF-8 bytes',hashes.every((h,i)=>h===sha64(TEXTS[i])&&/^[0-9a-f]{64}$/.test(h))&&await fa.assetBodyHash('abc')===hashes[0]&&await fa.assetBodyHash('')===sha64(''));
check('13: a non-string body hashes to the empty string',(await Promise.all([null,undefined,5,{},['a'],5n].map(x=>fa.assetBodyHash(x)))).every(h=>h===''));
const NFC='가 도넛\n매일 굽습니다',NFD='가 도넛\r\n매일 굽습니다';
const vNfc=VAL(NFC,[],'portal_intro'),vNfd=VAL(NFD,[],'portal_intro'),vCr=VAL('가 도넛\r매일 굽습니다',[],'portal_intro');
const dNfc=await fa.draftAsset(null,vNfc.value,META),dNfd=await fa.draftAsset(null,vNfd.value,META);
check('14: the hash does not normalize, validation does (NFC, CRLF and CR to LF)',await fa.assetBodyHash('가')!==await fa.assetBodyHash('가')&&await fa.assetBodyHash('가')===sha64('가')&&vNfd.ok&&vNfd.value.body===NFC&&vCr.value.body===NFC&&dNfc.bodyHash===dNfd.bodyHash&&dNfd.bodyHash===sha64(NFC));
check('15: one character or one trailing newline changes the hash',await fa.assetBodyHash('도넛 가게')!==await fa.assetBodyHash('도넛 가계')&&await fa.assetBodyHash('도넛')!==await fa.assetBodyHash('도넛\n'));

// ════ 입력 검사 ════
const v16=fa.validateAssetInput({...inputOf(PAGE(),['f-total','f-menu']),factRefs:[{id:'f-total',version:1,extra:'x'},{id:'f-menu',version:1}]},CTX);
check('16: a startup page with f-total validates to the normal form',OK(v16)&&v16.value.type==='startup_page'&&v16.value.body===PAGE()&&same(v16.value.factRefs,[{id:'f-menu',version:1},{id:'f-total',version:1}])&&v16.value.disclosureVersionId==='dvA'&&v16.value.judgement.blocked===false&&typeof v16.value.judgement.version==='string'&&same(v16.warnings,plain(jc.franchiseIssueLabels(v16.value.judgement).warnings)));
check('17: switch off wins over a malformed input, the timestamp check comes first',is(fa.validateAssetInput(null,{...CTX,enabled:false}),'switch_off')&&is(fa.validateAssetInput(inputOf(PAGE()),{...CTX,enabled:'yes'}),'switch_off')&&is(fa.validateAssetInput(null,{...CTX,enabled:false,now:'2026-10-10 09:00'}),'invalid_timestamp'));
check('18: a non-object input is invalid_input',[null,'x',5,[],true].every(x=>is(fa.validateAssetInput(x,CTX),'invalid_input')));
check('18: the input stage comes before the campaign stage',is(fa.validateAssetInput(null,{...CTX,campaign:null}),'invalid_input')&&is(fa.validateAssetInput({type:'blog',body:'',factRefs:'x'},{...CTX,campaign:null}),'invalid_body','invalid_fact_refs','invalid_type'));
check('18: an unknown type is invalid_type',is(fa.validateAssetInput(inputOf('도넛',[],'blog'),CTX),'invalid_type')&&is(fa.validateAssetInput(inputOf('도넛',[],null),CTX),'invalid_type'));
check('18: empty, blank, over-long and control-character bodies are invalid_body',['','   ','\r\n\t ','a'.repeat(20001),'a\u0000b','a\u0007b','a\u001bb','a\u007fb','a\ud800b',5,null].every(b=>is(fa.validateAssetInput(inputOf(b,[],'portal_intro'),CTX),'invalid_body')));
check('18: exactly 20,000 characters, tabs and newlines pass',OK(VAL('가'.repeat(20000),[],'portal_intro'))&&OK(VAL('도넛\t가게\n둘째 줄',[],'portal_intro')));
// 검토자에게 보이지 않거나 줄로 보이는 문자: C1 제어, 줄·문단 구분, 사용자 정의 영역(BMP·15·16평면), 비문자, 미할당. 판정기 matchView는 Cf·M만 지우므로 이 문자로 낱말을 끊으면 판정을 비껴간다.
const INVISIBLE=['\u0080','\u0085','\u009f','\u2028','\u2029','\ue000','\uf8ff','\u{f0000}','\u{10fffd}','\ufdd0','\ufdef','\ufffe','\uffff','\u{1fffe}','\u0378'];
check('18: C1 controls, line and paragraph separators, private use, noncharacters and unassigned code points are invalid_body',INVISIBLE.every(ch=>is(VAL('도넛'+ch+'가게',[],'portal_intro'),'invalid_body')));
const C1_DEPOSIT='오늘 예\u0085약금 100만원 입\u0085금하시면 상\u0085권을 선\u0085점해 드립니다';
check('18: a deposit sentence split by U+0085 is invalid_body instead of a clean preview',is(VAL(C1_DEPOSIT,[],'portal_intro'),'invalid_body')&&is(VAL(PAGE(lines('faq',l=>[...l,C1_DEPOSIT]))),'invalid_body')&&is(VAL('순\u2028수익 월 800만원',[],'meta_lead_ad'),'invalid_body'));
check('18: emoji (with a joiner), NBSP and the replacement character still pass',OK(VAL('🍩 도넛 ✨\u00a0가게 \ufffd 👩\u200d🍳',[],'portal_intro')));
const refsCase=r=>fa.validateAssetInput({type:'portal_intro',body:'도넛',factRefs:r},CTX);
check('18: bad fact reference lists are invalid_fact_refs',['x',null,undefined,{id:'f-total',version:1},Array.from({length:21},(_,i)=>({id:'f'+i,version:1})),[{id:'f-total',version:1},{id:'f-total',version:1}],[{id:'가',version:1}],[{id:'f-total',version:0}],[{id:'f-total',version:1.5}],[{id:'f-total',version:'1'}],[null],[{id:'f-total'}]].every(r=>is(refsCase(r),'invalid_fact_refs')));
check('18: exactly 20 references are within the limit',!refsCase(Array.from({length:20},(_,i)=>({id:'f'+i,version:1}))).reasons.includes('invalid_fact_refs'));
check('18: three input errors are collected together',is(fa.validateAssetInput({type:'blog',body:'',factRefs:'x'},CTX),'invalid_body','invalid_fact_refs','invalid_type'));
check('19: a missing or other-brand campaign is campaign_other_brand (400)',is(fa.validateAssetInput(inputOf(PAGE()),{...CTX,campaign:null}),'campaign_other_brand')&&is(fa.validateAssetInput(inputOf(PAGE()),{...CTX,campaign:CAMP_B2}),'campaign_other_brand')&&is(fa.validateAssetInput(inputOf(PAGE()),{...CTX,campaign:{...CONSUMER,brandId:'b2'}}),'campaign_other_brand'));
const consumer=fa.validateAssetInput(inputOf(PAGE()),{...CTX,campaign:CONSUMER});
check('19: a consumer campaign is campaign_not_recruitment (409)',is(consumer,'campaign_not_recruitment')&&consumer.status===409&&is(fa.validateAssetInput(inputOf(PAGE()),{...CTX,campaign:{...CAMP,objective:'Franchise_Recruitment'}}),'campaign_not_recruitment'));
const otherRef=VAL('도넛',['f-other'],'portal_intro');
check('20: another brand fact is 400 and stops before the state stage',is(otherRef,'fact_other_brand')&&otherRef.status===400&&is(VAL('도넛',['f-other','f-exp'],'portal_intro'),'fact_other_brand'));
check('21: a store-scoped fact is fact_store_scoped (400), both input errors are collected',is(VAL('도넛',['f-store'],'portal_intro'),'fact_store_scoped')&&is(VAL('도넛',['f-other','f-store'],'portal_intro'),'fact_other_brand','fact_store_scoped'));
check('22: missing, re-versioned, candidate, expired, future and sourceless facts are fact_changed (409)',is(VAL('도넛',['f-none'],'portal_intro'),'fact_changed')&&is(fa.validateAssetInput({type:'portal_intro',body:'도넛',factRefs:[{id:'f-total',version:2}]},CTX),'fact_changed')
 &&['f-cand','f-exp','f-future','f-blank'].every(id=>is(VAL('도넛',[id],'portal_intro'),'fact_changed'))&&VAL('도넛',['f-exp'],'portal_intro').status===409&&is(VAL('도넛',['f-cand','f-exp'],'portal_intro'),'fact_changed'));
// 빈 칸이 있는 배열(sparse)은 빈 칸을 undefined로 보고 검사한다(every는 빈 칸을 건너뛴다). JSON에서는 나오지 않지만 순수 함수 호출자에게도 fail closed여야 한다.
const SPARSE_INCLUDES=['가맹비'];SPARSE_INCLUDES.length=2;
const SPARSE_REFS=[{id:'f-total',version:1}];SPARSE_REFS.length=2;
const SPARSE_FACTS=[...CTX.facts];SPARSE_FACTS.length+=1;
check('22: sparse fact references are invalid_fact_refs, a sparse fact list or string list in the context is invalid_record',is(fa.validateAssetInput({type:'portal_intro',body:'도넛',factRefs:SPARSE_REFS},CTX),'invalid_fact_refs')&&is(fa.validateAssetInput(inputOf('도넛',[],'portal_intro'),{...CTX,facts:SPARSE_FACTS}),'invalid_record')
 &&is(fa.validateAssetInput(inputOf('도넛',[],'portal_intro'),{...CTX,facts:[...CTX.facts.filter(f=>f.id!=='f-total'),{...F.total,cost:{...F.total.cost,includes:SPARSE_INCLUDES}}]}),'invalid_record'));
const dupFact=fa.validateAssetInput(inputOf('도넛',['f-menu'],'portal_intro'),{...CTX,facts:[...CTX.facts,{...F.menu,brandId:'b1',status:'candidate'}]});
check('22: an ambiguous fact id (two records) is fact_changed',is(dupFact,'fact_changed'));
const revRef=VAL('도넛',['f-rev'],'portal_intro'),both=VAL('도넛',['f-rev','f-nosrc'],'portal_intro');
check('23: revenue, sourceless and stale facts map to their codes and fixed messages',is(revRef,'fact_revenue')&&revRef.message===FM.revenueNoAd&&is(VAL('도넛',['f-nosrc'],'portal_intro'),'fact_source_missing')&&is(fa.validateAssetInput(inputOf('도넛',['f-total'],'portal_intro'),{...CTX,versions:V_NEW}),'fact_stale')
 &&is(both,'fact_revenue','fact_source_missing')&&both.message===FM.revenueNoAd+' '+FM.sourceMissingInUse);
const effIds=fa.effectiveAssetFacts(Object.values(F),'b1',NOW).map(f=>f.id).sort(asc);
check('24: effective facts equal effectiveBrandFacts for brand-level input',same(effIds,bf.effectiveBrandFacts(Object.values(F),'b1',undefined,Date.parse(NOW)).map(f=>f.id).sort(asc))&&same(effIds,['f-claim','f-count','f-menu','f-nosrc','f-prod','f-rev','f-total'])&&fa.effectiveAssetFacts(Object.values(F),'b1','yesterday').length===0);
const FNOW={...base,id:'f-now',key:'hours',value:'매일 영업',verifiedAt:NOW},FDATE={...base,id:'f-date',key:'delivery',value:'포장 가능',validUntil:'2027-04-01'},nowCtx={...CTX,facts:[...CTX.facts,FNOW,FDATE]};
const effNow=fa.effectiveAssetFacts(nowCtx.facts,'b1',NOW).map(f=>f.id);
check('24: verifiedAt equal to now is effective, a date-only validUntil is excluded without failing validation',effNow.includes('f-now')&&!effNow.includes('f-date')&&OK(fa.validateAssetInput(inputOf('도넛',['f-now'],'portal_intro'),nowCtx))&&OK(fa.validateAssetInput(inputOf('도넛',[],'portal_intro'),nowCtx))&&is(fa.validateAssetInput(inputOf('도넛',['f-date'],'portal_intro'),nowCtx),'fact_changed'));
const DEPOSIT='오늘 예약금 100만원 입금하시면 상권을 선점해 드립니다';
const v25=VAL(DEPOSIT,[],'portal_intro');
check('25: a draft with an unremovable sentence still saves and previews the hard block',OK(v25)&&v25.value.judgement.hardBlocked===true);
check('25: the preview judges with the brand revenue facts, so an unreferenced revenue value is hard-blocked',VAL('강남점 3,200만원 기록',[],'portal_intro').value.judgement.hardBlocked===true);

// ════ 초안 ════
const d1=await DRAFT(PAGE());
check('26: a new draft is version 1 with the SHA-256 of the normal body',d1.version===1&&d1.status==='draft'&&d1.bodyHash===sha64(PAGE())&&d1.approval===null&&same(d1.placements,[])&&same(d1.exports,[])&&same(d1.review,{needed:false,reasons:[],at:null})&&d1.createdAt===NOW&&d1.updatedAt===NOW&&d1.id==='a-startup_page'&&d1.brandId==='b1'&&d1.campaignId==='c1'&&same(d1.factRefs,[{id:'f-total',version:1}])&&d1.disclosureVersionId==='dvA');
check('26: saving the same value returns the previous record unchanged',await fa.draftAsset(d1,VAL(PAGE()).value,{...META,now:LATER})===d1);
const flagged={...plain(d1),status:'approved',approval:{by:'u-owner'},placements:[{label:'창업 포털',confirmedAt:'2026-10-10'}],exports:[{at:NOW}],review:{needed:true,reasons:['fact_changed'],at:NOW}};
const d2=await fa.draftAsset(flagged,VAL(PAGE(lines('why',l=>[...l,'둘째 문장입니다.']))).value,{...META,id:d1.id,now:LATER});
check('26: a changed body makes version 2 and resets approval, placements, exports and review',d2.version===2&&d2.status==='draft'&&d2.approval===null&&same(d2.placements,[])&&same(d2.exports,[])&&same(d2.review,{needed:false,reasons:[],at:null})&&d2.createdAt===NOW&&d2.updatedAt===LATER);
const vType=VAL(PAGE(),['f-total'],'portal_intro'),vRefs=VAL(PAGE(),['f-total','f-menu']);
check('26: a changed type, reference set or disclosure version also makes a new version',(await fa.draftAsset(d1,vType.value,META)).version===2&&(await fa.draftAsset(d1,vRefs.value,META)).version===2&&(await fa.draftAsset(d1,{...VAL(PAGE()).value,disclosureVersionId:'dvB'},META)).version===2&&(await fa.draftAsset(d1,{...VAL(PAGE()).value,factRefs:[{id:'f-total',version:2}]},META)).version===2);

// ════ 절 구조 ════
const S=(type,body,refs=[F.total],facts=BF,versions=V)=>plain(fa.assetStructureIssues(type,body,refs,facts,versions,NOW));
const tpl=fa.sectionTemplate('startup_page');
check('27: the startup page template only lacks the cost table and does not block the judge',tpl===[PAGE_HEADINGS[0],PAGE_HEADINGS[1],PAGE_HEADINGS[2],[PAGE_HEADINGS[3],...WAIT].join('\n'),PAGE_HEADINGS[4],PAGE_HEADINGS[5]].join('\n\n')&&same(S('startup_page',tpl),E('cost_table_missing'))&&VAL(tpl,[]).value.judgement.blocked===false);
check('27: the deck template only lacks the cost table, free types have no template',same(S('event_deck',fa.sectionTemplate('event_deck')),['cost_table_missing'])&&fa.sectionTemplate('event_deck').endsWith(DECK_HEADINGS[5]+'\n'+QNA)&&['portal_intro','first_call_script','blog',null,5].every(t=>fa.sectionTemplate(t)===''));
check('28: a complete startup page has no structure code and no judge issue',same(S('startup_page',PAGE()),[])&&VAL(PAGE()).value.judgement.issues.length===0);
check('29: a removed heading is section_missing',same(S('startup_page',PAGE(heading('support',null))),E('section_missing')));
check('29: a repeated heading is section_duplicate',same(S('startup_page',PAGE(bs=>[...bs,{id:'x',heading:PAGE_HEADINGS[0],lines:['다시 씁니다.']}])),E('section_duplicate'))&&same(S('startup_page',PAGE(bs=>[bs[0],bs[1],{id:'x',heading:PAGE_HEADINGS[0],lines:[]},...bs.slice(2)])),['section_duplicate']));
check('29: swapped headings are section_order',same(S('startup_page',PAGE(bs=>[...bs.slice(0,4),bs[5],bs[4]])),E('section_order')));
check('29: an unknown section line is section_unknown',same(S('startup_page',PAGE(lines('faq',l=>[...l,'■ 예상 수익','월 얼마인지는 상담에서 말씀드립니다.']))),E('section_unknown'))&&same(S('startup_page',PAGE(lines('faq',l=>[...l,'  ■예상 수익']))),['section_unknown']));
check('29: a heading without its label is section_missing and section_unknown',same(S('startup_page',PAGE(heading('why','■ 왜 이 브랜드인가'))),['section_missing','section_unknown']));
check('29: a heading with surrounding spaces is still the heading',same(S('startup_page',PAGE(heading('cost','  '+PAGE_HEADINGS[1]+'  '))),[]));
check('30: a cost table without the includes line is cost_table_missing',same(S('startup_page',PAGE(lines('cost',()=>[ff.factLine(F.total).split('\n')[0],FOOT]))),E('cost_table_missing')));
check('30: fact lines outside the cost section are cost_table_missing',same(S('startup_page',PAGE(bs=>lines('why',l=>[...l,ff.factLine(F.total)])(lines('cost',()=>[FOOT])(bs)))),['cost_table_missing'])&&same(S('startup_page',PAGE(lines('cost',()=>[' '+ff.factLine(F.total),FOOT]))),['cost_table_missing']));
check('30: no referenced cost fact and no brand total cost fact is cost_table_missing',same(S('startup_page',PAGE(),[],BF.filter(f=>f.id!=='f-total')),['cost_table_missing']));
const total2={...F.total,id:'f-total2',value:'6,000만원',cost:{...F.total.cost,storeType:'매장형',areaM2:50}};
check('30: every current total cost fact of the brand (per store type) must be in the table',same(S('startup_page',PAGE(),[F.total],[...BF,total2]),['cost_table_missing'])&&same(S('startup_page',PAGE(lines('cost',()=>[ff.factLine(F.total),ff.factLine(total2),FOOT])),[F.total],[...BF,total2]),[])&&same(S('startup_page',PAGE(),[F.total],[...BF,{...total2,brandId:'b1',sourceRef:SRC(12,{disclosureVersionId:'dvZ'})}]),[]));
// 참조한 창업비용 구성 항목(storeType 필수) 사실도 비용 표에 있어야 한다. f-nosrc는 근거가 없어 참조할 수 없으므로 근거 있는 가맹비 사실을 따로 둔다.
const FEE={...base,id:'f-fee',key:'franchise_fee',value:'700만원',sourceRef:SRC(14)},FEE_CTX={...XCTX,facts:[...CTX.facts,FEE]};
const feePage=PAGE(lines('cost',()=>[ff.factLine(F.total),ff.factLine(FEE),FOOT]));
check('30: a referenced cost-component fact must also be in the cost table',same(S('startup_page',PAGE(),[F.total,FEE],[...BF,FEE]),['cost_table_missing'])&&same(S('startup_page',feePage,[F.total,FEE],[...BF,FEE]),[])
 &&is(await EXP(FORGE(PAGE(),['f-fee','f-total'],'startup_page'),FEE_CTX),'cost_table_missing')&&OK(await EXP(FORGE(feePage,['f-fee','f-total'],'startup_page'),FEE_CTX)));
// 사실·버전 라벨은 NFC가 아닐 수 있다(저장소는 trim만 한다). 원문은 NFC로 저장되므로 사실 줄·각주 줄도 NFC로 맞춰 비교한다.
const TOTAL_NFD={...F.total,cost:{...F.total.cost,storeType:'소형 매장'.normalize('NFD')}},NFD_CTX={...CTX,facts:[...CTX.facts.filter(f=>f.id!=='f-total'),TOTAL_NFD]};
const nfdPage=PAGE(lines('cost',()=>[ff.factLine(TOTAL_NFD),FOOT])),vNfdPage=fa.validateAssetInput(inputOf(nfdPage),NFD_CTX);
const dNfdPage=vNfdPage.ok?await fa.draftAsset(null,vNfdPage.value,META):null;
check('30: an NFD cost fact pasted verbatim is compared in NFC and approves',OK(vNfdPage)&&vNfdPage.value.body!==nfdPage&&same(S('startup_page',vNfdPage.value.body,[TOTAL_NFD],[...BF.filter(f=>f.id!=='f-total'),TOTAL_NFD]),[])&&OK(await APP(dNfdPage,APPROVE_IN(dNfdPage),{...NFD_CTX,actor:OWNER})));
const V_NFD=V.map(v=>v.id==='dvA'?{...v,label:'2026년 1차'.normalize('NFD')}:v),footNfd=ff.footnoteLine(F.prod,V_NFD);
const vNfdFoot=fa.validateAssetInput(inputOf('손으로 빚은 도넛\n'+footNfd,['f-prod'],'portal_intro'),{...CTX,versions:V_NFD});
const dNfdFoot=vNfdFoot.ok?await fa.draftAsset(null,vNfdFoot.value,META):null;
check('30: an NFD version label in a footnote pasted verbatim is compared in NFC and approves',footNfd!==footNfd.normalize('NFC')&&OK(vNfdFoot)&&OK(await APP(dNfdFoot,APPROVE_IN(dNfdFoot),{...ACTX,versions:V_NFD})));
// 줄로 보일 수 있는 U+0085·U+2028·U+2029 뒤의 ■ 제목도 절 검사가 본다(저장 원문에는 이 문자가 없지만 직접 부르는 미리보기도 fail closed).
check('29: a ■ line after U+0085, U+2028 or U+2029 is still a section line',['\u0085','\u2028','\u2029'].every(sep=>same(S('startup_page',PAGE(lines('support',l=>[l[0]+sep+'■ 예상 수익']))),['section_unknown'])&&same(S('startup_page',PAGE(lines('support',l=>[l[0]+sep+PAGE_HEADINGS[0]]))),['section_duplicate'])&&is(VAL(PAGE(lines('support',l=>[l[0]+sep+'■ 예상 수익']))),'invalid_body')));
check('31: a stray ■ line ends the section before the waiting notes, fixed lines match exactly without trim',same(S('startup_page',PAGE(lines('process',()=>['■ 참고',...WAIT]))),['section_unknown','waiting_note_missing'])&&same(S('startup_page',PAGE(lines('process',()=>[WAIT[0]+' ',WAIT[1]]))),['waiting_note_missing']));
check('31: a missing or misplaced waiting note is waiting_note_missing',same(S('startup_page',PAGE(lines('process',()=>[WAIT[0]]))),E('waiting_note_missing'))&&same(S('startup_page',PAGE(bs=>lines('faq',l=>[...l,...WAIT])(lines('process',()=>[])(bs)))),['waiting_note_missing']));
check('32: the deck is complete, loses its revenue note or is out of order',same(S('event_deck',DECK()),[])&&VAL(DECK(),['f-total'],'event_deck').value.judgement.issues.length===0&&same(S('event_deck',DECK(lines('qna',()=>[]))),E('revenue_qna_note_missing'))&&same(S('event_deck',DECK(bs=>[bs[0],bs[2],bs[1],...bs.slice(3)])),['section_order']));
check('33: free asset types have no structure check, a non-string body misses every heading',['portal_intro','first_call_script','naver_search','meta_lead_ad','expo_banner'].every(t=>same(S(t,'■ 예상 수익\n자유 문안'),[]))&&same(S('startup_page',null),['section_missing'])&&same(S('event_deck',5),['section_missing']));

// ════ 승인 ════
const bothApproved=await Promise.all([OWNER,ADMIN].map(actor=>fa.approveDecision(d1,{...APPROVE_IN(d1),checklist:{version:fa.CHECKLIST_VERSION,checked:[...fa.CHECKLIST_IDS].reverse()}},{...CTX,actor})));
check('34: owner and admin approve with the full approval record',bothApproved.every((r,i)=>OK(r)&&same(r.value.approval,{by:[OWNER,ADMIN][i].id,role:[OWNER,ADMIN][i].role,at:NOW,bodyHash:d1.bodyHash,checklist:{version:fa.CHECKLIST_VERSION,checked:[...fa.CHECKLIST_IDS].sort(asc)}})&&r.value.judgement.blocked===false));
const r35=await Promise.all([MEMBER,{id:'u-v',role:'viewer'},null,{role:'owner'},{id:'',role:'owner'},{id:'u\u0001x',role:'owner'},{id:'u'.repeat(201),role:'admin'},{id:5,role:'admin'},{id:'u-x',role:'Owner'}].map(actor=>APP(d1,APPROVE_IN(d1),{...CTX,actor})));
check('35: member, viewer, a missing actor and malformed actor ids are 403',r35.every(r=>is(r,'role_forbidden')&&r.status===403)&&OK(await APP(d1,APPROVE_IN(d1),{...CTX,actor:{id:'u'.repeat(200),role:'admin'}})));
check('35: actor ids with a C1 control, a line separator or a private-use character are 403',(await Promise.all(['u\u0085x','u\u2028x','u\ue000x'].map(id=>APP(d1,APPROVE_IN(d1),{...CTX,actor:{id,role:'owner'}})))).every(r=>is(r,'role_forbidden')));
check('35: the role check comes before the record check (403 like the route ADMIN_ONLY)',is(await APP({...d1,brandId:'b2'},APPROVE_IN(d1),{...CTX,actor:MEMBER}),'role_forbidden')&&is(await APP({...d1,status:'wip'},APPROVE_IN(d1),{...CTX,actor:MEMBER}),'role_forbidden'));
check('36: switch off wins over a member actor, the timestamp over both',is(await APP(d1,APPROVE_IN(d1),{...CTX,enabled:false,actor:MEMBER}),'switch_off')&&is(await APP(d1,APPROVE_IN(d1),{...CTX,enabled:false,actor:MEMBER,now:'yesterday'}),'invalid_timestamp'));
const branchRes=await Promise.all(['B','C','undetermined',null,'a','',undefined].map(branch=>APP(d1,APPROVE_IN(d1),{...ACTX,branch})));
check('37: branches other than A are branch_not_a (409) with H7 and the disclaimer',branchRes.every(r=>is(r,'branch_not_a')&&r.status===409&&r.message.includes('H7')&&r.message.includes(DISCLAIMER)));
check('4: a malformed record or another brand record is 400 before the branch check',is(await APP({...d1,status:'wip'},APPROVE_IN(d1),{...ACTX,branch:'B'}),'invalid_record')&&is(await APP({...d1,brandId:'b2'},APPROVE_IN(d1),{...ACTX,branch:'B'}),'record_other_brand')&&is(await APP(d1,APPROVE_IN(d1),{...ACTX,facts:[...CTX.facts,{id:'bad'}]}),'invalid_record'));
check('6-7: campaign mismatch is 400, a consumer campaign 409',is(await APP(d1,APPROVE_IN(d1),{...ACTX,campaign:{...CAMP,id:'c9'}}),'campaign_other_brand')&&is(await APP(d1,APPROVE_IN(d1),{...ACTX,campaign:null}),'campaign_other_brand')&&is(await APP(d1,APPROVE_IN(d1),{...ACTX,campaign:{...CONSUMER,id:'c1'}}),'campaign_not_recruitment'));
const B2_CAMP={id:'c1',brandId:'b2',objective:'franchise_recruitment'};
check('6: a campaign with the asset campaign id but another brand is campaign_other_brand',is(await APP(d1,APPROVE_IN(d1),{...ACTX,campaign:B2_CAMP}),'campaign_other_brand')&&is(await EXP(FORGE(PAGE(),['f-total'],'startup_page'),{...XCTX,campaign:B2_CAMP}),'campaign_other_brand'));
check('5-6: the branch check comes before the campaign check',is(await APP(d1,APPROVE_IN(d1),{...ACTX,branch:'B',campaign:{...CAMP,id:'c9'}}),'branch_not_a')&&is(await EXP(FORGE(PAGE(),['f-total'],'startup_page'),{...XCTX,branch:'B',campaign:{...CAMP,id:'c9'}}),'branch_not_a'));
check('8-9: an approved record that is also flagged is not_draft',is(await APP({...d1,status:'approved',review:{needed:true,reasons:['fact_changed'],at:NOW}}),'not_draft'));
const cl=checked=>({bodyHash:d1.bodyHash,checklist:{version:fa.CHECKLIST_VERSION,checked}});
const dropEach=await Promise.all(fa.CHECKLIST_IDS.map(id=>APP(d1,cl(fa.CHECKLIST_IDS.filter(x=>x!==id)))));
check('38: leaving out any one of the six items is checklist_incomplete (400)',dropEach.length===6&&dropEach.every(r=>is(r,'checklist_incomplete')&&r.status===400));
check('38: six copies of one item or five items plus an unknown id are checklist_incomplete',(await Promise.all([cl(Array(6).fill('no_wait_bypass')),cl([...fa.CHECKLIST_IDS.filter(x=>x!=='h7_branch_a'),'zz_unknown'])].map(i=>APP(d1,i)))).every(r=>is(r,'checklist_incomplete')));
// 빈 칸이 있는 배열(sparse): 길이 6이고 Set 크기도 6이지만 every는 빈 칸을 건너뛴다. JSON에서는 나오지 않지만 순수 함수 호출자에게도 fail closed여야 한다.
const SPARSE=fa.CHECKLIST_IDS.filter(x=>x!=='no_captive_advisor');SPARSE.length=6;
check('38: a sparse checklist array with one hole is checklist_incomplete',SPARSE.length===6&&!(5 in SPARSE)&&is(await APP(d1,cl(SPARSE)),'checklist_incomplete'));
check('38: a missing, unknown or duplicated item or a malformed checklist is checklist_incomplete (400)',(await Promise.all([cl(fa.CHECKLIST_IDS.slice(1)),cl([...fa.CHECKLIST_IDS.slice(1),'zz_unknown']),cl([...fa.CHECKLIST_IDS,fa.CHECKLIST_IDS[0]]),cl([...fa.CHECKLIST_IDS.slice(1),fa.CHECKLIST_IDS[1]]),cl('all'),cl(null),{bodyHash:d1.bodyHash,checklist:'x'},{bodyHash:d1.bodyHash},null,'x'].map(i=>APP(d1,i)))).every(r=>is(r,'checklist_incomplete')&&r.status===400));
check('38: an old checklist version is checklist_outdated (409) even when items are missing',is(await APP(d1,{bodyHash:d1.bodyHash,checklist:{version:'fr-assets-checklist@2026-09-01.1',checked:[...fa.CHECKLIST_IDS]}}),'checklist_outdated')&&is(await APP(d1,{bodyHash:d1.bodyHash,checklist:{version:'fr-assets-checklist@2026-09-01.1',checked:[]}}),'checklist_outdated'));
check('39: a different input hash or a body changed after saving is hash_mismatch',is(await APP(d1,{...APPROVE_IN(d1),bodyHash:sha64('다른 원문')}),'hash_mismatch')&&is(await APP({...d1,body:d1.body+' '}),'hash_mismatch')&&is(await APP(d1,{checklist:APPROVE_IN(d1).checklist}),'hash_mismatch'));
check('40: an approved or retired record is not_draft, a flagged draft is review_needed',is(await APP({...d1,status:'approved'}),'not_draft')&&is(await APP({...d1,status:'retired'}),'not_draft')&&is(await APP({...d1,review:{needed:true,reasons:['fact_changed'],at:NOW}}),'review_needed'));
const faqDeposit=await DRAFT(PAGE(lines('faq',l=>[...l,DEPOSIT])));
const r41=await APP(faqDeposit);
check('41: an unremovable sentence is hard_block (409) even for the owner with every item checked',is(r41,'hard_block')&&r41.status===409&&r41.message.includes('승인으로 풀 수 없음')&&r41.judgement?.hardBlocked===true&&r41.message.startsWith(jc.franchiseGateError(r41.judgement).message));
check('41: a lone judge code carries exactly the judge message',r41.message===jc.franchiseGateError(r41.judgement).message);
const warnApproved=await APP(await DRAFT('입금 순서대로 자리 확정됩니다',[],'portal_intro'));
check('34: approval returns the judge warnings',OK(warnApproved)&&warnApproved.warnings.length===1&&same(warnApproved.warnings,plain(jc.franchiseIssueLabels(warnApproved.value.judgement).warnings)));
const hand=await DRAFT('손으로 빚은 도넛',[],'portal_intro'),handRef=await DRAFT('손으로 빚은 도넛',['f-prod'],'portal_intro'),handFoot=await DRAFT('손으로 빚은 도넛\n'+FOOT,['f-prod'],'portal_intro');
const r42=await APP(hand);
check('42: a handmade claim without its fact is block_unresolved, with the fact and footnote it passes',is(r42,'block_unresolved')&&r42.message.startsWith('가맹 모집 규칙상 근거 사실이 필요한 표현입니다')&&is(await APP(handRef),'footnote_missing')&&OK(await APP(handFoot)));
const NEAR=['본사 협력 행정사가 서류를 대신 봐 드려 빠르게 계약합니다','점주협의회 가입하면 지원에서 빠질 수 있어요','첫 달에 900 찍은 매장도 있어요'];
const near=await DRAFT(PAGE(lines('why',l=>[...l,...NEAR])));
const nearRes=await APP(near,{bodyHash:near.bodyHash,checklist:{version:fa.CHECKLIST_VERSION,checked:fa.CHECKLIST_IDS.filter(x=>x!=='no_captive_advisor')}});
check('43: near-miss sentences cannot be approved without the matching checklist item',is(nearRes,'checklist_incomplete')&&nearRes.status===400);
const SUPER='업계 최초 도넛 프랜차이즈(근거: 가상연구소 2026 도넛 조사)';
check('44: an unreferenced claim-basis fact does not count as evidence, a referenced one does',is(await APP(await DRAFT(SUPER,[],'portal_intro')),'block_unresolved')&&OK(await APP(await DRAFT(SUPER,['f-claim'],'portal_intro'))));
const r45=await APP(await DRAFT('강남점 3,200만원 기록',[],'portal_intro'));
check('45: an unreferenced but valid revenue fact still hard-blocks its value',is(r45,'hard_block')&&r45.judgement.issues.some(x=>x.ruleId==='h.revenue_figures_no_ad'&&x.reason==='revenue_fact'));
const r46=await APP(await DRAFT('가맹점 12개로 성장했습니다',[],'portal_intro'));
check('46: a store count without its referenced fact is fact_ref_missing and block_unresolved',is(r46,'block_unresolved','fact_ref_missing','h8_label_missing')&&OK(await APP(await DRAFT('가맹점 12개로 성장했습니다\n'+FOOT,['f-count'],'portal_intro'))));
check('46: fact_ref_missing alone when the unreferenced value is otherwise evidenced',is(await APP(await DRAFT('가맹점 12개로 성장했습니다\n'+FOOT,['f-total'],'portal_intro')),'block_unresolved','fact_ref_missing'));
check('47: a record saved under a superseded version is version_not_current before the fact stage',is(await APP(d1,APPROVE_IN(d1),{...ACTX,versions:V_NEW}),'version_not_current')&&is(await APP({...d1,disclosureVersionId:null}),'version_not_current')&&is(await APP(d1,APPROVE_IN(d1),{...ACTX,versions:V.filter(v=>v.brandId!=='b1')}),'version_not_current'));
check('2 (approve): the fact stage re-runs at approval (400 then 409)',is(await APP({...d1,factRefs:[{id:'f-other',version:1},{id:'f-total',version:2}]}),'fact_other_brand')&&is(await APP({...d1,factRefs:[{id:'f-total',version:2}]}),'fact_changed')&&is(await APP(d1,APPROVE_IN(d1),{...ACTX,facts:CTX.facts.filter(f=>f.id!=='f-total')}),'fact_changed'));

// ════ 내보내기 ════
const A=await APPROVED(PAGE());
const x48=await EXP(A);
check('48: an approved page exports its exact body with the export record',OK(x48)&&x48.value.body===PAGE()&&x48.value.body===A.body&&sha64(x48.value.body)===x48.value.record.bodyHash&&same(x48.value.record,{at:NOW,by:'u-admin',role:'admin',bodyHash:A.bodyHash,judgeVersion:x48.value.judgement.version,assetsVersion:fa.ASSETS_VERSION,checklistVersion:fa.CHECKLIST_VERSION})&&same(x48.warnings,plain(jc.franchiseIssueLabels(x48.value.judgement).warnings)));
check('49: switch off is 409, a member is 403',is(await EXP(A,{...XCTX,enabled:false}),'switch_off')&&(await EXP(A,{...XCTX,actor:MEMBER})).status===403&&is(await EXP(A,{...XCTX,actor:MEMBER}),'role_forbidden')&&is(await EXP(A,{...XCTX,actor:{id:'u-v',role:'viewer'}}),'role_forbidden'));
check('49: branch, record and campaign checks precede the approval check',is(await EXP(A,{...XCTX,branch:'C'}),'branch_not_a')&&is(await EXP({...A,brandId:'b2'}),'record_other_brand')&&is(await EXP({...A,type:'blog'}),'invalid_record')&&is(await EXP(A,{...XCTX,campaign:CONSUMER}),'campaign_other_brand')&&is(await EXP(A,{...XCTX,campaign:{...CONSUMER,id:'c1'}}),'campaign_not_recruitment'));
const badApprovals=[{...A,status:'draft'},{...A,approval:null},{...A,approval:{...A.approval,role:'member'}},{...A,approval:{...A.approval,at:LATER}},{...A,approval:{...A.approval,at:'2026-10-10'}},{...A,approval:{...A.approval,by:''}},{...A,approval:{...A.approval,bodyHash:'x'}},{...A,approval:{...A.approval,bodyHash:A.bodyHash.toUpperCase()}},{...A,approval:{...A.approval,checklist:null}},{...A,approval:{...A.approval,checklist:{version:fa.CHECKLIST_VERSION,checked:'all'}}},{...A,status:'retired'}];
check('49: a draft, missing or invalid approval is not_approved (409)',(await Promise.all(badApprovals.map(a=>EXP(a)))).every(r=>is(r,'not_approved')&&r.status===409));
check('50: a different approval hash or a body changed after approval is hash_mismatch',is(await EXP({...A,approval:{...A.approval,bodyHash:sha64('다른 원문')}}),'hash_mismatch')&&is(await EXP({...A,body:A.body+'\n'}),'hash_mismatch')&&is(await EXP({...A,bodyHash:sha64('x'),approval:{...A.approval,bodyHash:sha64('x')}}),'hash_mismatch'));
check('51: a flagged record is review_needed',is(await EXP({...A,review:{needed:true,reasons:['version_changed'],at:NOW}}),'review_needed'));
check('52: an old approval checklist is checklist_outdated, a partial current one not_approved',is(await EXP({...A,approval:{...A.approval,checklist:{version:'fr-assets-checklist@2026-09-01.1',checked:[...fa.CHECKLIST_IDS]}}}),'checklist_outdated')&&is(await EXP({...A,approval:{...A.approval,checklist:{version:fa.CHECKLIST_VERSION,checked:fa.CHECKLIST_IDS.slice(1)}}}),'not_approved'));
const withChecked=checked=>({...A,approval:{...A.approval,checklist:{version:fa.CHECKLIST_VERSION,checked}}});
check('52: a stored approval with six copies of one item, an unknown id or a hole is not_approved',is(await EXP(withChecked(Array(6).fill('no_wait_bypass'))),'not_approved')&&is(await EXP(withChecked([...fa.CHECKLIST_IDS.slice(1),'zz_unknown'])),'not_approved')&&is(await EXP(withChecked(SPARSE)),'not_approved'));
check('49: the role check comes before the record check, the hash check before the review flag',is(await EXP({...A,brandId:'b2'},{...XCTX,actor:MEMBER}),'role_forbidden')&&is(await EXP({...A,type:'blog'},{...XCTX,actor:MEMBER}),'role_forbidden')&&is(await EXP({...A,body:A.body+'\n',review:{needed:true,reasons:['fact_changed'],at:NOW}}),'hash_mismatch'));
// 저장된 기록의 원문도 입력 검사와 같은 불변식을 지켜야 한다(정규형·1~20,000자·금지 문자 없음, 해시는 16진 64자). 다른 쓰기 경로가 판정기를 비껴가지 못하게 invalid_record로 닫는다.
const NUL_DEPOSIT=[...DEPOSIT].join('\u0000'),BAD_BODIES=[NUL_DEPOSIT,'','   ','도넛 '.repeat(8000),'가'.repeat(20001),'도넛 가게\r입니다','도넛\ud800','도넛\u0085가게',C1_DEPOSIT,'가'.normalize('NFD')+' 도넛','도넛\u0007가게',PAGE(lines('support',l=>[l[0]+'\u2028■ 예상 수익']))];
check('4: a stored body outside the input invariants is invalid_record at approval and export',is(await APP({...FORGE(NUL_DEPOSIT),status:'draft',approval:null}),'invalid_record')&&(await Promise.all(BAD_BODIES.map(b=>EXP(FORGE(b))))).every(r=>is(r,'invalid_record'))&&is(await EXP({...A,bodyHash:'x',approval:{...A.approval,bodyHash:A.bodyHash}}),'invalid_record'));
const ASSOC='점주협의회에 가입하면 가맹 계약을 해지합니다';
const r53=await EXP(FORGE(DEPOSIT)),r53b=await EXP(FORGE(ASSOC),{...XCTX,now:'2027-01-05T09:00:00+09:00'}),r53c=await EXP(FORGE(ASSOC));
check('53: a forged approved record with unremovable sentences is hard_block, rules chosen by date',is(r53,'hard_block')&&is(r53b,'hard_block')&&r53b.judgement.issues.some(x=>x.registryId==='kr.fr.association_condition_2026')&&!r53b.judgement.issues.some(x=>x.registryId==='kr.fr.association_condition')&&r53c.judgement.issues.some(x=>x.registryId==='kr.fr.association_condition'));
const PORTAL='가맹점 12개, 동네 도넛 브랜드';
const r54=await EXP(FORGE(PORTAL,['f-count']));
check('54: a portal count without label or footnote is h8_label_missing and footnote_missing, the footnote clears both',is(r54,'footnote_missing','h8_label_missing')&&r54.message===MESSAGES.footnote_missing+' '+MESSAGES.h8_label_missing&&OK(await EXP(FORGE(PORTAL+'\n'+FOOT,['f-count']))));
check('54: an [사실] label clears H8 but not the missing footnote',is(await EXP(FORGE('[사실] '+PORTAL,['f-count'])),'footnote_missing'));
const RR='수익률은 설명회에서 따로 말씀드려요 대략 25% 정도';
const deckRR=FORGE(DECK(lines('story',l=>[...l,RR])),['f-total'],'event_deck'),callRR=FORGE(RR,[],'first_call_script'),portalRR=await EXP(FORGE(RR));
const r55a=await EXP(deckRR),r55b=await EXP(callRR);
check('55: a revenue-like figure is spoken_revenue_figure (409) in the deck and the first call script',is(r55a,'spoken_revenue_figure')&&is(r55b,'spoken_revenue_figure')&&r55a.message.includes(DISCLAIMER)&&r55b.status===409);
check('55: the same figure in a portal intro exports with a warning',OK(portalRR)&&portalRR.warnings.some(w=>w.includes('수익처럼 보이는 수치')));
check('56: a revenue figure in a deck script is hard_block',is(await EXP(FORGE(DECK(lines('story',l=>[...l,'가맹점 월 매출 3,200만원'])),['f-total'],'event_deck')),'hard_block'));
check('56: a structure error in a forged deck is caught at export',is(await EXP(FORGE(DECK(lines('process',()=>[WAIT[1]])),['f-total'],'event_deck')),'waiting_note_missing'));
const PF=(edit,refs=['f-total'])=>FORGE(PAGE(edit),refs,'startup_page');
check('56: structure errors reach approval and export as 409 decisions',is(await APP(await DRAFT(PAGE(heading('support',null)))),'section_missing')&&is(await EXP(PF(bs=>[...bs.slice(0,4),bs[5],bs[4]])),'section_order')&&is(await EXP(PF(bs=>[...bs,{id:'x',heading:PAGE_HEADINGS[0],lines:[]}])),'section_duplicate')
 &&is(await EXP(PF(lines('faq',l=>[...l,'■ 예상 수익']))),'section_unknown')&&is(await EXP(PF(),{...XCTX,facts:[...CTX.facts,total2]}),'cost_table_missing')&&is(await EXP(FORGE(DECK(lines('qna',()=>[])),['f-total'],'event_deck')),'revenue_qna_note_missing')&&(await EXP(PF(lines('faq',l=>[...l,'■ 예상 수익'])))).status===409);
const rev=ctx=>({...ctx,facts:[...ctx.facts].reverse(),versions:[...ctx.versions].reverse()});
check('57: the same input gives the same result regardless of fact and version order',JSON.stringify(plain(await EXP(A)))===JSON.stringify(plain(x48))&&JSON.stringify(plain(await EXP(A,rev(XCTX))))===JSON.stringify(plain(x48))&&JSON.stringify(plain(await EXP(FORGE(PORTAL,['f-count']),rev(XCTX))))===JSON.stringify(plain(r54)));

// ════ 체크리스트 ════
const cA=fa.approvalChecklist(null,'A');
check('58: branch A has no H7 notice, items keep the screen order',cA.version===fa.CHECKLIST_VERSION&&cA.h7Notice===null&&same(cA.items.map(i=>i.id),ITEMS.map(x=>x[0]))&&cA.items.every((i,k)=>i.text===ITEMS[k][1]&&same(i.ruleIds,ITEMS[k][2])&&i.warnings.length===0)&&fa.h7Notice('A')===null);
check('58: other branches show the fixed H7 notice',fa.approvalChecklist(null,'B').h7Notice===H7.B&&fa.approvalChecklist(null,'C').h7Notice===H7.C&&[null,'undetermined','Z',undefined,5].every(b=>fa.approvalChecklist(null,b).h7Notice===H7.undetermined&&fa.h7Notice(b)===H7.undetermined)&&fa.h7Notice('B')===H7.B);
const warnOf=(text,id)=>{const j=VAL(text,[],'portal_intro').value.judgement,c=fa.approvalChecklist(j,'A');return c.items.every(i=>i.id===id?i.warnings.length===1&&i.warnings[0].startsWith('가맹 규칙 확인 · '):i.warnings.length===0)};
check('58: the deposit net goes to the wait-bypass item',warnOf('입금 순서대로 자리 확정됩니다','no_wait_bypass'));
check('58: the revenue net goes to the revenue item',warnOf(RR,'no_revenue_figures'));
check('58: the endorsement warning goes to the endorsement item',warnOf('점주님 인터뷰: 이 브랜드로 인생이 바뀌었어요','endorsement_disclosure'));
const mixJ=VAL('손으로 빚은 도넛. 입금 순서대로 자리 확정됩니다',[],'portal_intro').value.judgement,mixC=fa.approvalChecklist(mixJ,'A');
check('58: with a block issue and a warning, only the warning is shown, next to its item',mixJ.issues.some(x=>x.tier==='block')&&mixJ.issues.some(x=>x.tier==='warn')&&mixC.items.every(i=>i.warnings.every(w=>typeof w==='string'&&w.startsWith('가맹 규칙 확인 · ')))&&same(mixC.items.map(i=>i.warnings.length),ITEMS.map(x=>x[0]==='no_wait_bypass'?1:0)));
check('58: a garbage judgement gives no warnings',fa.approvalChecklist('x','A').items.every(i=>i.warnings.length===0)&&fa.approvalChecklist({issues:[null]},'A').items.every(i=>i.warnings.length===0));

// ════ 재검토 ════
const T=F.total,fca=fa.factChangeAffects;
const rows=[
 ['new fact',null,T,false],['deleted fact',T,null,true],['confirmed to candidate',T,{...T,status:'candidate'},true],['candidate to rejected',{...T,status:'candidate'},{...T,status:'rejected'},true],['rejected stays rejected',{...T,status:'rejected'},{...T,status:'rejected'},false],
 ['value changed',T,{...T,value:'4,600만원'},true],['validUntil shortened',T,{...T,validUntil:'2027-03-01T00:00:00.000Z'},true],['validUntil extended',T,{...T,validUntil:'2027-04-20T00:00:00.000Z'},false],['validUntil same instant in another offset',T,{...T,validUntil:'2027-04-01T09:00:00+09:00'},false],
 ['validUntil unreadable after',T,{...T,validUntil:'2027-04-01'},true],['validUntil unreadable before',{...T,validUntil:'soon'},T,true],
 ['disclosure version changed',T,{...T,sourceRef:{...T.sourceRef,disclosureVersionId:'dvB'}},true],['fiscal year changed',T,{...T,sourceRef:{...T.sourceRef,fiscalYear:2024}},true],['asOf changed',F.count,{...F.count,sourceRef:{...F.count.sourceRef,asOf:'2025-11-30'}},true],['sourceRef removed',T,{...T,sourceRef:undefined},true],
 ['store type changed',T,{...T,cost:{...T.cost,storeType:'매장형'}},true],['area changed',T,{...T,cost:{...T.cost,areaM2:34}},true],['includes changed',T,{...T,cost:{...T.cost,includes:['가맹비','교육비']}},true],['excludes reordered',T,{...T,cost:{...T.cost,excludes:['권리금','임차보증금']}},true],['cost removed',T,{...T,cost:undefined},true],
 ['page only',T,{...T,sourceRef:{...T.sourceRef,page:13}},false],['source text only',T,{...T,source:'정보공개서 2026-1'},false],['version bump only',T,{...T,version:2,updatedAt:NOW},false],['identical',T,{...T},false],
 ['malformed before',undefined,T,true],['malformed after',T,5,true],['malformed string',T,'x',true],['bigint version',T,{...T,version:2n},true]];
for(const [name,b,a,want] of rows)check(`59: factChangeAffects ${name} is ${want}`,fca(b,a)===want);
const RA=(id,refs,status='approved',x={})=>({...FORGE('도넛',refs),id,status,...x});
const assets=[RA('a-2',['f-total'],'draft'),RA('a-1',['f-count']),RA('a-3',['f-total'],'retired'),RA('a-0',['f-total'],'approved',{version:3})];
const before=JSON.stringify(assets);
const m1=fa.markAssetsForReview(assets,{factIds:['f-total']},LATER);
check('60: a changed fact flags only the live assets that reference it, sorted by id and version',same(m1,[{id:'a-0',version:3,review:{needed:true,reasons:['fact_changed'],at:LATER}},{id:'a-2',version:1,review:{needed:true,reasons:['fact_changed'],at:LATER}}])&&JSON.stringify(assets)===before);
const applied=assets.map(a=>{const m=plain(m1).find(x=>x.id===a.id&&x.version===a.version);return m?{...a,review:m.review}:a});
check('60: applying the same change again gives nothing',same(fa.markAssetsForReview(applied,{factIds:['f-total']},'2026-10-21T09:00:00+09:00'),[]));
const m3=plain(fa.markAssetsForReview(applied,{versionIds:['dvA']},'2026-10-21T09:00:00+09:00'));
check('60: a version change merges reasons and keeps the first flag time',same(m3.find(x=>x.id==='a-2').review,{needed:true,reasons:['fact_changed','version_changed'],at:LATER})&&same(m3.find(x=>x.id==='a-1').review,{needed:true,reasons:['version_changed'],at:'2026-10-21T09:00:00+09:00'})&&!m3.some(x=>x.id==='a-3')&&m3.length===3);
const m4=plain(fa.markAssetsForReview([RA('a-5',['f-total'],'approved',{version:2}),RA('a-5',['f-total'],'draft',{version:1,review:{needed:true,reasons:['version_changed'],at:NOW}})],{factIds:['f-total']},LATER));
check('60: reasons are merged in ASCII order and the same id is ordered by version',same(m4,[{id:'a-5',version:1,review:{needed:true,reasons:['fact_changed','version_changed'],at:NOW}},{id:'a-5',version:2,review:{needed:true,reasons:['fact_changed'],at:LATER}}]));
check('60: a record with a malformed stored body is skipped',same(fa.markAssetsForReview([{...RA('a-6',['f-total']),body:''},{...RA('a-7',['f-total']),body:NUL_DEPOSIT}],{factIds:['f-total']},LATER),[]));
check('60: malformed inputs give nothing and never throw',[[null,{factIds:['f-total']},LATER],[assets,null,LATER],[assets,{factIds:'f-total'},LATER],[assets,{factIds:['f-total']},'yesterday'],[[null,5,'x'],{factIds:['f-total']},LATER]].every(([a,c,t])=>Array.isArray(fa.markAssetsForReview(a,c,t))&&fa.markAssetsForReview(a,c,t).length===0));
check('61: changedVersionIds finds the current version that stopped being current or whose note changed',same(fa.changedVersionIds(V,V_NEW,NOW,null),['dvA'])&&same(fa.changedVersionIds(V,V,NOW,'dvA'),['dvA'])&&same(fa.changedVersionIds(V,V,NOW,null),[])&&same(fa.changedVersionIds(V,[...V,{...V_NEW[2],validFrom:'2026-11-01T00:00:00+09:00'}],NOW,null),[])
 &&same(fa.changedVersionIds(V,V.map(v=>v.id==='dvX'?{...v,status:'retired'}:v),NOW,null),['dvX'])&&same(fa.changedVersionIds(V_NEW,V_NEW,NOW,null),[])&&same(fa.changedVersionIds(V_NEW,V_NEW,NOW,'dvA'),[])&&same(fa.changedVersionIds(V_NEW,V_NEW,NOW,'dvB'),['dvB'])&&same(fa.changedVersionIds(null,V,NOW,null),[])&&same(fa.changedVersionIds(V,V_NEW,'yesterday',null),[])&&same(fa.changedVersionIds(V,[5],NOW,null),[]));
const flaggedA={...A,review:{needed:true,reasons:['fact_changed'],at:LATER}},flaggedD={...d1,review:{needed:true,reasons:['fact_changed'],at:LATER}};
const fresh=await fa.draftAsset(flaggedD,VAL(PAGE(lines('why',l=>[...l,'새 문장입니다.']))).value,{...META,id:d1.id,now:LATER});
check('62: after flagging, approval and export are review_needed until a new draft version clears it',is(await APP(flaggedD),'review_needed')&&is(await EXP(flaggedA),'review_needed')&&fresh.review.needed===false&&fresh.version===2&&OK(await APP(fresh)));
// 같은 원문을 다시 저장해도 prev가 더는 쓸 수 없으면(재검토 표시, 옛 체크리스트 승인, 승인 없는 approved, 폐기) 새 초안 버전을 만든다. 그래야 review_needed·checklist_outdated 문구가 안내하는 재승인 길이 열린다.
const samePage=VAL(PAGE()).value,stuck=[flaggedA,flaggedD,{...A,approval:{...A.approval,checklist:{version:'fr-assets-checklist@2026-09-01.1',checked:[...fa.CHECKLIST_IDS]}}},{...A,approval:null},{...A,status:'retired'}];
const resaved=await Promise.all(stuck.map(p=>fa.draftAsset(p,samePage,{...META,id:A.id,now:LATER})));
check('62: re-saving the same body of a flagged, outdated-checklist, approval-less or retired record makes a new draft version that approves',resaved.every(r=>r.version===2&&r.status==='draft'&&r.approval===null&&same(r.review,{needed:false,reasons:[],at:null})&&same(r.exports,[])&&same(r.placements,[])&&r.body===A.body&&r.bodyHash===A.bodyHash&&r.createdAt===NOW&&r.updatedAt===LATER)
 &&(await Promise.all(resaved.map(r=>APP(r)))).every(OK)&&is(await EXP(stuck[2]),'checklist_outdated'));
check('26: an approved record with the current checklist and no review flag is kept unchanged',await fa.draftAsset(A,samePage,{...META,id:A.id,now:LATER})===A);

// ════ 행사 ════
const DECK_A=await APPROVED(DECK(),['f-total'],'event_deck'),PAGE_D=await DRAFT(PAGE(),['f-total'],'startup_page',CTX,'a-page-draft'),PAGE_A=await APPROVED(PAGE(),['f-total'],'startup_page',CTX,'a-page-ok');
const ECTX={enabled:true,brandId:'b1',branch:'A',campaign:CAMP,assets:[DECK_A,PAGE_D,PAGE_A,{id:'a-other',version:1,brandId:'b2',status:'approved',type:'event_deck'}],actor:ADMIN,now:NOW};
const EV_IN=(x={})=>({type:'briefing',startsAt:LATER,placeLabel:'가상 창업센터 3층',capacity:30,spendRef:null,assetRefs:[{id:DECK_A.id,version:DECK_A.version}],...x});
const EVENT=(x={})=>({id:'e1',brandId:'b1',campaignId:'c1',type:'briefing',startsAt:LATER,placeLabel:'가상 창업센터 3층',capacity:2,spendRef:null,counts:{applied:0,attended:0,noShow:0},codes:[],assetRefs:[],status:'scheduled',version:1,createdAt:NOW,updatedAt:NOW,...x});
const VE=(x={},ctx=ECTX,prev)=>fa.validateEvent(EV_IN(x),ctx,prev);
const e63=VE({placeLabel:'  가상 창업센터 3층  ',spendRef:'sp-1'});
check('63: an admin in branch A registers a briefing with an approved deck',OK(e63)&&same(e63.value,{type:'briefing',startsAt:LATER,placeLabel:'가상 창업센터 3층',capacity:30,spendRef:'sp-1',assetRefs:[{id:DECK_A.id,version:DECK_A.version}]})&&same(e63.warnings,[]));
check('63: a briefing without an approved deck succeeds with a warning, other event types do not warn',same(VE({assetRefs:[]}).warnings,[fa.ASSET_WARNING_MESSAGES.briefingDeckMissing])&&same(VE({assetRefs:[{id:PAGE_A.id,version:1}]}).warnings,[fa.ASSET_WARNING_MESSAGES.briefingDeckMissing])&&same(VE({type:'expo',assetRefs:[]}).warnings,[])&&OK(VE({type:'tour',assetRefs:[],startsAt:'2026-09-01T10:00:00+09:00'})));
check('64: branches other than A are branch_not_a (409), a member 403, switch off 409',['B','C','undetermined',null].every(branch=>is(VE({},{...ECTX,branch}),'branch_not_a'))&&is(VE({},{...ECTX,actor:MEMBER}),'role_forbidden')&&is(VE({},{...ECTX,enabled:false,actor:MEMBER}),'switch_off')&&is(VE({},{...ECTX,now:'yesterday'}),'invalid_timestamp'));
check('65: bad type, capacity, place label, spend reference or linked assets are invalid_event',[{type:'seminar'},{capacity:0},{capacity:1001},{capacity:2.5},{capacity:'30'},{placeLabel:''},{placeLabel:'   '},{placeLabel:'가'.repeat(101)},{placeLabel:'가\u0001나'},{placeLabel:'가\n나'},{spendRef:'가'},{spendRef:undefined},{assetRefs:'x'},{assetRefs:Array.from({length:11},(_,i)=>({id:'a'+i,version:1}))},{assetRefs:[{id:DECK_A.id,version:1},{id:DECK_A.id,version:1}]},{assetRefs:[{id:'가',version:1}]},{assetRefs:[{id:DECK_A.id,version:0}]}].every(x=>is(VE(x),'invalid_event')));
check('65: limits are inclusive (capacity 1 and 1000, label 100 characters)',OK(VE({capacity:1}))&&OK(VE({capacity:1000}))&&OK(VE({placeLabel:'가'.repeat(100)})));
check('65: a start time without a zone is invalid_timestamp, input errors are collected',is(VE({startsAt:'2026-10-20 14:00'}),'invalid_timestamp')&&is(VE({type:'seminar',startsAt:'2026-10-20T14:00'}),'invalid_event','invalid_timestamp')&&is(fa.validateEvent(null,ECTX),'invalid_input'));
check('65: another brand asset is record_other_brand (400), a draft or unknown version asset_not_approved (409)',is(VE({assetRefs:[{id:'a-other',version:1}]}),'record_other_brand')&&is(VE({assetRefs:[{id:PAGE_D.id,version:1}]}),'asset_not_approved')&&is(VE({assetRefs:[{id:DECK_A.id,version:2}]}),'asset_not_approved')&&is(VE({assetRefs:[{id:'a-none',version:1}]}),'asset_not_approved'));
check('65: a consumer campaign is 409, another brand campaign 400',is(VE({},{...ECTX,campaign:CONSUMER}),'campaign_not_recruitment')&&is(VE({},{...ECTX,campaign:CAMP_B2}),'campaign_other_brand')&&is(VE({},{...ECTX,campaign:null}),'campaign_other_brand'));
const prev2=EVENT({counts:{applied:2,attended:0,noShow:0},codes:[{code:'p_alpha1',state:'applied'}]});
check('66: capacity below applications and a cancelled event are refused',is(VE({capacity:1},ECTX,prev2),'capacity_below_applied')&&OK(VE({capacity:2},ECTX,prev2))&&is(VE({},ECTX,{...prev2,status:'cancelled'}),'event_cancelled')&&is(VE({capacity:1},ECTX,{...prev2,status:'cancelled'}),'capacity_below_applied','event_cancelled'));
check('66: a malformed, other-brand or other-campaign previous event is refused',is(VE({},ECTX,{...prev2,counts:null}),'invalid_record')&&is(VE({},ECTX,{...prev2,brandId:'b2'}),'record_other_brand')&&is(VE({},ECTX,{...prev2,campaignId:'c9'}),'campaign_other_brand')&&OK(VE({},ECTX,null)));
check('66: a capacity reduction above the applications is allowed',OK(VE({capacity:10},ECTX,{...prev2,capacity:30})));
check('66: a previous event malformed only in its codes or version is invalid_record',is(VE({},ECTX,{...prev2,codes:[{code:'01000000101',state:'applied'}]}),'invalid_record')&&is(VE({},ECTX,{...prev2,codes:[{code:'ab',state:'applied'}]}),'invalid_record')&&is(VE({},ECTX,{...prev2,codes:[{code:'010-0000-0101',state:'applied'}]}),'invalid_record')&&is(VE({},ECTX,{...prev2,version:0}),'invalid_record'));
check('64-65: role before branch, input before campaign, other-brand link before the version lookup',is(VE({},{...ECTX,actor:MEMBER,branch:'B'}),'role_forbidden')&&is(VE({type:'seminar'},{...ECTX,campaign:CONSUMER}),'invalid_event')&&VE({type:'seminar'},{...ECTX,campaign:CONSUMER}).status===400&&is(VE({assetRefs:[{id:'a-other',version:9}]}),'record_other_brand'));
check('65: place labels and actor ids with a C1 control or a line separator are refused',is(VE({placeLabel:'본사\u0085교육장'}),'invalid_event')&&is(VE({placeLabel:'본사\u2028교육장'}),'invalid_event')&&is(VE({},{...ECTX,actor:{id:'u\u0085x',role:'admin'}}),'role_forbidden'));
const LINK10=Array.from({length:10},(_,i)=>({id:'a-l'+i,version:1,brandId:'b1',status:'approved',type:'expo_banner'})),LCTX={...ECTX,assets:[...ECTX.assets,...LINK10]};
const eSorted=VE({type:'expo',assetRefs:[{id:'a-l9',version:1},{id:'a-l1',version:1}]},LCTX),eNfd=VE({placeLabel:'가상 창업센터'.normalize('NFD')});
check('65: exactly ten linked assets pass, links come back sorted, the place label is NFC',OK(VE({type:'expo',assetRefs:LINK10.map(a=>({id:a.id,version:1}))},LCTX))&&same(eSorted.value.assetRefs,[{id:'a-l1',version:1},{id:'a-l9',version:1}])&&eNfd.value.placeLabel==='가상 창업센터'&&eNfd.value.placeLabel.length===7);
const OPCTX={enabled:true,brandId:'b1',branch:'A',now:NOW};
const REG=(e,input={},ctx=OPCTX)=>fa.registerDecision(e,input,ctx);
const e0=EVENT(),r1=REG(e0),e1={...e0,counts:plain(r1.value.counts),codes:plain(r1.value.codes)},r2=REG(e1,{code:'p_alpha1'}),e2={...e1,counts:plain(r2.value.counts),codes:plain(r2.value.codes)};
check('67: the first and second applications succeed and the code is linked',OK(r1)&&same(r1.value.counts,{applied:1,attended:0,noShow:0})&&same(r1.value.codes,[])&&OK(r2)&&same(r2.value,{counts:{applied:2,attended:0,noShow:0},codes:[{code:'p_alpha1',state:'applied'}]}));
check('67: the third application is capacity_full (409)',is(REG(e2),'capacity_full')&&REG(e2).status===409&&OK(REG({...e2,capacity:3})));
check('67: an application at or after the start is event_started, one millisecond before is not',is(REG(e1,{},{...OPCTX,now:LATER}),'event_started')&&is(REG(e1,{},{...OPCTX,now:'2026-10-20T05:00:00Z'}),'event_started')&&OK(REG(e1,{},{...OPCTX,now:'2026-10-20T13:59:59.999+09:00'})));
check('67: cancelled, full and started are collected; branch B is branch_not_a',is(REG({...e2,status:'cancelled'}),'capacity_full','event_cancelled')&&is(REG({...e2,status:'cancelled'},{},{...OPCTX,now:LATER}),'capacity_full','event_cancelled','event_started')&&is(REG(e1,{},{...OPCTX,branch:'B'}),'branch_not_a')&&is(REG(e1,{},{...OPCTX,branch:'undetermined'}),'branch_not_a'));
check('67: phone-like, short, spaced or non-string codes are invalid_code',['01000000101','ab','abc def','p_alpha1\n',5,{},'가나다라마바'].every(code=>is(REG(e1,{code}),'invalid_code'))&&is(REG(e1,null),'invalid_input'));
check('67: a repeated code is code_duplicate, codes stay sorted, any role may register',is(REG({...e2,capacity:5},{code:'p_alpha1'}),'code_duplicate')&&is(REG(e2,{code:'p_alpha1'}),'capacity_full','code_duplicate')&&same(REG({...e2,capacity:5},{code:'p_Zeta01'}).value.codes,[{code:'p_Zeta01',state:'applied'},{code:'p_alpha1',state:'applied'}])&&OK(REG(e1,{code:null})));
check('67: switch, timestamp and record checks come first',is(REG(e1,{},{...OPCTX,enabled:false,branch:'B'}),'switch_off')&&is(REG(e1,{},{...OPCTX,now:'yesterday'}),'invalid_timestamp')&&is(REG({...e1,brandId:'b2'},{},{...OPCTX,branch:'B'}),'record_other_brand')&&is(REG({...e1,capacity:0}),'invalid_record')&&is(REG({...e1,codes:[{code:'01000000101',state:'applied'}]}),'invalid_record'));
check('67: a seven-digit run is invalid_code, six digits pass',is(REG(e1,{code:'p1234567'}),'invalid_code')&&OK(REG(e1,{code:'p123456'})));
// 구분자('-'·'_')로 끊은 전화·주민번호 꼴도 막는다(명세 2.1의 목적). 합성 번호만 쓴다(공개 저장소 경계).
const SEP_CODES=['010-0000-0101','010_0000_0101','010-00000-101','p-010-0000-0101-x','900101-123-4567','ab-123-4567'];
check('67: phone or resident-number-like codes split by - or _ are invalid_code, six digits across separators pass',SEP_CODES.every(code=>is(REG(e1,{code}),'invalid_code'))&&OK(REG(e1,{code:'ab-123-456'})));
check('67: a stored event holding such a code is invalid_record',is(REG({...e1,codes:[{code:'010-0000-0101',state:'applied'}]}),'invalid_record')&&is(REG({...e1,codes:[{code:'010_0000_0101',state:'applied'}]}),'invalid_record'));
check('67: an input error is reported alone even when the event is also full',is(REG(e2,{code:'ab'}),'invalid_code')&&REG(e2,{code:'ab'}).status===400);
const codesN=n=>Array.from({length:n},(_,i)=>({code:'c-'+String(i).padStart(4,'0'),state:'applied'}));
check('67: an event with exactly 1000 codes is readable, 1001 is invalid_record',OK(REG({...e1,capacity:1000,codes:codesN(1000)}))&&is(REG({...e1,capacity:1000,codes:codesN(1001)}),'invalid_record'));
const E3=EVENT({capacity:30,counts:{applied:3,attended:0,noShow:0},codes:[{code:'p_alpha1',state:'applied'},{code:'p_beta22',state:'applied'},{code:'p_gamma3',state:'attended'}]});
check('67: a code already attended or marked no-show is still code_duplicate',is(REG(E3,{code:'p_gamma3'}),'code_duplicate')&&is(REG({...E3,codes:[...E3.codes,{code:'p_delta4',state:'no_show'}]},{code:'p_delta4'}),'code_duplicate'));
const ATT=(input,now=NOW,x={})=>fa.attendanceDecision(E3,input,{...OPCTX,now,...x});
const AIN={attended:2,noShow:1,codes:[{code:'p_alpha1',state:'attended'},{code:'p_beta22',state:'no_show'}]};
check('68: the day before the event (KST 23:59:59) is attendance_before_event (400)',is(ATT(AIN,'2026-10-19T14:59:59Z'),'attendance_before_event')&&ATT(AIN,'2026-10-19T14:59:59Z').status===400&&is(ATT({attended:-1},'2026-10-19T14:59:59Z'),'attendance_before_event'));
const a68=ATT(AIN,'2026-10-19T15:00:00Z');
check('68: KST midnight of the event day and the same day before the start succeed',OK(a68)&&same(a68.value,{counts:{applied:3,attended:2,noShow:1},codes:[{code:'p_alpha1',state:'attended'},{code:'p_beta22',state:'no_show'},{code:'p_gamma3',state:'applied'}]})&&OK(ATT(AIN,'2026-10-20T13:00:00+09:00'))&&OK(ATT(AIN,'2026-10-25T13:00:00+09:00')));
check('68: recording twice gives the same result',JSON.stringify(plain(fa.attendanceDecision({...E3,...plain(a68.value)},AIN,{...OPCTX,now:LATER})))===JSON.stringify(plain(ATT(AIN,LATER))));
check('68: counts over applications or capacity, negative or fractional counts are invalid_counts',[{attended:0,noShow:4},{attended:31,noShow:0},{attended:-1,noShow:0},{attended:1.5,noShow:0},{attended:'2',noShow:0},{attended:1,noShow:0,codes:[{code:'p_alpha1',state:'attended'},{code:'p_beta22',state:'attended'}]},{attended:0,noShow:0,codes:[{code:'p_alpha1',state:'no_show'}]}].every(i=>is(ATT(i,LATER),'invalid_counts')));
check('68: attended may exceed applications up to capacity (walk-ins)',OK(ATT({attended:30,noShow:0},LATER)));
check('68: unknown codes are code_unknown, malformed codes invalid_code, both collected with counts',is(ATT({attended:1,noShow:0,codes:[{code:'p_unknown1',state:'attended'}]},LATER),'code_unknown')&&[[{code:'ab',state:'attended'}],[{code:'p_alpha1',state:'applied'}],'x',[{code:'p_alpha1',state:'attended'},{code:'p_alpha1',state:'no_show'}]].every(codes=>is(ATT({attended:1,noShow:1,codes},LATER),'invalid_code'))&&is(ATT({attended:99,noShow:0,codes:[{code:'p_unknown1',state:'attended'}]},LATER),'code_unknown','invalid_counts')&&is(ATT(null,LATER),'invalid_input'));
check('68: cancelled is 409, switch off 409, branch B still records',is(fa.attendanceDecision({...E3,status:'cancelled'},AIN,{...OPCTX,now:LATER}),'event_cancelled')&&is(ATT(AIN,LATER,{enabled:false}),'switch_off')&&OK(ATT(AIN,LATER,{branch:'B'}))&&is(ATT(AIN,'yesterday'),'invalid_timestamp')&&is(fa.attendanceDecision({...E3,brandId:'b2'},AIN,{...OPCTX,now:LATER}),'record_other_brand'));
check('68: a cancelled event is event_cancelled even the day before',is(fa.attendanceDecision({...E3,status:'cancelled'},AIN,{...OPCTX,now:'2026-10-19T14:59:59Z'}),'event_cancelled'));
check('68: everyone may be a no-show (noShow equal to applications)',OK(ATT({attended:0,noShow:3},LATER)));
check('68: separator-split phone-like marks are invalid_code, a stored event holding one is invalid_record',SEP_CODES.every(code=>is(ATT({attended:1,noShow:0,codes:[{code,state:'attended'}]},LATER),'invalid_code'))&&is(fa.attendanceDecision({...E3,codes:[...E3.codes,{code:'010-0000-0101',state:'applied'}]},AIN,{...OPCTX,now:LATER}),'invalid_record'));
const SPARSE_MARKS=[{code:'p_alpha1',state:'attended'}];SPARSE_MARKS.length=2;
check('68: a sparse marks array is invalid_code',is(ATT({attended:1,noShow:0,codes:SPARSE_MARKS},LATER),'invalid_code'));
const EXPORTED={...A,exports:[{at:'2026-10-09T15:30:00Z',by:'u-admin',role:'admin',bodyHash:A.bodyHash,judgeVersion:'j',assetsVersion:fa.ASSETS_VERSION,checklistVersion:fa.CHECKLIST_VERSION}]};
const PCTX={enabled:true,brandId:'b1',actor:ADMIN,now:LATER};
const PL=(input,a=EXPORTED,ctx=PCTX)=>fa.placementDecision(a,input,ctx);
const p69=PL({label:'  창업 포털  ',confirmedAt:'2026-10-20'});
check('69: an exported approved asset records a placement dated today',OK(p69)&&same(p69.value,{placement:{label:'창업 포털',confirmedAt:'2026-10-20'}})&&OK(PL({label:'창업 포털',confirmedAt:'2026-10-10'}))&&OK(PL({label:'가'.repeat(100),confirmedAt:'2026-10-15'})));
check('69: a future date, a date before the KST export day, the 21st place or a bad label is invalid_placement',[{label:'창업 포털',confirmedAt:'2026-10-21'},{label:'창업 포털',confirmedAt:'2026-10-09'},{label:'',confirmedAt:'2026-10-15'},{label:'가'.repeat(101),confirmedAt:'2026-10-15'},{label:'창업\u0000포털',confirmedAt:'2026-10-15'},{label:'창업 포털',confirmedAt:'2026/10/15'},{label:'창업 포털',confirmedAt:'2026-10-15T00:00:00+09:00'},null].every(i=>is(PL(i),'invalid_placement'))
 &&is(PL({label:'창업 포털',confirmedAt:'2026-10-15'},{...EXPORTED,placements:Array.from({length:20},(_,i)=>({label:'p'+i,confirmedAt:'2026-10-15'}))}),'invalid_placement')&&OK(PL({label:'창업 포털',confirmedAt:'2026-10-15'},{...EXPORTED,placements:Array.from({length:19},(_,i)=>({label:'p'+i,confirmedAt:'2026-10-15'}))})));
check('69: never exported is not_exported, a draft not_approved, a member 403',is(PL({label:'창업 포털',confirmedAt:'2026-10-15'},A),'not_exported')&&is(PL({label:'창업 포털',confirmedAt:'2026-10-15'},{...EXPORTED,status:'draft'}),'not_approved')&&is(PL({label:'창업 포털',confirmedAt:'2026-10-15'},EXPORTED,{...PCTX,actor:MEMBER}),'role_forbidden')&&is(PL({label:'창업 포털',confirmedAt:'2026-10-15'},EXPORTED,{...PCTX,enabled:false,actor:MEMBER}),'switch_off')&&is(PL({},EXPORTED,{...PCTX,now:'x'}),'invalid_timestamp')&&is(PL({},{...EXPORTED,brandId:'b2'}),'record_other_brand')&&is(PL({},{...EXPORTED,exports:[{at:'soon'}]}),'invalid_record'));
const EXP2={...EXPORTED,exports:[{...EXPORTED.exports[0],at:'2026-10-11T10:00:00+09:00'},{...EXPORTED.exports[0],at:'2026-10-15T10:00:00+09:00'}]};
check('69: today is the KST date of now in any offset, the first export sets the lower bound',OK(PL({label:'창업 포털',confirmedAt:'2026-10-20'},EXPORTED,{...PCTX,now:'2026-10-19T16:00:00Z'}))&&is(PL({label:'창업 포털',confirmedAt:'2026-10-20'},EXPORTED,{...PCTX,now:'2026-10-20T00:30:00+14:00'}),'invalid_placement')
 &&OK(PL({label:'창업 포털',confirmedAt:'2026-10-12'},EXP2))&&is(PL({label:'창업 포털',confirmedAt:'2026-10-10'},EXP2),'invalid_placement'));
const pNfd=PL({label:'창업 포털'.normalize('NFD'),confirmedAt:'2026-10-15'});
check('69: the role check comes before the record check, labels are NFC and refuse C1 controls, a malformed stored body is invalid_record',is(PL({label:'p',confirmedAt:'2026-10-15'},{...EXPORTED,brandId:'b2'},{...PCTX,actor:MEMBER}),'role_forbidden')&&pNfd.value.placement.label==='창업 포털'
 &&is(PL({label:'창업\u0085포털',confirmedAt:'2026-10-15'}),'invalid_placement')&&is(PL({label:'창업\u2028포털',confirmedAt:'2026-10-15'}),'invalid_placement')&&is(PL({label:'p',confirmedAt:'2026-10-15'},{...EXPORTED,body:NUL_DEPOSIT}),'invalid_record'));

// ════ 게이트 함수 직접 호출(R15a-2 미리보기) ════
const g1=fa.assetGateIssues(A,{brandId:'b1',facts:CTX.facts,versions:V,now:NOW}),g2=fa.assetGateIssues(FORGE(PORTAL,['f-count']),{brandId:'b1',facts:CTX.facts,versions:V,now:NOW}),g3=fa.assetGateIssues(A,{brandId:'b1',facts:CTX.facts,versions:V_NEW,now:NOW}),g4=fa.assetGateIssues({...A,factRefs:[{id:'f-store',version:1}]},{brandId:'b1',facts:CTX.facts,versions:V,now:NOW});
check('3.7: the gate returns codes, stage status, judgement and message',same(g1.codes,[])&&g1.status===200&&g1.message===null&&g1.judgement.blocked===false&&same(g2.codes,['footnote_missing','h8_label_missing'])&&g2.status===409&&g2.message===r54.message&&same(g3.codes,['version_not_current'])&&g3.judgement===null&&same(g4.codes,['fact_store_scoped'])&&g4.status===400&&same(fa.assetGateIssues(A,{brandId:'b1',facts:CTX.facts,versions:V,now:'x'}).codes,['invalid_timestamp'])&&same(fa.assetGateIssues(null,{brandId:'b1',facts:[],versions:V,now:NOW}).codes,['invalid_record'])&&(g=>same(g.codes,['record_other_brand'])&&g.status===400&&g.judgement===null)(fa.assetGateIssues({...A,brandId:'b2'},{brandId:'b1',facts:CTX.facts,versions:V,now:NOW})));
const GCTX={brandId:'b1',facts:CTX.facts,versions:V,now:NOW},refsN=n=>Array.from({length:n},(_,i)=>({id:'f-r'+String(i).padStart(2,'0'),version:1}));
check('3.7: a stored record with exactly 20 references reaches the fact stage, 21 is invalid_record',same(fa.assetGateIssues({...A,factRefs:refsN(20)},GCTX).codes,['fact_changed'])&&same(fa.assetGateIssues({...A,factRefs:refsN(21)},GCTX).codes,['invalid_record']));
check('3.7: a stored body outside the input invariants is invalid_record in the gate',BAD_BODIES.every(b=>same(fa.assetGateIssues(FORGE(b),GCTX).codes,['invalid_record'])));

// ════ 던지지 않음 ════
const HUGE=Array.from({length:10000},()=>({id:'f-total',version:1}));
const GARBAGE=[null,'x',5,5n,{x:5n},[],HUGE];
const BAD_NOW=['yesterday','2199-12-31T20:00:00Z'];
let noThrow=0;
// 결정 함수는 결정 객체를 돌려주고, 실패면 D 불변식을 지킨다. 그 밖의 함수는 던지지 않기만 하면 된다.
const call=async(fn,decision)=>{let r;try{r=await fn()}catch(e){assert.fail('던졌습니다: '+e?.message)}noThrow++;if(decision){assert.ok(typeof r?.ok==='boolean'&&r.ruleVersion===fa.ASSETS_VERSION,'결정 객체여야 합니다');if(!r.ok)D(r)}return r};
for(const g of GARBAGE){
 await call(()=>fa.validateAssetInput(g,CTX),'decision');await call(()=>fa.validateAssetInput(inputOf(PAGE()),g),'decision');
 await call(()=>fa.validateAssetInput({type:'portal_intro',body:'도넛',factRefs:g},CTX),'decision');await call(()=>fa.validateAssetInput(inputOf('도넛',[],'portal_intro'),{...CTX,facts:g}),'decision');
 await call(()=>fa.approveDecision(g,APPROVE_IN(d1),ACTX),'decision');await call(()=>fa.approveDecision(d1,g,ACTX),'decision');await call(()=>fa.approveDecision(d1,APPROVE_IN(d1),g),'decision');await call(()=>fa.approveDecision(d1,cl(g),ACTX),'decision');
 await call(()=>fa.exportDecision(g,XCTX),'decision');await call(()=>fa.exportDecision(A,g),'decision');await call(()=>fa.exportDecision(A,{...XCTX,versions:g}),'decision');await call(()=>fa.exportDecision({...A,approval:g},XCTX),'decision');
 await call(()=>fa.placementDecision(g,{label:'p',confirmedAt:'2026-10-15'},PCTX),'decision');await call(()=>fa.placementDecision(EXPORTED,g,PCTX),'decision');await call(()=>fa.placementDecision(EXPORTED,{label:'p',confirmedAt:'2026-10-15'},g),'decision');
 await call(()=>fa.validateEvent(g,ECTX),'decision');await call(()=>fa.validateEvent(EV_IN(),g),'decision');await call(()=>fa.validateEvent(EV_IN(),ECTX,g),'decision');await call(()=>fa.validateEvent(EV_IN({assetRefs:g}),ECTX),'decision');await call(()=>fa.validateEvent(EV_IN(),{...ECTX,assets:g}),'decision');
 await call(()=>fa.registerDecision(g,{},OPCTX),'decision');await call(()=>fa.registerDecision(e1,g,OPCTX),'decision');await call(()=>fa.registerDecision(e1,{},g),'decision');
 await call(()=>fa.attendanceDecision(g,AIN,OPCTX),'decision');await call(()=>fa.attendanceDecision(E3,g,{...OPCTX,now:LATER}),'decision');await call(()=>fa.attendanceDecision(E3,{attended:1,noShow:0,codes:g},{...OPCTX,now:LATER}),'decision');await call(()=>fa.attendanceDecision(E3,AIN,g),'decision');
 await call(()=>fa.assetGateIssues(g,{brandId:'b1',facts:CTX.facts,versions:V,now:NOW}));await call(()=>fa.assetGateIssues(A,g));await call(()=>fa.assetStructureIssues('startup_page',g,g,g,g,g));await call(()=>fa.approvalChecklist(g,g));await call(()=>fa.h7Notice(g));
 await call(()=>fa.factChangeAffects(g,T));await call(()=>fa.changedVersionIds(g,g,NOW,g));await call(()=>fa.markAssetsForReview(g,g,g));await call(()=>fa.effectiveAssetFacts(g,'b1',NOW));await call(()=>fa.sectionTemplate(g));await call(()=>fa.assetBodyHash(g));
}
for(const now of BAD_NOW){
 check(`70: now ${now} is invalid_timestamp everywhere`,[fa.validateAssetInput(inputOf(PAGE()),{...CTX,now}),await APP(d1,APPROVE_IN(d1),{...ACTX,now}),await EXP(A,{...XCTX,now}),PL({label:'p',confirmedAt:'2026-10-15'},EXPORTED,{...PCTX,now}),VE({},{...ECTX,now}),REG(e1,{},{...OPCTX,now}),ATT(AIN,now)].every(r=>is(r,'invalid_timestamp'))&&same(fa.assetGateIssues(A,{brandId:'b1',facts:CTX.facts,versions:V,now}).codes,['invalid_timestamp']));
}
check('70: BigInt fields, huge arrays and garbage never throw from any function',noThrow===GARBAGE.length*38&&is(fa.validateAssetInput({type:'portal_intro',body:'도넛',factRefs:[{id:'f-total',version:1n}]},CTX),'invalid_fact_refs')&&is(fa.validateAssetInput(inputOf('도넛',[],'portal_intro'),{...CTX,facts:[{...F.total,version:5n}]}),'invalid_record')&&is(fa.validateAssetInput({type:'portal_intro',body:'도넛',factRefs:HUGE},CTX),'invalid_fact_refs')&&is(await APP(d1,cl(HUGE.map(()=>'no_wait_bypass'))),'checklist_incomplete'));

// ════ 6) 가드 컨텍스트 재실행 ════
// console·가드 Date(인자 없는 생성·Date()·Date.now·Date.parse는 던짐)·가드 Math.random·crypto.subtle·TextEncoder만 둔 컨텍스트에서 모듈과 폐포를 다시 불러 모든 판정 함수를 돌린다.
// 링커는 lib/ 안의 './'·'../' 경로만 허용한다. URL·process·fetch·Response가 없어 접근하면 ReferenceError다.
const RealDate=Date;
function GuardDate(...a){if(!new.target)throw new Error('Date() 호출 금지');if(!a.length)throw new Error('인자 없는 new Date 금지');return new RealDate(...a)}
GuardDate.UTC=RealDate.UTC;GuardDate.now=()=>{throw new Error('Date.now 금지')};GuardDate.parse=()=>{throw new Error('Date.parse 금지')};GuardDate.prototype=RealDate.prototype;
const guardCtx=createContext({console,Date:GuardDate,Math:Object.create(Math,{random:{value:()=>{throw new Error('Math.random 금지')}}}),crypto:{subtle:webcrypto.subtle},TextEncoder}),guardCache=new Map(),LIB=resolve('lib')+'/';
const guardModule=path=>{path=resolve(path);if(guardCache.has(path))return guardCache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context:guardCtx,identifier:path});guardCache.set(path,m);return m};
const guardLoad=async path=>{const m=guardModule(path);if(m.status==='unlinked')await m.link((s,r)=>{if(!s.startsWith('./')&&!s.startsWith('../'))throw new Error('상대 경로만: '+s);const p=resolve(dirname(r.identifier),s.endsWith('.ts')?s:s+'.ts');if(!p.startsWith(LIB))throw new Error('lib 밖: '+s);return guardModule(p)});if(m.status!=='evaluated')await m.evaluate();return m.namespace};
const ga=await guardLoad('lib/franchise-assets.ts');
const runAll=async m=>{
 const d=await m.draftAsset(null,m.validateAssetInput(inputOf(PAGE()),CTX).value,META);
 return [await m.assetBodyHash(PAGE()),m.effectiveAssetFacts(Object.values(F),'b1',NOW),m.validateAssetInput(inputOf(PAGE()),CTX),m.validateAssetInput(inputOf(DEPOSIT,[],'portal_intro'),CTX),d,m.sectionTemplate('event_deck'),m.assetStructureIssues('startup_page',PAGE(heading('why',null)),[F.total],BF,V,NOW),
  m.assetGateIssues(FORGE(PORTAL,['f-count']),{brandId:'b1',facts:CTX.facts,versions:V,now:NOW}),m.approvalChecklist(VAL(RR,[],'portal_intro').value.judgement,'B'),m.h7Notice('C'),await m.approveDecision(d,APPROVE_IN(d),ACTX),await m.approveDecision(faqDeposit,APPROVE_IN(faqDeposit),ACTX),
  await m.exportDecision(A,XCTX),await m.exportDecision(deckRR,XCTX),m.placementDecision(EXPORTED,{label:'창업 포털',confirmedAt:'2026-10-20'},PCTX),m.factChangeAffects(T,{...T,value:'x'}),m.changedVersionIds(V,V_NEW,NOW,null),m.markAssetsForReview(assets,{factIds:['f-total'],versionIds:['dvA']},LATER),
  m.validateEvent(EV_IN(),ECTX),m.validateEvent(EV_IN({assetRefs:[]}),ECTX,prev2),m.registerDecision(e1,{code:'p_alpha1'},OPCTX),m.registerDecision(e2,{},OPCTX),m.attendanceDecision(E3,AIN,{...OPCTX,now:LATER}),m.attendanceDecision(E3,AIN,{...OPCTX,now:'2026-10-19T14:59:59Z'})];
};
check('6: every decision function runs without clock, randomness, URL, process or fetch and matches the normal run',JSON.stringify(plain(await runAll(ga)))===JSON.stringify(plain(await runAll(fa))));
let compileThrew=false;try{ga.ID_PATTERN.compile('^.*$')}catch{compileThrew=true}
let pseudoThrew=false;try{ga.PSEUDONYM_PATTERN.compile('^.*$')}catch{pseudoThrew=true}
check('12: compiling the exported patterns cannot loosen the module checks',compileThrew&&pseudoThrew&&same(ga.validateAssetInput({type:'portal_intro',body:'도넛',factRefs:[{id:'가',version:1}]},CTX).reasons,['invalid_fact_refs'])&&same(ga.registerDecision(e1,{code:'ab'},OPCTX).reasons,['invalid_code']));

// ════ 71) 사유 코드 전부·외부 호출 ════
const missingSeen=plain(fa.ASSET_CODES).filter(c=>!seen.has(c)),missingProduced=plain(fa.ASSET_CODES).filter(c=>!produced.has(c));
assert.deepEqual(missingSeen,[],'기대값으로 확인하지 않은 코드: '+missingSeen.join(', '));passed.push('71: all 51 codes are asserted as expected values');
assert.deepEqual(missingProduced,[],'실제로 나오지 않은 코드: '+missingProduced.join(', '));passed.push('71: all 51 codes were produced by a decision');
check(`71: the status invariant held on every failure result (${failCount})`,failCount>=300);
check('71: no external call was made',fetchCalls===0);

console.log(JSON.stringify({passed:passed.length}));
