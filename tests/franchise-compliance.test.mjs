// 트랙 R R2 가맹 모집 규제 가드레일: 규제 사전 범주 franchise_recruit, 해제 불가 목록(결정 25), 휴리스틱 표현·근거 조건, 캡션·발행 게이트의 직접 판정(원장 해소·[확인 필요] 면제·인용 강등 없음),
// 소비자 범위와 모집 범위 분리(소비자 판촉 합성 20건 오탐 0), 값 대조(매장 수·창업비용), 교체된 정보공개서 버전 값 차단, ruleAt 날짜 주입, 대표 승인으로도 풀리지 않는 409, 모집 유사 경고, 비가맹 불변, 모델 제출 바이트 동일.
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
check('6: ip claim passes with a registration fact',ok('특허받은 반죽 기술',[cur('ip_registration','특허 제10-0000000호')]));
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
check('8a: 한정 12개, 대기 없음 is not a mention of the store count 12 (no footnote needed)',jc.mentionedFranchiseFacts({text:'한정 12개, 대기 없음',now:NOW,brandId:'b',facts:consumerFacts,versions:[V1]}).length===0&&jc.mentionedFranchiseFacts({text:'전국 12개 매장에서 만나요',now:NOW,brandId:'b',facts:consumerFacts,versions:[V1]}).length===1);

// ════ 9·10·11) 값 대조 ════
const reasonOf=(j,id)=>j.issues.find(i=>i.ruleId===id)?.reason;
const SC='kr.fr.store_count_claims',SU='kr.fr.startup_cost_claims';
check('9: confirmed store count 12 with reference date blocks 전국 20개 매장 (value_mismatch)',reasonOf(judge('전국 20개 매장',{scope:'consumer',facts:[count(12)]}),SC)==='value_mismatch'&&judge('전국 20개 매장',{scope:'consumer',facts:[count(12)]}).blocked);
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
check('11: startup cost passes with the matching value and its details line',!ids(judge('창업비용 5,000만원\n'+DETAIL,{facts:[startup]})).includes(SU));
check('11: the same value without the details line is details_missing',reasonOf(judge('창업비용 5,000만원이면 시작',{facts:[startup]}),SU)==='details_missing');
check('11: a different value is value_mismatch',reasonOf(judge('창업비용 4,000만원이면 시작\n'+DETAIL,{facts:[startup]}),SU)==='value_mismatch');
check('11: a fee claim with a matching fee fact passes, a different amount is value_mismatch',!ids(judge('가맹비 870만원',{facts:[cur('franchise_fee','870만원')]})).includes(SU)&&reasonOf(judge('가맹비 990만원',{facts:[cur('franchise_fee','870만원')]}),SU)==='value_mismatch');

// ════ 12) 부정문·[확인 필요]·인용 ════
check('12: negations are not flagged (4 cases)',['수익을 보장하지 않습니다','수익 보장은 없습니다','가계약금은 받지 않습니다','본사 전속 가맹거래사를 두지 않습니다'].every(t=>judge(t).issues.length===0));
const marked=judge('[확인 필요] 월 순수익 500만원 보장',{scope:'consumer'}),quoted=judge('“월 순수익 500만원 보장” 같은 경쟁 사례',{scope:'consumer'});
check('12: a [확인 필요] mark and a quoted competitor case stay hard_block (no exemption or downgrade)',marked.hardBlocked&&quoted.hardBlocked&&ids(marked).includes('kr.fr.revenue_guarantee')&&ids(quoted).includes('kr.fr.revenue_guarantee'));
check('12: the same quoted sentence is info on the A2 opt-in path (different from the gate)',comp.checkCompliance('“월 순수익 500만원 보장” 같은 경쟁 사례',{franchise:{scope:'consumer'}}).issues.filter(i=>i.category==='franchise_recruit').every(i=>i.severity==='info'));
check('12: the gate does not use ledger resolution (a confirmed store count key without a matching value still blocks)',reasonOf(judge('전국 20개 매장',{facts:[count(12)]}),SC)==='value_mismatch'&&!comp.checkCompliance('전국 20개 매장',{franchise:{scope:'consumer'},facts:{confirmed:[{key:'franchise_store_count',value:'12개'}],prohibited:[]}}).issues.some(i=>i.ruleId===SC));

