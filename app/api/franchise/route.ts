import {franchiseGet,franchisePost,franchiseFailure} from '@/lib/franchise-server';

// 트랙 R 가맹 모집 API(R1a 가맹 설정 + R4b 리드 원장, 대표 결정 20·22). 읽기는 GET ?view=, 쓰기는 POST {action,requestId,...}이다.
// 역할·스위치·잠금·요청 제한·영수증·감사는 lib/franchise-server.ts가 한다. 오류는 failure()를 쓰지 않는다(알 수 없는 오류의 메시지를 로그에 남기지 않는다).
export async function GET(req:Request){try{return await franchiseGet(req)}catch(error){return franchiseFailure(error)}}
export async function POST(req:Request){try{return await franchisePost(req)}catch(error){return franchiseFailure(error)}}
