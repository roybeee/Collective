import {ApiError} from './server';
// 외부 입력(HERMES 응답·요청 본문)을 unknown으로 받아 좁히는 공용 헬퍼.
// obj(v)[k]는 v?.[k]와 같다: null·undefined는 빈 객체, 원시값은 JS 속성 접근 그대로(문자열 색인 포함).
// usage-ledger의 object()처럼 배열·원시값을 비우지 않는 이유는 기존 파서의 반환값과 오류를 그대로 두기 위해서다.
export const obj=(v:unknown):Record<string,unknown>=>v==null?{}:Object(v);
export function boundedArray(v:unknown,max:number,message:string):unknown[]{if(!Array.isArray(v)||v.length>max)throw new ApiError(422,message);return v}