// ════ 13) ruleAt 날짜 주입 ════
const assoc=at=>judge('점주 협의회에 가입하면 계약이 불가합니다',{at}).issues.find(i=>i.ruleId==='kr.fr.association_condition');
check('13: 2026-12-30 picks the ⑤ rule and 2026-12-31 the ⑥ rule',assoc('2026-12-30T12:00:00+09:00')?.registryId==='kr.fr.association_condition'&&assoc('2026-12-31T00:00:00+09:00')?.registryId==='kr.fr.association_condition_2026'&&assoc('2026-12-30T15:00:00Z')?.registryId==='kr.fr.association_condition_2026');
check('13: the family keeps hard_block on both sides of the boundary',assoc('2026-12-30T12:00:00+09:00').tier==='hard_block'&&assoc('2026-12-31T00:00:00+09:00').tier==='hard_block');
check('13: virtual human label applies from 2026-06-01, endorsement from 2024-12-01',!ids(judge('AI 점주가 소개합니다',{at:'2026-05-31T12:00:00+09:00'})).includes('kr.ad.virtual_human_label')&&ids(judge('AI 점주가 소개합니다',{at:'2026-06-01T00:00:00+09:00'})).includes('kr.ad.virtual_human_label')&&!ids(judge('점주 인터뷰 영상 공개',{at:'2024-11-30T12:00:00+09:00'})).includes('kr.ad.endorsement_disclosure')&&ids(judge('점주 인터뷰 영상 공개',{at:'2024-12-01T00:00:00+09:00'})).includes('kr.ad.endorsement_disclosure'));

// ════ 14) H9 ════
const first=judge('독점 상권 3km 보장\n안내',{scope:'consumer'}),second=judge('안내\n독점 상권 3km 보장',{scope:'consumer'});
check('14: first line numeric territory claim is block with escalatedBy, second line stays warn',first.issues.find(i=>i.ruleId==='kr.fr.territory_claims')?.escalatedBy==='h.headline_claim_block'&&second.issues.find(i=>i.ruleId==='kr.fr.territory_claims')?.tier==='warn'&&!second.blocked);
check('14: a first-line warn claim without a number stays warn',judge('독점 상권 보장 안내',{scope:'consumer',facts:[cur('trade_area_source','독점 상권 보장 안내')]}).issues.every(i=>i.tier!=='block'||i.ruleId!=='kr.fr.territory_claims'));

