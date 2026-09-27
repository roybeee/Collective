// A1 커머스·감사 묶음(성장 계획 A1, 2026-09-27): 기존 단위 본문 확장 후보만 둔다(새 단위 없음, 트랙 R 결정 26).
// 커머스 = channel.commerce(발매 일정이 있는 팬덤 상품·화장품 표시 전제), 감사 = channel.shortform(메타 Advantage+ 자동 변경 소재 대조)와 viral.discovery(국내 사례 우선, 해외는 보조 표시).
// 계약(tests/local-channel-practice.test.mjs와 같은 형식): 후보는 코드 폴백 본문을 한 글자도 바꾸지 않고 앞에 둔 채 뒤에만 덧붙이고, 적용 범위는 코드(applies)가 정한다.
// 평가 함정(channel.offline v1~v4 쌍 평가): 업종 사전 용어·광고 표현 용어를 본문에 두지 않고(industry_metric_leak·unsupported_claim_term), 확인 지시는 외부 검색 없이 입력 자료로 한정한다(input_budget).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw new Error('No external calls expected')});
const practice=await load('lib/practice.ts'),policy=await load('lib/campaign-policy.ts'),industry=await load('lib/graders/industry.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const bodyOf=unit=>JSON.parse(readFileSync(`prompts/${unit}.json`,'utf8')).body;
const fallbackOf=id=>practice.channelSkills.find(s=>s.id===id).body;
const commerce=bodyOf('channel.commerce'),shortform=bodyOf('channel.shortform'),viral=bodyOf('viral.discovery');
const candidates={'channel.commerce':[commerce,fallbackOf('commerce')],'channel.shortform':[shortform,fallbackOf('shortform')],'viral.discovery':[viral,practice.viralPractice]};
const O='franchise_recruitment';
const beauty={goal:'신제품 구매 전환을 늘린다.',products:'미스트',stores:'',channels:'올리브영, Instagram'};
const fandom={goal:'발매 첫 주 예약 구매를 늘린다.',products:'음반',stores:'',channels:'자사 커머스, 팬덤 플랫폼'};
const search={goal:'문의를 늘린다.',products:'수업',stores:'',channels:'네이버 블로그'};

for(const [unit,[candidate,fallback]] of Object.entries(candidates)){
 check(`${unit}: the candidate keeps the code fallback unchanged at the front`,()=>assert.ok(candidate.startsWith(fallback),unit));
 check(`${unit}: the candidate extends the fallback`,()=>assert.ok(candidate.length>fallback.length+100,`${candidate.length} vs ${fallback.length}`));
 // v4 936자 기준으로 짧게 둔다(본문이 짧을수록 입력 예산·지시 충돌이 적다).
 check(`${unit}: the candidate stays under 1,000 characters`,()=>assert.ok(candidate.length<=1000,String(candidate.length)));
 // 여러 업종 캠페인에 같은 본문이 붙으므로 어느 업종 사전 용어도 본문에 두지 않는다.
 check(`${unit}: no industry dictionary term`,()=>{for(const [id,re] of Object.entries(industry.INDUSTRY_TERMS))assert.ok(!re.test(candidate),`${id}: ${candidate.match(re)?.[0]}`)});
 // 광고 표현 용어를 인용하지 않는다(피할 표현 목록 인용이 카피 재사용을 부른다).
 check(`${unit}: no claim term`,()=>{for(const t of policy.claimTerms)assert.ok(!candidate.includes(t),t)});
}
check('commerce and shortform checks are limited to the input and ask for no outside search',()=>{for(const b of [commerce,shortform])assert.ok(b.includes('입력 자료')&&b.includes('외부 검색은 하지 않는다'),b)});
check('commerce: the fandom release line asks for release periods, per-seller counts and rights checks',()=>{for(const w of ['발매','판매처','권리'])assert.ok(commerce.includes(w),w)});
check('commerce: the cosmetics line keeps efficacy copy to substantiated confirmed facts and functional status as a check item',()=>{for(const w of ['화장품','실증','기능성'])assert.ok(commerce.includes(w),w)});
check('commerce: only the product type line that fits is followed',()=>assert.ok(commerce.includes('맞는 한 줄만'),commerce));
check('shortform: the Advantage+ audit compares delivered creatives with the approved original',()=>{for(const w of ['Advantage+','승인본','대조'])assert.ok(shortform.includes(w),w)});
check('viral: domestic cases first and overseas cases marked as supporting',()=>{for(const w of ['국내','해외 사례·보조'])assert.ok(viral.includes(w),w)});

// 적용 범위는 코드가 정한다: 후보를 레지스트리로 넣어도 적용 조건이 맞는 캠페인에만 붙는다.
const withCandidates={commerce,shortform};
check('a beauty marketplace campaign gets the commerce and shortform candidates from the registry',()=>{const t=practice.campaignPractice(beauty,withCandidates);assert.ok(t.includes(commerce)&&t.includes(shortform))});
check('a campaign whose channels name commerce gets the commerce candidate',()=>assert.ok(practice.campaignPractice(fandom,withCandidates).includes(commerce)));
check('a campaign without commerce or short-form channels gets neither candidate',()=>{const t=practice.campaignPractice(search,withCandidates);assert.ok(!t.includes(commerce)&&!t.includes(shortform))});
check('a recruitment objective campaign does not get the commerce candidate',()=>assert.ok(!practice.campaignPractice({...beauty,objective:O},withCandidates).includes(commerce)));
check('without the registry the code fallback bodies are used',()=>{const t=practice.campaignPractice(beauty);assert.ok(t.includes(fallbackOf('commerce'))&&!t.includes(commerce))});
console.log(JSON.stringify({passed:passed.length}));
