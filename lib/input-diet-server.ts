import {isEnabled} from './feature-flags';

// 입력 축소(input_diet, PR 4b) 스위치 읽기. 실행기(role-execution·meeting-execution·brief-execution)는 스위치를 직접 import하지 않는다(tests/franchise-objective.test.mjs 6).
// 읽기 실패는 꺼짐으로 보아 제출을 이전과 바이트 동일하게 둔다(a3_copy_pack·a3_brand_voice와 같은 규칙). 결과는 조립 함수 인자({inputDiet})로 넘긴다.
export async function inputDietEnabled(owner:string):Promise<boolean>{
 try{return await isEnabled(owner,'input_diet')}catch{console.error('input_diet_flag_unreadable');return false}
}
