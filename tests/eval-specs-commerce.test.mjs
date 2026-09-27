// 커머스 dev 합성 스펙(레인 Q 요청, 2026-09-27): A1 커머스 후보(channel.commerce, PR #210)의 쌍 평가에 적용 케이스가 있어야 한다.
// 기존 합성 명세에는 채널 문구로 channel.commerce가 켜지는 캠페인이 없어, 후보를 넣어도 두 쪽 입력이 같았다.
// 수용: 두 스펙(밀키트 온라인 판매 fnb, 팬덤 상품 kpop)이 dev이고, 생성한 역할 요청의 채널 지시에 커머스 스킬이 실제로 들어가며, 점포 캠페인이 아니라 현장 스킬은 붙지 않는다.
// 업종 기대값은 채점기 업종 사전의 키여야 한다(lib/graders/industry.ts). 근거: mocked(스텁 HERMES, 메모리 SQLite, 합성 스펙). 외부 네트워크 0회.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {synthesizeCases} from '../scripts/eval/synthesize.mjs';

const {load}=testRuntime(async()=>{throw new Error('No external calls expected')});
const practice=await load('lib/practice.ts'),industry=await load('lib/graders/industry.ts'),kinds=await load('lib/eval-kinds.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const generator={commit:'c'.repeat(40),tree:'d'.repeat(40)};
const bodyOf=id=>practice.channelSkills.find(s=>s.id===id).body;
// 봉인 업종(beauty·popup·retail)은 dev에 쓰지 않는다(docs/SEALED-CASES.ko.md, 레인 Q 결정 2026-09-27). 채널은 실명 판매처 없이 일반 문구 '커머스'로 적용 조건에 건다.
const SPECS={'syn-s10-fnb-commerce':'fnb','syn-s11-kpop-commerce':'kpop'},SEALED_INDUSTRIES=['beauty','popup','retail'];

for(const [id,expected] of Object.entries(SPECS)){
 const spec=JSON.parse(readFileSync(`scripts/eval/specs/${id}.json`,'utf8'));
 const campaign=spec.records.find(r=>r.kind==='campaign'&&r.id===spec.campaignId).data;
 check(`${id}: a dev spec`,()=>assert.ok(spec.id===id&&spec.set==='dev'));
 check(`${id}: the industry expectation is the ${expected} dictionary key`,()=>{assert.deepEqual(spec.expectations.industry,[expected]);assert.ok(expected in industry.INDUSTRY_TERMS)});
 check(`${id}: no sealed industry`,()=>assert.ok(spec.expectations.industry.every(x=>!SEALED_INDUSTRIES.includes(x))));
 check(`${id}: the channels reach the commerce skill through the generic word, not a seller name`,()=>assert.ok(campaign.channels.includes('커머스')&&!/올리브영|무신사|olive|musinsa/i.test(campaign.channels),campaign.channels));
 check(`${id}: not a local store campaign`,()=>assert.equal(spec.expectations.localStore,false));
 check(`${id}: the campaign applies channel.commerce and not the store skill`,()=>{const ids=practice.channelSkillIds(campaign);assert.ok(ids.includes('commerce')&&!ids.includes('offline'),ids.join())});
 // 동결 요청을 평가 제출과 같은 조립(evalKind('role').build)으로 펼쳐 모델 입력의 채널 지시를 본다.
 const out=await synthesizeCases(spec,{generator}),roles=out.cases.filter(c=>c.kind==='role'),practiceOf=c=>JSON.parse(kinds.evalKind('role').build(c.request).input).channelPractice;
 check(`${id}: eight role cases`,()=>assert.equal(roles.length,8));
 check(`${id}: every generated role request carries the commerce skill`,()=>assert.ok(roles.every(c=>practiceOf(c).includes(bodyOf('commerce'))),roles.map(c=>c.role).join()));
 check(`${id}: no generated role request carries the store skill`,()=>assert.ok(roles.every(c=>!practiceOf(c).includes(bodyOf('offline')))));
 check(`${id}: role cases carry the industry expectation`,()=>assert.ok(roles.every(c=>JSON.stringify(c.expectations.industry)===JSON.stringify([expected])&&c.expectations.localStore===false)));
}
console.log(JSON.stringify({passed:passed.length}));
