import {agenda} from '@/lib/agenda-server';
import {actor,json,failure} from '@/lib/server';
// 홈 '오늘의 안건' 집계(읽기 전용, 외부 호출 없음). 모든 역할이 자기 소유 범위만 읽는다.
export async function GET(req:Request){try{return json(await agenda(await actor(req)))}catch(e){return failure(e)}}
