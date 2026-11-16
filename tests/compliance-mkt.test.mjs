// 규정 사전 .16 마케팅 묶음(pack 'mkt', 스위치 compliance_mkt_rules 기본 꺼짐). 순서: ① 꺼짐일 때 .15와 같은지(회귀 오라클) ② 규칙별 위반·정상 쌍
// ③ 과차단 정상 묶음(오탐 0이 기준) ④ 수정 제안 기대값 ⑤ 서버 스위치 연결(작업물 규정 보기·수정 적용·채점).
// 근거: mocked(메모리 SQLite, 쿠키 세션 주입, fetch 스텁). 모델·외부 네트워크 호출 0회. 문장은 전부 합성이며 법률 자문이 아니다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {corpus,textKey} from './helpers/compliance-corpus.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const cc=await rt.load('lib/graders/compliance.ts'),fx=await rt.load('lib/graders/compliance-fixes.ts');
const server=await rt.load('lib/server.ts'),flags=await rt.load('lib/feature-flags.ts'),og=await rt.load('lib/online-grading.ts');
const sourcesRoute=await rt.load('app/api/artifact-sources/route.ts'),actionRoute=await rt.load('app/api/action/route.ts');
const {COMPLIANCE_LEXICON}=cc;
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};
const plain=x=>JSON.parse(JSON.stringify(x));
const MKT={packs:['mkt']};
const issues=(text,opts)=>plain(cc.checkCompliance(text,opts)).issues;
const ids=(text,opts)=>issues(text,opts).map(i=>i.ruleId);
const mktRules=COMPLIANCE_LEXICON.rules.filter(r=>r.pack==='mkt'),mktIds=new Set(mktRules.map(r=>r.id));
const sig=r=>r.issues.map(i=>[i.ruleId,i.severity,textKey(i.excerpt).slice(0,8)].join('|'));

// ── ① 꺼짐 = .15 (회귀 오라클) ──
// tests/fixtures/compliance-15-oracle.json: origin/integrate/wave8 559df20(.15)에서 같은 말뭉치(tests/helpers/compliance-corpus.mjs)로 만든 이슈 서명.
// 다른 레인이 테스트에 새 문장을 더해도 오라클에 없는 문장은 건너뛴다. 오라클 문장의 95% 이상을 지금 말뭉치에서 찾아야 한다.
const oracle=JSON.parse(readFileSync('tests/fixtures/compliance-15-oracle.json','utf8'));
check('the oracle was made from the .15 dictionary',oracle.version==='compliance-lexicon-2026-11-15.15'&&oracle.count>3000);
let compared=0;const diffs=[];
for(const {text,source} of corpus()){
 const want=oracle.entries[textKey(text)];if(!want)continue;compared++;
 for(const [key,opts] of [['d',{}],['r',{franchise:{scope:'recruitment'}}],['d',{packs:[]}],['d',{packs:null}]]){
  const got=sig(cc.checkCompliance(text,opts));
  if(JSON.stringify(got)!==JSON.stringify(want[key]))diffs.push(`${source} ${key} ${JSON.stringify(opts)}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want[key])}`);
 }
}
check(`flag off: issue lists equal .15 on ${compared} corpus texts (default, franchise opt-in, packs [] and null)`,compared>=oracle.count*0.95&&(diffs.length===0||assert.fail(diffs.slice(0,5).join('\n'))));
check('flag off: no corpus text reports a mkt rule',corpus().every(({text})=>!ids(text).some(id=>mktIds.has(id))));
check('the version string is bumped to .16',COMPLIANCE_LEXICON.version==='compliance-lexicon-2026-11-16.16');
check('the mkt pack adds 14 rules (36 → 50) without new categories',mktRules.length===14&&COMPLIANCE_LEXICON.rules.length===50&&mktRules.every(r=>cc.COMPLIANCE_CATEGORIES.includes(r.category)));
check('an unknown pack name changes nothing',corpus().slice(0,300).every(({text})=>JSON.stringify(sig(cc.checkCompliance(text,{packs:['zzz']})))===JSON.stringify(sig(cc.checkCompliance(text)))));