// ════ 15) 결과 모양 ════
const all=judge(Object.values(VIOLATIONS).flat().join('\n'));
check('15: every issue carries basis, the registry article verbatim and a basis label',all.issues.length>=26&&all.issues.every(i=>{const r=rules.FRANCHISE_RULES.find(x=>x.id===i.registryId);return r&&i.basis===r.basis&&i.article===r.article&&i.registryScope===r.scope&&same(i.sources,r.sourceUrls)}));
check('15: heuristic results carry the disclaimer, official results say 공식 규정',all.issues.every(i=>i.basis==='heuristic'?i.basisLabel===DISCLAIMER:i.basisLabel.startsWith('공식 규정 · '+i.article)));
const consumerOfficial=judge('월 순수익 500만원 보장',{scope:'consumer'}).issues.find(i=>i.ruleId==='kr.fr.revenue_guarantee'),recruitOfficial=judge('월 순수익 500만원 보장').issues.find(i=>i.ruleId==='kr.fr.revenue_guarantee');
check('15: franchise-law-only official rules in consumer scope add the heuristic scope note',consumerOfficial.basisLabel.endsWith('소비자 캠페인 적용은 '+DISCLAIMER)&&!recruitOfficial.basisLabel.includes('소비자 캠페인')&&!judge('전국 20개 매장',{scope:'consumer'}).issues.find(i=>i.ruleId===SC).basisLabel.includes('소비자 캠페인'));
check('15: notice is the compliance notice and disclaimer the gate disclaimer',all.notice===comp.COMPLIANCE_NOTICE&&all.disclaimer===gates.GATE_DISCLAIMER&&all.disclaimer===DISCLAIMER&&all.version===rules.FRANCHISE_CLAIMS_VERSION+'+'+comp.COMPLIANCE_LEXICON.version);
check('15: issues sort hard_block, block, warn then rule id, one per rule, excerpt at most 60 chars',all.issues.every((x,k,a)=>k===0||['hard_block','block','warn'].indexOf(a[k-1].tier)<['hard_block','block','warn'].indexOf(x.tier)||(a[k-1].tier===x.tier&&a[k-1].ruleId<x.ruleId))&&new Set(ids(all)).size===all.issues.length&&all.issues.every(i=>i.excerpt.length<=60));
const input={text:'전국 20개 매장',at:AT,now:NOW,scope:'consumer',brandId:'b',facts:[count(12)],versions:[V1]},before=JSON.stringify(input);jc.judgeFranchiseText(input);
check('15: the judge does not mutate its input',JSON.stringify(input)===before);
check('15: 40,000-character inputs finish within one second',['가'.repeat(40000),('수제 '+'가'.repeat(28)).repeat(1300),('월 순수익 '+'나'.repeat(20)+' ').repeat(1500),'전국 1개 매장 '.repeat(4000)].every(t=>{const s=Date.now();judge(t,{facts:[count(12)]});return Date.now()-s<1000}));
const gateMsg=jc.franchiseGateError(judge('월 순수익 500만원 보장',{scope:'consumer'}));
check('15: a hard_block gate error is a 409 that says approval cannot release it',gateMsg.status===409&&gateMsg.message.includes('승인으로 풀 수 없음')&&gateMsg.message.includes('월 순수익 500만원 보장')&&gateMsg.message.includes(DISCLAIMER));
check('15: a block-only gate error asks for evidence and a clean text has no error',jc.franchiseGateError(judge('전국 20개 매장',{scope:'consumer',facts:[count(12)]})).message.includes('근거 사실')&&jc.franchiseGateError(judge('가을 신메뉴 출시',{scope:'consumer'}))===null);
const FORBIDDEN=/법적으로 적합|준수 완료|합법/;
check('15: judge texts make no legal-adequacy claim',!FORBIDDEN.test(readFileSync('lib/franchise-compliance.ts','utf8'))&&!FORBIDDEN.test(JSON.stringify(all))&&!FORBIDDEN.test(jc.recruitmentWarning('B')));

// ════ 16~22) 게이트(라우트) ════
const WS='fc-owner';
const boss=f.signIn('fc-boss','admin',1000,WS),admin=f.signIn('fc-admin','admin',2000,WS),member=f.signIn('fc-member','member',3000,WS);
const F='fc-f',G='fc-g',N='fc-n',B='fc-b',S='fc-s';
for(const b of [F,G,N,B,S])await f.brand(WS,b);
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

