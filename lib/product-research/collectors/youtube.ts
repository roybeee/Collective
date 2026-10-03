// YouTube Data API v3 수집기. 하루 10,000단위라 search.list(100단위)는 키워드별 영상 발견에만 아껴 쓰고,
// 조회수 추적은 videos.list(1단위, 50개씩)로 한다. 조회수 증가 속도(video_view_velocity)는 두 스냅샷 차이로 나중에 계산한다.
// API 키는 쿼리(key=)로 보내지만 스냅샷 request에는 남기지 않는다. 호스트는 고정 상수다.
import type {YoutubeCredential} from '../credentials';
import type {Observation,Subject} from '../types';
import {fetchSourceJson,inputError,keywordInput,list,nonNegative,record,text} from './http';
import {kstDayKey,unitsFor} from './quota';
import type {CollectDeps,CollectResult} from './index';

export const YOUTUBE_BASE='https://www.googleapis.com/youtube/v3';
const LABEL='YouTube Data API';
const MAX_SEARCH_RESULTS=25,MAX_VIDEO_IDS=50;
const MAX_BYTES=800_000;
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;

export type YoutubeDiscoverInput={keyword:string;publishedAfter:string;maxResults?:number};
export type YoutubeDiscoverResult=CollectResult&{videoIds:string[]};

// 고정 기본 주소 + 경로 이름(search·videos)에 쿼리만 붙인다. 값은 searchParams가 인코딩한다.
function endpoint(name:'search'|'videos',query:Record<string,string>){
 const url=new URL(`${YOUTUBE_BASE}/${name}`);
 for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
 return url.toString();
}

function rfc3339(value:unknown,label:string,now:Date){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)||!Number.isFinite(Date.parse(value)))inputError(`${label}은 UTC 시각(예: 2026-09-01T00:00:00Z)으로 입력하세요.`);
 if(Date.parse(value)>now.getTime())inputError(`${label}이 현재보다 늦습니다.`);
 return value;
}

// 키워드로 최근 영상을 찾는다(search.list, 100단위). 관측은 키워드의 관련 영상 수(video_count) 하나이고, 찾은 영상 ID는 추적 대상으로 돌려준다.
export async function discoverYoutubeVideos(credential:YoutubeCredential,input:YoutubeDiscoverInput,deps:CollectDeps):Promise<YoutubeDiscoverResult>{
 const keyword=keywordInput(input.keyword,'키워드',100);
 const publishedAfter=rfc3339(input.publishedAfter,'게시 시작 시각',deps.now());
 const maxResults=input.maxResults??MAX_SEARCH_RESULTS;
 if(!Number.isInteger(maxResults)||maxResults<1||maxResults>MAX_SEARCH_RESULTS)inputError(`영상 검색 개수는 1~${MAX_SEARCH_RESULTS}개입니다.`);
 const res=await fetchSourceJson('youtube_data',endpoint('search',{part:'snippet',type:'video',q:keyword,maxResults:String(maxResults),publishedAfter,regionCode:'KR',relevanceLanguage:'ko',order:'relevance',key:credential.apiKey}),{method:'GET'},deps,{label:LABEL,maxBytes:MAX_BYTES});
 const body=record(res.json);
 const videoIds:string[]=[];
 let skipped=0;
 for(const raw of list(body.items)){
  const id=text(record(record(raw).id).videoId,20);
  if(!id||!VIDEO_ID.test(id)){skipped++;continue}
  if(!videoIds.includes(id))videoIds.push(id);
 }
 const total=nonNegative(record(body.pageInfo).totalResults);
 const day=kstDayKey(new Date(res.fetchedAt));
 const observations:Observation[]=[{subject:{type:'keyword',text:keyword},metric:'video_count',value:total,period:{from:publishedAfter.slice(0,10),to:day}}];
 const limitations=[
  'YouTube 검색 결과 수(totalResults)는 근사치이며 최대 1,000,000으로 잘립니다. 같은 조건끼리의 비교에만 씁니다.',
  '검색은 한 번에 100단위를 써서 발견용으로만 호출합니다. 조회수는 영상 단위 추적(videos.list)으로 모읍니다.',
 ];
 if(total===null)limitations.push('관련 영상 수를 확인하지 못했습니다.');
 if(skipped)limitations.push(`영상 ID가 없는 검색 결과 ${skipped}개를 건너뛰었습니다.`);
 return {
  draft:{
   sourceId:'youtube_data',method:'api',
   request:{operation:'search',keyword,publishedAfter,maxResults,regionCode:'KR'},
   fetchedAt:res.fetchedAt,bodyDigest:res.bodyDigest,bodyBytes:res.bodyBytes,
   status:total===null||skipped?'partial':'ok',limitations,observations,
  },
  unitsUsed:unitsFor('youtube_data','youtube_search'),
  videoIds,
 };
}