// ── ② 규칙별 위반·정상 쌍 [규칙, 위반, 정상(같은 주제), 정상 옵션] ──
const LEDGER=key=>({packs:['mkt'],facts:{confirmed:[{key,value:'합성 확인 자료'}],prohibited:[]}});
const pairs=[
 ['kr.ad.scarcity_unverified','선착순 50명 한정으로 떡볶이 세트를 드립니다. 서두르세요!','11/20–11/26 행사, 선착순 50명에게 떡볶이 세트를 드립니다.'],
 ['kr.ad.scarcity_unverified','오늘만 이 가격! 곧 품절됩니다.','오늘만 이 가격!',LEDGER('offer_period')],
 ['kr.ad.scarcity_unverified','겨울 한정 어묵탕을 팝니다.','겨울 한정 어묵탕(매년 12월~2월)을 팝니다.'],
 ['kr.ad.foreign_only_disclosure','#AD 이번 주 신메뉴를 먹어 봤어요. 매콤해서 좋았어요.','#광고 #AD 이번 주 신메뉴를 먹어 봤어요.'],
 ['kr.ad.foreign_only_disclosure','[PR] 브랜드에서 보내 준 키트로 만들어 봤어요.','[광고] 브랜드에서 보내 준 키트로 만들어 봤어요.'],
 ['kr.rv.negative_suppression','부정적인 후기를 남긴 고객에게는 후기 삭제를 요청한다.','부정 후기도 같은 보상을 드리고, 후기 삭제를 요청하지 않는다.'],
 ['kr.rv.negative_suppression','별점 3점 이하 리뷰는 쿠폰 지급에서 제외한다.','별점과 내용에 관계없이 모든 리뷰에 같은 쿠폰을 드린다.'],
 ['kr.ad.authority_claim','식약처 인증을 받은 떡볶이 소스입니다.','식약처 인증을 받은 떡볶이 소스입니다.',LEDGER('certification')],
 ['kr.ad.authority_claim','백년가게로 선정된 분식집입니다.','정부 지원 사업 공고를 확인한다.'],
 ['kr.cos.ai_expert','AI로 만든 피부과 전문의가 이 세럼을 추천하는 영상을 올린다.','피부과 전문의 자문을 받아 세럼 성분표를 정리했다.'],
 ['kr.cos.ai_expert','가상 약사 캐릭터가 선크림을 권하는 카드뉴스','가상 약사 캐릭터는 쓰지 않고 선크림 사용법만 안내한다.'],
 ['kr.food.body_change','야근 스트레스 날리는 매운 떡볶이','야근 뒤 친구와 나누는 매운 떡볶이'],
 ['kr.food.body_change','먹고 나면 피로가 싹 풀리는 국밥','뜨끈하고 든든한 국밥 한 그릇'],
 ['kr.food.body_change','속 편한 담백한 도우','바삭하고 담백한 도우'],
 ['kr.food.body_change','늦은 밤에도 부담 없는 가벼운 씬 도우','부담 없는 가격의 씬 도우 1인 세트 9,900원'],
 ['kr.ad.comparison_unsupported','다른 가게보다 2배 많은 양의 떡볶이','리뉴얼 전보다 더 쫄깃해진 떡'],
 ['kr.ad.comparison_unsupported','시중 제품보다 30% 저렴한 소스','시중 제품보다 30% 저렴한 소스',LEDGER('claim_basis')],
 ['kr.ad.unconditional_warranty','100% 품질 보증! 마음에 안 들면 무조건 환불해 드립니다.','구매 후 7일 이내 미개봉 상품은 환불해 드립니다.'],
 ['kr.ad.unconditional_warranty','평생 무상 수리 보증 텀블러','품질 보증 기간: 구매일부터 1년. 절차: 고객센터 접수 뒤 교환.'],
 ['kr.ec.preselected_option','추가 토핑 옵션은 미리 체크된 상태로 노출한다.','추가 토핑 옵션은 고객이 직접 고르게 둔다.'],
 ['kr.ec.preselected_option','마케팅 수신 동의 상자는 기본으로 체크되어 있게 만든다.','마케팅 수신 동의 상자는 미리 체크하지 않는다.'],
 ['kr.msg.sender_missing','오픈 알림 문자 초안: (광고) 오늘 오픈! 첫 주문 고객께 김밥을 드립니다. 무료 수신거부 080-000-0000','오픈 알림 문자 초안: (광고) 전송자 가상분식 02-000-0000. 오늘 오픈! 김밥을 드립니다. 무료 수신거부 080-000-0000'],
 ['kr.msg.consent_refusal_denial','마케팅 수신 동의를 해야만 회원 가입이 가능합니다.','마케팅 수신 동의는 선택이며, 동의하지 않아도 모든 서비스를 이용할 수 있습니다.'],
 ['kr.msg.consent_refusal_denial','마케팅 정보 수신 동의(필수)','마케팅 정보 수신 동의(선택)'],
 ['kr.msg.consent_refusal_denial','광고 수신에 동의하지 않으시면 이벤트 참여가 불가합니다.','마케팅 수신 동의한 고객에게만 쿠폰 문자를 보낸다.'],
 ['kr.rights.ugc_repost','고객이 올린 사진을 공식 계정에 리그램한다.','고객이 올린 사진은 작성자 허락을 받은 뒤 공식 계정에 리그램한다.'],
 ['kr.rights.ugc_repost','태그해 주시면 리그램해 드려요!','고객 후기 사진은 작성자 동의를 받은 것만 재게시한다.'],
 ['kr.rights.official_claim','공식 판매처에서만 구할 수 있는 굿즈','공식 계정 안내: 새 소식은 인스타그램 공지로 알립니다.'],
 ['kr.rights.official_claim','정품 인증 앨범을 판매합니다.','정품 인증 앨범을 판매합니다. 공급 계약서로 정품 확인 방법을 안내합니다.'],
 ['kr.ec.extra_cost_missing','떡볶이 세트 12,900원, 지금 배달 주문하세요.','떡볶이 세트 12,900원(배달비 3,000원 별도), 지금 배달 주문하세요.'],
 ['kr.ec.extra_cost_missing','택배 주문 시 밀키트 19,800원','택배 주문 시 밀키트 19,800원, 배송비 무료(최소 주문 2만 원)'],
 // 기존 규칙의 mkt 확장(꺼지면 .15와 같다).
 ['disease_claim','장 건강에 도움을 주는 발효 김치','아삭하고 깊은 맛의 발효 김치'],
 ['disease_claim','하루 한 잔 디톡스 주스','하루 한 잔 사과 착즙 주스'],
 ['kr.ad.outcome_guarantee','네이버 검색 상위 노출을 보장합니다.','상위 노출을 목표로 키워드를 정리합니다.'],
 ['kr.ad.outcome_guarantee','AI 추천 1순위 보장 패키지','AI 답변에 브랜드가 나오는지 주마다 관측합니다.'],
];
for(const [rule,bad,good,goodOpts] of pairs){
 check(`${rule} flags: ${bad.slice(0,18)}`,ids(bad,MKT).includes(rule)||assert.fail(JSON.stringify(issues(bad,MKT))));
 check(`${rule} passes: ${good.slice(0,18)}`,!ids(good,goodOpts||MKT).includes(rule)||assert.fail(JSON.stringify(issues(good,goodOpts||MKT))));
 check(`${rule} is silent with the pack off: ${bad.slice(0,12)}`,mktIds.has(rule)?!ids(bad).includes(rule):JSON.stringify(sig(cc.checkCompliance(bad)))===JSON.stringify(sig(cc.checkCompliance(bad,{packs:[]}))));
}
check('every mkt rule has at least one violation/normal pair',[...mktIds].every(id=>pairs.some(p=>p[0]===id)));
const sev=Object.fromEntries(mktRules.map(r=>[r.id,r.severity]));
check('block only where the law row is explicit (AI expert in cosmetics, refusal of service over marketing consent); the rest start as warn',
 sev['kr.cos.ai_expert']==='block'&&sev['kr.msg.consent_refusal_denial']==='block'&&Object.entries(sev).filter(([,s])=>s==='block').length===2);
