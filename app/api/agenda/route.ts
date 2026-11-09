import {agenda} from '@/lib/agenda-server';
import {json,failure} from '@/lib/server';
import {accessOf} from '@/lib/server-access';
// 홈 '오늘의 안건' 집계(읽기 전용, 외부 호출 없음). 모든 역할이 자기 소유 범위만 읽는다. 범위 역할(G7)은 배정 브랜드·지점 안의 항목만 받는다(lib/agenda-server.ts).
export async function GET(req:Request){try{const {actor,principal}=await accessOf(req);return json(await agenda(actor,Date.now(),principal))}catch(e){return failure(e)}}
