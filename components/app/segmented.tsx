'use client';
// 둘 이상 중 하나를 고르는 선택(탭처럼 보이지만 내용 패널을 바꾸지 않는 경우). role=tab은 연결된 tabpanel이 있어야 하므로(axe aria-valid-attr-value) radiogroup으로 둔다.
// 좌우 화살표로 선택을 옮긴다(WAI-ARIA radio group 패턴).
import {useRef} from 'react';
export type SegmentedOption<T extends string>={value:T;label:React.ReactNode};
export function Segmented<T extends string>({label,value,options,onChange,disabled}:{label:string;value:T;options:SegmentedOption<T>[];onChange:(value:T)=>void;disabled?:boolean}){
 const refs=useRef<(HTMLButtonElement|null)[]>([]);
 const move=(index:number)=>{const next=(index+options.length)%options.length;onChange(options[next].value);refs.current[next]?.focus();};
 return <div role="radiogroup" aria-label={label} className="segmented">{options.map((o,i)=><button key={o.value} ref={el=>{refs.current[i]=el;}} type="button" role="radio" aria-checked={value===o.value} tabIndex={value===o.value?0:-1} disabled={disabled} onClick={()=>onChange(o.value)} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();move(i+1);}else if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();move(i-1);}}}>{o.label}</button>)}</div>;
}