check('extensions keep the existing rule ids and severities',ids('장 건강에 도움을 주는 발효 김치',MKT).includes('disease_claim')&&issues('장 건강에 도움을 주는 발효 김치',MKT).find(i=>i.ruleId==='disease_claim').severity==='block');

// ── ③ 과차단 정상 묶음(계획 §5-1): 묶음을 켜도 이슈 0건 ──
const normals=[
 '가상분식 최고의 맛, 매콤한 국물 떡볶이',
 '대표 메뉴는 국물 떡볶이입니다.',
 '11월 20일~11월 26일 기간 한정 치즈 떡볶이를 팝니다.',
 '기간 한정(11/20–11/26) 로제 떡볶이',
 'PR 담당자에게 보도자료 일정을 공유한다.',
 '퇴근 뒤 속 편한 자리에서 친구와 나누는 떡볶이',
 '공식 계정 안내: 영업시간 변경은 인스타그램 공지로 알립니다.',
 '한정 수량 문구의 클릭률을 측정한다.',
 '선착순 문구별 전환율을 지표로 비교한다.',
 '부담 없는 가격의 1인 세트 9,900원',
 '겨울 한정 메뉴(매년 12월~2월)로 어묵탕을 팝니다.',
 '한 판이면 든든한 저녁',
 '입안이 얼얼한 매운맛',
 '피곤한 오후, 달콤한 도넛 한 입',
 '가볍게 휘핑한 크림을 올린 도넛',
 '맛은 자신 있습니다. 직접 와서 드셔 보세요.',
 '착한 가격의 점심 세트',
 '리뷰는 별점과 관계없이 모두 답글을 단다.',
 '고객 후기는 작성자 허락을 받은 것만 공식 계정에 공유한다.',
 '수신 동의 고객에게만 문자를 보낸다.',
 '배달앱 리뷰 정책은 담당자가 화면으로 확인한다.',
 '오늘의 추천 메뉴는 김말이입니다.',
 '단골 고객을 위한 스탬프 카드를 드립니다.',
 // P2 로컬 측정에서 나온 오탐(2026-11-16 관측)을 정상 묶음에 고정한다.
 '상품×국가 선정은 주문 자료가 있으면 출처와 기간을 적는다.',
 '홍보(PR) 담당자와 보도 일정을 맞춘다.',
 '신메뉴는 전국 5개 매장에서 한정 판매합니다.',
 '공휴일 목록이 없어 주말만 반영했습니다.',
 '오늘만 영업시간이 21시까지입니다.',
 '가격표 기준 경쟁사보다 30% 비싸다.',
 'A1,2026-09-20 13:05,"12,000원",1000,AB23,배달의민족,member-777',
];
let falsePositives=0;
for(const text of normals){const got=issues(text,MKT);if(got.length)falsePositives++;check(`normal stays clean with the pack on: ${text.slice(0,18)}`,got.length===0||assert.fail(JSON.stringify(got)))}
check('normal corpus false positives = 0',falsePositives===0&&normals.length>=20);

