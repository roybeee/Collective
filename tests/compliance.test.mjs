// 규제·플랫폼·업종 표시 가드레일(A2) 순수 함수. 합성 위반 예시는 전부 검출하고 정상 예시 오탐은 0건이어야 한다. 법률 자문이 아니다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
async function load(path){const m=moduleFor(path);if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const {checkCompliance,downgradeVerdict,COMPLIANCE_LEXICON,COMPLIANCE_NOTICE,COMPLIANCE_CATEGORIES}=await load('lib/graders/compliance.ts');
const {qualityCriteria,qualityScopeNotice}=await load('lib/quality.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const categoriesOf=(text,opts)=>[...new Set(checkCompliance(text,opts).issues.map(i=>i.category))];

// 합성 위반 예시: [범주, 문장]. 범주마다 2건 이상.
const violations=[
 ['platform_review','영수증 리뷰 작성 시 음료 1잔을 증정합니다.'],
 ['platform_review','별점 5점 리뷰를 남겨 주시면 다음 방문 때 쓸 쿠폰을 드려요.'],
 ['platform_review','블로그 체험단 30명을 모집해 오픈 첫 주에 리뷰 100건을 확보한다.'],
 ['platform_review','영수증리뷰 작성시 김밥 증정 이벤트'],
 ['endorsement','직원들이 실제 고객인 척 후기를 작성해 올린다.'],
 ['endorsement','인플루언서에게 제품을 무상 제공하고 후기 게시를 요청한다.'],
 ['endorsement','협찬 게시물로 올리되 광고 표기는 빼 주세요.'],
 ['endorsement','가상 인플루언서 루나가 매장을 소개하는 릴스를 게시한다.'],
 ['ai_label','생성형 AI로 만든 매장 이미지를 메인 배너에 쓴다.'],
 ['ai_label','AI 음성으로 내레이션한 15초 영상을 게시한다.'],
 ['ad_message','오픈 알림 문자 초안: 가상분식 오픈! 첫 주문 고객께 김밥을 드립니다. 지금 방문하세요.'],
 ['ad_message','카카오톡 채널 메시지는 밤 10시에 발송해 퇴근 후 주문을 유도한다. (광고) 표기와 무료 수신거부 안내를 넣고 수신 동의 고객에게만 보낸다.'],
 ['ad_message','앱 푸시 문안: 오늘만 김밥 무료! 지금 주문하세요'],
 ['food_claim','매일 먹으면 면역력 강화와 다이어트 효과가 있는 떡볶이입니다.'],
 ['food_claim','혈당을 낮춰 주는 건강 김밥'],
 ['food_claim','국내산 돼지고기로 만든 순대입니다.'],
 ['food_claim','고춧가루는 100% 국산만 씁니다.'],
 ['cosmetic_claim','이 미스트가 여드름을 치료하고 피부 재생을 돕습니다.'],
 ['cosmetic_claim','아토피가 사라지는 진정 미스트'],
 ['cosmetic_claim','한 번만 뿌려도 미백·주름 개선 효과'],
 ['ecommerce_terms','지금 구매하기 버튼으로 스토어에 연결합니다. 한정 수량!'],
 ['ecommerce_terms','오늘만 30% 할인 특가, 바로 구매하세요.'],
 ['rights','아티스트 사진을 매장 포스터에 넣어 팬 방문을 유도한다.'],
 ['rights','앨범 재킷 이미지를 카드뉴스 배경으로 사용한다.'],
];
// 합성 정상 예시: [설명, 문장, 옵션]. 추천·보증 표기를 갖춘 협찬 게시물을 포함한다.
const normals=[
 ['disclosed sponsored post','[광고] 가상분식에서 제품을 제공받아 작성한 후기입니다. 떡볶이 소스가 달지 않고 매콤해 퇴근길 포장 메뉴로 괜찮았습니다. #광고 #협찬'],
 ['compliant ad message','(광고) 가상분식 오픈 안내 문자입니다. 오전 11시에 마케팅 정보 수신에 동의한 고객에게만 발송합니다. 무료 수신거부 080-000-0000'],
 ['origin confirmed in ledger','국내산 돼지고기로 만든 순대입니다.',{facts:{confirmed:[{key:'원산지',value:'돼지고기 국내산'}],prohibited:[]}}],
 ['certified functional cosmetic','식약처 기능성 화장품 심사를 받은 미백 미스트입니다. 사용 후 피부 상태는 개인마다 다릅니다.'],
 ['full sales terms','정가 12,000원, 할인가 9,000원(판매 기간 10월 1일~7일). 배송비 3,000원, 교환·환불은 수령 후 7일 이내 가능합니다. 지금 구매하기'],
 ['rights confirmed','아티스트 사진은 소속사 사용 승인과 초상권 확인 후 게시합니다.'],
 ['AI output labelled','AI로 생성한 이미지에는 "AI 생성" 표시를 붙여 게시합니다.'],
 ['review policy stated','방문 고객에게 리뷰를 강요하거나 보상을 조건으로 요청하지 않습니다.'],
 ['plain local plan','오픈 전에는 네이버 플레이스에 주소와 영업시간을 먼저 등록하고 입구 사진을 올립니다.'],
 ['negated prohibited list','허위 인기 표현, 가짜 리뷰, 위장 후기, 대량 홍보, 추천 조작을 하지 않습니다.'],
 ['virtual person disclosed','가상 인플루언서 루나(가상 인물입니다)가 메뉴를 소개합니다.'],
 ['health wording excluded','건강 효능은 확정 문구로 사용하지 않습니다.'],
 // 실데이터 재채점에서 찾은 오탐의 합성 회귀 예시: 브랜드 핵심 메시지 초안은 전송 메시지가 아니고, 확인 목록의 '원산지' 낱말은 원산지 주장이 아니다.
 ['brand key message draft','핵심 메시지 초안: 가상동에 새로 여는 분식집, 오픈 소식을 먼저 알립니다.'],
 ['origin in a confirmation list','| 승인된 실제 메뉴·가격·원산지·포장 구성 | 확정 문구 작성 전 확인 |'],
];

check('lexicon has a version and eight categories',()=>{assert.match(COMPLIANCE_LEXICON.version,/^compliance-lexicon-\d{4}-\d{2}-\d{2}\.\d+$/);assert.deepEqual([...COMPLIANCE_CATEGORIES],['platform_review','endorsement','ai_label','ad_message','food_claim','cosmetic_claim','ecommerce_terms','rights']);for(const c of COMPLIANCE_CATEGORIES)assert.ok(COMPLIANCE_LEXICON.rules.some(r=>r.category===c),c)});
check('every rule cites official source links',()=>{for(const r of COMPLIANCE_LEXICON.rules){assert.ok(r.sources.length>0,r.id);for(const s of r.sources){const src=COMPLIANCE_LEXICON.sources[s];assert.ok(src,s);assert.match(src.url,/^https:\/\/www\.law\.go\.kr\//,s)}}});
check('rules use block, warn or info severities',()=>assert.ok(COMPLIANCE_LEXICON.rules.every(r=>['block','warn','info'].includes(r.severity))));
check('notice states this is not legal advice',()=>{assert.match(COMPLIANCE_NOTICE,/법률 자문이 아닙니다/);assert.equal(checkCompliance('가상 문장').notice,COMPLIANCE_NOTICE)});
check('at least two synthetic violations per category (16+)',()=>{assert.ok(violations.length>=16);for(const c of COMPLIANCE_CATEGORIES)assert.ok(violations.filter(v=>v[0]===c).length>=2,c)});
let detected=0;
for(const [category,text] of violations)check(`detects ${category}: ${text.slice(0,16)}`,()=>{assert.ok(categoriesOf(text).includes(category),JSON.stringify(checkCompliance(text).issues));detected++});
let falsePositives=0;
for(const [name,text,opts] of normals)check(`no false positive: ${name}`,()=>{const issues=checkCompliance(text,opts).issues;falsePositives+=issues.length?1:0;assert.deepEqual([...issues],[])});
check('fake testimonials and missing ad labels are blocking',()=>{assert.ok(checkCompliance(violations[4][1]).issues.some(i=>i.severity==='block'));assert.ok(checkCompliance(violations[10][1]).issues.some(i=>i.ruleId==='ad_label_missing'&&i.severity==='block'))});
check('unconfirmed origin is a warning, not a block',()=>assert.deepEqual([...checkCompliance('국내산 돼지고기로 만든 순대입니다.').issues.map(i=>i.severity)],['warn']));
check('issues carry sources and a short excerpt',()=>{const i=checkCompliance(violations[0][1]).issues[0];assert.ok(i.sources.length&&i.excerpt.length<=60&&i.title)});
check('issues are reported once per rule',()=>{const ids=checkCompliance(violations[0][1]+' '+violations[0][1]).issues.map(i=>i.ruleId);assert.equal(new Set(ids).size,ids.length)});
// 판정은 하향만 한다: 위반이 없어도 올리지 않고, 차단은 사용자 검토 준비를 수정 필요로 내린다.
const rank={ready_for_review:0,revise:1,needs_data:2};
const block=checkCompliance(violations[4][1]).issues,warn=checkCompliance('국내산 돼지고기로 만든 순대입니다.').issues;
check('compliance never upgrades a verdict',()=>{for(const v of Object.keys(rank))for(const issues of [[],warn,block])assert.ok(rank[downgradeVerdict(v,issues)]>=rank[v],v)});
check('blocking issue downgrades ready_for_review to revise',()=>assert.equal(downgradeVerdict('ready_for_review',block),'revise'));
check('warnings alone keep the verdict',()=>assert.equal(downgradeVerdict('ready_for_review',warn),'ready_for_review'));
check('needs_data stays needs_data',()=>assert.equal(downgradeVerdict('needs_data',block),'needs_data'));
check('model quality checks keep the five criteria',()=>assert.deepEqual(Object.keys(qualityCriteria),['evidence','brand','execution','economics','measurement']));
check('quality scope notice still excludes legal review',()=>assert.match(qualityScopeNotice,/법적 검토는 포함하지 않습니다/));
check('input text is not mutated',()=>{const opts={facts:{confirmed:[],prohibited:[]}},before=JSON.stringify(opts);checkCompliance(violations[0][1],opts);assert.equal(JSON.stringify(opts),before)});
check('compliance finishes quickly on 40,000-character inputs',()=>{for(const text of ['가'.repeat(40000),('리뷰 '+'가'.repeat(28)).repeat(1200),'AI'+' 가'.repeat(20000)]){const t=Date.now();checkCompliance(text);assert.ok(Date.now()-t<1000,text.slice(0,6))}});
check('detection rate is 100% and false positive rate is 0%',()=>{assert.equal(detected,violations.length);assert.equal(falsePositives,0)});
console.log(JSON.stringify({passed:passed.length,violations:violations.length,detected,normals:normals.length,falsePositives}));
