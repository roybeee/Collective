import {searchRecords} from '@/lib/record-search-server';
import {actor,json,failure} from '@/lib/server';
import {readableCampaignIds} from '@/lib/server-access';
// 바로 가기(/)의 기록 찾기(읽기 전용, 외부 호출 없음). 모든 역할이 자기 소유 범위만 찾는다. q는 2자 이상.
export async function GET(req:Request){try{const q=new URL(req.url).searchParams.get('q')??'';const who=await actor(req),ids=await readableCampaignIds(req);if(!ids)return json(await searchRecords(who,q));
 // 범위 역할: 모든 기록에서 찾은 뒤 볼 수 있는 캠페인의 것만 기본 개수(20)까지 남긴다.
 const all=await searchRecords(who,q,5000);return json({...all,hits:all.hits.filter(h=>ids.has(h.campaignId)).slice(0,20)})}catch(e){return failure(e)}}
