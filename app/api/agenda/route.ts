import {agenda} from '@/lib/agenda-server';
import {actor,json,failure} from '@/lib/server';
import {readableCampaigns} from '@/lib/server-access';
// 홈 '오늘의 안건' 집계(읽기 전용, 외부 호출 없음). 모든 역할이 자기 소유 범위만 읽는다.
export async function GET(req:Request){try{const who=await actor(req),visible=await readableCampaigns(req);return json(await agenda(who,undefined,visible??undefined))}catch(e){return failure(e)}}
