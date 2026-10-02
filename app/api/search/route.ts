import {searchRecords} from '@/lib/record-search-server';
import {actor,json,failure} from '@/lib/server';
// 바로 가기(/)의 기록 찾기(읽기 전용, 외부 호출 없음). 모든 역할이 자기 소유 범위만 찾는다. q는 2자 이상.
export async function GET(req:Request){try{const q=new URL(req.url).searchParams.get('q')??'';return json(await searchRecords(await actor(req),q))}catch(e){return failure(e)}}