// 영상 조회수 추적(videos.list, 호출당 1단위, 50개까지). 비공개·삭제·통계 숨김 영상은 0이 아니라 미확인(null) 관측으로 남겨 시계열에 빈칸을 드러낸다.
export async function trackYoutubeVideos(credential:YoutubeCredential,videoIds:readonly string[],deps:CollectDeps):Promise<CollectResult>{
 const ids=[...new Set(Array.isArray(videoIds)?videoIds:[])];
 if(!ids.length||ids.length>MAX_VIDEO_IDS)inputError(`영상 ID는 한 번에 1~${MAX_VIDEO_IDS}개입니다.`);
 if(!ids.every(id=>typeof id==='string'&&VIDEO_ID.test(id)))inputError('영상 ID 형식이 올바르지 않습니다(11자).');
 const res=await fetchSourceJson('youtube_data',endpoint('videos',{part:'statistics,snippet',id:ids.join(','),maxResults:String(MAX_VIDEO_IDS),key:credential.apiKey}),{method:'GET'},deps,{label:LABEL,maxBytes:MAX_BYTES});
 const day=kstDayKey(new Date(res.fetchedAt)),period={from:day,to:day};
 const found=new Map<string,Record<string,unknown>>();
 for(const raw of list(record(res.json).items)){
  const item=record(raw),id=text(item.id,20);
  if(id&&ids.includes(id))found.set(id,item);
 }
 const observations:Observation[]=[];
 let hidden=0;
 for(const id of ids){
  const item=found.get(id);
  const snippet=record(item?.snippet);
  // brand는 상품 브랜드 자리라 채널 이름을 넣지 않는다. 영상 주소는 화면이 externalId로 만든다(호스트 문자열을 수집기에 두지 않음).
  const subject:Subject={type:'listing',sourceId:'youtube_data',externalId:id,title:text(snippet.title,300)??`영상 ${id}`,brand:null,price:null,url:null,categoryPath:null};
  const views=item?nonNegative(record(item.statistics).viewCount):null;
  if(item&&views===null)hidden++;
  observations.push({subject,metric:'video_views',value:views,period});
 }
 const missing=ids.filter(id=>!found.has(id));
 const limitations=['조회수는 수집 시점 누적값입니다. 증가 속도는 다음 스냅샷과의 차이로 계산합니다.'];
 if(missing.length)limitations.push(`응답에 없는 영상 ${missing.length}개(비공개·삭제 추정)는 미확인으로 두었습니다.`);
 if(hidden)limitations.push(`조회수를 공개하지 않은 영상 ${hidden}개는 미확인으로 두었습니다.`);
 return {
  draft:{
   sourceId:'youtube_data',method:'api',
   request:{operation:'videos',videoIds:ids.join(','),count:ids.length},
   fetchedAt:res.fetchedAt,bodyDigest:res.bodyDigest,bodyBytes:res.bodyBytes,
   status:missing.length||hidden?'partial':'ok',limitations,observations,
  },
  unitsUsed:unitsFor('youtube_data','youtube_videos'),
 };
}