// ── ④ 수정 제안 기대값 ──
const fixesOf=(text,opts)=>plain(fx.computeComplianceFixes(text,opts));
const applyAll=(text,opts)=>fx.applyComplianceFixes(text,fx.computeComplianceFixes(text,opts));
const FOREIGN='#AD 이번 주 신메뉴를 먹어 봤어요. 매콤해서 좋았어요.';
let f=fixesOf(FOREIGN,MKT).filter(x=>x.ruleId==='kr.ad.foreign_only_disclosure');
check('foreign-only label: one insert of #광고 at the start of the line',f.length===1&&f[0].kind==='insert'&&f[0].after==='#광고 '&&applyAll(FOREIGN,MKT).startsWith('#광고 #AD'));
check('foreign-only fix clears the rule',!ids(applyAll(FOREIGN,MKT),MKT).includes('kr.ad.foreign_only_disclosure'));
const BODY='## 상세\n야근 스트레스 날리는 매운 떡볶이. 치즈를 듬뿍 올렸어요.';
f=fixesOf(BODY,MKT).filter(x=>x.ruleId==='kr.food.body_change');
check('body-change claim: the sentence is removed and the rest kept',f.length===1&&f[0].kind==='remove'&&applyAll(BODY,MKT)==='## 상세\n치즈를 듬뿍 올렸어요.');
const EXPERT='## 카드뉴스\nAI로 만든 피부과 전문의가 이 세럼을 추천한다. 하루 두 번 바르세요.';
f=fixesOf(EXPERT,MKT).filter(x=>x.ruleId==='kr.cos.ai_expert');
check('AI expert endorsement: the sentence is removed',f.length===1&&f[0].kind==='remove'&&!ids(applyAll(EXPERT,MKT),MKT).includes('kr.cos.ai_expert'));
const WARRANTY='100% 품질 보증 텀블러입니다.';
f=fixesOf(WARRANTY,MKT).filter(x=>x.ruleId==='kr.ad.unconditional_warranty');
check('unconditional warranty: the claim becomes a check placeholder and needs a check',f.length===1&&f[0].kind==='replace'&&f[0].needsCheck&&f[0].after===fx.WARRANTY_PLACEHOLDER&&applyAll(WARRANTY,MKT).includes(fx.WARRANTY_PLACEHOLDER));
check('mkt fixes do not invent numbers',[FOREIGN,BODY,EXPERT,WARRANTY].every(t=>fixesOf(t,MKT).every(x=>!/\d/.test(x.after.replace(/080/g,'')))));
check('with the pack off no fix names a mkt rule',[FOREIGN,BODY,EXPERT,WARRANTY].every(t=>fixesOf(t).every(x=>!mktIds.has(x.ruleId))));
check('rules without a safe fix stay manual (scarcity, authority, consent)',['kr.ad.scarcity_unverified','kr.ad.authority_claim','kr.msg.consent_refusal_denial','kr.ec.preselected_option'].every(id=>!fx.hasFixer(id)));

