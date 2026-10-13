'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {CheckInput} from '@/components/app/check';
import {Note} from '@/components/app/note';
import type {WeeklySchedule} from '@/lib/store-browser';

type WeeklyDay=WeeklySchedule['mon'];
const days=[['mon','월요일'],['tue','화요일'],['wed','수요일'],['thu','목요일'],['fri','금요일'],['sat','토요일'],['sun','일요일']] as const;
const blankDay=():WeeklyDay=>({state:'unknown',intervals:[]});
const blank=():WeeklySchedule=>({mon:blankDay(),tue:blankDay(),wed:blankDay(),thu:blankDay(),fri:blankDay(),sat:blankDay(),sun:blankDay()});
const known=(s:WeeklySchedule)=>days.every(([key])=>s[key].state!=='unknown'&&(s[key].state==='closed'||s[key].intervals.length>0));

export function WeeklyScheduleView({schedule}:{schedule:WeeklySchedule}){
 return <ul>{days.map(([key,label])=><li key={key}>{label}: {schedule[key].state==='closed'?'휴무':schedule[key].state==='unknown'?'확인 필요':schedule[key].intervals.map(i=>`${i.start}–${i.endsNextDay?'다음 날 ':''}${i.end}`).join(', ')}</li>)}</ul>;
}

function ScheduleEditor({label,value,onChange,disabled}:{label:string;value:WeeklySchedule;onChange:(v:WeeklySchedule)=>void;disabled:boolean}){
 const update=(key:keyof WeeklySchedule,day:WeeklyDay)=>onChange({...value,[key]:day});
 return <fieldset disabled={disabled} className="form-stack"><legend>{label}</legend>{days.map(([key,dayLabel])=>{
  const day=value[key];
  return <div key={key} className="form-stack"><label className="store-field"><span>{label} {dayLabel} 상태</span><NativeSelect value={day.state} onChange={e=>{const state=e.target.value as WeeklyDay['state'];update(key,{state,intervals:state==='open'?(day.intervals.length?day.intervals:[{start:'09:00',end:'18:00',endsNextDay:false}]):[]})}}><NativeSelectOption value="unknown">확인 필요</NativeSelectOption><NativeSelectOption value="open">영업</NativeSelectOption><NativeSelectOption value="closed">휴무</NativeSelectOption></NativeSelect></label>
   {day.state==='open'&&<>{day.intervals.map((interval,index)=><div key={index} className="flex gap-2 flex-wrap items-center">
    <label className="store-field"><span>{label} {dayLabel} {index+1} 시작</span><Input required type="time" value={interval.start} onChange={e=>update(key,{...day,intervals:day.intervals.map((x,i)=>i===index?{...x,start:e.target.value}:x)})}/></label>
    <label className="store-field"><span>{label} {dayLabel} {index+1} 종료</span><Input required type="time" value={interval.end} onChange={e=>update(key,{...day,intervals:day.intervals.map((x,i)=>i===index?{...x,end:e.target.value}:x)})}/></label>
    <label><CheckInput checked={interval.endsNextDay} onChange={e=>update(key,{...day,intervals:day.intervals.map((x,i)=>i===index?{...x,endsNextDay:e.target.checked}:x)})}/>다음 날 종료</label>
    <Button type="button" variant="ghost" disabled={disabled} onClick={()=>update(key,{...day,intervals:day.intervals.filter((_,i)=>i!==index)})}>시간대 삭제</Button>
   </div>)}<Button type="button" variant="outline" disabled={disabled||day.intervals.length>=6} disabledReason={day.intervals.length>=6?'한 요일에 최대 6개 시간대까지 입력하세요.':undefined} onClick={()=>update(key,{...day,intervals:[...day.intervals,{start:'09:00',end:'18:00',endsNextDay:false}]})}>영업 시간대 하나 더</Button></>}
  </div>;
 })}</fieldset>;
}

export function StoreBrowserWeekly({busy,connected,observed,onRead,onCreate}:{busy:boolean;connected:boolean;observed?:WeeklySchedule;onRead:()=>void;onCreate:(beforeSchedule:WeeklySchedule,afterSchedule:WeeklySchedule)=>Promise<void>}){
 const [before,setBefore]=useState<WeeklySchedule>(blank),[after,setAfter]=useState<WeeklySchedule>(blank);
 const complete=known(before)&&known(after);
 return <details><summary>요일별 영업시간 관리</summary><Note>요일별 영업·휴무와 시간대를 확인한 뒤 변경안을 저장하세요. 휴게시간이 있다면 전후 영업 시간을 나눠 쓰고 자정 이후 종료는 다음 날로 표시하세요.</Note>
  <div className="flex gap-2 flex-wrap"><Button type="button" variant="outline" disabled={busy||!connected} disabledReason={!connected?'이 점포의 네이버 계정을 먼저 연결하세요.':undefined} onClick={onRead}>요일별 현재 시간 확인</Button><Button type="button" variant="outline" disabled={busy||!observed} disabledReason={!observed?'요일별 시간 조회가 완료되면 가져올 수 있습니다.':undefined} onClick={()=>{if(observed){setBefore(observed);setAfter(observed)}}}>조회 결과 가져오기</Button></div>
  <form className="form-stack" onSubmit={e=>{e.preventDefault();void onCreate(before,after)}}><div className="form-two"><ScheduleEditor label="현재" value={before} onChange={setBefore} disabled={busy}/><ScheduleEditor label="변경" value={after} onChange={setAfter} disabled={busy}/></div><Button disabled={busy||!connected||!complete} disabledReason={!connected?'이 점포의 네이버 계정을 먼저 연결하세요.':!complete?'현재·변경 시간의 모든 요일을 영업 또는 휴무로 확인하세요.':undefined}>요일별 변경안 저장</Button></form>
 </details>;
}
