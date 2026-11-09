// 회의 이견 선택 게이트(X2) 스위치 읽기. 실행기(lib/meeting-execution.ts)는 feature-flags를 직접 읽지 않고 이 보조 모듈을 부른다(tests/data-requests-auto.test.mjs 규칙).
// 스위치를 읽지 못하면 꺼진 것으로 보아 회의를 멈추지 않는다(선택 기록·입력 전달은 스위치와 무관하다).
import {isEnabled} from './feature-flags';
export function choiceGateEnabled(owner:string):Promise<boolean>{
 return isEnabled(owner,'meeting_choice_gate').catch(()=>{console.error('meeting_choice_gate_flag_unreadable');return false});
}
