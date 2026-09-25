// 트랙 R R2 가맹 모집 규제 가드레일: 규제 사전 범주 franchise_recruit, 해제 불가 목록(결정 25), 휴리스틱 표현·근거 조건, 캡션·발행 게이트의 직접 판정(원장 해소·[확인 필요] 면제·인용 강등 없음),
// 소비자 범위와 모집 범위 분리(소비자 판촉 합성 20건 오탐 0, 소비자 캡션은 가맹 모집 문구가 있을 때만 차단 15d), 모집 범위 안전망 경고(15d), 값 대조(매장 수·창업비용), 교체된 정보공개서 버전 값 차단, ruleAt 날짜 주입, 대표 승인으로도 풀리지 않는 409, 모집 유사 경고, 비가맹 불변, 모델 제출 바이트 동일.
// 근거: mocked(메모리 SQLite, 이메일 모드 세션 주입, 모의 R2, 외부 fetch는 던지는 스텁, 모의 HERMES). 값·문장은 모두 합성이다. 판정은 COLLECTIVE 휴리스틱 · 법률 자문 아님(결정 20 보류).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {franchiseFixture,captureConsole,DISCLAIMER,sha64} from './helpers/franchise-fixture.mjs';
import {testRuntime} from './helpers/runtime.mjs';
import {seed,mockHermes,runRole,runMeeting,roleCampaign,meetingCampaign,brand as seedBrand,now as seedNow} from './helpers/prompt-seed.mjs';

captureConsole();
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const plain=x=>JSON.parse(JSON.stringify(x));

