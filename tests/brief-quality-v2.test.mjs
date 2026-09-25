// 브리프 품질 수정 v2(2026-09-25 파일럿 R2 S2 브리프 실측): 보호 항목 제안과 스키마 경로 노출.
// (1) 지시문은 suggestions 허용 키에서 보호 키를 빼고 보호 키를 이름으로 밝힌다. (2) 입력 JSON 경로를 본문에 쓰지 말라는 규칙이 있다.
// (3) 운영 초안 결과(summary·제안·질문·가정·참고 자료)의 알려진 스키마 경로는 한국어 라벨로 바꾼다. 사용자가 적은 사실 후보(factCandidates)는 원문 그대로 둔다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw new Error('No external calls expected')});
const brief=await load('lib/brief.ts'),normalize=await load('lib/brief-normalize.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const PROTECTED=['baseline','target','operations','owner','learning'];

const allowedLine=brief.briefInstructions.split('\n').find(l=>l.startsWith('suggestions 허용 키:'))||'';
const allowedKeys=allowedLine.slice('suggestions 허용 키:'.length).split('.')[0].split(',').map(k=>k.trim()).filter(Boolean);
check('suggestion keys listed to the model exclude every protected key',()=>{assert.ok(allowedKeys.length>10,allowedLine);for(const k of PROTECTED)assert.ok(!allowedKeys.includes(k),k)});
check('suggestion keys listed to the model are exactly the non-protected brief fields',()=>assert.deepEqual(allowedKeys,Object.keys(brief.briefFields).filter(k=>!brief.protectedFields.has(k))));
check('the instruction names the protected keys and says users record them',()=>{const line=brief.briefInstructions.split('\n').find(l=>l.includes('보호 키'))||'';for(const k of PROTECTED)assert.ok(line.includes(k),k);assert.ok(line.includes('suggestions에 넣지 마세요'),line)});
check('the instruction forbids writing input JSON paths in brief text',()=>assert.ok(brief.briefInstructions.includes('입력 JSON의 필드 경로(점으로 이은 영문 이름)')&&brief.briefInstructions.includes("'거절된 사실'")));

const result={summary:'evidence.facts.confirmed만 근거로 씁니다.',suggestions:[{field:'constraints',value:'“당일 전량 소진”은 evidence.facts.prohibited에 해당하므로 쓰지 않습니다.',reason:'확정 사실(evidence.facts.confirmed) 기준'},{field:'stores',value:'가상동 34 [확인 사실: 주소/evidence.facts.confirmed]',reason:'확정 주소'}],
 questions:[{field:'budget',question:'campaign.budget을 확정할까요?',why:'evidence.facts.candidate에 가격이 없습니다.'}],assumptions:['brand.brandIntro는 미확인입니다.'],contextUsed:['evidence.directives 1건'],factCandidates:[{key:'주소',value:'evidence.facts.confirmed 원문',source:'사용자 브리프'}]};
const frozen=JSON.stringify(result),labeled=normalize.labelBriefResult(result);
check('known schema paths in brief prose become Korean labels',()=>{
 assert.equal(labeled.summary,'확정 사실만 근거로 씁니다.');
 assert.equal(labeled.suggestions[0].value,'“당일 전량 소진”은 거절된 사실에 해당하므로 쓰지 않습니다.');
 assert.equal(labeled.suggestions[0].reason,'확정 사실 기준');
 assert.ok(!JSON.stringify({s:labeled.summary,g:labeled.suggestions,q:labeled.questions,a:labeled.assumptions,c:labeled.contextUsed}).includes('evidence.'),JSON.stringify(labeled));
});
check('fields, fact candidates and the input object are left unchanged',()=>{assert.deepEqual(labeled.suggestions.map(s=>s.field),['constraints','stores']);assert.deepEqual(labeled.factCandidates,result.factCandidates);assert.equal(JSON.stringify(result),frozen)});
check('a result without paths is returned with equal content',()=>{const plain={summary:'접근법',suggestions:[{field:'kpi',value:'주간 재방문',reason:'목표'}],questions:[],assumptions:[],contextUsed:[]};assert.equal(JSON.stringify(normalize.labelBriefResult(plain)),JSON.stringify(plain))});
check('production brief execution labels the parsed result before saving',()=>{const s=readFileSync('lib/brief-execution.ts','utf8');assert.ok(/labelBriefResult\(parseBrief\(/.test(s),'brief-execution.ts must save labelBriefResult(parseBrief(...))')});

console.log(JSON.stringify({passed:passed.length}));
