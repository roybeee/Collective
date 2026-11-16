import {isEnabled} from './feature-flags';

// 마케팅 스킬 블록(mkt_skill_prompts, P4b) 스위치 읽기. 실행기(role-execution·meeting-execution)는 스위치를 직접 import하지 않는다(tests/franchise-objective.test.mjs 6).
// 읽기 실패는 꺼짐으로 보아 제출을 이전과 바이트 동일하게 둔다(input_diet와 같은 규칙). 결과는 조립 함수 인자({mktSkills})·회의 스냅샷으로 넘긴다.
export async function mktSkillPromptsEnabled(owner:string):Promise<boolean>{
 try{return await isEnabled(owner,'mkt_skill_prompts')}catch{console.error('mkt_skill_prompts_flag_unreadable');return false}
}