// ── 합성 PNG(1080×1080) ──
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
const pngOf=fill=>{const pixels=Buffer.alloc((1080*3+1)*1080,fill);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64')};
const PNG=pngOf(0);

const f=await franchiseFixture();
const {sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const objects=new Map();env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
// 서버 시각을 2026-09-26 12:00 KST로 고정한다.
const NOW_MS=Date.parse('2026-09-26T03:00:00Z');f.clock.set(NOW_MS-Date.now());
const NOW='2026-09-26T12:00:00+09:00';
const jc=await f.load('lib/franchise-compliance.ts'),rules=await f.load('lib/franchise-rules.ts'),comp=await f.load('lib/graders/compliance.ts'),catalog=await f.load('lib/fact-catalog.ts');
const gates=await f.load('lib/franchise-gates.ts'),exec=await f.load('lib/execution.ts'),ffacts=await f.load('lib/franchise-facts.ts');
const MSG=plain(ffacts.FRANCHISE_FACT_MESSAGES);

// ════ 1) 판정원 매핑과 상수(순수) ════
const scoped=rules.FRANCHISE_RULES.filter(r=>r.scope);
const lexIds=new Set(comp.COMPLIANCE_LEXICON.rules.filter(r=>r.category==='franchise_recruit').map(r=>r.id));
const sourcesOf=r=>[lexIds.has(r.family??r.id)&&r.basis==='official'?'lexicon':null,rules.FRANCHISE_CLAIM_MATCHERS[r.id]?'matcher':null,rules.FRANCHISE_CLAIM_LOGIC.includes(r.id)?'logic':null].filter(Boolean);
check('1: the 29 scoped registry ids each map to exactly one judge source',scoped.length===29&&scoped.every(r=>sourcesOf(r).length===1&&jc.claimSourceOf(r)?.kind===sourcesOf(r)[0]));
check('1: every lexicon franchise rule and every heuristic matcher is a scoped registry rule',[...lexIds].every(id=>scoped.some(r=>(r.family??r.id)===id))&&Object.keys(rules.FRANCHISE_CLAIM_MATCHERS).every(id=>scoped.some(r=>r.id===id&&r.basis==='heuristic')));
check('2: the unremovable list is the 8 scoped hard_block registry ids and none of them has evidence except the insurance condition',same([...rules.FRANCHISE_HARD_BLOCK_IDS].sort(),scoped.filter(r=>r.tier==='hard_block').map(r=>r.id).sort())&&rules.FRANCHISE_HARD_BLOCK_IDS.length===8&&Object.keys(rules.FRANCHISE_CLAIM_EVIDENCE).every(id=>!rules.FRANCHISE_HARD_BLOCK_IDS.includes(id)||id==='kr.fr.insurance_mark'));
const evidenceKeys=Object.values(rules.FRANCHISE_CLAIM_EVIDENCE).flatMap(e=>e.factKeys??(e.factKey?[e.factKey]:[]));
check('3: every evidence fact key is a franchise catalog item',evidenceKeys.length>0&&evidenceKeys.every(k=>catalog.franchiseFactKey(k)===k&&catalog.factCatalogItem(k)?.franchise===true));
const kindNames=new Set(['매장 수','창업비용','가맹비','교육비','가맹 보증금','인테리어 비용','로열티']);
check('3: value evidence names only the franchise value kinds',Object.values(rules.FRANCHISE_CLAIM_EVIDENCE).filter(e=>e.kind==='values').every(e=>e.valueKinds.every(k=>kindNames.has(k))));

// ── 판정 입력 보조 ──
const AT='2026-10-15T01:00:00.000Z';
const V=(id,over={})=>({id,brandId:'b',label:'가상 정보공개서 '+id,registeredAt:'2026-03-15T10:00:00+09:00',validFrom:'2026-03-15T00:00:00+09:00',validUntil:'2027-07-01T00:00:00+09:00',status:'active',...over});
const V1=V('v1');
const fact=(key,value,over={})=>({id:'f-'+key+'-'+value.length,brandId:'b',key,value,status:'confirmed',source:'가상 근거',verifiedAt:'2026-09-20T00:00:00.000Z',validUntil:'2027-04-01T00:00:00.000Z',version:1,updatedAt:'2026-09-20T00:00:00.000Z',...over});
const ref=(over={})=>({disclosureVersionId:'v1',fiscalYear:2025,page:3,...over});
const count=(n,over={})=>fact('franchise_store_count',n+'개',{sourceRef:ref({asOf:'2025-12-31'}),...over});
const judge=(text,{scope='recruitment',facts=[],versions=[V1],at=AT,now=NOW}={})=>jc.judgeFranchiseText({text,at,now,scope,brandId:'b',facts,versions});
const ids=j=>j.issues.map(i=>i.ruleId);
// 소비자 범위는 캡션에 가맹 모집 문구가 있을 때만 가맹 규칙이 막는다(결정 25 기본값을 소비자 캠페인에 맞게 좁힘, R2 3차 재검토). 소비자 범위 차단 검사는 모집 문구 줄을 붙인 캡션으로 본다.
const RC='\n가맹 문의 환영';

// ════ 4) 규칙마다 합성 위반 2건 이상(모집 범위, 사실 없음) ════
const VIOLATIONS={
 'kr.fr.revenue_guarantee':['월 순수익 500만원 보장','최저 수익을 약속드립니다'],
 'kr.fr.insurance_mark':['가맹금 100% 안전하게 지켜드립니다','피해보상보험 가입 브랜드'],
 'kr.fr.association_condition':['가맹점주 단체 미가입을 조건으로 계약합니다','점주 협의회에 가입하면 계약이 불가합니다'],
 'kr.fr.store_count_claims':['전국 20개 매장 운영 중','100호점 돌파 기념'],
 'kr.fr.startup_cost_claims':['창업비용 5,000만원이면 시작','가맹비 870만원, 교육비 550만원'],
 'kr.fr.ip_claims':['특허받은 반죽 기술','상표 등록 완료 브랜드'],
 'kr.fr.conditional_support':['인테리어 전액 지원','정부 창업 지원 연계'],
 'kr.fr.superlative_claims':['업계 최저 창업비용','국내 1위 도넛 브랜드'],
 'kr.fr.trade_area_claims':['유동인구 하루 3만 명 상권','경쟁 점포 없는 입지'],
 'kr.fr.production_claims':['자체 공장에서 생산합니다','본사 직접 생산 원재료'],
 'kr.fr.exclusive_channel_claims':['가맹점에서만 파는 도넛','가맹점 전용 원두'],
 'kr.fr.territory_claims':['독점 상권 보장','영업지역 보호 3km'],
 'kr.ad.endorsement_disclosure':['가맹 점주 후기: 첫 달부터 만족','점주 인터뷰 영상 공개'],
 'kr.ad.virtual_human_label':['AI 점주가 소개하는 창업 이야기','가상 모델이 추천하는 브랜드'],
 'h.revenue_figures_no_ad':['월 평균 매출 4,200만원','직영점 매출 1억 돌파'],
 'h.net_profit_payback_claims':['월 순수익 600만원','18개월이면 투자금 회수'],
 'h.wait_bypass_solicitation':['가계약금 100만원으로 상권 선점','계약 당일 바로 오픈 준비'],
 'h.captive_advisor_phrase':['본사 전속 가맹거래사로 7일 계약','변호사 자문으로 7일 만에 계약'],
 'h.zero_cost_claims':['로열티 0원','가맹비 면제 이벤트'],
 'h.direct_store_popularity':['직영점 오픈런 행렬','하루 1,000개 완판'],
 'h.handmade_claims':['100% 수제 도넛','손으로 빚은 반죽'],
 'h.exclusive_supply_claims':['본사 독점 공급 원료','독점 공급 소스'],
 'h.collab_rights_claims':['가상 캐릭터 콜라보 에디션','협업 메뉴 출시'],
 'h.own_ip_claims':['자체 캐릭터 IP 보유','자사 캐릭터 굿즈'],
 'h.heritage_claims':['30년 전통의 맛','since 1998'],
 'h.direct_to_franchise_inference':['직영점의 성과를 가맹점에서도 기대할 수 있습니다','본점 줄서기, 점주님 매장도 같은 인기'],
};
check('4: every pattern rule id has at least two synthetic violations',same(Object.keys(VIOLATIONS).sort(),[...lexIds,...Object.keys(rules.FRANCHISE_CLAIM_MATCHERS)].sort())&&Object.values(VIOLATIONS).every(v=>v.length>=2));
let detected=0;
for(const [id,list] of Object.entries(VIOLATIONS))for(const text of list)check(`4: ${id} detects “${text}”`,ids(judge(text)).includes(id)&&++detected>0);
const tierOf=id=>judge(VIOLATIONS[id][0]).issues.find(i=>i.ruleId===id)?.tier;
check('4: hard_block ids judge as hard_block, evidence rules as block, warn rules as warn',['kr.fr.revenue_guarantee','kr.fr.insurance_mark','kr.fr.association_condition','h.revenue_figures_no_ad','h.net_profit_payback_claims','h.wait_bypass_solicitation','h.captive_advisor_phrase'].every(id=>tierOf(id)==='hard_block')&&['kr.fr.store_count_claims','kr.fr.ip_claims','h.zero_cost_claims','h.handmade_claims'].every(id=>tierOf(id)==='block')&&['kr.ad.endorsement_disclosure','h.direct_to_franchise_inference'].every(id=>tierOf(id)==='warn'));
// H8·H9 각 2건
const h8=judge('전국 20개 매장 운영 중'),h8b=judge('가맹비 870만원이면 시작합니다');
check('4: H8 warns when a store count or cost claim has neither a [사실] label nor a disclosure footnote',ids(h8).includes('h.fact_opinion_labels')&&ids(h8b).includes('h.fact_opinion_labels')&&h8.issues.find(i=>i.ruleId==='h.fact_opinion_labels').tier==='warn');
check('4: H8 is satisfied by a [사실] label or a disclosure footnote',!ids(judge('[사실: 가맹점 수·2025-12-31 기준] 전국 20개 매장 운영 중')).includes('h.fact_opinion_labels')&&!ids(judge('전국 20개 매장 운영 중\n※ 정보공개서 등록 버전 가상본(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-25')).includes('h.fact_opinion_labels'));
const h9a=judge('독점 상권 3km 보장\n가맹 상담은 평일에 합니다',{scope:'consumer'}),h9b=judge('영업지역 보호 3km 약속\n안내',{scope:'recruitment'});
check('4: H9 escalates a first-line numeric warn claim to block (2 cases)',[h9a,h9b].every(j=>j.issues.some(i=>i.ruleId==='kr.fr.territory_claims'&&i.tier==='block'&&i.escalatedBy==='h.headline_claim_block')&&j.blocked));

// ════ 5) 가맹 문맥 정상 문장 오탐 0(모집 범위, 사실 없음) ════
const NORMALS=['수익을 보장하지 않습니다','수익 보장은 없습니다','가계약금은 받지 않습니다','로열티 면제는 없습니다','본사 전속 가맹거래사를 두지 않습니다','매출은 점포마다 다릅니다','매출의 10%를 기부합니다','일회용컵 보증금 300원','가맹 상담은 평일 10시부터입니다','정보공개서를 먼저 드립니다','매장 수는 정보공개서에서 확인하세요',
 '가맹 계약 전 정보공개서와 계약서안을 먼저 드립니다','계약은 정보공개서를 받은 뒤 14일이 지나야 합니다','가맹 문의는 대표 번호로 받습니다','상담 신청서를 남겨 주시면 연락드립니다','설명회 일정은 추후 안내합니다','가맹점사업자단체 가입 여부는 계약 조건이 아닙니다','점포 개설 절차를 단계별로 안내합니다','예비 창업자분들의 질문에 답합니다','상표 사용 허락 관계를 계약서에 적습니다'];
const normalHits=NORMALS.filter(t=>judge(t).issues.length);
check('5: 20+ normal franchise-context sentences raise no issue',NORMALS.length>=20&&normalHits.length===0);

// ════ 6) 근거 사실이 있으면 통과(BUE 규칙마다 1건) ════
const ok=(text,facts)=>judge(text,{facts}).issues.filter(i=>i.tier!=='warn').length===0;
const cur=(key,value,extra={})=>fact(key,value,catalog.franchiseItem(key)?.disclosure?{sourceRef:ref(extra.asOf?{asOf:extra.asOf}:{}),...extra}:extra);
check('6: production claim passes with a production_method fact',ok('매일 직접 굽는 수제 도넛',[cur('production_method','매장에서 직접 생산(수제)')]));
check('6: direct-store popularity passes with a performance fact and the 직영점 실적 marker',ok('오늘도 완판 · 직영점 실적: 가상점 2026-09 판매 기록',[cur('direct_store_performance','가상점 2026-09 판매 기록')])&&!ok('오늘도 완판',[cur('direct_store_performance','가상점 2026-09 판매 기록')]));
check('6: store count passes with the matching confirmed count',ok('전국 12개 매장 운영 중',[count(12)]));
check('6: startup cost passes with the matching value and details line',ok('총 창업비용 · 테이크아웃형: 5,000만원\n포함: 가맹비, 교육비 · 불포함: 임차보증금 · 전용면적 33㎡',[cur('startup_cost_total','5,000만원',{cost:{storeType:'테이크아웃형',includes:['가맹비','교육비'],excludes:['임차보증금'],areaM2:33}})]));
check('6: a percentage royalty card passes on its own fact value',ok('로열티: 매출의 3%',[cur('royalty_fee','매출의 3%')]));
check('6: ip claim passes with a registration fact',ok('특허받은 반죽 기술',[cur('ip_registration','가상 특허 등록번호 A1')]));
check('6: superlative passes when the basis fact is on the same screen',ok('국내 1위 도넛 브랜드(가상 조사 2026)',[cur('claim_basis','가상 조사 2026')]));
check('6: trade area passes when the source fact is on the same screen',ok('유동인구 하루 3만 명(가상 상권 자료)',[cur('trade_area_source','가상 상권 자료')]));
check('6: conditional support passes when the condition is stated',ok('인테리어 전액 지원(조건: 계약 기간 5년, 선착순 3곳)',[]));
check('6: exclusive channel passes with a sales-channel fact of none',ok('가맹점에서만 파는 도넛',[cur('sales_channels','없음')])&&!ok('가맹점에서만 파는 도넛',[cur('sales_channels','편의점 납품')]));
check('6: insurance mark passes only with an insurance, guarantee or mutual-aid contract fact',ok('피해보상보험 가입 브랜드',[cur('escrow_insurance','피해보상보험 계약 체결')])&&!ok('피해보상보험 가입 브랜드',[cur('escrow_insurance','가맹금 예치')]));
check('6: zero-cost claim passes only with both supply pricing and margin facts on screen',ok('로열티 0원 · 공급가 원가+10% · 차액가맹금 있음',[cur('required_items_pricing','공급가 원가+10%'),cur('margin_fee','차액가맹금 있음'),cur('royalty_fee','0원')])&&!ok('로열티 0원 · 공급가 원가+10%',[cur('required_items_pricing','공급가 원가+10%'),cur('margin_fee','차액가맹금 있음'),cur('royalty_fee','0원')]));
check('6: handmade, supply, collab, own IP, heritage and territory pass with their facts',ok('100% 수제 도넛',[cur('production_method','매장 수제')])&&ok('본사 독점 공급 원료 · 공급가 원가+10% · 차액가맹금 있음',[cur('required_items_pricing','공급가 원가+10%'),cur('margin_fee','차액가맹금 있음')])&&ok('가상 캐릭터 콜라보 에디션(가상 권리자 서면 동의 2026-09)',[cur('collab_consent','가상 권리자 서면 동의 2026-09')])&&ok('자체 캐릭터 IP 보유',[cur('own_ip_rights','가상 가맹본부 저작권')])&&ok('30년 전통의 맛(1996 개업 가상 증빙)',[cur('heritage_basis','1996 개업 가상 증빙')])&&judge('독점 상권 보장',{facts:[cur('territory_clause','반경 500m')]}).issues.every(i=>i.ruleId!=='kr.fr.territory_claims'));
check('6: production evidence refuses an OEM fact and does not accept cooking_method',!ok('자체 공장에서 생산합니다',[cur('production_method','OEM 위탁 생산')])&&!ok('자체 공장에서 생산합니다',[fact('cooking_method','자체 조리')]));

// ════ 7·8) 소비자 판촉 합성 20건 ════
const CONSUMER=['매일 직접 굽는 수제 도넛','오늘도 완판, 내일 다시 만나요','대기 없이 바로 픽업하세요','가을 신메뉴 밤 크림 도넛 출시','이번 주만 한정 판매하는 무화과 타르트','매장 안내: 가상점은 오전 10시에 문을 엽니다','2호점 오픈 기념 아메리카노 증정','주말 웨이팅이 길어요, 미리 주문해 주세요','반죽부터 토핑까지 손으로 빚었어요','인기 메뉴 글레이즈드 도넛 재입고','포장 주문 시 박스 무료','생일 케이크 예약은 3일 전까지','비 오는 날엔 따뜻한 라떼와 함께','가상점 매장 한정 딸기 도넛','품절 전에 서두르세요','오늘 구운 빵만 판매합니다','6개 세트 12,000원, 포장 가능','앱 주문 시 대기 없이 바로 받기','할로윈 한정 호박 도넛 출시','매장에서 직접 만든 크림을 채웠어요'];
const consumerFacts=[count(12)];
const consumerHits=CONSUMER.flatMap(t=>judge(t,{scope:'consumer',facts:consumerFacts}).issues.map(i=>t+' → '+i.ruleId));
check('7: 20 consumer donut promo sentences raise 0 issues in a franchise brand consumer campaign',CONSUMER.length===20&&same(consumerHits,[]));
check('7: the 20 sentences as one caption also raise 0 issues',judge(CONSUMER.join('\n'),{scope:'consumer',facts:consumerFacts}).issues.length===0);
const RECRUIT_BLOCK=[0,1,7,8,14,19].map(i=>CONSUMER[i]);
check('8: the production and sold-out sentences (1·2·8·9·15·20) are blocked in recruitment scope without supporting facts',RECRUIT_BLOCK.every(t=>{const j=judge(t,{scope:'recruitment'});return j.blocked&&j.issues.every(i=>i.registryScope==='objective_export')}));
// 8a) 초안 정규식에서 실제로 걸렸던 소비자 문장
const EXTRA=['수입 버터로 만든 풍미, 맛은 보장합니다','하루 매출의 10%를 기부합니다','판매 수익금 전액 기부를 보장합니다','전국 가맹점에서 바로 사용 가능한 쿠폰','가맹점 당일 픽업 가능','케이크 예약금 미리 받습니다','로열티 카드 5개 모으면 도넛 1개','베이킹 클래스 교육비 35,000원','멤버십 가입비 무료','포장 용기 보증금 없음','정부 지원 소비쿠폰 사용 가능','그랜드 오픈 지원 이벤트','세트 No.10 출시','한정 12개, 대기 없음'];
check('8a: 14 consumer sentences that tripped the draft patterns raise 0 issues in consumer scope',same(EXTRA.flatMap(t=>judge(t,{scope:'consumer',facts:consumerFacts}).issues.map(i=>t+' → '+i.ruleId)),[]));
check('8a: none of them is a hard_block even in recruitment scope',EXTRA.every(t=>!judge(t,{scope:'recruitment',facts:consumerFacts}).hardBlocked));
check('8b: unremovable revenue patterns need a money or rate figure (rankings and imported goods are not revenue figures)',['매일 매출 1위 메뉴 글레이즈드 도넛','9월 수입 원두 2종 입고','이달 수입 버터 3종으로 구웠어요'].every(t=>!judge(t+RC,{scope:'consumer'}).hardBlocked)&&['일 매출 300만원','매월 순수익 20%','가맹점 매출 2배'].every(t=>judge(t+RC,{scope:'consumer'}).hardBlocked));
check('8a: 한정 12개, 대기 없음 is not a mention of the store count 12 (no footnote needed)',jc.mentionedFranchiseFacts({text:'한정 12개, 대기 없음',now:NOW,brandId:'b',facts:consumerFacts,versions:[V1]}).length===0&&jc.mentionedFranchiseFacts({text:'전국 12개 매장에서 만나요',now:NOW,brandId:'b',facts:consumerFacts,versions:[V1]}).length===1);

// ════ 9·10·11) 값 대조 ════
const reasonOf=(j,id)=>j.issues.find(i=>i.ruleId===id)?.reason;
const SC='kr.fr.store_count_claims',SU='kr.fr.startup_cost_claims';
check('9: confirmed store count 12 with reference date blocks 전국 20개 매장 (value_mismatch)',reasonOf(judge('전국 20개 매장'+RC,{scope:'consumer',facts:[count(12)]}),SC)==='value_mismatch'&&judge('전국 20개 매장'+RC,{scope:'consumer',facts:[count(12)]}).blocked);
check('9: 전국 12개 매장 passes',!judge('전국 12개 매장',{scope:'consumer',facts:[count(12)]}).blocked&&!ids(judge('전국 12개 매장',{scope:'consumer',facts:[count(12)]})).includes(SC));
check('9: an old count fact without a reference date (or source) is no evidence',reasonOf(judge('전국 12개 매장',{facts:[count(12,{sourceRef:ref()})]}),SC)==='no_evidence'&&reasonOf(judge('전국 12개 매장',{facts:[fact('가맹점 수','12개')]}),SC)==='no_evidence');
const direct3=fact('direct_store_count','3개',{sourceRef:ref({asOf:'2025-12-31'})});
check('9: adding direct stores 3 lets 전국 15개 매장 pass (franchise + direct)',!ids(judge('전국 15개 매장',{facts:[count(12),direct3]})).includes(SC)&&reasonOf(judge('전국 15개 매장',{facts:[count(12)]}),SC)==='value_mismatch');
check('9: 오픈 예정 5개 is always no evidence',reasonOf(judge('오픈 예정 5개',{facts:[count(12),direct3]}),SC)==='no_evidence');
const V2=V('v2',{registeredAt:'2026-09-20T10:00:00+09:00',validFrom:'2026-09-01T00:00:00+09:00',validUntil:'2027-10-01T00:00:00+09:00'});
const old10=count(10);
check('10: once v2 is current the v1-sourced count 10 leaves the ledger and 전국 10개 매장 is blocked',!ids(judge('전국 10개 매장',{facts:[old10],versions:[V1]})).includes(SC)&&reasonOf(judge('전국 10개 매장',{facts:[old10],versions:[V1,V2]}),SC)==='no_evidence'&&judge('전국 10개 매장',{facts:[old10],versions:[V1,V2]}).blocked);
check('10: a v2-sourced count passes after the switch',!ids(judge('전국 12개 매장',{facts:[count(12,{sourceRef:ref({disclosureVersionId:'v2',asOf:'2026-06-30'})})],versions:[V1,V2]})).includes(SC));
const startup=cur('startup_cost_total','5,000만원',{cost:{storeType:'테이크아웃형',includes:['가맹비','교육비'],excludes:['임차보증금'],areaM2:33}});
const DETAIL='포함: 가맹비, 교육비 · 불포함: 임차보증금 · 전용면적 33㎡';
check('11: startup cost passes with the matching value, its store type and its details line',!ids(judge('테이크아웃형 창업비용 5,000만원\n'+DETAIL,{facts:[startup]})).includes(SU));
check('11: the same value and details without the store type is details_missing',reasonOf(judge('창업비용 5,000만원\n'+DETAIL,{facts:[startup]}),SU)==='details_missing');
check('11: the same value without the details line is details_missing',reasonOf(judge('창업비용 5,000만원이면 시작',{facts:[startup]}),SU)==='details_missing');
check('11: a different value is value_mismatch',reasonOf(judge('창업비용 4,000만원이면 시작\n'+DETAIL,{facts:[startup]}),SU)==='value_mismatch');
check('11: a fee claim with a matching fee fact passes, a different amount is value_mismatch',!ids(judge('가맹비 870만원',{facts:[cur('franchise_fee','870만원')]})).includes(SU)&&reasonOf(judge('가맹비 990만원',{facts:[cur('franchise_fee','870만원')]}),SU)==='value_mismatch');

// ════ 12) 부정문·[확인 필요]·인용 ════
check('12: negations are not flagged (4 cases)',['수익을 보장하지 않습니다','수익 보장은 없습니다','가계약금은 받지 않습니다','본사 전속 가맹거래사를 두지 않습니다'].every(t=>judge(t).issues.length===0));
const marked=judge('[확인 필요] 월 순수익 500만원 보장'+RC,{scope:'consumer'}),quoted=judge('“월 순수익 500만원 보장” 같은 경쟁 사례'+RC,{scope:'consumer'});
check('12: a [확인 필요] mark and a quoted competitor case stay hard_block (no exemption or downgrade)',marked.hardBlocked&&quoted.hardBlocked&&ids(marked).includes('kr.fr.revenue_guarantee')&&ids(quoted).includes('kr.fr.revenue_guarantee'));
check('12: the same quoted sentence is info on the A2 opt-in path (different from the gate)',comp.checkCompliance('“월 순수익 500만원 보장” 같은 경쟁 사례',{franchise:{scope:'consumer'}}).issues.filter(i=>i.category==='franchise_recruit').every(i=>i.severity==='info'));
check('12: the gate does not use ledger resolution (a confirmed store count key without a matching value still blocks)',reasonOf(judge('전국 20개 매장',{facts:[count(12)]}),SC)==='value_mismatch'&&!comp.checkCompliance('전국 20개 매장',{franchise:{scope:'consumer'},facts:{confirmed:[{key:'franchise_store_count',value:'12개'}],prohibited:[]}}).issues.some(i=>i.ruleId===SC));

// ════ 13) ruleAt 날짜 주입 ════
const assoc=at=>judge('점주 협의회에 가입하면 계약이 불가합니다',{at}).issues.find(i=>i.ruleId==='kr.fr.association_condition');
check('13: 2026-12-30 picks the ⑤ rule and 2026-12-31 the ⑥ rule',assoc('2026-12-30T12:00:00+09:00')?.registryId==='kr.fr.association_condition'&&assoc('2026-12-31T00:00:00+09:00')?.registryId==='kr.fr.association_condition_2026'&&assoc('2026-12-30T15:00:00Z')?.registryId==='kr.fr.association_condition_2026');
check('13: the family keeps hard_block on both sides of the boundary',assoc('2026-12-30T12:00:00+09:00').tier==='hard_block'&&assoc('2026-12-31T00:00:00+09:00').tier==='hard_block');
check('13: virtual human label applies from 2026-06-01, endorsement from 2024-12-01',!ids(judge('AI 점주가 소개합니다',{at:'2026-05-31T12:00:00+09:00'})).includes('kr.ad.virtual_human_label')&&ids(judge('AI 점주가 소개합니다',{at:'2026-06-01T00:00:00+09:00'})).includes('kr.ad.virtual_human_label')&&!ids(judge('점주 인터뷰 영상 공개',{at:'2024-11-30T12:00:00+09:00'})).includes('kr.ad.endorsement_disclosure')&&ids(judge('점주 인터뷰 영상 공개',{at:'2024-12-01T00:00:00+09:00'})).includes('kr.ad.endorsement_disclosure'));

// ════ 14) H9 ════
const first=judge('독점 상권 3km 보장\n가맹 상담 안내',{scope:'consumer'}),second=judge('가맹 상담 안내\n독점 상권 3km 보장',{scope:'consumer'});
check('14: first line numeric territory claim is block with escalatedBy, second line stays warn',first.issues.find(i=>i.ruleId==='kr.fr.territory_claims')?.escalatedBy==='h.headline_claim_block'&&second.issues.find(i=>i.ruleId==='kr.fr.territory_claims')?.tier==='warn'&&!second.blocked);
check('14: a first-line warn claim without a number stays warn',judge('독점 상권 보장 안내',{scope:'consumer',facts:[cur('trade_area_source','독점 상권 보장 안내')]}).issues.every(i=>i.tier!=='block'||i.ruleId!=='kr.fr.territory_claims'));

// ════ 15) 결과 모양 ════
const all=judge(Object.values(VIOLATIONS).flat().join('\n'));
check('15: every issue carries basis, the registry article verbatim and a basis label',all.issues.length>=26&&all.issues.every(i=>{const r=rules.FRANCHISE_RULES.find(x=>x.id===i.registryId);return r&&i.basis===(i.extended?'heuristic':r.basis)&&i.article===r.article&&i.registryScope===r.scope&&same(i.sources,r.sourceUrls)}));
check('15: heuristic results carry the disclaimer, official results say 공식 규정',all.issues.every(i=>i.extended?i.basisLabel.endsWith(DISCLAIMER):i.basis==='heuristic'?i.basisLabel===DISCLAIMER:i.basisLabel.startsWith('공식 규정 · '+i.article)));
const consumerOfficial=judge('월 순수익 500만원 보장',{scope:'consumer'}).issues.find(i=>i.ruleId==='kr.fr.revenue_guarantee'),recruitOfficial=judge('월 순수익 500만원 보장').issues.find(i=>i.ruleId==='kr.fr.revenue_guarantee');
check('15: franchise-law-only official rules in consumer scope add the heuristic scope note',consumerOfficial.basisLabel.endsWith('소비자 캠페인 적용은 '+DISCLAIMER)&&!recruitOfficial.basisLabel.includes('소비자 캠페인')&&!judge('전국 20개 매장',{scope:'consumer'}).issues.find(i=>i.ruleId===SC).basisLabel.includes('소비자 캠페인'));
check('15: notice is the compliance notice and disclaimer the gate disclaimer',all.notice===comp.COMPLIANCE_NOTICE&&all.disclaimer===gates.GATE_DISCLAIMER&&all.disclaimer===DISCLAIMER&&all.version===rules.FRANCHISE_CLAIMS_VERSION+'+'+comp.COMPLIANCE_LEXICON.version);
check('15: issues sort hard_block, block, warn then rule id, one per rule, excerpt at most 60 chars',all.issues.every((x,k,a)=>k===0||['hard_block','block','warn'].indexOf(a[k-1].tier)<['hard_block','block','warn'].indexOf(x.tier)||(a[k-1].tier===x.tier&&a[k-1].ruleId<x.ruleId))&&new Set(ids(all)).size===all.issues.length&&all.issues.every(i=>i.excerpt.length<=60));
const input={text:'전국 20개 매장',at:AT,now:NOW,scope:'consumer',brandId:'b',facts:[count(12)],versions:[V1]},before=JSON.stringify(input);jc.judgeFranchiseText(input);
check('15: the judge does not mutate its input',JSON.stringify(input)===before);
check('15: 40,000-character inputs finish within one second',['가'.repeat(40000),('수제 '+'가'.repeat(28)).repeat(1300),('월 순수익 '+'나'.repeat(20)+' ').repeat(1500),'전국 1개 매장 '.repeat(4000)].every(t=>{const s=Date.now();judge(t,{facts:[count(12)]});return Date.now()-s<1000}));
const gateMsg=jc.franchiseGateError(judge('월 순수익 500만원 보장'+RC,{scope:'consumer'}));
check('15: a hard_block gate error is a 409 that says approval cannot release it',gateMsg.status===409&&gateMsg.message.includes('승인으로 풀 수 없음')&&gateMsg.message.includes('월 순수익 500만원 보장')&&gateMsg.message.includes(DISCLAIMER));
check('15: a block-only gate error asks for evidence and a clean text has no error',jc.franchiseGateError(judge('전국 20개 매장'+RC,{scope:'consumer',facts:[count(12)]})).message.includes('근거 사실')&&jc.franchiseGateError(judge('가을 신메뉴 출시',{scope:'consumer'}))===null);
const FORBIDDEN=/법적으로 적합|준수 완료|합법/;
check('15: judge texts make no legal-adequacy claim',!FORBIDDEN.test(readFileSync('lib/franchise-compliance.ts','utf8'))&&!FORBIDDEN.test(JSON.stringify(all))&&!FORBIDDEN.test(jc.recruitmentWarning('B')));

// ════ 15b) 검토 반영(합성): 붙은 부정만 부정, 다른 절의 면제·부정 없음, 전각 숫자, 소비자 오탐, 값 대조 세분화, 확장 라벨, H9 창 ════
const SC_ID='kr.fr.store_count_claims',hardC=t=>judge(t+RC,{scope:'consumer'}).hardBlocked;
// 뒤 절의 비용 주석·면책·권유·다른 금지 문구는 해제 불가 표현을 부정하거나 면제하지 않는다.
const HARD_SUFFIXED=['월 순수익 500만원 보장, 인건비 제외','이벤트: 월 순수익 500만원 보장, 인건비 제외','최저 수익 보장, 임대료 무관','월 매출 4,200만원, 임대료 제외','월 순수익 500만원 보장, 걱정하지 마세요','18개월이면 투자금 회수, 의심하지 마세요','가계약금 100만원이면 바로 계약, 서두르지 않으면 늦어요','월 평균 매출 4,200만원 대신 순수익으로 보세요','가맹금 100% 안전, 걱정하지 마세요','본사 전속 가맹거래사로 7일 계약, 기다리지 마세요','가계약금 100만원, 환불 불가','월 순수익 500만원 보장 · 중복 신청 불가','월 평균 매출 4,200만원 매장, 매출 1% 기부','가맹금 100% 안전 보장 - 무단 복제 금지','가계약금 100만원으로 상권 선점 + 유튜브 구독 이벤트','월 평균 매출 4,200만원, 외부 유출 금지','매출 보장 대신 확실한 수익','본사 전속 가맹거래사로 7일 계약, 연락 없이 방문 불가','이벤트(월 순수익 500만원 보장, 인건비 제외)','점주 모임 가입 시 계약 불가(탈퇴는 자유)'];
check(`15b: ${HARD_SUFFIXED.length} hard_block claims with a trailing note, disclaimer or unrelated clause stay hard_block`,HARD_SUFFIXED.every(hardC));
// H6 수치 규칙은 부정 면제가 없다(수치 자체가 광고에 남는다).
const FIGURE_NEGATED=['월 순수익 500만원은 보장하지 않습니다','월 평균 매출 4,200만원은 보장되지 않습니다','직영점 매출 1억, 보장하지 않습니다','수익률 30% 보장하지 않음','18개월이면 투자금 회수, 보장되지 않습니다','월 순수익 500만원 가능(보장하지 않음)'];
check('15b: revenue figures stay hard_block when the guarantee is negated (figure rules have no negation exemption)',FIGURE_NEGATED.every(t=>judge(t+RC,{scope:'consumer'}).issues.some(i=>['h.net_profit_payback_claims','h.revenue_figures_no_ad'].includes(i.ruleId)&&i.tier==='hard_block')));
check('15b: a guarantee negated right at its verb is still not flagged, a guarantee with a later cost note is',!ids(judge('수익을 보장하지 않습니다')).includes('kr.fr.revenue_guarantee')&&!ids(judge('최저 수익은 보장할 수 없습니다')).length&&ids(judge('최저 수익 보장, 임대료 무관')).includes('kr.fr.revenue_guarantee'));
check('15b: fullwidth digits are the same figures (NFKC)',['월 평균 매출 ４,２００만원','월 순수익 ６００만원'].every(hardC)&&reasonOf(judge('전국 ２０개 매장 운영 중',{scope:'consumer',facts:[count(12)]}),SC_ID)==='value_mismatch');
check('15b: block rules are not cleared by a trailing reassurance clause',judge('전국 20개 매장 운영, 걱정하지 마세요'+RC,{scope:'consumer',facts:[count(12)]}).blocked&&judge('업계 1위 도넛, 의심하지 마세요'+RC,{scope:'consumer'}).blocked);
// 소비자 문장(검토에서 해제 불가·차단 오탐이었던 것): 날짜의 '월', 순위, 기부·전달, 픽업, 제휴 계약, 수입품, 다회용컵 회수, 로열티 고객, 한정 판매 매장 수.
const CONSUMER_MORE=['12월 수입 원두 20% 할인','9월 수익금의 10%를 기부합니다','9월 매출 1위 도넛 3,500원','월 매출 1위 메뉴 20% 할인','월 매출 감사 이벤트 20% 할인','단체 주문은 예약금 선납 후 점포에서 당일 수령','매출 1위 메뉴, 맛은 보장합니다','매출 1위 비결은 신선함 보장','전 가맹 매장에서 당일 픽업 가능','가맹 매장 어디서나 바로 사용 가능한 쿠폰','크리스마스 케이크는 점포별 예약금 선납 후 픽업 가능합니다','제휴 계약 카드로 결제하면 바로 10% 할인','계약직 바리스타 모집, 즉시 근무 가능','본사 온라인몰 케이크 예약금 미리 결제','통신사 제휴 계약 매장에서 즉시 할인','기업 단체 주문 계약 시 당일 배송해 드립니다','렌탈 계약 당일 설치','품질 보장 수입 버터로 구운 크루아상','판매 수익 일부는 기부하고, 맛은 보장해요','판매 수익 일부를 기부하고 끝까지 책임지겠습니다','이번 달 판매 순수익의 10%를 동물보호단체에 기부합니다','하루 매출의 일부(10%)를 지역 아동센터에 전달합니다','3개월 회수 텀블러 캠페인에 참여하세요','월 수입 원두 2만원','1년 만에 회수한 다회용컵 1만 개','다회용컵은 1개월 이내 회수해 매장에서 세척합니다','로열티 고객 10% 할인 이벤트','VIP 로열티 혜택 2배 적립','리뉴얼 인테리어 비포 애프터 2탄 공개','베이킹 교육비 30,000원, 초보자 환영','바리스타 교육비 무료 이벤트','로열티 프리 음원으로 만든 영상','신메뉴는 전국 5개 매장에서 한정 판매합니다','현재 2개 매장에서만 판매하는 한정 메뉴','총 3곳 매장에서 먼저 선보여요','현재 4개 지점에서 시범 판매 중','매장 2곳 운영 시간 변경 안내'];
check(`8a: ${CONSUMER_MORE.length} more consumer sentences raise 0 issues in a franchise brand consumer campaign (store count 12 confirmed)`,same(CONSUMER_MORE.flatMap(t=>judge(t,{scope:'consumer',facts:consumerFacts}).issues.map(i=>t+' → '+i.ruleId)),[]));
check('8a: none of them is a hard_block in recruitment scope either',CONSUMER_MORE.every(t=>!judge(t,{scope:'recruitment',facts:consumerFacts}).hardBlocked));
check('8a: the 37 sentences as one caption raise 0 issues',judge(CONSUMER_MORE.join('\n'),{scope:'consumer',facts:consumerFacts}).issues.length===0);
// 법령을 옮긴 정확한 고지(해제 불가 오탐이면 사용자가 고칠 수 없다).
const DISCLOSURES=['가맹점사업자단체 가입 여부와 관계없이 계약 조건은 같습니다','최소 매출 기준 미달 시 계약 해지 사유가 됩니다','정보공개서를 받은 날부터 14일(변호사·가맹거래사 자문시 7일)이 지나야 계약할 수 있습니다','변호사 자문으로 7일 뒤에 계약할 수 있습니다','가계약금은 가맹금에 해당합니다','가계약금 요구는 불법입니다'];
check('15b: payback and wait-bypass claims keep their franchise forms (investment anchor, opening context)',['투자금 1년 만에 회수','1년 만에 투자금 회수','지금 계약하면 즉시 오픈','가맹 계약 당일 바로 오픈','본사 지정 가맹거래사 상담 후 7일 만에 계약'].every(hardC)&&['구독 7일 이내 계약 철회 가능','가입 7일 안에 계약 해지 가능','연말 한정 케이크 예약 시작, 예약금 미리 결제'].every(t=>!judge(t,{scope:'consumer'}).issues.length));
check('15b: accurate legal restatements are not hard_block (association, burden, waiting period, deposit definition)',DISCLOSURES.every(t=>!judge(t).hardBlocked));
check('15b: stated conditions in brackets or after a dash exempt conditional support',['인테리어 전액 지원(선착순 10개 점포 한정)','인테리어 전액 지원(2026년 12월 계약자 한정)','인테리어 지원(24시간 영업 점포 한정, 1년 이내 폐점 시 환수)','인테리어 전액 지원 - 선착순 10개 점포 한정'].every(t=>!ids(judge(t)).includes('kr.fr.conditional_support')));
check('15b: 조건 없이, 아무 조건 없이, 조건 없음 and 오픈까지 책임 are not stated conditions',['인테리어 전액 지원, 조건 없이 드립니다','아무 조건 없이 인테리어 무상 지원','가맹비 지원 조건 없음','인테리어 전액 지원, 상담부터 오픈까지 책임집니다'].every(t=>ids(judge(t)).includes('kr.fr.conditional_support')&&judge(t).blocked));
check('15b: zero-cost phrasings with 없이, 프리, 무(無) and 노 are detected',['가맹비 없이 창업하세요','로열티 없이 운영','로열티 프리','무(無)로열티','노 로열티'].every(t=>ids(judge(t)).includes('h.zero_cost_claims')));
check('15b: number-first store counts are checked, including the notice example (고시 제2019-8호 Ⅱ.4.가)',['650개 가맹점이 성업 중','20개 가맹점 성업 중입니다','벌써 20개 매장','매장 20개 돌파','전국에 20개 매장'].every(t=>reasonOf(judge(t,{scope:'consumer',facts:[count(12)]}),SC_ID)==='value_mismatch')&&!ids(judge('12개 가맹점이 성업 중',{scope:'consumer',facts:[count(12)]})).includes(SC_ID));
const both=[count(12),direct3],scOf=(t,facts=both)=>reasonOf(judge(t,{scope:'consumer',facts}),SC_ID);
check('15b: 가맹점 claims compare with the franchised count only, 직영점 with the direct count only',scOf('가맹점 15개')==='value_mismatch'&&scOf('직영점 12개')==='value_mismatch'&&scOf('가맹점 3개')==='value_mismatch'&&scOf('가맹점 12개')===undefined&&scOf('직영점 3개')===undefined&&scOf('전국 12개 가맹점')===undefined);
check('15b: 전국·매장 totals are the same-date sum when both counts exist, the single count otherwise',scOf('전국 15개 매장')===undefined&&scOf('전국 12개 매장')==='value_mismatch'&&scOf('전국 12개 매장',[count(12)])===undefined&&scOf('전국 15개 매장',[count(12),fact('direct_store_count','3개',{sourceRef:ref({asOf:'2025-06-30'})})])==='no_evidence');
const costOf=(storeType,v)=>cur('startup_cost_total',v,{cost:{storeType,includes:['가맹비','교육비'],excludes:['임차보증금'],areaM2:33}});
const twoTypes=[costOf('테이크아웃형','5,000만원'),costOf('카페형','8,000만원')],suOf=t=>reasonOf(judge(t,{facts:twoTypes}),SU);
check('15b: startup cost compares with the named store type only and needs the store type',suOf('카페형 창업비용 5,000만원\n'+DETAIL)==='value_mismatch'&&suOf('창업비용 5,000만원\n'+DETAIL)==='details_missing'&&suOf('테이크아웃형 창업비용 5,000만원\n'+DETAIL)===undefined&&suOf('총 창업비용 · 카페형: 8,000만원\n'+DETAIL)===undefined);
check('15b: a startup cost range checks both bounds (4,000~5,000만원 reads 4,000만원 and 5,000만원)',suOf('테이크아웃형 창업비용 4,000~5,000만원\n'+DETAIL)==='value_mismatch');
const revenueFacts=[cur('regional_avg_sales','월 평균 4,200만원 (2025년 기준)'),cur('profit_rate','영업이익률 18%'),cur('monthly_sales','월 500만원')];
check('15b: a restated revenue fact amount or rate is hard_block without the word 매출 (H6)',['가맹점 평균 4,200만원 달성','월 평균 4,200만원','가맹점 평균 월 4,200만원','수익 18% 브랜드','가맹점 평균 4,200만원 달성, 경품 증정'].every(t=>judge(t+RC,{scope:'consumer',facts:revenueFacts}).issues.some(i=>i.ruleId==='h.revenue_figures_no_ad'&&i.tier==='hard_block'&&i.reason==='revenue_fact')));
check('15b: a discount rate, a menu price, a counter, a composition rate or a giveaway amount is not a revenue fact value',['아메리카노 18% 할인','라떼 4,200원','누적 판매 4,200만 개','카카오 18% 함유 초코 도넛','총 500만원 상당 경품 이벤트'].every(t=>!judge(t,{scope:'consumer',facts:revenueFacts}).hardBlocked));
const insured=[cur('escrow_insurance','피해보상보험 가입(가상보험사)')];
const extIssue=judge('가맹금 100% 안전하게 지켜드립니다').issues.find(i=>i.ruleId==='kr.fr.insurance_mark');
check('15b: 가맹금 안전 wording is a heuristic extension of 제15조의2⑥ with its own label, still unremovable',extIssue?.extended===true&&extIssue.basis==='heuristic'&&extIssue.basisLabel==='공식 규정 제15조의2⑥ 확장 적용 · '+DISCLAIMER&&extIssue.tier==='hard_block'&&judge('피해보상보험 가입 브랜드').issues.find(i=>i.ruleId==='kr.fr.insurance_mark')?.basis==='official');
check('15b: an insurance fact clears the factual mark and 가맹금 보호 but not 100%·보장 wording',ok('피해보상보험 가입 브랜드',insured)&&ok('가맹금 보호를 위해 피해보상보험에 가입했습니다',insured)&&['가맹금 100% 안전하게 지켜드립니다','가맹금 100% 보호 보장','가맹금 보호(100% 보장)'].every(t=>judge(t,{facts:insured}).hardBlocked));
check('15b: H9 escalates only when the number belongs to the warned claim (menu prices and discounts do not)',['점주 추천 메뉴 6개 세트 12,000원','AI 모델이 소개하는 신메뉴 5,000원','가상 인플루언서 콜라보 도넛 3,500원 출시','점주님 추천 메뉴 20% 할인'].every(t=>{const j=judge(t+'\n둘째 줄',{scope:'consumer'});return j.issues.length>0&&!j.blocked})&&judge('점주 후기: 가맹비 870만원이면 시작\n둘째 줄',{scope:'consumer',facts:[cur('franchise_fee','870만원')]}).issues.some(i=>i.ruleId==='kr.ad.endorsement_disclosure'&&i.escalatedBy==='h.headline_claim_block'));
check('15b: the territory rule cites only the franchise act in the lexicon (시행령 제13조의4 is about changing territories)',same(comp.COMPLIANCE_LEXICON.rules.find(r=>r.id==='kr.fr.territory_claims').sources,['franchise_act']));

// ════ 15c) R2 2차 검토 확정 사례(합성 319건, 원인별 수정의 회귀) ════
// 소비자 오탐 0(사실 없음·가맹 원장 둘 다), 모집 범위 우회 표현 검출(규칙별), 모집 정상 문장 0(원장별), 값 대조(범위·원장별 기대). 원장은 R2 검토 프로브의 합성 원장이다.
const R2_COST={C0:{"storeType":"테이크아웃형","includes":["가맹비","교육비","인테리어","집기"],"excludes":["임차보증금","권리금"],"areaM2":33},C1:{"storeType":"테이크아웃형","includes":["가맹비","교육비","인테리어","주방설비"],"excludes":["임차보증금","권리금"],"areaM2":33},C2:{"storeType":"카페형","includes":["가맹비","교육비","인테리어","주방설비"],"excludes":["임차보증금","권리금"],"areaM2":66},C3:{"storeType":"테이크아웃형","includes":["목공","전기","간판"],"excludes":["철거","냉난방"],"areaM2":33},C4:{"storeType":"테이크아웃형","includes":["가맹비","교육비","인테리어"],"excludes":["임차보증금","권리금"],"areaM2":33},C5:{"storeType":"매장형","includes":["가맹비","교육비","인테리어"],"excludes":["임차보증금","권리금"],"areaM2":66}};
const R2_LEDGER_ROWS={CONSUMER:[["franchise_store_count","142개","2025-12-31"],["direct_store_count","8개","2025-12-31"],["startup_cost_total","6,800만원",null,"C0"],["franchise_fee","1,100만원",null,"C0"],["education_fee","330만원",null,"C0"],["franchise_deposit","500만원",null,"C0"],["interior_cost","3,300만원",null,"C0"],["royalty_fee","월 25만원"],["escrow_insurance","가맹금 예치기관 예치(가상은행)"],["production_method","매장에서 직접 반죽·굽기(수제)"],["sales_channels","온라인몰·백화점 팝업"],["store_types","테이크아웃형·카페형"],["ip_registration","상표 등록 제40-0000000호(가상)"],["territory_clause","반경 500m 영업지역 설정"],["required_items_pricing","공급가 원가+10%"],["margin_fee","차액가맹금 있음"],["disclosure_registration_no","제20250000호(가상)"],["regional_avg_sales","수도권 가맹점 월 평균 3,850만원 (2025년)"],["direct_store_sales","연 6억 2,000만원"],["direct_store_contribution","월 1,000만원"],["monthly_sales","월 4,500만원"],["profit_rate","영업이익률 15%"]],
 MAIN:[["franchise_store_count","42개","2025-12-31"],["direct_store_count","3개","2025-12-31"],["startup_cost_total","6,500만원",null,"C1"],["startup_cost_total","9,800만원",null,"C2"],["franchise_fee","550만원"],["education_fee","220만원"],["franchise_deposit","500만원"],["interior_cost","2,800만원",null,"C3"],["ip_registration","상표 등록 제40-0000000호(가상)"],["claim_basis","가상리서치 2026 소비자 조사"],["trade_area_source","가상 상권정보 2026-08 조회"],["production_method","반죽은 본사 직영 공장에서 직접 생산, 매장에서 수제 마무리"],["sales_channels","없음"],["required_items_pricing","공급가 원가+10%"],["margin_fee","차액가맹금 있음"],["territory_clause","반경 500m 영업지역 설정"],["direct_store_performance","가상 직영 1호점 2026-08 판매 기록"],["collab_consent","가상 권리자 서면 동의 2026-09"],["own_ip_rights","가상 가맹본부 저작권"],["heritage_basis","2016 개업 가상 증빙"],["store_types","테이크아웃형, 카페형"],["disclosure_registration_no","제20260000호(가상)"],["base_fiscal_year","2025년"],["regional_avg_sales","월 평균 3,900만원 (2025년 기준)"],["direct_store_sales","월 5,200만원 (2025년 기준)"],["profit_rate","영업이익률 15%"],["royalty_fee","월 20만원"],["escrow_insurance","가맹점사업자피해보상보험 가입(가상보험사, 2026-01-01~2026-12-31)"]],
 ESCROW:[["franchise_store_count","42개","2025-12-31"],["direct_store_count","3개","2025-12-31"],["startup_cost_total","6,500만원",null,"C1"],["startup_cost_total","9,800만원",null,"C2"],["franchise_fee","550만원"],["education_fee","220만원"],["franchise_deposit","500만원"],["interior_cost","2,800만원",null,"C3"],["ip_registration","상표 등록 제40-0000000호(가상)"],["claim_basis","가상리서치 2026 소비자 조사"],["trade_area_source","가상 상권정보 2026-08 조회"],["production_method","반죽은 본사 직영 공장에서 직접 생산, 매장에서 수제 마무리"],["sales_channels","없음"],["required_items_pricing","공급가 원가+10%"],["margin_fee","차액가맹금 있음"],["territory_clause","반경 500m 영업지역 설정"],["direct_store_performance","가상 직영 1호점 2026-08 판매 기록"],["collab_consent","가상 권리자 서면 동의 2026-09"],["own_ip_rights","가상 가맹본부 저작권"],["heritage_basis","2016 개업 가상 증빙"],["store_types","테이크아웃형, 카페형"],["disclosure_registration_no","제20260000호(가상)"],["base_fiscal_year","2025년"],["regional_avg_sales","월 평균 3,900만원 (2025년 기준)"],["direct_store_sales","월 5,200만원 (2025년 기준)"],["profit_rate","영업이익률 15%"],["royalty_fee","월 20만원"],["escrow_insurance","가맹금 예치 약정(가상은행, 2026-03-01)"]],
 PCT:[["franchise_store_count","42개","2025-12-31"],["direct_store_count","3개","2025-12-31"],["startup_cost_total","6,500만원",null,"C1"],["startup_cost_total","9,800만원",null,"C2"],["franchise_fee","550만원"],["education_fee","220만원"],["franchise_deposit","500만원"],["interior_cost","2,800만원",null,"C3"],["ip_registration","상표 등록 제40-0000000호(가상)"],["claim_basis","가상리서치 2026 소비자 조사"],["trade_area_source","가상 상권정보 2026-08 조회"],["production_method","반죽은 본사 직영 공장에서 직접 생산, 매장에서 수제 마무리"],["sales_channels","없음"],["required_items_pricing","공급가 원가+10%"],["margin_fee","차액가맹금 있음"],["territory_clause","반경 500m 영업지역 설정"],["direct_store_performance","가상 직영 1호점 2026-08 판매 기록"],["collab_consent","가상 권리자 서면 동의 2026-09"],["own_ip_rights","가상 가맹본부 저작권"],["heritage_basis","2016 개업 가상 증빙"],["store_types","테이크아웃형, 카페형"],["disclosure_registration_no","제20260000호(가상)"],["base_fiscal_year","2025년"],["regional_avg_sales","월 평균 3,900만원 (2025년 기준)"],["direct_store_sales","월 5,200만원 (2025년 기준)"],["profit_rate","영업이익률 15%"],["royalty_fee","매출액의 3%"],["escrow_insurance","가맹점사업자피해보상보험 가입(가상보험사, 2026-01-01~2026-12-31)"]],
 COLLIDE:[["franchise_store_count","42개","2025-12-31"],["direct_store_count","3개","2025-12-31"],["startup_cost_total","6,500만원",null,"C1"],["startup_cost_total","9,800만원",null,"C2"],["franchise_fee","550만원"],["education_fee","220만원"],["franchise_deposit","500만원"],["interior_cost","2,800만원",null,"C3"],["ip_registration","상표 등록 제40-0000000호(가상)"],["claim_basis","가상리서치 2026 소비자 조사"],["trade_area_source","가상 상권정보 2026-08 조회"],["production_method","반죽은 본사 직영 공장에서 직접 생산, 매장에서 수제 마무리"],["sales_channels","없음"],["required_items_pricing","공급가 원가+10%"],["margin_fee","차액가맹금 있음"],["territory_clause","반경 500m 영업지역 설정"],["direct_store_performance","가상 직영 1호점 2026-08 판매 기록"],["collab_consent","가상 권리자 서면 동의 2026-09"],["own_ip_rights","가상 가맹본부 저작권"],["heritage_basis","2016 개업 가상 증빙"],["store_types","테이크아웃형, 카페형"],["disclosure_registration_no","제20260000호(가상)"],["base_fiscal_year","2025년"],["regional_avg_sales","월 평균 3,900만원 (2025년 기준)"],["direct_store_sales","월 5,200만원 (2025년 기준)"],["profit_rate","영업이익률 10%"],["direct_store_contribution","월 550만원 (2025년 기준)"],["royalty_fee","월 20만원"],["escrow_insurance","가맹점사업자피해보상보험 가입(가상보험사, 2026-01-01~2026-12-31)"]],
 COUNT:[["franchise_store_count","12개","2025-12-31"],["direct_store_count","3개","2025-12-31"]],
 COUNT_BIG:[["franchise_store_count","1,248개","2025-12-31"],["direct_store_count","12개","2025-12-31"]],
 COST_ONE:[["startup_cost_total","5,000만원",null,"C4"]],
 COST_TWO:[["startup_cost_total","5,000만원",null,"C4"],["startup_cost_total","8,000만원",null,"C5"]],
 COST_RANGE:[["startup_cost_total","4,500~5,500만원(추정)",null,"C4"]],
 COST_VAT:[["startup_cost_total","5,000만원(VAT 별도)",null,"C4"]],
 COST_UNTYPED:[["startup_cost_total","5,000만원"]],
 FEES:[["franchise_fee","870만원",null,"C4"],["education_fee","300만원",null,"C4"],["franchise_deposit","500만원",null,"C4"],["royalty_fee","월 30만원"],["interior_cost","3.3㎡당 150만원",null,"C4"]],
 FULL:[["franchise_store_count","12개","2025-12-31"],["direct_store_count","3개","2025-12-31"],["startup_cost_total","5,000만원",null,"C4"],["franchise_fee","870만원",null,"C4"],["interior_cost","3.3㎡당 150만원",null,"C4"],["monthly_sales","월 4,200만원"],["profit_rate","18%"],["direct_store_contribution","1,100만원"]],
 REV_DEC:[["profit_rate","12.5%"]],
 REV:[["monthly_sales","월 4,200만원"],["regional_avg_sales","3억 2,000만원"],["profit_rate","18%"],["direct_store_sales","월 6,500만원"],["direct_store_contribution","1,100만원"]]};
const R2L=Object.fromEntries(Object.entries(R2_LEDGER_ROWS).map(([k,rows])=>[k,rows.map(([key,value,asOf,cost])=>cur(key,value,{...(asOf?{asOf}:{}),...(cost?{cost:R2_COST[cost]}:{})}))]));
const R2_CONSUMER_NONE=["이번 시즌 메뉴판 No.1 클래식 글레이즈드 · No.2 초코 스프링클 · No.3 딸기 필링","오늘의 추천 조합 №1 오리지널 + №2 시나몬 슈가","Ｎｏ．１ 밤 크림 / Ｎｏ．２ 고구마 크림 – 가을 박스 구성","당 함량을 기존보다 평균 15% 낮춘 라이트 글레이즈드 출시","세트로 사면 단품보다 평균 15% 저렴해요 🙌","직영점 한정 아이스 음료 15% 증량 이벤트","로열티 스탬프 12개 완성하면 본사 한정 굿즈 증정","로열티 쿠폰 3장 모아 오시면 본사 머그컵 교환","지역화폐 가맹 업소라 결제 즉시 10% 캐시백 돼요","전국 가맹 지점에서 바로 사용 가능한 모바일 교환권","간편결제 가맹 가게라 QR로 바로 결제돼요","현재 12개 매장에서 사용 가능한 쿠폰이에요","그랜드 오픈 기념 홀케이크 예약, 예약금 선납 부탁드려요 🎂","오픈 시간 전 픽업을 원하시면 예약금 먼저 입금해 주세요","나만의 도넛 디자인 등록하고 실제 메뉴로 출시될 기회를 잡으세요!","앱에서 케이크 디자인 등록 후 픽업 날짜를 선택하세요","창업 30주년 기념 바리스타 교육비 무료 🎓","본사 아카데미 홈카페 교육비 무료, 선착순 20명","본사 베이킹 스튜디오 쿠키 만들기 교육비 25,000원","바리스타 기초반 교육비 4만원, 신청은 본사 홈페이지에서","누적 판매 1,000만 돌파! 감사 이벤트 🎉","누적 방문객 1,000만 돌파 감사 이벤트","벌써 5개 매장 완판! 내일 오전 10시에 다시 만나요 🙏","벌써 ５개 매장 완판 🔥","이미 3곳 매장에서 품절됐어요 😭 다른 매장 재고는 앱에서 확인!","현재 7개 매장에서 사전 예약 받고 있어요","총 3곳 매장에서 배달 주문이 가능해요","이번 주 신규 2개 매장 오픈 소식 전해드려요 🎈","오픈 예정 매장 2곳을 미리 소개합니다: 광교점, 송도점","매장 3곳 오픈 기념 스탬프 2배","5개 매장에서 오픈 1주년 이벤트를 함께 진행해요","백화점 입점 계약 마치고 바로 팝업 오픈합니다! 🛍️","추석 연휴 3개 매장이 영업을 쉽니다. 매장별 일정은 앱 공지 확인!","리뉴얼 공사로 2개 매장 영업 중단 (10/20~10/27)","매장 2곳 영업 종료 안내 - 그동안 감사했습니다","지점 3곳 오픈 시간이 30분 앞당겨집니다","가상구 가맹점 2곳 임시 휴무 안내","직영점 3곳 리뉴얼 공사로 이번 주 휴무","임대 계약 만료로 31일 당일까지만 영업하고, 새 매장으로 이전 오픈합니다","오픈 기념 텀블러 대여, 보증금 먼저 결제 후 반납 시 환불","오픈 행사 케이터링, 단체 계약 시 당일 배송 가능","케이크 퀵 배송은 파손 피해보상보험에 가입된 업체가 진행합니다","매월 매출의 1%는 지역 아동 급식비로 쓰입니다 🍱","매년 매출의 1%를 장학금으로 적립합니다","행사 순수익 100%는 유기동물 보호소 사료 구입에 사용됩니다 🐶","연간 순이익의 3%를 지역 청소년 장학금으로 지급합니다","지역아동센터에 제빵 장비 지원, 아이들과 쿠키도 구웠어요","보육원 공부방 인테리어 무상 지원 봉사를 다녀왔습니다","청년 창업 자금 지원 캠페인에 판매 수익 일부를 기부합니다","지역 대학에 장학금 1,000만원을 전달했습니다 🎓","골목 상권 보호 캠페인에 동참합니다 🏘️","점주 협의회 참여 나눔 바자회는 사전 신청 시에만 입장 가능해요","직원 복지: 바리스타 자격증 교육비 전액 지원 ☕","유니폼·장비 지원, 식대 제공, 4대 보험","신규 개설 매장 파트타이머 모집, 근로 계약 즉시 4대 보험 가입","딸기 시즌 오픈 🍓 계약 재배 농가에서 당일 수확한 딸기만 써요","신규 오픈 매장도 계약 농장에서 바로 받은 우유를 씁니다","소비자피해보상보험: 고객님은 안전거래를 위해 현금 결제 시 가입한 소비자피해보상보험 서비스를 이용하실 수 있습니다.","온라인몰 현금 결제 시 구매안전서비스(채무지급보증) 이용 가능","매장에 AI 아바타 포토존 오픈! 나만의 도넛 캐릭터 만들기","우리 매장 매출을 책임지는 효자 메뉴, 글레이즈드 🍩","기업 간식 정기배송, 상담 후 7일 안에 계약하면 첫 주 무료"];
const R2_CONSUMER_WARN=["점주님 추천 메뉴 🍩 카카오 70% 다크 초코 도넛","점주 추천 원두 100% 아라비카로 내린 드립커피","AI 모델이 먹어본 100% 우유 크림 도넛"];
const R2_BYPASS={"kr.fr.revenue_guarantee":["수 익 보 장 브랜드, 지금 가맹 문의하세요","수.익.보.장 가맹 브랜드","수익-보장 창업 아이템","수익/보장 프랜차이즈 가맹점 모집","수익💰보장 가맹점 모집","매출✨보장 창업","profit guaranteed 가맹 모집","Guaranteed profit! 창업 문의 환영","guaranteed income 월 500만원, 가맹 상담 진행","수익\n보장","매출\n100% 보장합니다","수익(을) 보장합니다","(수익) 보장 가맹 조건","월 천만원 보장, 가맹점 모집 중","원금 보장 창업, 지금 상담하세요","투자 원금 100% 보장 가맹 조건","수익금 보장 프로그램으로 창업하세요","수입 보장 가맹점 모집","수익 보증 가맹 브랜드","가맹 계약 시 수익 확정!","매출 개런티 제도 운영 중인 창업 브랜드","적자 발생 시 본사가 전액 보전해 드립니다","매출 미달 시 차액을 본사가 보상합니다","최소 수익 월 400만원을 본사가 약속합니다","평균 수익 500만원 확실히 보장","매출 보.장 창업 브랜드","연봉 1억 보장 창업","월급보다 많은 수익, 본사가 책임집니다","보장된 수익으로 창업하세요","ROI 보장 가맹 브랜드","매 출 보 장","💸 매달 500만원 수익 확정 💸","수익 보장하지 않는 브랜드와는 다릅니다, 저희는 확실합니다","수익 보장이 없는 브랜드는 잊으세요","월 수익 보 장 창업"],"h.net_profit_payback_claims":["월 순수익 오백만원","순수익 월 5백만원","순 수 익 월 600만원","순익 월 600만원","net profit 월 600만원 가맹점","monthly net profit 6M KRW 창업","매달 수익 700만원 가져가세요","한 달 수익 700만원 가맹점","점주 수익 월 650만원","투자비 1년 만에 회수","투자금 회 수 10개월","창업비 8개월이면 뽑습니다","본전 뽑는 데 6개월이면 충분한 가맹 브랜드","손익분기점 3개월 달성","payback 10개월 가맹 브랜드","ROI: 250%","R O I 250%","월 순수익\n550만원","1년 안에 투자비 전액 회수","창업비용, 8개월이면 회수"],"h.revenue_figures_no_ad":["평 균 매 출 4,200만원","직.영.점 매출 1억","매장 매출 월 8천만원","매출이 월 5천만원 나오는 가맹점","점당 매출 5천만원","월매출 억대 가맹점 속출","monthly sales 50M KRW 가맹점","영업이익 월 800만원 가맹점","마진율 40% 가맹 브랜드","이익률 20% 이상 창업 아이템","연매출\n12억","매 출 액 3억","월 매출 사천만원","직영 1호점 매출 월 9천","매출 1위 아니고 매출 7천만원 브랜드"],"h.wait_bypass_solicitation":["가 계약금 100만원 입금 시 자리 확보","가.계.약.금 받습니다 창업 상담","임시 계약금 50만원으로 입지 확보, 창업 문의","자리 선점금 50만원, 창업 희망 지역 확보","입지 선점비 30만원 선입금 후 개설 진행","우선협상 예치금 200만원 입금 시 개설 우선권","우선순위 예약금 100만원으로 가맹 지역 확보","점포 개발 약정 보증금을 먼저 입금해 주세요 (창업 상담)","14일 기다릴 필요 없이 계약 가능한 창업 브랜드","14일 대기기간 없이 가맹 계약","가맹 상담 후 숙려기간 생략하고 계약 진행","정보공개서 받은 날 바로 계약하세요","바 로 계 약 가능한 창업","Sign today, open tomorrow! 가맹 문의","계약금 먼저 넣으시면 자리 확보해 드려요 (창업 문의)","입점 확정금 50만원 선입금","가맹 희망 지역 홀딩비 30만원","(가)계약금 50만원 받고 상권 확보","계약 즉.시 오픈","정보공개서 수령 후 14일 안 기다려도 됩니다, 창업 문의","deposit 50만원으로 가맹 지역 선점"],"kr.fr.insurance_mark":["가 맹 금 안 전 보장 브랜드","가맹비 안전 보장 창업","가맹금 떼일 걱정 없는 브랜드","가맹금 먹튀 없음, 창업 문의","보증보험 가입 가맹본부","가맹금 안.전","Franchise fee 100% safe 가맹 모집","가맹금 보.호 인증","가맹금\n안전하게 지켜드립니다"],"kr.fr.association_condition":["가맹점 협의회 가입 시 재계약 불가","점주 연합회 가입 불가 조건","점주협의회 활동 시 계약 해지","점 주 단 체 가입 시 계약 제한","가맹점주 노조 가입 시 계약 불가"],"h.captive_advisor_phrase":["본사 파트너 가맹거래사 자문으로 빠르게 계약","본부 연계 변호사로 일주일 만에 계약","7 일 만 에 계약","일주일 안에 가맹 계약","칠일 만에 계약","본사 전속 가.맹.거.래.사 자문","7days 계약! 본사 지정 거래사 무료 자문"],"kr.fr.store_count_claims":["벌써 30호점","전.국 20개 매장","매장 수 50+ 브랜드","가맹점이 100곳이 넘습니다"],"kr.fr.startup_cost_claims":["창.업.비.용 4천만원","초기 투자금 3천만원으로 가맹점 오픈","startup cost 4,000만원 가맹","창 업 비 용 3,500만원"],"kr.fr.ip_claims":["특 허 받은 반죽 기술","patented 도우 기술로 창업"],"kr.fr.conditional_support":["인테리어비 지원 가맹 조건","인테리어 비용 지원 창업","오픈 비용 전액 본사 부담"],"kr.fr.superlative_claims":["업계 최.저 가맹비","국.내.최.초 도넛 프랜차이즈"],"kr.fr.trade_area_claims":["경쟁점 없는 상권","상 권 분 석 완료 입지"],"kr.fr.production_claims":["자.체.공.장 생산","자 체 생 산 도우 공급"],"kr.fr.exclusive_channel_claims":["가맹점만 판매하는 메뉴"],"h.exclusive_supply_claims":["본사 독.점 공급 원료"],"h.direct_store_popularity":["연일 매진 행렬 직영점","줄 서는 가게, 직영점 이야기","완.판 직영점"],"h.zero_cost_claims":["로 열 티 0원","royalty free 가맹 모집"],"h.handmade_claims":["수.제 도넛 가맹점"]};
const R2_LEGIT={"MAIN":["본사는 가맹점 수익을 책임지지 않습니다.","매출이나 수익을 보장하는 문구는 광고에 쓰지 않습니다.","수익 보장 광고는 법으로 금지돼 있습니다.","최저 수익 보장 제도는 운영하지 않습니다.","월 순수익이나 투자금 회수 기간은 광고하지 않습니다.","투자 회수 기간은 점포마다 다르고 약속할 수 없습니다.","가계약금, 상권 선점금, 우선협상 보증금을 받지 않습니다.","우선협상권을 돈을 받고 드리지 않습니다.","가맹 계약은 14일 대기 없이 체결할 수 없습니다.","가맹 상담 당일에는 계약하지 않습니다.","가맹 계약 해지 시 즉시 반환 절차를 안내합니다.","점주 협의회 참여 여부로 불이익을 주지 않습니다.","가맹점사업자단체 가입을 계약 조건으로 요구하지 않습니다.","본사 지정 가맹거래사를 통한 계약 기간 단축은 하지 않습니다.","전국 40여 개 매장(2025-12-31 기준 45개)\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20","슈퍼바이저 1명이 가맹점 10곳을 담당합니다.","인근가맹점 현황문서에는 예정지에서 가장 가까운 가맹점 10개를 적습니다.","직영점 1곳 이상을 1년 넘게 운영한 브랜드만 가맹사업을 할 수 있습니다.","테이크아웃형 창업비용 6,500만원(가맹비 550만원·교육비 220만원·인테리어 비용 2,800만원·주방설비 2,930만원 포함)\n포함: 가맹비, 교육비, 인테리어, 주방설비 · 불포함: 임차보증금, 권리금 · 전용면적 33㎡\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20","창업비용 6,500만원 = 가맹비 550만원 + 교육비 220만원 + 인테리어 비용 2,800만원 + 주방설비 2,930만원 (테이크아웃형)\n포함: 가맹비, 교육비, 인테리어, 주방설비 · 불포함: 임차보증금, 권리금 · 전용면적 33㎡\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20","창업비용은 매장 유형과 면적에 따라 다르며 정보공개서에 유형별로 적혀 있습니다.","창업비용 상세는 상담 때 정보공개서로 안내합니다.","개설 비용 항목은 가맹비, 교육비, 인테리어, 주방설비이며 임차보증금과 권리금은 별도입니다.","총 창업비용 6,500만원(테이크아웃형 기준)에는 가맹비·교육비·인테리어·주방설비가 포함되고 임차보증금·권리금은 별도이며 전용면적 33㎡ 기준입니다.\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20","테이크아웃형(33㎡) 창업비용 6,500만원 - 포함: 가맹비, 교육비, 인테리어, 주방설비 / 불포함: 임차보증금, 권리금\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20","업계 최저 창업비용 같은 근거 없는 표현은 쓰지 않습니다.","후보지 상권 분석은 가맹희망자와 함께 현장에서 확인합니다.","교육비 지원 대상: 계약 기간 5년 이상 신규 가맹점","정부 창업 지원 제도는 본사와 무관하며 직접 확인하셔야 합니다.","본사는 정부 지원 대출을 알선하지 않습니다.","가맹 상담 신청 즉시 담당자가 연락드립니다.","가맹 문의는 당일 회신을 원칙으로 합니다.","가맹 설명회 신청 후 바로 확인 문자를 보내 드립니다.","가맹 계약서안은 상담 당일 드립니다.","가맹 정보공개서는 상담 당일 바로 드립니다.","가맹본부 직원이 개점 당일 매장에 함께합니다.","가맹 계약 후 바로 교육 일정을 안내합니다.","가맹 계약 체결 즉시 가맹금은 예치기관에 입금됩니다.","가맹 교육 수료 당일 매장 인수 점검을 합니다.","가맹 설명회 당일 현장 상담도 받습니다.","가맹 상담 예약은 대기 없이 온라인으로 할 수 있습니다.","가맹 정보공개서 제공 당일은 대기기간 계산에 넣지 않습니다.","예비 창업자 설명회 안내\n일시: 매월 둘째 주 토요일 오후 2시\n순서: 브랜드 소개 → 직영 공간 견학 → 창업비용 표 → 가맹 절차와 대기기간 → 질의응답\n설명회에서는 계약하지 않고 가맹금도 받지 않습니다.","가맹 조건 요약\n가맹비 550만원 · 교육비 220만원 · 가맹 보증금 500만원 · 로열티 월 20만원\n가맹금 보호를 위해 가맹점사업자피해보상보험에 가입했습니다.\n가계약금은 받지 않습니다.\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20","가맹비 550만원 · 교육비 220만원\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20","가맹비 550만원 / 교육비 220만원\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20","가맹비 550만원 교육비 220만원 가맹 보증금 500만원\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20","투자금 회수를 약속하는 광고는 하지 않습니다.","가맹금 반환 요청은 접수 즉시 처리합니다."],"ESCROW":["가맹금은 가상은행에 예치해 보호합니다.","피해보상보험 대신 가맹금 예치 제도를 이용합니다.","피해보상보험에는 가입하지 않았으며 가맹금은 가상은행에 예치합니다."],"PCT":["로열티는 가맹점 매출액의 3%입니다.\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20","로열티: 월 매출액의 3%(부가세 별도)\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20"],"COLLIDE":["가맹점 필수품목 공급가는 원가에 10%를 더해 정합니다.","가맹비 550만원(부가세 별도)\n※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-20"]};
const R2_VALUE=[["매장 수: 20개","recruitment","COUNT","block","kr.fr.store_count_claims"],["가맹점 수: 20개","recruitment","COUNT","block","kr.fr.store_count_claims"],["가맹점 수는 20개입니다","recruitment","COUNT","block","kr.fr.store_count_claims"],["가맹점은 20곳입니다","recruitment","COUNT","block","kr.fr.store_count_claims"],["매장 20개 이상 운영 중","recruitment","COUNT","block","kr.fr.store_count_claims"],["전국 20개 이상 매장","recruitment","COUNT","block","kr.fr.store_count_claims"],["전국 매장 20개","recruitment","COUNT","block","kr.fr.store_count_claims"],["가맹 매장 15곳 운영 중","recruitment","COUNT","block","kr.fr.store_count_claims"],["가맹 매장 12곳 운영 중","recruitment","COUNT","pass"],["직영 매장 3곳 운영 중","recruitment","COUNT","pass"],["전국 15개 가맹 매장","recruitment","COUNT","block","kr.fr.store_count_claims"],["가맹점과 직영점 합계 20개","recruitment","COUNT","block","kr.fr.store_count_claims"],["가맹점 10여 개 운영 중","recruitment","COUNT","pass"],["가맹점 10개 이상","recruitment","COUNT","pass"],["2026년 9월 현재 가맹점 12개","recruitment","COUNT","block","kr.fr.store_count_claims"],["2026.06.30 기준 전국 15개 매장","recruitment","COUNT","block","kr.fr.store_count_claims"],["매장이 20곳이나 됩니다","recruitment","COUNT","block","kr.fr.store_count_claims"],["전국 1,200여 개 매장","recruitment","COUNT_BIG","pass"],["가맹점 1,200개 이상","recruitment","COUNT_BIG","pass"],["전국 1,300개 이상 매장","recruitment","COUNT_BIG","block","kr.fr.store_count_claims"],["1,000호점 돌파","recruitment","COUNT_BIG","pass"],["전국 2천여 개 매장","recruitment","COUNT_BIG","block","kr.fr.store_count_claims"],["전국 1.5천 개 매장","recruitment","COUNT_BIG","block","kr.fr.store_count_claims"],["이번 주 3개 매장 오픈! 오픈 기념 아메리카노 1+1","consumer","COUNT","pass"],["리뉴얼 공사로 매장 2곳 영업 중단 안내","consumer","COUNT","pass"],["신규 2개 매장 오픈 기념 20% 할인","consumer","COUNT","pass"],["5개 지점 영업 종료 시간 변경","consumer","COUNT","pass"],["수도권 4개 매장 오픈런 이벤트","consumer","COUNT","pass"],["이번 달 오픈 예정 매장 2곳에서 사전 예약 이벤트","consumer","COUNT","pass"],["테이크아웃형 창업비용 5,000만원(가맹비·교육비·인테리어 포함, 임차보증금·권리금 별도, 전용면적 33㎡)","recruitment","COST_ONE","pass"],["테이크아웃형 창업비용 5,000만원\n매장형 창업비용 5,000만원\n포함: 가맹비, 교육비, 인테리어 · 불포함: 임차보증금, 권리금 · 전용면적 33㎡","recruitment","COST_TWO","block","kr.fr.startup_cost_claims"],["테이크아웃형 창업비용 5,000만원 / 매장형 6,000만원\n포함: 가맹비, 교육비, 인테리어 · 불포함: 임차보증금, 권리금 · 전용면적 33㎡\n포함: 가맹비, 교육비, 인테리어 · 불포함: 임차보증금, 권리금 · 전용면적 66㎡","recruitment","COST_TWO","block","kr.fr.startup_cost_claims"],["테이크아웃형 창업비용 4,500만원부터\n포함: 가맹비, 교육비, 인테리어 · 불포함: 임차보증금, 권리금 · 전용면적 33㎡","recruitment","COST_RANGE","block","kr.fr.startup_cost_claims"],["테이크아웃형 창업비용 5,500만원\n포함: 가맹비, 교육비, 인테리어 · 불포함: 임차보증금, 권리금 · 전용면적 33㎡","recruitment","COST_RANGE","block","kr.fr.startup_cost_claims"],["테이크아웃형 창업비용 5,000만원(VAT 포함)\n포함: 가맹비, 교육비, 인테리어 · 불포함: 임차보증금, 권리금 · 전용면적 33㎡","recruitment","COST_VAT","block","kr.fr.startup_cost_claims"],["창업비용 5,000만원","recruitment","COST_UNTYPED","block","kr.fr.startup_cost_claims"],["인테리어 비용 3.3㎡당 120만원","recruitment","FEES","block","kr.fr.startup_cost_claims"],["인테리어 비용 150만원","recruitment","FEES","block","kr.fr.startup_cost_claims"],["유튜브 조회수 4,200만 돌파 기념 이벤트","consumer","FULL","pass"],["팔로워 4,200만 달성 감사 이벤트","consumer","FULL","pass"],["전국 가맹점에서 음료 사이즈 18% 업!","consumer","FULL","pass"],["당도를 평균 18% 낮춘 저당 케이크","consumer","FULL","pass"],["점주 추천 메뉴 18% 증량 이벤트","consumer","FULL","noH6"],["직영점 한정 18% 더 큰 컵","consumer","FULL","pass"],["총 1,100만원 상당 경품 추첨","consumer","FULL","pass"],["전 메뉴 12.5% 할인","consumer","REV_DEC","pass"],["한 달 4천2백만원","recruitment","REV","hard","h.revenue_figures_no_ad"],["한 달 4천200만원","recruitment","REV","hard","h.revenue_figures_no_ad"],["한 달 사천이백만 원","recruitment","REV","hard","h.revenue_figures_no_ad"],["1년에 3억 2천 버셨어요","recruitment","REV","hard","h.revenue_figures_no_ad"],["가맹점 마진율 18프로 수준","recruitment","REV","hard","h.revenue_figures_no_ad"],["창업비용 18% 절감 프로모션","recruitment","REV","blockOnly","kr.fr.startup_cost_claims"],["가맹점 18%가 2호점까지 개설했습니다","recruitment","REV","noH6"],["교육비 50만원만 내면 됩니다","recruitment","FEES","block","kr.fr.startup_cost_claims"],["4,000만원으로 창업 가능한 디저트 브랜드","recruitment","COST_ONE","block","kr.fr.startup_cost_claims"],["5,000만원이면 창업 가능, 테이크아웃형","recruitment","COST_ONE","block","kr.fr.startup_cost_claims"],["창업비는 4,000만원","recruitment","COST_ONE","block","kr.fr.startup_cost_claims"],["매장 인테리어 비용 1억 원 들인 리뉴얼 오픈","consumer","FULL","pass"],["올해 누적 기부금 1,100만원을 지역 푸드뱅크에 전달했습니다","consumer","FULL","pass"]];
const r2=(t,scope,L)=>judge(t,{scope,facts:L?R2L[L]:[]}),R2_HARD=new Set(rules.FRANCHISE_HARD_BLOCK_IDS);
const consumerR2=R2_CONSUMER_NONE.flatMap(t=>[...r2(t,'consumer').issues,...r2(t,'consumer','CONSUMER').issues].map(i=>t+' → '+i.ruleId));
check(`15c: ${R2_CONSUMER_NONE.length} consumer sentences from review round 2 raise 0 issues with no facts and with a full franchise ledger`+(consumerR2.length?' '+JSON.stringify(consumerR2):''),R2_CONSUMER_NONE.length===62&&same(consumerR2,[]));
check('15c: the same consumer sentences as one caption also raise 0 issues',r2(R2_CONSUMER_NONE.join('\n'),'consumer').issues.length===0&&r2(R2_CONSUMER_NONE.join('\n'),'consumer','CONSUMER').issues.length===0);
check('15c: a product or promo percentage next to 점주 추천·AI 모델 stays a warning (no H9 escalation)',R2_CONSUMER_WARN.length===3&&R2_CONSUMER_WARN.every(t=>[undefined,'CONSUMER'].every(L=>{const j=r2(t,'consumer',L);return j.issues.length>0&&!j.blocked&&j.issues.every(i=>i.tier==='warn'&&!i.escalatedBy)})));
let r2detected=0;
for(const [id,list] of Object.entries(R2_BYPASS))for(const t of list)check(`15c: ${id} detects ${JSON.stringify(t)} (${R2_HARD.has(id)?'hard_block':'block'})`,r2(t,'recruitment').issues.some(i=>i.ruleId===id&&i.tier===(R2_HARD.has(id)?'hard_block':'block'))&&++r2detected>0);
const legitR2=Object.entries(R2_LEGIT).flatMap(([L,list])=>list.flatMap(t=>r2(t,'recruitment',L).issues.map(i=>`${L}: ${t} → ${i.ruleId}`)));
check(`15c: ${Object.values(R2_LEGIT).flat().length} accurate recruitment statements raise 0 issues with their confirmed ledgers`+(legitR2.length?' '+JSON.stringify(legitR2):''),Object.values(R2_LEGIT).flat().length===56&&same(legitR2,[]));
const r2Value=([t,scope,L,kind,id])=>{const j=r2(t,scope,L),has=tier=>j.issues.some(i=>i.ruleId===id&&i.tier===tier);return kind==='hard'?has('hard_block'):kind==='block'?has('block'):kind==='blockOnly'?has('block')&&!j.hardBlocked:kind==='noH6'?!j.issues.some(i=>i.ruleId==='h.revenue_figures_no_ad')&&!j.blocked:!j.blocked};
const r2ValueBad=R2_VALUE.filter(v=>!r2Value(v)).map(v=>v[0]);
check(`15c: ${R2_VALUE.length} value cases (store count qualifiers·dates·classes, cost windows·types·details·range·VAT·per-3.3㎡, revenue numerals, consumer notices) judge as confirmed`+(r2ValueBad.length?' '+JSON.stringify(r2ValueBad):''),R2_VALUE.length===59&&r2ValueBad.length===0);
check('15c: 319 confirmed round-2 sentences are covered',R2_CONSUMER_NONE.length+R2_CONSUMER_WARN.length+r2detected+Object.values(R2_LEGIT).flat().length+R2_VALUE.length===319);

// ════ 15d) R2 3차 재검토(합성): 소비자 범위 모집 문구 게이트, 글자 사이 구분 기호, 현실적인 모집 우회 표현, 모집 범위 안전망 ════
// 소비자 캡션은 가맹 모집 문구가 있을 때만 막는다. 재검토 소비자 프로브(376문장)에서 이전에 차단(block·hard_block)이던 65문장과 이전 등급(원장 없음·소비자 원장, H·B·W·-)이다.
// 모집 우회 표현은 재검토 모집 프로브(120건) 가운데 이번에 고친 104건이다(규칙별). 나머지 16건은 승인자 확인에 맡긴다(lib/franchise-rules.ts FRANCHISE_REVIEW_NET 주석).
const R3_CONSUMER=[["매장 매출 1등 도넛 2,500원에 만나보세요","HH"],["블프 마진 0원 특가 🔥 도넛 6개 박스 7,900원","HH"],["사장님이 미쳤어요! 사장님 수익 0원 특가 도넛 박스","HH"],["앱 로열티 무료 가입하고 웰컴 쿠폰 받으세요","BB"],["골드 로열티 매월 5% 추가 적립 혜택","BB"],["전월 실적 무관 15% 캐시백, 제휴 카드로 결제하세요","-H"],["선불 충전금은 원금 100% 보장, 잔액은 언제든 환불돼요","HH"],["구독 회원은 매월 10% 확정 할인!","HH"],["모바일 상품권 발행액은 보증보험으로 지급 보증됩니다","HH"],["천만 영화 개봉 기념 팝콘맛 도넛 출시 🍿","-H"],["추석 맞이 총 1,000만원 쏜다! 앱 스탬프 이벤트","-H"],["천만다행으로 비가 그쳐 오늘 야외 플리마켓 정상 진행해요 ☀\uFE0F","-H"],["오픈 첫 주문 No.1 고객님께 1년 무료 쿠폰을 드립니다","BB"],["오픈 기념 한정 굿즈 우선 배정권 증정 (선착순 100명)","HH"],["창업 30주년 기념 케이크, 예약금을 미리 받습니다","HH"],["오픈 기념 케이크 우선 예약, 예약금을 미리 입금해 주세요","HH"],["오픈 첫날 매장 자리 예약 시 예약금 1만원은 음식값에서 차감돼요","HH"],["오픈 첫 주 단체석은 선입금 확인 후 자리를 확보해 드려요","HH"],["크리스마스 D-14 🎄 14일 기다리지 않고 오픈 즉시 예약하세요","HH"],["점주 협의회가 준비한 나눔 장터, 참여 조건은 장바구니 지참!","HH"],["Skip the wait — sign in and order ahead 🍩","HH"],["Daily sales: 20% off all donuts after 8pm","HH"],["추석 당일에는 총 6개 매장만 문을 엽니다","BB"],["현재 5개 매장만 영업 중이에요 (명절 당일)","BB"],["드디어 3개 매장에서도 크리스마스 케이크 예약 오픈","BB"],["드디어 2호점 오픈합니다! 이번엔 판교에서 만나요","BW"],["새 매장 계약 후 바로 오픈 준비 중이에요, 12월에 만나요","HH"],["브런치 메뉴는 3개 매장에서 운영 중이에요","BB"],["직영점 2곳은 24시간 운영해요","BB"],["연휴 기간에도 매장 5곳이 영업 중이에요","BB"],["가맹점 3곳에서 새벽 배송을 시작해요","BB"],["2개 지점에서 운영하는 루프탑 테라스, 날씨 좋은 날 놀러 오세요","BB"],["인테리어 비용 1억, 새로워진 성수점을 만나보세요","BB"],["다회용컵 회수 기간: 2주 (미반납 시 보증금 차감)","HH"],["제휴 카드 페이백 기간은 1개월 이내예요","HH"],["돌잔치 답례품 상담 후 일주일 내 계약 시 포장 무료 (본사 공식몰)","HH"],["지난달 나눔 바자회 순수익 320만원, 전액 지역아동센터에 기부했습니다","HH"],["약속된 수익금 전액을 아동센터에 전달했어요 💛","HH"],["판매 수익금은 전액 약속드린 대로 푸드뱅크에 전달했습니다","HH"],["소상공인 상권 보호 주간, 동네 가게 스탬프 투어에 함께해요","BB"],["지역 마라톤 대회 급수대에 음료와 장비 지원했어요","BB"],["기초생활수급 가구·월 소득 200만원 이하 가구는 음료 20% 할인","HH"],["점주 이야기: 매장 옆 300m 거리 텃밭에서 키운 허브로 만든 에이드","BB"],["덕분에 우리 매장 매출이 2배로 늘었어요, 감사 이벤트 준비했어요!","HH"],["AI 모델 ‘도리’와 함께하는 5km 도넛런 챌린지","BB"],["리뷰 답글: 천만에요! 또 놀러 오세요 😊","-H"],["알바 구해요! 사장이 약속해요, 월급 꼭 책임집니다","HH"],["홈카페 머신 렌탈, 초기 비용 부담 없이 시작하세요","BB"],["법인 선물 계정 개설 비용 0원, 대량 주문 할인","BB"],["원데이 마카롱 클래스 신규 개설, 교육비 3만원","BB"],["라떼아트 교실 교육비 무료, 강사는 10년 차 점주님","BB"],["커피 구독 본전 뽑는 기간? 딱 2주!","HH"],["매일 한 잔이면 2주 만에 본전 뽑는 커피 구독권","HH"],["카드 매출전표 기준 3만원 이상 결제 시 에코백 증정","HH"],["영업시간 내내 15% 캐시백, 오늘 하루만!","-H"],["안심하세요! 전 매장 식품 피해보상보험 가입","HH"],["고객 디자인 등록 수 1,000건 돌파! 투표로 신메뉴를 골라 주세요","B-"],["오픈 기념, 대기 없이 대관 계약 가능한 파티룸","HH"],["Flash sales ₩990 · 아이스 아메리카노 오늘만","HH"],["전국 150개 매장에서 동시 진행 🎉","BW"],["[사실: 가맹점 수·직영점 수 2025-12-31 기준] 가맹점 142개, 직영점 8개에서 만나요","B-"],["드디어 100호점 시대! 감사 이벤트 진행합니다","BW"],["특허받은 저온 숙성 반죽으로 더 쫀득하게","B-"],["국내 최초 흑당 크림 도넛 출시","BB"],["우리 동네 넘버원 도넛, 오늘도 맛있게 구웠어요","BB"]];
const R3_BYPASS={"kr.fr.revenue_guarantee":["수익·보장 가맹 브랜드","매출・보장 창업 아이템","수익ㅡ보장 창업 문의","수익\u3164보장 가맹점 모집","수\u034F익 보장 가맹 브랜드","수익 保障 창업 아이템","월 500 보장 창업 브랜드","월 천 보장, 가맹 상담 환영","수익 담보 가맹 브랜드","최저수익 책임제 운영 가맹본부","매출 안 나오면 본사가 메꿔드립니다","손해 보시면 본사가 전부 물어드립니다, 가맹점 모집","수익 안 나면 가맹비 전액 환불해 드립니다","수익 — 보장 창업 브랜드","Your profit, guaranteed. 가맹 문의","매출 확약 가맹 브랜드","월 500만원 수익, 보장합니다","월 순수익 걱정 끝.\n본사가 보장합니다.","수\n익\n보\n장\n가맹 모집","수익을 본사가 끝까지 책임지고 보장합니다","매출은 저희 본사가 확실하게 보장합니다"],"h.net_profit_payback_claims":["월 600만원 순수익 달성 가맹점","한 달에 700만원 버는 점주님들","점주님들 월 700 가져가십니다","월 순수익 5백 이상","월 순수입 600만원 가맹점","실수령 월 650만원, 점주 모집","평균 수익 월 600만원 가맹점","1년이면 본전입니다, 가맹 문의","창업비 1년이면 빠져요","BEP 4개월 달성 매장 다수","투자 대비 250% 수익","R0I 250%","월 순수익 500萬원","6개월 컷! 투자금 회수","회수까지 딱 8개월, 창업비용 부담 끝","석 달 만에 투자금 회수","월 순수익 5,000,000","월 순수익(인건비·임대료 제외 기준) 550만원","월 순수익\n\n500만원"],"h.revenue_figures_no_ad":["월 5천만원 매출 올리는 가맹점","월 매상 4천만원 가맹점","하루 판매액 200만원 직영점","일매출 300 찍는 매장","月매출 5千만원","Store sales: 50,000,000 KRW/month","1억 매출 신화 가맹점","월 매출 42,000,000","월 매출(2025년 가맹점 평균) 4,200만원"],"h.wait_bypass_solicitation":["가맹 착수금 100만원 먼저 받습니다","가맹 신청금 50만원 입금 순으로 희망 지역 배정","선계약 먼저, 정보공개서는 나중에 드립니다","약식 계약으로 자리부터 잡으세요 (창업 상담)","사전 계약금 50만원만 받고 상권 킵해 드립니다","LOI 제출 시 예치금 200만원, 지역 우선권 부여","정보공개서는 계약 후에 드려요, 오늘 바로 사인하세요","오늘 상담, 오늘 계약!","당일 계약 시 가맹비 50% 할인","사흘 만에 가맹 계약 완료","당장 계약 가능한 창업 브랜드","대기 0일! 가맹 계약","No waiting, 가맹 계약 즉시","14일? 저희는 그런 거 없습니다, 바로 도장 찍으세요","숙려 기간 패스하고 계약","입점 보장금 50만원"],"kr.fr.insurance_mark":["가맹금 전액 보장 제도","가맹금 보증 제도 운영","안전 가맹비 시스템","피해보상 공제 가입 본부","Franchise fee protection program 가입 본부","가맹금 걱정 제로","가맹금 지급보증 가입"],"kr.fr.association_condition":["협의회 가입 시 재계약 불가","점주협의회 결성 시 재계약 없음","사업자단체 가입 점주는 지원 대상에서 빠집니다","점주회 가입 금지가 계약 조건"],"h.captive_advisor_phrase":["7일 계약 패키지 (본사 지정 자문)","1주 만에 가맹 계약","본사가 자문료 대드리는 가맹거래사로 7일 단축","본사 협력사 가맹거래사 무료 매칭, 일주일 계약"],"kr.fr.store_count_claims":["전국 100여 매장 운영","200호점 오픈 임박","매장 150개 넘은 브랜드"],"kr.fr.startup_cost_claims":["3천으로 창업 가능","오픈 비용 3,500만원","창업 예산 3천만원대면 충분","투자금 4천만원이면 내 가게 오픈"],"kr.fr.ip_claims":["특허청 등록 반죽 기술","특허 획득 도우","特許 받은 레시피"],"kr.fr.conditional_support":["간판·집기 무상 제공","오픈 지원금 1천만원 드립니다"],"kr.fr.superlative_claims":["업계 1등 도넛 창업","TOP 1 도넛 프랜차이즈","국내 첫 번째 도넛 프랜차이즈"],"kr.fr.production_claims":["자가 공장 생산 도우","자사 공장에서 만든 크림"],"kr.fr.exclusive_channel_claims":["가맹 전용 메뉴 공급"],"h.exclusive_supply_claims":["원료는 본사만 공급합니다"],"h.direct_store_popularity":["직영점 하루 1,000개 판매","직영점 대기 2시간은 기본"],"h.zero_cost_claims":["로열티 0%","가맹비 ₩0"],"h.handmade_claims":["손수 빚은 도넛 가맹점"]};
const TIER_CODE={hard_block:'H',block:'B',warn:'W'},topCode=j=>j.issues.reduce((a,i)=>'-WBH'.indexOf(TIER_CODE[i.tier])>'-WBH'.indexOf(a)?TIER_CODE[i.tier]:a,'-');
const R3_LEDGERS=[undefined,'CONSUMER'];
const r3Plain=R3_CONSUMER.flatMap(([t,want])=>R3_LEDGERS.flatMap((L,k)=>{const j=r2(t,'consumer',L),was='HB'.includes(want[k]);return j.blocked||j.recruitmentContext||!j.issues.every(i=>i.tier==='warn')||was&&!j.issues.some(i=>i.downgradedBy==='consumer_no_recruitment_context'&&i.downgradedFrom===(want[k]==='H'?'hard_block':'block'))?[t+' ('+(L??'none')+')']:[]}));
check(`15d: ${R3_CONSUMER.length} consumer sentences that were blocked in re-probe are warnings only without recruitment wording (downgraded, never block)`+(r3Plain.length?' '+JSON.stringify(r3Plain):''),R3_CONSUMER.length===65&&r3Plain.length===0);
const r3Ctx=R3_CONSUMER.flatMap(([t,want])=>R3_LEDGERS.flatMap((L,k)=>{const got=topCode(r2(t+RC,'consumer',L));return got===want[k]?[]:[`${t} (${L??'none'}) ${want[k]}→${got}`]}));
check('15d: the same sentences with a recruitment line (가맹 문의 환영) keep their previous tiers'+(r3Ctx.length?' '+JSON.stringify(r3Ctx):''),r3Ctx.length===0);
check('15d: the 65 sentences as one caption without recruitment wording do not block',!r2(R3_CONSUMER.map(x=>x[0]).join('\n'),'consumer').blocked&&!r2(R3_CONSUMER.map(x=>x[0]).join('\n'),'consumer','CONSUMER').blocked);
const G3='월 순수익 500만원 보장';
check('15d: loose words (본사, 창업 N주년, 점포, 가맹점 쿠폰, 교육비) are not recruitment wording',['본사 아카데미 소식','창업 30주년 기념','점포 리뉴얼 안내','전국 가맹점에서 사용 가능한 쿠폰','바리스타 교육비 무료'].every(p=>{const j=judge(p+'\n'+G3,{scope:'consumer'});return !j.blocked&&!j.recruitmentContext&&j.issues.some(i=>i.downgradedFrom==='hard_block')}));
check('15d: strict recruitment wording turns the consumer gate back on (hard_block stays unremovable)',['가맹 상담 환영','가맹점 모집','창업 설명회 안내','예비 창업자 모십니다','가맹비 550만원','창업비용 문의','점주 모집','가.맹.문.의 환영'].every(p=>{const j=judge(p+'\n'+G3,{scope:'consumer'});return j.hardBlocked&&j.recruitmentContext&&!j.issues.some(i=>i.downgradedBy)}));
const down=judge(G3,{scope:'consumer'}),downSc=judge('전국 20개 매장',{scope:'consumer',facts:[count(12)]}).issues.find(i=>i.ruleId===SC);
check('15d: a downgraded issue keeps its rule, reason and original tier; the recruitment scope is unchanged',down.issues.find(i=>i.ruleId==='kr.fr.revenue_guarantee')?.downgradedFrom==='hard_block'&&downSc.tier==='warn'&&downSc.reason==='value_mismatch'&&downSc.downgradedFrom==='block'&&judge(G3).hardBlocked&&judge(G3).recruitmentContext&&!judge(G3).issues.some(i=>i.downgradedBy));
const downLabels=jc.franchiseIssueLabels(down);
check('15d: downgraded issues are approval-screen warnings with a short Korean reason, and no 409',jc.franchiseGateError(down)===null&&downLabels.blockers.length===0&&downLabels.warnings.some(w=>w.startsWith('가맹 규칙 확인 · 수익·매출 보장 표현(모집 문구 없는 소비자 캡션이라 경고, 모집 문구가 있으면 해제 불가 차단)')));
check('15d: H9 does not escalate a consumer caption without recruitment wording',(()=>{const j=judge('독점 상권 3km 보장\n안내',{scope:'consumer'});return !j.blocked&&j.issues.every(i=>!i.escalatedBy)})());
// 글자 사이 구분 기호·한자·세로쓰기(모집 범위, 사실 없음).
const SEPARATED=['수익‧보장 가맹 브랜드','수익–보장 창업 문의','수익 / 보장 가맹 모집','수익\u115F보장 가맹점 모집','매출 保證 가맹 브랜드','수\n익\n보\n장','매 출\n보 장','월 순수익\n\n500만원','수·익·보·장 창업','월 순수익(인건비·임대료·카드 수수료 제외 기준) 550만원'];
check('15d: separators inside words (middle dots, dashes, slashes, fillers, marks), Hanja and vertical runs read as the plain claim',SEPARATED.every(t=>judge(t).hardBlocked));
check('15d: list dots and parenthetical notes stay clause boundaries for negation and legit statements',['수익·매출 보장 표현은 쓰지 않습니다','가맹비·교육비·가맹 보증금은 정보공개서로 안내합니다','가맹금(예치 약정) 반환 절차를 안내합니다'].every(t=>!judge(t).hardBlocked));
let r3detected=0;
for(const [id,list] of Object.entries(R3_BYPASS))for(const t of list)check(`15d: ${id} detects ${JSON.stringify(t)} (${R2_HARD.has(id)?'hard_block':'block'})`,r2(t,'recruitment').issues.some(i=>i.ruleId===id&&i.tier===(R2_HARD.has(id)?'hard_block':'block'))&&++r3detected>0);
const R3_MORE={'kr.fr.revenue_guarantee':['장사 안 되면 본사가 책임집니다','매장 손실 나면 본사가 보전해 드립니다','수익 안 나오면 투자금 돌려 드립니다','매출은 우리 본사가 끝까지 책임지고 보장합니다'],'h.net_profit_payback_claims':['한 달 반이면 투자금 회수','넉 달 만에 본전','투자금 대비 월 3% 수익','월 1,000만원 이상 버는 점주님','매달 천 가져가세요']};
for(const [id,list] of Object.entries(R3_MORE))for(const t of list)check(`15d: ${id} detects ${JSON.stringify(t)} (hard_block)`,judge(t).issues.some(i=>i.ruleId===id&&i.tier==='hard_block')&&++r3detected>0);
check('15d: new revenue forms keep their negation and franchise anchors (no hard_block)',['수익이 안 나면 원인을 함께 찾습니다','매출이 안 나오면 본사가 보상하지 않습니다','직원 채용, 실수령 월 280만원','다회용컵 회수까지 2주','가맹 계약 후 교육은 3일 만에 끝납니다','오늘 가맹 계약서안을 드립니다','정보공개서 수령 확인서에 바로 서명해 주세요'].every(t=>!judge(t).hardBlocked));
// 모집 범위 안전망: 어느 규칙도 잡지 않은 수익 낱말 곁 금액·비율은 경고(H6 부모, COLLECTIVE 휴리스틱)로 승인자에게 보인다.
const NET='h.revenue_like_figure_review',net=t=>judge(t).issues.filter(i=>i.ruleId===NET);
const netOne=net('매출 대비 남는 돈 35%')[0];
check('15d: the safety net warns on a revenue-like figure no rule caught (registry H6 parent, heuristic, reason review)',netOne?.tier==='warn'&&netOne.reason==='review'&&netOne.registryId==='h.revenue_figures_no_ad'&&netOne.basis==='heuristic'&&netOne.basisLabel===DISCLAIMER&&!judge('매출 대비 남는 돈 35%').blocked&&net('월 매출 4200 (단위: 만원)').length===1&&net('점주님 월 수익 대박, 평균 순익 420')[0]?.tier==='warn');
check('15d: the safety net stays a warning on the first line, is at most one issue, and skips caught sentences',(()=>{const j=judge('매출 대비 남는 돈 35%\n마진 40퍼 남는 구조');return j.issues.filter(i=>i.ruleId===NET).length===1&&!j.blocked&&!j.issues.some(i=>i.escalatedBy)})()&&!net('월 순수익 600만원').length&&net('매출 대비 남는 돈 35%'+RC).length===1);
check('15d: the safety net is recruitment scope only and skips cost, fee-share, giveaway and discount clauses',!judge('매출 대비 남는 돈 35%'+RC,{scope:'consumer'}).issues.some(i=>i.ruleId===NET)&&['광고분담금은 매출액의 1%입니다.','카드 수수료는 매출의 2%입니다','매출의 10%를 기부합니다','매출 감사 이벤트 20% 할인','로열티: 월 매출액의 3%(부가세 별도)'].every(t=>!net(t).length));

// ════ 16~22) 게이트(라우트) ════
const WS='fc-owner';
const boss=f.signIn('fc-boss','admin',1000,WS),admin=f.signIn('fc-admin','admin',2000,WS),member=f.signIn('fc-member','member',3000,WS);
const F='fc-f',G='fc-g',N='fc-n',B='fc-b',S='fc-s',H='fc-h';
for(const b of [F,G,N,B,S,H])await f.brand(WS,b);
const factsRoute=await f.load('app/api/brand-facts/route.ts'),execRoute=await f.load('app/api/execution/route.ts');
const headersOf=s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='id'));
const clearRate=()=>sql.prepare("DELETE FROM records WHERE kind='execution_rate'").run();
const responses=[];
async function call(res){const body=await res.json();responses.push(body);return {status:res.status,body}}
const factPost=async(s,input)=>{clearRate();return call(await factsRoute.POST(new Request('https://agency.test/api/brand-facts',{method:'POST',headers:{'content-type':'application/json',...headersOf(s)},body:JSON.stringify(input)})))};
const execPost=async(s,input)=>{clearRate();return call(await execRoute.POST(new Request('https://agency.test/api/execution',{method:'POST',headers:{'content-type':'application/json',...headersOf(s)},body:JSON.stringify(input)})))};
const execGet=async(s,id)=>call(await execRoute.GET(new Request('https://agency.test/api/execution?campaignId='+id,{headers:headersOf(s)})));
const LABEL='가상 보관함';
assert.equal((await f.setFlag(boss,true)).status,200);
const profile=(brandId,over={})=>f.profile(boss,brandId,{forecastInputs:{sme:true,storesAtFyEnd:3,fiscalYearEnd:'2025-12-31'},storageLabels:[LABEL],...over},0);
const register=async(brandId,label,seedText,meta)=>{const r=await f.post(boss,{action:'register_disclosure_version',brandId,label,sha256:sha64(seedText),storageLabel:LABEL,...meta});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result.id};
const V1META={registeredAt:'2026-03-15T10:00:00+09:00',validFrom:'2026-03-15',validUntil:'2027-06-30'};
for(const b of [F,S])assert.equal((await profile(b)).status,200);
assert.equal((await profile(B,{branch:'B'})).status,200);
const vF=await register(F,'가상 정보공개서 2026','fc dvF',V1META),vS=await register(S,'가상 교체 전본','fc dvS1',V1META);
const VERIFIED='2026-09-25T10:00:00+09:00',UNTIL_Y='2027-04-01T00:00:00+09:00';
const save=(s,d)=>factPost(s,{action:'save_fact',data:d,confirmed:d.status==='confirmed'});
const confirmed=(brandId,key,value,extra={})=>save(boss,{brandId,key,value,status:'confirmed',source:'가상 근거',verifiedAt:VERIFIED,validUntil:UNTIL_Y,...extra});
const campaign=async(id,brandId,title='가상 도넛 가을')=>{const c={id,brandId,title,goal:'가을 신메뉴 알리기',audience:'동네 주민',channels:'인스타그램',version:1,status:'approved',startDate:'2026-09-01',endDate:'2026-12-31',budget:0,budgetConfirmedAt:'2026-09-01T00:00:00.000Z'};await server.recordStatement(WS,'campaign',id,c).run();
 if(!await server.readRecord(WS,'publisher_credential',brandId).catch(()=>null))await server.recordStatement(WS,'publisher_credential',brandId,{secret:await server.encrypt('synthetic-buffer-token'),channelId:'channel-1',account:'가상 계정',organizationId:'org',version:1},brandId).run();
 const l=await execPost(boss,{action:'save_limits',campaignId:id,maxPublications:20,maxPlannedCostKRW:0});assert.equal(l.status,200);return {...c,limitsVersion:l.body.version}};
