'use client';
// 공용 데이터 표(UX-PLAN-3 7차원 '목록형 기록은 공용 표: 정렬·필터·모바일 카드'). 화면마다 <table>을 따로 그리지 않는다.
// - 정렬: 열에 sort 값을 주면 머리글을 눌러 오름·내림차순을 바꾸고 aria-sort로 알린다.
// - 찾기: filterText를 주면 표 위에 찾기 칸을 둔다. 찾은 행 수를 화면 읽기 프로그램에 알린다.
// - 모바일: 머리글이 숨는 좁은 화면에서는 칸마다 열 이름(data-label)을 붙여 카드처럼 읽는다(globals.css .data-table).
// - CSV: csvName(영문 파일 이름. 일부 브라우저는 한글 파일 이름을 버린다)과 열의 csv 값을 주면 'CSV 내려받기'로 지금 보이는 순서의 행을 내려받는다(엑셀 한글이 깨지지 않게 BOM).
import {useId,useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
export type DataColumn<R>={label:string;cell:(row:R)=>React.ReactNode;sort?:(row:R)=>string|number;csv?:(row:R)=>string|number;align?:'right'};
// 화면용으로 형식을 갖춘 숫자 문자열('1,200원', '3건')을 정렬 값으로 바꾼다. 숫자가 없으면('미확인') 맨 끝으로 보낸다.
export const sortNumber=(v:string|number|null|undefined)=>{if(typeof v==='number')return v;const n=Number(String(v??'').replace(/[^0-9.-]/g,''));return String(v??'').match(/[0-9]/)&&Number.isFinite(n)?n:-Infinity};
const csvCell=(v:string|number)=>{const s=String(v);return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};
export function DataTable<R>({rows,columns,rowKey,caption,captionHidden=true,csvName,filterText,limit,className}:{rows:readonly R[];columns:readonly DataColumn<R>[];rowKey:(row:R)=>string;caption:React.ReactNode;captionHidden?:boolean;csvName?:string;filterText?:(row:R)=>string;limit?:number;className?:string}){
 const [sort,setSort]=useState<{i:number;dir:1|-1}|null>(null),[query,setQuery]=useState(''),statusId=useId();
 const shown=useMemo(()=>{
  const q=query.trim().toLowerCase();let list=filterText&&q?rows.filter(r=>filterText(r).toLowerCase().includes(q)):[...rows];
  const by=sort&&columns[sort.i]?.sort;
  if(sort&&by)list=[...list].sort((a,b)=>{const x=by(a),y=by(b);return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'ko'))*sort.dir});
  return limit?list.slice(0,limit):list;
 },[rows,columns,sort,query,filterText,limit]);
 const csvColumns=columns.filter(c=>c.csv);
 function download(){
  const lines=[csvColumns.map(c=>csvCell(c.label)).join(','),...shown.map(r=>csvColumns.map(c=>csvCell(c.csv!(r))).join(','))];
  const url=URL.createObjectURL(new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`${csvName}.csv`;a.hidden=true;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 // 찾기는 행이 5개 이상일 때만 둔다(1~4행 표의 찾기 칸은 소음이다, 평가 7회차).
 const searchable=!!filterText&&rows.length>=5;
 // 숫자 열은 오른쪽 정렬한다. align을 주지 않아도 모든 행의 정렬 값이 숫자이고 날짜·시각 열이 아니면 숫자 열로 본다.
 const right=(c:DataColumn<R>)=>c.align==='right'||(!!c.sort&&rows.length>0&&!/(일|시각|날짜|기간|주)$/.test(c.label)&&rows.every(r=>typeof c.sort!(r)==='number'));
 return <div className={'data-table-wrap'+(className?' '+className:'')}>
  {((searchable)||(csvName&&csvColumns.length>0))&&<div className="data-table-tools">
   {searchable&&<Input type="search" aria-label="표 안에서 찾기" aria-describedby={statusId} placeholder="표 안에서 찾기" value={query} onChange={e=>setQuery(e.target.value)}/>}
   {csvName&&csvColumns.length>0&&<Button type="button" variant="outline" size="sm" disabled={!shown.length} onClick={download}>CSV 내려받기</Button>}
   <span id={statusId} className="sr-only" role="status">{query?`${shown.length}행을 찾았습니다.`:''}</span>
  </div>}
  <div className="ledger-table-wrap"><table className="ledger-table data-table">
   <caption className={captionHidden?'sr-only':undefined}>{caption}</caption>
   <thead><tr>{columns.map((c,i)=><th key={c.label} scope="col" className={right(c)?'text-right tabular-nums':undefined} aria-sort={c.sort?(sort?.i===i?(sort.dir===1?'ascending':'descending'):'none'):undefined}>{c.sort?<Button type="button" variant="ghost" size="sm" className="table-sort" aria-label={`${c.label} 정렬`} onClick={()=>setSort(s=>s?.i===i?{i,dir:s.dir===1?-1:1}:{i,dir:1})}>{c.label}<span aria-hidden="true">{sort?.i===i?(sort.dir===1?' ↑':' ↓'):''}</span></Button>:c.label}</th>)}</tr></thead>
   <tbody>{shown.map(r=><tr key={rowKey(r)}>{columns.map(c=><td key={c.label} data-label={c.label} className={right(c)?'text-right tabular-nums':undefined}>{c.cell(r)}</td>)}</tr>)}</tbody>
  </table></div>
 </div>;
}