// 16) 비가맹 브랜드의 '월 순수익 500만원 보장 이벤트' 소재·초안 → 가맹 프로필 저장 → 대표·관리자 승인 409
const CG=await campaign('fc-camp-g',G);
const promo=await confirmed(G,'promotion','월 순수익 500만원 보장 이벤트');
const cardG=await creative(CG,[promo.body]),pubG=await publication(CG,cardG.body.id);
check('16: before any franchise profile the consumer card and draft save (200)',promo.status===200&&cardG.status===200&&pubG.status===200&&pubG.body.status==='draft');
assert.equal((await profile(G)).status,200);
const bossTry=await approve(CG,pubG.body,boss,{override:true,hardBlockRelease:true,release:['kr.fr.revenue_guarantee']});
check('16: the owner (CEO) approving with every confirmation and release-looking fields is still 409',bossTry.status===409&&bossTry.body.error.includes('승인으로 풀 수 없음')&&bossTry.body.error.includes('월 순수익 500만원 보장'));
const adminTry=await approve(CG,pubG.body,admin);
check('16: an admin approval is also 409 and the publication stays a draft',adminTry.status===409&&adminTry.body.error===bossTry.body.error&&(await server.readRecord(WS,'execution_publication',pubG.body.id)).status==='draft');
check('16: member approval stays 403',(await approve(CG,pubG.body,member)).status===403);
const stateG=await execGet(boss,CG.id),blockersG=stateG.body.franchise?.publications?.[pubG.body.id]?.blockers??[];
check('16: getExecution shows the same unremovable items as approval blockers',blockersG.length>=2&&blockersG.every(b=>b.startsWith('가맹 규칙(해제 불가) · ')||b.startsWith('가맹 규칙 · '))&&blockersG.filter(b=>b.startsWith('가맹 규칙(해제 불가)')).every(b=>bossTry.body.error.includes(b.slice('가맹 규칙(해제 불가) · '.length))));
check('16: the screen blockers include the franchise items (approvalBlockers)',exec.approvalBlockers({campaign:CG,publication:pubG.body,state:stateG.body,factCount:1,rightsConfirmed:true,franchise:stateG.body.franchise.publications[pubG.body.id]}).some(b=>b.startsWith('가맹 규칙(해제 불가)')));

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
await server.recordStatement(WS,'artifact','fc-copy',{id:'fc-copy',campaignId:CF.id,campaignVersion:1,role:'content',title:'콘텐츠 스튜디오 · 가상',content:'## 게시 카피\n\n전국 20개 매장에서 만나요\n\n전국 12개 매장에서 만나요',version:1,status:'approved',origin:'manual',createdAt:'2026-09-25T00:00:00.000Z'},CF.id).run();
const copy=index=>({artifactId:'fc-copy',artifactVersion:1,index});
r=await publication(CF,cardCount.body.id,{copy:copy(1)});
check('19: with AI_COPY_CAPTIONS off the decision-17 409 comes first',r.status===409&&r.body.error.includes('결정 17'));
env.AI_COPY_CAPTIONS='enabled';
const stateF=await execGet(boss,CF.id),c20=stateF.body.copies.find(c=>c.index===0),c12=stateF.body.copies.find(c=>c.index===1);
check('19: the 전국 20개 candidate lists a franchise issue, the 12 one only warnings',c20.issues.some(i=>i.startsWith('가맹 규칙 · 매장 수 주장(확정 사실 값과 다름)'))&&!c12.issues.length&&Array.isArray(c12.warnings)&&c12.warnings.some(w=>w.includes('H8')));
r=await publication(CF,cardCount.body.id,{copy:copy(0)});
check('19: save_publication with the 20 copy is 409',r.status===409&&r.body.error.includes('매장 수 주장'));
const with12=await publication(CF,cardCount.body.id,{copy:copy(1)});
check('19: the 12 copy with the store count card saves (200) and keeps the footnote',with12.status===200&&with12.body.caption.startsWith('전국 12개 매장에서 만나요\n\n')&&with12.body.caption.endsWith(NOTE_F));
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
const nFact=await confirmed(N,'promotion','월 순수익 500만원 보장 이벤트');
const nCard=await creative(CN,[nFact.body]),nPub=await publication(CN,nCard.body.id);
r=await approve(CN,nPub.body);
check('22: the same revenue-guarantee wording in a non-franchise brand approves as before (no franchise gate)',nCard.status===200&&nPub.status===200&&r.status===200);
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

console.log(JSON.stringify({passed:passed.length,violations:detected,consumer:CONSUMER.length,extraConsumer:EXTRA.length,normals:NORMALS.length}));