let fill=1;
const creative=(c,refs)=>execPost(boss,{action:'save_creative',campaignId:c.id,campaignVersion:1,factRefs:refs.map(x=>({id:x.id,version:x.version})),png:PNG});
const uniqueCreative=(c,refs)=>execPost(boss,{action:'save_creative',campaignId:c.id,campaignVersion:1,factRefs:refs.map(x=>({id:x.id,version:x.version})),png:pngOf(fill++)});
let minute=0;
const publication=(c,creativeId,extra={})=>execPost(boss,{action:'save_publication',campaignId:c.id,creativeId,scheduledAt:new Date(Date.parse('2026-10-15T01:00:00.000Z')+(minute++)*60000).toISOString(),plannedCostKRW:0,...extra});
const approve=(c,p,s=boss,extra={})=>execPost(s,{action:'approve',campaignId:c.id,id:p.id,version:p.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:1,limitsVersion:c.limitsVersion,...extra});

// 16) 비가맹 브랜드의 '월 순수익 500만원 보장 이벤트, 가맹 문의 환영' 소재·초안 → 가맹 프로필 저장 → 대표·관리자 승인 409
// 소비자 캠페인 캡션은 가맹 모집 문구('가맹 문의 환영')가 있을 때만 막힌다. 모집 문구가 없는 같은 표현은 승인 화면 경고만 보이고 승인된다(아래 16b).
const CG=await campaign('fc-camp-g',G);
const promo=await confirmed(G,'promotion','월 순수익 500만원 보장 이벤트, 가맹 문의 환영');
const cardG=await creative(CG,[promo.body]),pubG=await publication(CG,cardG.body.id);
check('16: before any franchise profile the consumer card and draft save (200)',promo.status===200&&cardG.status===200&&pubG.status===200&&pubG.body.status==='draft');
// 검토 반영: 뒤에 비용 주석·권유·환불 불가를 붙여도 해제 불가 표현이다. 가맹 프로필 저장 전에 만든 초안이 프로필 뒤 대표 승인에서 409인지 본다.
const SUFFIXED_ROUTE=['월 순수익 500만원 보장, 인건비 제외','월 순수익 500만원 보장, 걱정하지 마세요','가계약금 100만원, 환불 불가'],suffixedG=[];
for(const [k,t] of SUFFIXED_ROUTE.entries()){const fx=await confirmed(G,'가상 행사 문구 '+(k+1),t+' · 가맹 문의 환영'),card=await uniqueCreative(CG,[fx.body]),pub=await publication(CG,card.body.id);suffixedG.push({fx,card,pub})}
check('16: the suffixed drafts save before the franchise profile (200)',suffixedG.every(x=>x.fx.status===200&&x.card.status===200&&x.pub.status===200));
const plainFx=await confirmed(G,'가상 행사 문구 0','월 순수익 500만원 보장 이벤트'),plainCard=await uniqueCreative(CG,[plainFx.body]),plainPub=await publication(CG,plainCard.body.id);
check('16b: the same wording without recruitment wording saves as a draft before the profile (200)',plainFx.status===200&&plainCard.status===200&&plainPub.status===200);
assert.equal((await profile(G)).status,200);
const bossTry=await approve(CG,pubG.body,boss,{override:true,hardBlockRelease:true,release:['kr.fr.revenue_guarantee']});
check('16: the owner (CEO) approving with every confirmation and release-looking fields is still 409',bossTry.status===409&&bossTry.body.error.includes('승인으로 풀 수 없음')&&bossTry.body.error.includes('월 순수익 500만원 보장'));
const adminTry=await approve(CG,pubG.body,admin);
check('16: an admin approval is also 409 and the publication stays a draft',adminTry.status===409&&adminTry.body.error===bossTry.body.error&&(await server.readRecord(WS,'execution_publication',pubG.body.id)).status==='draft');
check('16: member approval stays 403',(await approve(CG,pubG.body,member)).status===403);
const suffixedTries=[];for(const x of suffixedG)suffixedTries.push(await approve(CG,x.pub.body,boss,{override:true}));
check('16: the owner approving a suffixed claim (, 인건비 제외 · , 걱정하지 마세요 · , 환불 불가) is still 409 and unremovable',suffixedTries.every((t,k)=>t.status===409&&t.body.error.includes('승인으로 풀 수 없음')&&t.body.error.includes(SUFFIXED_ROUTE[k].split(',')[0])));
const stateG=await execGet(boss,CG.id),blockersG=stateG.body.franchise?.publications?.[pubG.body.id]?.blockers??[];
check('16: getExecution shows the same unremovable items as approval blockers',blockersG.length>=2&&blockersG.every(b=>b.startsWith('가맹 규칙(해제 불가) · ')||b.startsWith('가맹 규칙 · '))&&blockersG.filter(b=>b.startsWith('가맹 규칙(해제 불가)')).every(b=>bossTry.body.error.includes(b.slice('가맹 규칙(해제 불가) · '.length))));
check('16: the screen blockers include the franchise items (approvalBlockers)',exec.approvalBlockers({campaign:CG,publication:pubG.body,state:stateG.body,factCount:1,rightsConfirmed:true,franchise:stateG.body.franchise.publications[pubG.body.id]}).some(b=>b.startsWith('가맹 규칙(해제 불가)')));
const plainState=stateG.body.franchise.publications[plainPub.body.id];
check('16b: without recruitment wording the consumer caption shows the franchise items as warnings only (no blocker)',plainState.blockers.length===0&&plainState.warnings.length>=2&&plainState.warnings.every(w=>w.startsWith('가맹 규칙 확인 · '))&&plainState.warnings.some(w=>w.includes('월 순수익 500만원 보장')&&w.includes('모집 문구 없는 소비자 캡션이라 경고, 모집 문구가 있으면 해제 불가 차단')));
const plainApproved=await approve(CG,plainPub.body);
check('16b: the owner approves it (200): the approver is the last check',plainApproved.status===200&&plainApproved.body.status==='approved');

