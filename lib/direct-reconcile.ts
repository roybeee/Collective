// C3 후속: 결과 미확인(uncertain) 직접 게시(Instagram·Threads) 발행을 계정의 최근 게시물로 대조한다(순수 모듈). 다시 보내지 않는다.
// 판정: 캡션 해시가 같고 게시 시각이 접수 시각 창(접수 5분 전 ~ 30분 뒤) 안인 게시물이 정확히 하나면 확정, 없으면 창이 닫힌 뒤에만 실패, 여럿이면 미확인 유지(후보 표시).
// 창 길이는 운영 관측으로 조정하는 초깃값이다(공급자 공식 값이 아니다).
import type {RecentMediaItem} from './connectors/types';

export const RECONCILE_LEAD_MS=5*60000,RECONCILE_WINDOW_MS=30*60000;
export type ReconcileVerdict={result:'match';media:RecentMediaItem}|{result:'none';windowClosed:boolean;closesAt:string}|{result:'multiple';candidates:RecentMediaItem[]};

// 공급자가 줄바꿈(\r\n)·앞뒤 공백·유니코드 정규형을 바꿔 돌려줄 수 있어 해시 전에 맞춘다. 그 밖의 글자는 그대로 비교한다.
export const normalizeCaption=(text:string)=>text.normalize('NFC').replace(/\r\n?/g,'\n').trim();
export async function captionHash(text:string){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizeCaption(text)));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
// excludeIds: 이미 다른 발행에 연결된 게시물 id(같은 게시물을 두 발행에 붙이지 않는다).
export async function matchUncertain(input:{caption:string;attemptedAt:string;now:number;media:readonly RecentMediaItem[];excludeIds?:ReadonlySet<string>}):Promise<ReconcileVerdict>{
 const at=Date.parse(input.attemptedAt),from=at-RECONCILE_LEAD_MS,to=at+RECONCILE_WINDOW_MS,want=await captionHash(input.caption);
 const inWindow=(m:RecentMediaItem)=>{const t=Date.parse(m.timestamp??'');return Number.isFinite(t)&&t>=from&&t<=to};
 const hits:RecentMediaItem[]=[];
 for(const m of input.media){
  if(input.excludeIds?.has(m.id)||!m.caption||!inWindow(m))continue;
  if(await captionHash(m.caption)===want)hits.push(m);
 }
 if(hits.length===1)return {result:'match',media:hits[0]};
 if(hits.length>1)return {result:'multiple',candidates:hits};
 const closesAt=new Date(Number.isFinite(to)?to:input.now).toISOString();
 return {result:'none',windowClosed:!Number.isFinite(at)||input.now>to,closesAt};
}