// ── ⑤ 서버 스위치 연결 ──
const O='mkt-owner',now=new Date().toISOString();
const put=(kind,id,data,parent='')=>server.recordStatement(O,kind,id,data,parent).run();
rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('admin','admin@test.invalid',O,'admin','active',1);
const token=createHash('sha256').update('tok-admin').digest('hex');
rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'admin',Date.now()+600000,Date.now());
const cookie={cookie:'__Host-collective_session='+token};
const get=async q=>{const r=await sourcesRoute.GET(new Request('https://app.test/api/artifact-sources'+q,{headers:cookie}));return {status:r.status,data:await r.json()}};
const post=async data=>{const r=await actionRoute.POST(new Request('https://app.test/api/action',{method:'POST',headers:{...cookie,origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}};
await put('brand','gb',{id:'gb',name:'가상분식',short:'GB'});
await put('campaign','c1',{id:'c1',brandId:'gb',title:'가상분식 오픈',goal:'첫 포장 주문',audience:'',channels:'Instagram',stores:'',products:'떡볶이',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'review',version:1,createdAt:now,updatedAt:now});
const CONTENT='## 게시물 카피\n#AD 이번 주 신메뉴를 먹어 봤어요. 매콤해서 좋았어요.\n\n## 상세\n야근 스트레스 날리는 매운 떡볶이. 치즈를 듬뿍 올렸어요.';
await put('artifact','a1',{id:'a1',campaignId:'c1',campaignVersion:1,role:'content',title:'콘텐츠',content:CONTENT,version:1,status:'review',origin:'ai',createdAt:now},'c1');
const viewIds=v=>v.compliance.issues.map(i=>i.ruleId);
const passSum=v=>v.compliance.categories.reduce((s,c)=>s+c.pass,0);
let r=await get('?artifact=a1');
const offView=r.data;
check('flag off: the artifact view has no mkt issue',r.status===200&&!viewIds(offView).some(id=>mktIds.has(id)));
const consumerRules=COMPLIANCE_LEXICON.rules.filter(x=>x.scope!=='recruitment');
check('flag off: category pass counts cover only the .15 rule set',passSum(offView)+new Set(viewIds(offView)).size===consumerRules.filter(x=>!x.pack).length);
check('the mkt switch is a known flag, off by default, and says it is not legal advice',flags.FEATURE_FLAGS.compliance_mkt_rules?.defaultEnabled===false&&/법률 자문 아님/.test(flags.FEATURE_FLAGS.compliance_mkt_rules.description)&&await flags.isEnabled(O,'compliance_mkt_rules')===false);
await flags.setFeatureFlag(O,{flag:'compliance_mkt_rules',enabled:true},{id:'admin',email:null});
r=await get('?artifact=a1');
check('flag on: the artifact view shows the mkt issues with law sources',['kr.ad.foreign_only_disclosure','kr.food.body_change'].every(id=>viewIds(r.data).includes(id))&&r.data.compliance.issues.filter(i=>mktIds.has(i.ruleId)).every(i=>i.sources.length&&i.sources.every(s=>/^https:\/\/www\.law\.go\.kr\//.test(s.url))));
check('flag on: category pass counts include the mkt rules',passSum(r.data)+new Set(viewIds(r.data)).size===consumerRules.length);
check('flag on: mkt off/on differs only by mkt issues',JSON.stringify(viewIds(r.data).filter(id=>!mktIds.has(id)))===JSON.stringify(viewIds(offView)));
check('og.compliancePacksOf reads the switch',JSON.stringify(await og.compliancePacksOf(O))==='["mkt"]'&&JSON.stringify(await og.compliancePacksOf('other-owner'))==='[]');
const graded=plain(og.gradeArtifact({id:'a1',role:'content',content:CONTENT,version:1},{facts:null,industry:null,localStore:false},null,['mkt']));
const gradedOff=plain(og.gradeArtifact({id:'a1',role:'content',content:CONTENT,version:1},{facts:null,industry:null,localStore:false},null));
check('online grading counts mkt issues only when packs are passed',graded.compliance.issues.some(i=>mktIds.has(i.ruleId))&&!gradedOff.compliance.issues.some(i=>mktIds.has(i.ruleId)));
await flags.setFeatureFlag(O,{flag:'compliance_fixes',enabled:true},{id:'admin',email:null});
r=await get('?artifact=a1');
const items=r.data.compliance.fixes.items;
check('flag on: the fixes view carries the mkt fixes computed with the pack',items.some(i=>i.ruleId==='kr.ad.foreign_only_disclosure')&&JSON.stringify(items.map(i=>i.id))===JSON.stringify(fixesOf(CONTENT,{packs:['mkt'],senderName:'가상분식'}).map(i=>i.id)));
r=await post({action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:items.filter(i=>mktIds.has(i.ruleId)).map(i=>i.id)});
check('applying a mkt fix id works because the server recomputes with the same pack',r.status===200&&r.data.version===2&&r.data.ruleIds.includes('kr.ad.foreign_only_disclosure')||assert.fail(JSON.stringify(r)));
check('no external call was made',fetchCalls===0);

console.log(JSON.stringify({passed,compared,pairs:pairs.length,normals:normals.length,falsePositives}));