// 17) 가맹 브랜드 소재: 매장 수 카드 각주·멱등, 수익 카드 409, 근거 없는 옛 가맹비 409, 교체 버전 카드 409
const CF=await campaign('fc-camp-f',F);
const refF=(over={})=>({disclosureVersionId:vF,fiscalYear:2025,page:7,...over});
const sc=await confirmed(F,'franchise_store_count','12개',{sourceRef:refF({asOf:'2025-12-31'})});assert.equal(sc.status,200,JSON.stringify(sc.body));
const menu=await confirmed(F,'signature_menu','매일 직접 굽는 수제 도넛');
const revenue=await confirmed(F,'monthly_sales','월 4,200만원',{sourceRef:refF()});
await server.recordStatement(WS,'brand_fact','fc-legacy',{id:'fc-legacy',brandId:F,key:'가맹비',value:'870만원',status:'confirmed',source:'옛 기록',verifiedAt:'2026-09-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z',version:1,updatedAt:'2026-09-01T00:00:00.000Z'},F).run();
const NOTE_F='※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-25';
const cardCount=await creative(CF,[sc.body]);
check('17: a store count card carries the fact line and the footnote, the same request is idempotent',cardCount.status===200&&cardCount.body.caption==='가맹점 수 (2025-12-31 기준): 12개\n'+NOTE_F&&(await creative(CF,[sc.body])).body.id===cardCount.body.id);
check('17: a revenue fact card is 409 (H6)',(await creative(CF,[revenue.body])).body.error===MSG.revenueNoAd);
check('17: an old free-key 가맹비 card without source is 409',(await creative(CF,[{id:'fc-legacy',version:1}])).body.error===MSG.sourceMissingInUse);
const CS=await campaign('fc-camp-s',S);
const scS=await confirmed(S,'franchise_store_count','10개',{sourceRef:{disclosureVersionId:vS,fiscalYear:2025,page:7,asOf:'2025-12-31'}});
await register(S,'가상 교체 후본','fc dvS2',{registeredAt:'2026-09-20T10:00:00+09:00',validFrom:'2026-09-01',validUntil:'2027-09-30'});
check('17: after the version is superseded its fact card is 409 (staleFact)',(await creative(CS,[scS.body])).body.error===MSG.staleFact);

