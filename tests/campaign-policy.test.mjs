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
check('claim policy covers unverified popularity, ranking and offer claims',['인기','판매 1위','최초','유일','할인','무료','오픈 혜택','[확인 필요]','prohibited','confirmed'].every(x=>policy.claimPolicy.includes(x)));
check('answer discipline forbids options and re-asking',policy.answerDiscipline.includes('되묻지')&&policy.answerDiscipline.includes('조건부 초안'));
check('all roles receive claim policy and answer discipline',practice.evidenceDiscipline.includes(policy.claimPolicy)&&practice.evidenceDiscipline.includes(policy.answerDiscipline));
// 거절 사실(prohibited)은 [확인 필요]를 붙여도 쓰지 않는다. [확인 필요] 허용 규칙과 분리돼야 한다(claimPolicy 모순 회귀).
const claimSentences=policy.claimPolicy.split(/(?<=[.])\s+/);
check('[확인 필요] allowance never covers prohibited facts',claimSentences.filter(x=>x.includes('[확인 필요]로 표기')).length>0&&claimSentences.filter(x=>x.includes('[확인 필요]로 표기')).every(x=>!x.includes('prohibited')));
check('prohibited facts stay unusable even with [확인 필요]',claimSentences.some(x=>x.includes('evidence.facts.prohibited')&&x.includes('붙여도')&&x.includes('쓰지 마세요')));
// 브리프 초안도 같은 광고 표현 규칙과 상시 지시 한계를 받는다. 재질문 금지는 questions 필드와 충돌하므로 제외한다.
check('brief receives claim policy and directive limits but not answer discipline',brief.briefInstructions.includes(policy.claimPolicy)&&brief.briefInstructions.includes(policy.directivePolicy)&&!brief.briefInstructions.includes(policy.answerDiscipline));
check('directive policy says directives cannot establish facts or lift prohibitions',policy.directivePolicy.includes('사실 근거가 아닙니다')&&policy.directivePolicy.includes('evidence.facts.confirmed')&&policy.directivePolicy.includes('prohibited')&&!policy.directivePolicy.includes('대표가'));
// 결정적 검사: 거절 사실 값은 [확인 필요]가 있어도, 근거 없는 광고 표현은 [확인 필요]가 없을 때 신호로 잡는다.
const guard=policy.claimGuard({confirmed:[{key:'오픈 혜택',value:'첫 주 음료 무료'}],prohibited:[{key:'조리 방식',value:'장작 화덕'}]});
check('claim guard keeps rejected values and claim words without confirmed support',guard.prohibited.includes('장작 화덕')&&guard.unverified.includes('할인')&&!guard.unverified.includes('무료')&&!guard.unverified.includes('오픈 혜택'));
check('claim check flags rejected values and unmarked claims only',JSON.stringify(policy.unverifiedClaims('장작 화덕에서 구운 피자 [확인 필요]\n오늘만 할인\n인기 메뉴 [확인 필요]\n할인 표현은 쓰지 않습니다',guard))===JSON.stringify(['장작 화덕','할인']));
check('claim check ignores spacing variants and clean copy',policy.unverifiedClaims('장작화덕 향',guard).includes('장작 화덕')&&policy.unverifiedClaims('픽업 대기 없는 한 끼',guard).length===0);
console.log(JSON.stringify({passed}));
