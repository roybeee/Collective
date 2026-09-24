// 품질 기준선 v1(실측 2026-09-24, 평가 케이스 11개) 결함의 지시문 예방 회귀. 역할 지시문(buildRoleInstruction)에
// (a) 입력 JSON 필드 경로를 본문에 쓰지 않는 규칙, (b) 계약 섹션 안 #·## 제목 금지·빈 섹션 금지, (c) 관찰이 끝난 코호트 분모, (d) 광고 카피·후기·광고 표시·가격 규칙이 있고,
// 정책 문장이 입력 경로를 라벨 없이 단독으로 부르지 않는지 본다. 지시 예시·표시 문구가 채점기(lib/graders)·규제 가드레일(compliance)의 판정과 맞는지도 본다.
// 근거: 순수 함수와 합성 문자열(mocked). 외부 호출 0회.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {pureLoader} from '../scripts/eval/load-ts.mjs';

const load=pureLoader(process.cwd());
const {buildRoleInstruction,buildRoleInput}=await load('lib/role-instruction.ts'),{roles}=await load('lib/agency.ts');
const policy=await load('lib/campaign-policy.ts'),{evidenceDiscipline}=await load('lib/practice.ts');
const {GRADERS}=await load('lib/graders/index.ts'),{checkCompliance,COMPLIANCE_LEXICON}=await load('lib/graders/compliance.ts');
const {meetingInstructions,parseMeetingStep}=await load('lib/meetings.ts'),{briefInstructions}=await load('lib/brief.ts'),{SCHEMA_PATH}=await load('lib/graders/structure.ts'),{SCHEMA_PATH_LABELS}=await load('lib/output-normalize.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
// vm 컨텍스트가 만든 배열·객체는 프로토타입이 달라 deepStrictEqual 전에 평범한 값으로 바꾼다.
const plain=x=>JSON.parse(JSON.stringify(x));

// 점 표기 입력 경로(campaign.goal, evidence.facts.confirmed, brand.brandIntro …)는 '확정 사실(evidence.facts.confirmed)'처럼 한글 라벨 바로 뒤 괄호 안에서만 허용한다.
const PATH=/(?<![\w/.])[a-z][A-Za-z]*(?:\.[A-Za-z_]\w*)+/g;
function unlabeledPaths(text){
 const labelled=[...text.matchAll(/[가-힣]\(([^()]*)\)/g)].map(m=>[m.index+2,m.index+m[0].length-1]);
 return [...text.matchAll(PATH)].filter(m=>!labelled.some(([s,e])=>m.index>=s&&m.index+m[0].length<=e)).map(m=>m[0]);
}
check('the label checker catches a bare input path',()=>assert.deepEqual(unlabeledPaths('evidence.facts.confirmed만 확정 사실입니다. campaign.plan.barrier와 비교'),['evidence.facts.confirmed','campaign.plan.barrier']));
check('the label checker accepts a label-first path',()=>assert.deepEqual(unlabeledPaths('확정 사실(evidence.facts.confirmed)만 근거입니다. 거절된 사실(evidence.facts.prohibited, 관리자 거절)'),[]));

const RULES={
 a:['입력 JSON의 필드 경로','사람이 읽는 이름'],
 b:['#·## 제목을 쓰지 말고','### 이하','빈 섹션'],
 c:['관찰이 끝난 코호트','관찰 기간이 끝나지 않은 고객은 분모에 넣지'],
 d:['같은 문장에 [확인 필요]','수정 제안 문구','[실제 고객 후기 수집 후 삽입 — 확인 필요]','#광고','맨 앞에 (광고)','상품 보기','[가격 확인 필요]','[판매 조건(배송·교환·환불) 확인 필요]','AI 생성 표시'],
};
for(const {id} of roles){
 const text=buildRoleInstruction({role:id}),missing=k=>RULES[k].filter(x=>!text.includes(x));
 check(`${id} instruction forbids input field paths in prose (a)`,()=>assert.deepEqual(missing('a'),[]));
 // 근거 표시를 '입력 필드명'으로 요구하면 모델이 campaign.goal 같은 경로를 근거로 적는다(기준선 internal_id_exposure 11/11).
 check(`${id} instruction no longer asks for input field names as evidence (a)`,()=>assert.ok(!text.includes('입력 필드명')&&!text.includes('입력 필드/')));
 check(`${id} instruction names input paths only after a readable label (a)`,()=>assert.deepEqual(unlabeledPaths(text),[]));
 // 품질 담당은 계약 섹션 없이 검수 JSON만 반환하므로 섹션 제목 규칙을 받지 않는다.
 if(id==='quality')check('quality instruction has no contract-section heading rule (b)',()=>assert.deepEqual(missing('b'),RULES.b));
 else check(`${id} instruction keeps contract sections at ### and never empty (b)`,()=>assert.deepEqual(missing('b'),[]));
 check(`${id} instruction defines revisit rates on completed cohorts (c)`,()=>assert.deepEqual(missing('c'),[]));
 check(`${id} instruction carries the ad copy, testimonial, disclosure and price rules (d)`,()=>assert.deepEqual(missing('d'),[]));
}

// 정책 상수와 입력의 사실 정책(factPolicy)도 경로를 라벨 뒤에서만 부른다.
for(const name of ['factDiscipline','claimPolicy','copyCompliancePolicy','directivePolicy','measurementDiscipline'])check(`${name} names input paths only after a label`,()=>assert.deepEqual(unlabeledPaths(policy[name]),[]));
check('evidence discipline names input paths only after a label',()=>assert.deepEqual(unlabeledPaths(evidenceDiscipline),[]));
const fixture=readdirSync('tests/fixtures').find(f=>/^role-submission-[0-9a-f]{7}\.json$/.test(f)),sample=JSON.parse(readFileSync('tests/fixtures/'+fixture,'utf8')).cases[0].context;
check('role input fact policy names input paths only after a label',()=>{const {factPolicy}=JSON.parse(buildRoleInput(sample));assert.ok(factPolicy.includes('확정 사실(evidence.facts.confirmed)'));assert.deepEqual(unlabeledPaths(factPolicy),[])});

// 지시문이 경로 앞에 붙이는 이름은 정규화 라벨(화면 이름)과 같다. 모델이 지시를 따른 경우와 정규화가 고친 경우에 같은 항목이 같은 이름으로 나온다.
const LABELLED=new RegExp(`\\((${Object.keys(SCHEMA_PATH_LABELS).map(k=>k.replace(/\./g,'\\.')).sort((a,b)=>b.length-a.length).join('|')})[,)]`,'g');
const mislabelled=text=>[...text.matchAll(LABELLED)].filter(m=>!text.slice(0,m.index).endsWith(SCHEMA_PATH_LABELS[m[1]])).map(m=>text.slice(Math.max(0,m.index-12),m.index+m[0].length));
check('the label checker catches a name that differs from the normalization label',()=>assert.deepEqual(mislabelled('고객 장벽(campaign.plan.barrier)과 확정 사실(evidence.facts.confirmed)'),['고객 장벽(campaign.plan.barrier)']));
const instructionTexts=[...roles.map(({id})=>['role '+id,buildRoleInstruction({role:id})]),...roles.flatMap(({id})=>['discussion','revision','quality'].map(phase=>[`meeting ${phase} ${id}`,meetingInstructions({id:`m:${phase}:${id}`,role:id,phase,status:'running'})])),['meeting synthesis',meetingInstructions({id:'m:synthesis:cmo',role:'cmo',phase:'synthesis',status:'running'})],['brief',briefInstructions]];
for(const [name,text] of instructionTexts)check(`${name} instruction names each labelled path with its normalization label`,()=>assert.deepEqual(mislabelled(text),[]));
// 회의·브리프 지시문도 같은 공유 정책을 쓰므로 자체 문장도 경로를 라벨 뒤에서만 부른다(회의 개선본은 역할 작업물을 대체한다).
for(const {id} of roles)for(const phase of ['discussion','synthesis','revision','quality'])if(!(phase==='synthesis'&&id!=='cmo'))check(`${id} ${phase} meeting instruction names input paths only after a label`,()=>assert.deepEqual(unlabeledPaths(meetingInstructions({id:`m:${phase}:${id}`,role:id,phase,status:'running'})),[]));
check('brief instruction names input paths only after a label',()=>assert.deepEqual(unlabeledPaths(briefInstructions),[]));
// 회의 개선본은 역할 작업물로 저장된다(lib/meeting-execution.ts). 사람이 보는 회의 결과 문자열의 알려진 스키마 경로는 라벨로 바꾼다. 계약 섹션이 없어 제목은 낮추지 않는다.
const revisionText=JSON.stringify({title:'개선본',content:'## 개선 방향\ncampaign.goal 기준으로 campaign.plan.barrier를 다시 정리했습니다. 확정 사실(evidence.facts.confirmed)에 없는 가격은 [확인 필요]로 둡니다. 채널별 카피와 측정 계획을 함께 고쳤고, 실행 전 담당자가 운영 조건을 확인합니다. 첫 주는 기준값을 모으고 둘째 주부터 비교합니다.\n\n### 실행 순서\n1. 상품 상세 첫 화면에 특전 구성과 배송 예정일을 함께 둡니다. 2. 장바구니 이탈 구간을 기준 기간과 비교합니다. 3. 반증 조건은 2주 동안 이탈률이 기준 기간과 같을 때입니다. [자료 필요] 기준 기간 이탈률, 특전 재고, 확인 담당.',changes:'전략 담당 지적을 반영해 evidence.directives 기준으로 고쳤습니다.'});
check('a meeting revision saved as a role artifact carries labels, not schema paths',()=>{
 const out=parseMeetingStep(revisionText,{id:'m:revision:strategy',role:'strategy',phase:'revision',status:'running'},[]).output;
 assert.deepEqual([...(out.content+out.changes).matchAll(SCHEMA_PATH)].map(m=>m[0]),[]);
 assert.ok(out.content.startsWith('## 개선 방향\n캠페인 목표 기준으로 고객의 이용 장애물·인사이트를 다시 정리했습니다. 확정 사실에 없는 가격은'),out.content);
 assert.equal(out.changes,'전략 담당 지적을 반영해 상시 지시 기준으로 고쳤습니다.');
});

// 이 정규화 이전에 저장된 AI 작업물도 화면에서는 같은 라벨로 보인다(작업물 보기 RichText). 저장 본문은 바꾸지 않는다.
check('the artifact reading view labels schema paths of AI artifacts on display',()=>assert.match(readFileSync('app/panels.tsx','utf8'),/<RichText text=\{a\.origin==='ai'\|\|a\.origin==='ai_edited'\?labelSchemaPaths\(scrubInternalIds\(a\.content\)\)\.text:a\.content\}\/>/));

// (c) 지시의 정의 예시를 그대로 옮겨 쓰면 revisit_cohort_definition을 통과하고, 기준선의 결함 형태(코호트 기준 없음)는 fail이다.
const revisit=GRADERS.find(g=>g.id==='revisit_cohort_definition'),grade=text=>revisit.grade({kind:'role',role:'insight',contract:true,text},{}).status;
const example=/30일 재방문율 = [^.]+/.exec(policy.measurementDiscipline)?.[0];
check('the revisit definition example passes the cohort grader',()=>{assert.ok(example&&example.includes('÷'));assert.equal(grade('### 주지표\n'+example+'.'),'pass')});
check('a definition without a completed cohort still fails the grader',()=>assert.equal(grade('### 주지표\n30일 재방문율 = 30일 이내 재방문 고객 수 ÷ 첫 방문 고객 수.'),'fail'));

// (d) 지시가 요구하는 표시 문구가 규제 가드레일이 해소로 보는 문구와 같다.
const rule=id=>COMPLIANCE_LEXICON.rules.find(r=>r.id===id);
check('the disclosure marker clears the sponsorship guardrail',()=>assert.ok(policy.copyCompliancePolicy.includes('#광고')&&new RegExp(rule('sponsorship_undisclosed').cleared).test('#광고')));
check('the message marker (광고) clears the ad-message label guardrail',()=>assert.ok(new RegExp(rule('ad_label_missing').cleared).test('(광고) 신메뉴 안내')));
check('the AI label phrase clears the AI-generated guardrail',()=>assert.ok(new RegExp(rule('ai_generated_unlabeled').cleared).test('AI 생성 표시')));
check('the sales-terms marker clears the terms guardrail',()=>assert.ok(new RegExp(rule('terms_missing').cleared).test('[판매 조건(배송·교환·환불) 확인 필요]')));
// 규칙대로 쓴 합성 카피(가격 미확정): 후기는 자리표시만, 구매 유도 대신 가격 표시가 필요 없는 행동 유도, 구매 문구는 확인 계획으로.
// 차단(block) 가드레일과 광고 표시·AI 표시·가격·판매 조건 경고가 없다.
const copy=['### 인스타그램 게시 카피 A','협찬 없이 브랜드가 직접 올리는 게시물입니다. #광고','퇴근길 포장 떡볶이, 오늘 저녁은 가볍게.','[실제 고객 후기 수집 후 삽입 — 확인 필요]','배경은 AI 생성 이미지로 만들고 AI 생성 표시를 넣습니다.','CTA: 상품 보기','','### 확인 계획','- 구매 유도 문구는 가격 확정 뒤 넣습니다. [가격 확인 필요] [판매 조건(배송·교환·환불) 확인 필요]'].join('\n');
const WARNED=['sponsorship_undisclosed','ai_generated_unlabeled','price_missing','terms_missing'];
check('copy written by the rules trips no block and no disclosure, AI, price or terms guardrail',()=>{const issues=checkCompliance(copy).issues;assert.deepEqual(plain(issues.filter(i=>i.severity==='block'||WARNED.includes(i.ruleId)).map(i=>i.ruleId)),[])});
// 가격 미확정인데 구매 유도 문구를 쓰면 [가격 확인 필요]를 붙여도 price_missing warn이 남는다(의도: 게시 전 사람이 가격을 확인할 항목). 그래서 지시는 구매 유도 문구 자체를 가격 확정 뒤로 미룬다.
check('a purchase CTA with only a [가격 확인 필요] marker still warns price_missing by design',()=>assert.deepEqual(plain(checkCompliance('### 카피\n지금 주문하기: [가격 확인 필요] [판매 조건(배송·교환·환불) 확인 필요]').issues.map(i=>[i.ruleId,i.severity])),[['price_missing','warn']]));
// 후기는 예시로도 지어내지 않는다: 표시만 붙인 지어낸 후기는 사람이 옮기면서 표시가 빠질 수 있다(표시광고법상 거짓 추천·보증 위험).
check('the policy never allows a made-up testimonial, even as a labelled example',()=>assert.ok(!policy.copyCompliancePolicy.includes('[예시')&&policy.copyCompliancePolicy.includes('후기 문장을 만들지 말고')));
// 모델이 규칙 문장을 산출물에 되풀이해도(예: 금지 사항 목록) 차단 가드레일과 가격·판매 조건 경고에 걸리지 않는다.
check('restating the copy compliance policy trips no block, price or terms guardrail',()=>assert.deepEqual(plain(checkCompliance(policy.copyCompliancePolicy).issues.filter(i=>i.severity==='block'||WARNED.includes(i.ruleId)).map(i=>i.ruleId)),[]));
check('restating the claim policy trips no block guardrail',()=>assert.deepEqual(plain(checkCompliance(policy.claimPolicy).issues.filter(i=>i.severity==='block').map(i=>i.ruleId)),[]));
console.log(JSON.stringify({passed:passed.length}));