// 18) 각주 삭제
const pubCount=await publication(CF,cardCount.body.id);
check('18: the count card draft saves with the footnote',pubCount.status===200&&pubCount.body.caption.endsWith(NOTE_F));
const setCaption=(kind,id,text)=>sql.prepare("UPDATE records SET data=json_set(data,'$.caption',?) WHERE kind=? AND json_extract(data,'$.id')=?").run(text,kind,id);
const strip=t=>t.split('\n').filter(l=>!l.startsWith('※ 정보공개서')).join('\n');
setCaption('execution_publication',pubCount.body.id,strip(pubCount.body.caption));
check('18: stripping the publication row only hits the existing material-changed 409 first',(await approve(CF,pubCount.body)).body.error==='소재가 변경됐습니다. 다시 준비하세요.');
setCaption('execution_creative',cardCount.body.id,strip(cardCount.body.caption));
let r=await approve(CF,pubCount.body);
check('18: stripping both rows is 409 footnoteMissing at approval',r.status===409&&r.body.error===MSG.footnoteMissing);
const stripped=await execGet(boss,CF.id);
check('18: the screen shows the footnote blocker for that draft',stripped.body.franchise.publications[pubCount.body.id].blockers.includes(MSG.footnoteMissing));
setCaption('execution_creative',cardCount.body.id,cardCount.body.caption);setCaption('execution_publication',pubCount.body.id,pubCount.body.caption);
r=await approve(CF,pubCount.body);
check('18: the intact caption approves (200)',r.status===200&&r.body.status==='approved');

