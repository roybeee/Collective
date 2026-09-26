import {isEnabled} from './feature-flags';
import {COPY_PACK_PROFILE} from './copy-pack';

// 카피 팩 v2(A3-1) 스위치 읽기. 실행기(role-execution·meeting-execution)는 스위치를 직접 import하지 않는다(tests/franchise-objective.test.mjs 6).
// 콘텐츠 역할만 스위치를 읽는다. 읽기 실패는 꺼짐으로 보아 요청을 이전과 바이트 동일하게 둔다(online_grading·a7_repair_turn과 같은 규칙).
export async function copyPackProfile(owner:string,role:string):Promise<typeof COPY_PACK_PROFILE|null>{
 if(role!=='content')return null;
 try{return await isEnabled(owner,'a3_copy_pack')?COPY_PACK_PROFILE:null}catch{console.error('a3_copy_pack_flag_unreadable');return null}
}
