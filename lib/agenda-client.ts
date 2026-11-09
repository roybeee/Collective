// 결정 인박스 v2(GLOBAL-PLAN X1) 화면 순수 규칙: 탭 필터, 미루기(이 기기 24시간), 키보드 자판 뜻, 일괄 승인 순차 실행. DOM·fetch는 app/agenda-panel.tsx가 한다.
// 선언만 둔다(브라우저 번들·tests/agenda-inbox.test.mjs가 같은 코드를 쓴다).
import {agendaTabOf,type AgendaItem,type AgendaTab} from './agenda-types';
export const SNOOZE_KEY='collective.agenda.snooze';
export const SNOOZE_MS=24*3600000;
export type SnoozeMap=Record<string,string>;
type StorageLike={getItem(key:string):string|null;setItem(key:string,value:string):void};
// 미룬 항목은 이 기기에만 남는다(localStorage). 읽기·쓰기 실패(비공개 창·차단)는 미루기 없음으로 본다.
export function readSnoozes(storage:StorageLike|undefined,now=Date.now()):SnoozeMap{
 try{const raw=storage?.getItem(SNOOZE_KEY);if(!raw)return {};const parsed=JSON.parse(raw) as unknown;if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
  return Object.fromEntries(Object.entries(parsed as Record<string,unknown>).filter(([,until])=>typeof until==='string'&&Date.parse(until)>now)) as SnoozeMap}catch{return {}}
}
export function snooze(map:SnoozeMap,id:string,now=Date.now()):SnoozeMap{return {...map,[id]:new Date(now+SNOOZE_MS).toISOString()}}
export function writeSnoozes(storage:StorageLike|undefined,map:SnoozeMap){try{storage?.setItem(SNOOZE_KEY,JSON.stringify(map))}catch{/* 저장 못 해도 화면은 그대로 */}}
// 보이는 행: 탭(전체는 null) 안의 항목 중 미루지 않은 것.
export function visibleItems(items:AgendaItem[],tab:AgendaTab|null,snoozed:SnoozeMap):AgendaItem[]{return items.filter(i=>(tab===null||agendaTabOf(i.kind)===tab)&&!snoozed[i.id])}
export const snoozedCount=(items:AgendaItem[],snoozed:SnoozeMap)=>items.filter(i=>!!snoozed[i.id]).length;
// 자판 뜻(입력 칸 밖에서만): J/K 이동, A 승인, R 수정 요청, H 미루기, 빈칸 열기.
export type InboxKey='next'|'prev'|'approve'|'changes'|'snooze'|'open';
export function inboxKey(key:string):InboxKey|null{
 const k=key.length===1?key.toLowerCase():key;
 return k==='j'||k==='ArrowDown'?'next':k==='k'||k==='ArrowUp'?'prev':k==='a'?'approve':k==='r'?'changes':k==='h'?'snooze':k===' '||k==='Enter'?'open':null;
}
export const moveIndex=(index:number,delta:number,length:number)=>length?Math.min(length-1,Math.max(0,(index<0?(delta>0?-1:length):index)+delta)):-1;
// 승인할 수 있는 행(일괄 선택 대상). AI 카피·코드 PNG 발행은 별도 확인란이 필요해 제외한다.
export const approvable=(i:AgendaItem)=>!!i.action&&(i.action.type==='review_artifact'||(i.action.type==='approve_publication'&&!i.action.aiCopy&&!i.action.codedPng));
export const costSum=(items:AgendaItem[])=>items.reduce((n,i)=>n+(i.cost??0),0);
export type BatchResult={id:string;title:string;ok:boolean;message:string};
// 순차 실행. 한 건이 실패해도 다음 건을 계속하고 건별 결과를 돌려준다(일괄 승인은 외부 집행이 아니라 기록 변경이다).
export async function runSequentially(items:AgendaItem[],run:(item:AgendaItem)=>Promise<void>):Promise<BatchResult[]>{
 const out:BatchResult[]=[];
 for(const item of items){try{await run(item);out.push({id:item.id,title:item.title,ok:true,message:'승인했습니다.'})}catch(e){const message=(e as {message?:unknown}|null)?.message;out.push({id:item.id,title:item.title,ok:false,message:typeof message==='string'&&message?message:'처리하지 못했습니다.'})}}
 return out;
}
export const batchSummary=(results:BatchResult[])=>{const ok=results.filter(r=>r.ok).length,failed=results.length-ok;return `${ok}건을 승인했습니다.${failed?` ${failed}건은 처리하지 못했습니다.`:''}`};