// 19) AI 카피 캡션(AI_COPY_CAPTIONS)
await server.recordStatement(WS,'artifact','fc-copy',{id:'fc-copy',campaignId:CF.id,campaignVersion:1,role:'content',title:'콘텐츠 스튜디오 · 가상',content:'## 게시 카피\n\n가맹 문의 환영! 전국 20개 매장에서 만나요\n\n전국 12개 매장에서 만나요\n\n전국 20개 매장에서 만나요',version:1,status:'approved',origin:'manual',createdAt:'2026-09-25T00:00:00.000Z'},CF.id).run();
const copy=index=>({artifactId:'fc-copy',artifactVersion:1,index});
r=await publication(CF,cardCount.body.id,{copy:copy(1)});
check('19: with AI_COPY_CAPTIONS off the decision-17 409 comes first',r.status===409&&r.body.error.includes('결정 17'));
env.AI_COPY_CAPTIONS='enabled';
const stateF=await execGet(boss,CF.id),c20=stateF.body.copies.find(c=>c.index===0),c12=stateF.body.copies.find(c=>c.index===1);
const c20plain=stateF.body.copies.find(c=>c.index===2);
check('19: the 전국 20개 candidate with recruitment wording lists a franchise issue, the 12 one only warnings',c20.issues.some(i=>i.startsWith('가맹 규칙 · 매장 수 주장(확정 사실 값과 다름)'))&&!c12.issues.length&&Array.isArray(c12.warnings)&&c12.warnings.some(w=>w.includes('H8')));
check('19: the same 전국 20개 candidate without recruitment wording is a warning, not an issue',!c20plain.issues.some(i=>i.includes('가맹'))&&c20plain.warnings.some(w=>w.startsWith('가맹 규칙 확인 · 매장 수 주장(확정 사실 값과 다름 · 모집 문구 없는 소비자 캡션이라 경고, 모집 문구가 있으면 차단)')));
r=await publication(CF,cardCount.body.id,{copy:copy(0)});
check('19: save_publication with the 20 copy is 409',r.status===409&&r.body.error.includes('매장 수 주장'));
const with12=await publication(CF,cardCount.body.id,{copy:copy(1)});
check('19: the 12 copy with the store count card saves (200) and keeps the footnote',with12.status===200&&with12.body.caption.startsWith('전국 12개 매장에서 만나요\n\n')&&with12.body.caption.endsWith(NOTE_F));
const plain20=await publication(CF,cardCount.body.id,{copy:copy(2)});
check('19: the 전국 20개 copy without recruitment wording saves (200, warning only)',plain20.status===200&&plain20.body.caption.startsWith('전국 20개 매장에서 만나요\n\n'));
const cardMenu=await uniqueCreative(CF,[menu.body]);
r=await publication(CF,cardMenu.body.id,{copy:copy(1)});
check('19: the 12 copy with a consumer card is 409 footnoteMissing',cardMenu.status===200&&r.status===409&&r.body.error===MSG.footnoteMissing);
env.AI_COPY_CAPTIONS='';

