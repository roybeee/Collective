import {ApiError} from './server';
export const WEEKDAYS=['mon','tue','wed','thu','fri','sat','sun'] as const;
export type Weekday=typeof WEEKDAYS[number];
export type HoursInterval={start:string;end:string;endsNextDay:boolean};
export type HoursDay={state:'open'|'closed'|'unknown';intervals:HoursInterval[]};
export type WeeklySchedule=Record<Weekday,HoursDay>;
const invalid=()=>{throw new ApiError(400,'7개 요일의 영업·휴무·확인 필요 상태와 겹치지 않는 시간 구간을 입력하세요.')};
function minutes(raw:unknown){if(typeof raw!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw))return invalid();const [h,m]=raw.split(':').map(Number);return h*60+m}
function dayInput(raw:unknown,complete:boolean):HoursDay{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return invalid();const v=raw as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['state','intervals'].includes(k))||!['open','closed','unknown'].includes(String(v.state))||!Array.isArray(v.intervals)||v.intervals.length>6)return invalid();
 if(complete&&v.state==='unknown')return invalid();
 if(v.state!=='open'&&v.intervals.length||v.state==='open'&&!v.intervals.length)return invalid();
 const intervals=v.intervals.map((r:unknown)=>{if(!r||typeof r!=='object'||Array.isArray(r))return invalid();const i=r as Record<string,unknown>;
  if(Object.keys(i).some(k=>!['start','end','endsNextDay'].includes(k))||typeof i.endsNextDay!=='boolean')return invalid();
  const start=minutes(i.start),end=minutes(i.end)+(i.endsNextDay?1440:0);if(end<=start||end-start>1440)return invalid();
  return {start:i.start as string,end:i.end as string,endsNextDay:i.endsNextDay};
 }).sort((a,b)=>minutes(a.start)-minutes(b.start));
 return {state:v.state as HoursDay['state'],intervals};
}
export function weeklySchedule(raw:unknown,complete=false):WeeklySchedule{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return invalid();const obj=raw as Record<string,unknown>;
 if(Object.keys(obj).length!==7||Object.keys(obj).some(k=>!(WEEKDAYS as readonly string[]).includes(k)))return invalid();
 const schedule=Object.fromEntries(WEEKDAYS.map(day=>[day,dayInput(obj[day],complete)])) as WeeklySchedule;
 const spans=WEEKDAYS.flatMap((day,index)=>schedule[day].intervals.map(i=>({start:index*1440+minutes(i.start),end:index*1440+minutes(i.end)+(i.endsNextDay?1440:0)})));
 const all=[...spans,...spans.map(s=>({start:s.start+10080,end:s.end+10080}))].sort((a,b)=>a.start-b.start);
 if(all.some((s,i)=>i>0&&s.start<all[i-1].end))return invalid();
 return schedule;
}
export const weeklyCanonical=(schedule:unknown)=>JSON.stringify(weeklySchedule(schedule));
