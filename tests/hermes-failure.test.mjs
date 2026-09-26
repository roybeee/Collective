import assert from 'node:assert/strict';
import {pureLoader} from '../scripts/eval/load-ts.mjs';
const {hermesFailureCategory}=await pureLoader(process.cwd())('lib/hermes-failure.ts');
const cases=[['401 invalid api key','모델 인증 실패'],[{code:'insufficient_quota',message:'SECRET'},'모델 사용 한도 또는 요청 제한'],['context_length_exceeded SECRET','모델 입력 길이 초과'],['model_not_found','모델 설정 오류'],['API call stale timeout','HERMES 내부 응답 시간 초과'],['interrupted','HERMES 재시작 또는 실행 중단'],['aside tool error','HERMES 도구 실행 오류'],['upstream 503','모델 서비스 연결 실패'],['ModuleNotFoundError: SECRET','HERMES 실행 환경 오류'],['SEALED SECRET','분류되지 않은 HERMES 오류'],[null,'HERMES 오류 상세 미보고']];
for(const [input,expected] of cases)assert.equal(hermesFailureCategory(input),expected);
console.log(JSON.stringify({passed:cases.length}));