// 20·21) 소비자 사실 카드 승인, 모집 유사 경고(승인은 막지 않음)
const CR=await campaign('fc-camp-r',F,'가맹점 모집 설명회 안내');
const cardR=await creative(CR,[menu.body]),pubR=await publication(CR,cardR.body.id);
const stateR=await execGet(boss,CR.id);
check('21: a recruitment-looking title in a franchise brand shows the branch A warning',stateR.body.franchise.recruitmentWarning===jc.recruitmentWarning('A')&&stateR.body.franchise.recruitmentWarning.includes(DISCLAIMER)&&!stateR.body.franchise.recruitmentWarning.includes('H7'));
r=await approve(CR,pubR.body);
check('20: a consumer card (매일 직접 굽는 수제 도넛) publication approves (200) in the franchise brand',cardR.status===200&&cardR.body.caption==='대표 메뉴: 매일 직접 굽는 수제 도넛'&&r.status===200&&r.body.status==='approved');
check('21: the warning does not block approval and is not a blocker',stateR.body.franchise.publications[pubR.body.id].blockers.length===0);
// 검토 반영: 검토에서 가맹 브랜드 소비자 카드가 409였던 문구는 사실 카드로 저장된다(200). 매장 수 12 확정 사실이 있는 브랜드다.
const FP_ROUTE=['전 가맹 매장에서 당일 픽업 가능','로열티 고객 10% 할인 이벤트','신메뉴는 전국 5개 매장에서 한정 판매합니다','점주 추천 메뉴 6개 세트 12,000원','이번 달 판매 순수익의 10%를 동물보호단체에 기부합니다','크리스마스 케이크는 점포별 예약금 선납 후 픽업 가능합니다'],fpCards=[];
for(const [k,t] of FP_ROUTE.entries()){const fx=await confirmed(F,'가상 소비자 문구 '+(k+1),t);fpCards.push({t,fx,card:await uniqueCreative(CR,[fx.body])})}
check(`20: ${FP_ROUTE.length} consumer sentences that were 409 in review save as fact cards on the franchise brand (200)`,fpCards.every(x=>x.fx.status===200&&x.card.status===200&&x.card.body.caption.endsWith(x.t)));
// 즉시 실행(execute) 경로: 가맹 프로필 전 승인한 발행도 접수 전 판정에서 409이고 접수 시도를 남기지 않는다(reservePublication → approvalInputs).
const CH=await campaign('fc-camp-h',H),promoH=await confirmed(H,'promotion','월 순수익 500만원 보장 이벤트, 가맹 문의 환영');
const cardH=await creative(CH,[promoH.body]),pubH=await publication(CH,cardH.body.id),approvedH=await approve(CH,pubH.body);
check('27: a publication approved before the franchise profile exists is approved (200)',cardH.status===200&&pubH.status===200&&approvedH.status===200&&approvedH.body.status==='approved');
assert.equal((await profile(H)).status,200);
const executed=await execPost(boss,{action:'execute',campaignId:CH.id,id:approvedH.body.id,version:approvedH.body.version});
const rowH=await server.readRecord(WS,'execution_publication',approvedH.body.id);
check('27: execute after the profile is saved is 409 unremovable and records no attempt',executed.status===409&&executed.body.error.includes('승인으로 풀 수 없음')&&rowH.status==='approved'&&!rowH.attemptedAt);
check('27: the screen lists the unremovable items for the approved row',((await execGet(boss,CH.id)).body.franchise?.publications?.[approvedH.body.id]?.blockers??[]).some(b=>b.startsWith('가맹 규칙(해제 불가) · ')));
const CB=await campaign('fc-camp-b',B,'가맹점 모집 설명회 안내');
check('21: a branch B profile adds the H7 sentence',(await execGet(boss,CB.id)).body.franchise.recruitmentWarning.includes('분기 A가 아니면 유료 모집 광고·설명회·가맹 조건 제시를 하지 않습니다(H7).'));
const CN=await campaign('fc-camp-n',N,'가맹점 모집 설명회 안내');
const nState=await execGet(boss,CN.id);
check('21: a non-franchise brand with the same title has no franchise key',nState.status===200&&!('franchise' in nState.body));
check('state: the franchise block carries scope, versions, blocked facts and the notices',stateF.body.franchise.scope==='consumer'&&stateF.body.franchise.branch==='A'&&stateF.body.franchise.versions.some(v=>v.id===vF&&v.state==='current')&&stateF.body.franchise.blockedFacts.some(b=>b.id===revenue.body.id&&b.reason===MSG.revenueNoAd)&&stateF.body.franchise.blockedFacts.some(b=>b.id==='fc-legacy')&&stateF.body.franchise.notice===comp.COMPLIANCE_NOTICE&&stateF.body.franchise.disclaimer===DISCLAIMER);

