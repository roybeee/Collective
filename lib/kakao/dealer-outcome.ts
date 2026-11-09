// 딜러 호출 결과를 전송 결과(success·failed·unknown)로 바꾸는 순수 도우미. 참고 구현과 모의 딜러가 같은 규칙을 쓴다.
// 규율: 한도 큐의 unknown(보낸 뒤 타임아웃·5xx·연결 끊김)은 그대로 unknown이고, fatal(4xx)·재시도 소진은 failed다. 결과 폴링은 읽기라 모르면 unknown으로 두고 다시 읽어도 된다.
import {runWithBackoff,type BackoffPolicy,type RunDeps,type RunResult} from '../connectors/rate-queue';
import type {RateLimit} from '../connectors/types';
import type {DealerAttempt,ResultStatus,SendResult} from './types';

export const DEALER_RATE_LIMIT:RateLimit={perSecond:5,perMinute:100,perDay:10000};
export const DEALER_POLICY:BackoffPolicy={maxAttempts:3,baseDelayMs:500,maxDelayMs:10000};
// 즉시 실행 시계(테스트·모의 딜러). 운영 참고 구현은 실제 시계·setTimeout을 쓴다.
export const immediateDeps:RunDeps={now:(()=>{let t=0;return ()=>(t+=1000)})(),random:()=>0.5,sleep:async()=>undefined};
export const realDeps:RunDeps={now:()=>Date.now(),random:()=>Math.random(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))};

export function toSendResult(run:RunResult<NonNullable<DealerAttempt['value']>>):SendResult{
 const value=run.value,last=run.last as DealerAttempt|null,lastDetail=last&&'value' in last?last.value?.detail:undefined;
 const detail=value?.detail||lastDetail||(last?describeAttempt(last):'');
 if(run.outcome==='success')return {outcome:'success',messageId:value?.messageId??null,costKrw:typeof value?.costKrw==='number'?value.costKrw:null,detail,attempts:run.attempts};
 if(run.outcome==='unknown')return {outcome:'unknown',messageId:null,costKrw:null,detail:`${detail?detail+'. ':''}전송 결과를 확인하지 못했습니다. 자동 재전송하지 않습니다(딜러 콘솔에서 멱등 키로 대조).`,attempts:run.attempts};
 return {outcome:'failed',messageId:null,costKrw:null,detail:detail||'딜러가 전송을 거부했습니다.',attempts:run.attempts};
}
export function describeAttempt(last:DealerAttempt):string{
 if(last.kind==='response')return `딜러 응답 ${last.status}`;
 if(last.kind==='timeout')return last.sent?'보낸 뒤 응답 시간 초과':'연결 전 시간 초과';
 if(last.kind==='network_error')return last.sent?'보낸 뒤 연결 끊김':'연결 실패';
 return '호출 중 예외';
}
// 딜러의 상태 문자열을 공통 상태로 옮긴다(대소문자 무시). 모르는 값은 unknown이다(실패로 단정하지 않는다).
export function resultStatus(raw:unknown):ResultStatus{
 const s=typeof raw==='string'?raw.trim().toUpperCase():'';
 if(['DELIVERED','SUCCESS','SENT','COMPLETED','OK'].includes(s))return 'delivered';
 if(['FAILED','FAIL','REJECTED','ERROR','EXPIRED'].includes(s))return 'failed';
 if(['PENDING','QUEUED','PROCESSING','ACCEPTED','READY'].includes(s))return 'pending';
 return 'unknown';
}
// 쓰기 한 건을 한도·백오프 규율로 보낸다. 같은 멱등 키는 호출자가 저널(bizmessage_send 레코드)로 막는다.
export function runSend(key:string,send:(attempt:number)=>Promise<DealerAttempt>,deps:RunDeps,policy:BackoffPolicy=DEALER_POLICY){
 return runWithBackoff<NonNullable<DealerAttempt['value']>>({key,limit:DEALER_RATE_LIMIT,write:true,policy,send},deps);
}
