import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw new Error('No external calls expected')});
const policy=await load('lib/campaign-policy.ts');
const brief=await load('lib/brief.ts');
const practice=await load('lib/practice.ts');
const oda={goal:'휘경동 C107 피자 오픈',products:'피자 메뉴 미확정',stores:'휘경동',channels:'Instagram'};
const locker={...oda,goal:'물품보관함 이용 확대',products:'물품보관함'};
let passed=0;
function check(name,condition){assert.ok(condition,name);passed++}
check('pizza gets no locker measurement instruction',!policy.campaignEvidencePolicy(oda).includes('가동 가능 시간'));
check('locker measurement is conditional on actual campaign service',policy.campaignEvidencePolicy(locker).includes('가동 가능 시간'));
check('common brief removes unrelated locker example',!brief.briefInstructions.includes('물품보관함'));
check('brand descriptions cannot automatically establish verified product facts',brief.briefInstructions.includes('브랜드 소개는 검증된 상품 사실이 아닙니다'));
check('repeat definition uses completed customer observation windows',policy.measurementDiscipline.includes('첫 구매일')&&policy.measurementDiscipline.includes('관찰이 끝난')&&policy.measurementDiscipline.includes('미성숙'));
check('all roles receive fact discipline',practice.evidenceDiscipline.includes(policy.factDiscipline));
check('brief receives common metric definitions',brief.briefInstructions.includes(policy.measurementDiscipline));
check('campaign-specific policy reaches role context',practice.campaignPractice(locker).includes('가동 가능 시간'));
console.log(JSON.stringify({passed}));