// 22) 비가맹 불변
env.AI_COPY_CAPTIONS='enabled';
await server.recordStatement(WS,'artifact','fc-copy-n',{id:'fc-copy-n',campaignId:CN.id,campaignVersion:1,role:'content',title:'콘텐츠 스튜디오 · 가상',content:'## 게시 카피\n\n전국 20개 매장에서 만나요',version:1,status:'approved',origin:'manual',createdAt:'2026-09-25T00:00:00.000Z'},CN.id).run();
const nCopies=(await execGet(boss,CN.id)).body;
check('22: a non-franchise caption candidate has no warnings key and no franchise issue',nCopies.copies.length===1&&!('warnings' in nCopies.copies[0])&&same(Object.keys(nCopies.copies[0]),['artifactId','artifactVersion','index','text','issues','aiGenerated'])&&!nCopies.copies[0].issues.some(i=>i.includes('가맹'))&&!('franchise' in nCopies));
const nFact=await confirmed(N,'promotion','월 순수익 500만원 보장 이벤트, 가맹 문의 환영');
const nCard=await creative(CN,[nFact.body]),nPub=await publication(CN,nCard.body.id);
r=await approve(CN,nPub.body);
check('22: the same revenue-guarantee wording in a non-franchise brand approves as before (no franchise gate)',nCard.status===200&&nPub.status===200&&r.status===200);
// 25) 잠금 밖의 재검토 표시(정보공개서 버전 교체)가 접수 예약의 읽기와 쓰기 사이에 붙어도 접수 행 쓰기가 지우지 않는다. 읽은 스냅샷(표시 없음)으로 예약을 쓴다.
const es=await f.load('lib/execution-server.ts');
const flagged=await es.flagPublicationsForFactChange(server.database(),WS,[nFact.body.id]);
const reserved=await es.reservePublication(WS,await server.readRecord(WS,'campaign',CN.id),r.body,'https://agency.test');
const rowN=await server.readRecord(WS,'execution_publication',r.body.id);
check('25: a review flag written between the execute read and the reservation write survives (submitting row keeps needsReview)',flagged===1&&!r.body.needsReview&&!reserved.pending.needsReview&&rowN.status==='submitting'&&!!rowN.needsReview?.reason);
env.AI_COPY_CAPTIONS='';
const blockerArgs={campaign:CN,publication:{scheduledAt:'2026-10-15T01:00:00.000Z',creativeId:'c'},state:{creatives:[{id:'c',current:true}],limits:{version:1,maxPlannedCostKRW:0},publisher:{connected:true}},factCount:1,rightsConfirmed:false};
check('22: approvalBlockers without a franchise argument returns the previous array',same(exec.approvalBlockers(blockerArgs),exec.approvalBlockers({...blockerArgs,franchise:undefined}))&&same(exec.approvalBlockers(blockerArgs),exec.approvalBlockers({...blockerArgs,franchise:null}))&&same(exec.approvalBlockers({...blockerArgs,franchise:{blockers:['x']}}),[...exec.approvalBlockers(blockerArgs),'x']));
check('no external network call from the gate paths',f.calls.length===0);
check('route responses make no legal-adequacy claim',!FORBIDDEN.test(JSON.stringify(responses)));

// ════ 23) 모델 제출 바이트 동일 ════
// 같은 사실 id·버전으로 A(가맹 기록 없음, 사실에 근거·상세 없음)와 B(가맹 프로필·버전, 사실에 sourceRef·cost·기준일)를 만들고 역할·회의·브리프 제출 본문을 비교한다.
async function modelRun(franchiseSide){
 const hermes=mockHermes();
 const RealDate=Date,started=RealDate.now(),pinned=RealDate.parse('2026-03-15T09:00:00.000Z'),clock=()=>pinned+RealDate.now()-started;
 class PinnedDate extends RealDate{constructor(...a){super(...(a.length?a:[clock()]))}static now(){return clock()}}
 globalThis.Date=PinnedDate;let rt;try{rt=testRuntime(hermes.fetch)}finally{globalThis.Date=RealDate}
 const s=await rt.load('lib/server.ts'),execution=await rt.load('lib/role-execution.ts'),meeting=await rt.load('lib/meeting-execution.ts'),brief=await rt.load('lib/brief-execution.ts');
 const owner='fc-model-owner';
 const put=await seed(s,rt.sql,owner);
 const base=(id,key,value)=>({id,brandId:seedBrand.id,key,value,status:'confirmed',source:'합성 정보공개서',verifiedAt:seedNow,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:seedNow});
 const facts=[base('fc-model-fee','franchise_fee','870만원'),base('fc-model-count','franchise_store_count','12개')];
 if(franchiseSide){
  await put('franchise_profile',seedBrand.id,{id:seedBrand.id,brandId:seedBrand.id,branch:'A',forecastInputs:{sme:true,storesAtFyEnd:3,fiscalYearEnd:'2025-12-31'},holidays:null,storageLabels:[LABEL],eligibility:null,version:1,updatedAt:seedNow,updatedBy:{id:'x',role:'owner'}},seedBrand.id);
  await put('franchise_disclosure_version','dv-fc-model',{id:'dv-fc-model',brandId:seedBrand.id,label:'가상 정보공개서 모델본',sha256:sha64('fc model'),registeredAt:'2025-12-01T00:00:00.000Z',validFrom:'2025-12-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',storageLabel:LABEL,status:'active',version:1,createdAt:seedNow,createdBy:{id:'x',role:'owner'}},seedBrand.id);
  await put('brand_fact',facts[0].id,{...facts[0],sourceRef:{disclosureVersionId:'dv-fc-model',fiscalYear:2024,page:3},cost:{storeType:'테이크아웃형',includes:['가맹비'],excludes:['없음'],areaM2:null}},seedBrand.id);
  await put('brand_fact',facts[1].id,{...facts[1],sourceRef:{disclosureVersionId:'dv-fc-model',fiscalYear:2024,page:5,asOf:'2024-12-31'}},seedBrand.id);
 }else for(const x of facts)await put('brand_fact',x.id,x,seedBrand.id);
 for(const [i,x] of facts.entries())rt.sql.prepare('UPDATE records SET updated_at=? WHERE id=?').run(`2026-01-01T00:00:00.50${i}Z`,`${owner}:brand_fact:${x.id}`);
 await runRole(execution,s,owner,roleCampaign,'cmo');
 await runMeeting(meeting,s,owner,meetingCampaign,'fc-model-meeting');
 const started2=await (await brief.executeBrief(owner,{action:'start',id:'fc-model-brief',data:{brandId:seedBrand.id,title:'가상 브리프',goal:'첫 방문을 늘린다.'}})).json();
 assert.equal(started2.status,'queued',JSON.stringify(started2));
 return {bodies:[...hermes.bodies.values()].map(b=>String(b).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,'<uuid>').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g,'<iso>')),external:hermes.external};
}
const beforeRun=await modelRun(false),afterRun=await modelRun(true);
check('23: role, meeting and brief submissions ran on the mock',beforeRun.bodies.length>3&&afterRun.bodies.length===beforeRun.bodies.length&&!beforeRun.external.length&&!afterRun.external.length);
check('23: submissions for a franchise brand are byte-identical to the same brand without franchise records',same(beforeRun.bodies,afterRun.bodies));
check('23: no franchise source, cost or R2 judge text reaches a model submission',afterRun.bodies.every(b=>!/sourceRef|disclosureVersionId|정보공개서 등록 버전|가상 정보공개서 모델본|storeType|dv-fc-model|franchise_recruit|fr-claims|가맹 규칙|COLLECTIVE 휴리스틱/.test(b))&&afterRun.bodies.some(b=>b.includes('franchise_fee')));

console.log(JSON.stringify({passed:passed.length,violations:detected,consumer:CONSUMER.length,extraConsumer:EXTRA.length,normals:NORMALS.length,round2:{consumer:R2_CONSUMER_NONE.length+R2_CONSUMER_WARN.length,bypass:r2detected,legit:Object.values(R2_LEGIT).flat().length,value:R2_VALUE.length},round3:{consumer:R3_CONSUMER.length,bypass:r3detected}}));
