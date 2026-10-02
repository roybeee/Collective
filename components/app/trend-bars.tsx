'use client';
// 주별 추세 막대(UX-PLAN-3 7차원 5점 조건 '추세 차트'). 계열 하나라 범례 없이 제목이 무엇을 그리는지 말한다.
// 막대 24px 이하·끝 4px 둥글게·바닥은 직각·막대 사이 간격, 가는 기준선 하나, 값 글자는 본문 색(데이터 색 아님).
// 값 표기는 마지막 막대와 가장 큰 막대에만 단다. 나머지는 막대에 마우스·초점을 두면 보이고, 아래 공용 표가 표 보기를 맡는다.
// 가장 큰 막대 표기는 늘 보인다. 마지막 막대 표기는 실제로 그려진 두 표기의 폭과 위치를 재서 겹치지 않을 때만 보인다(평가 10회차:
// 점 개수로만 정하면 넓은 화면에서 8주 막대 칸이 충분해도 마지막 주 '79,200원'이 숨었다). 390px 폭처럼 붙으면('99,000원79,200원') 가장 큰 막대 표기만 둔다.
// 폭을 재기 전(서버 렌더·ResizeObserver 없음)에는 좁은 화면 기준의 점 간격(trendLabelGap)으로 정한다.
// 숫자는 막대마다 접근 이름(aria-label)과 title, 아래 표에 그대로 남는다.
// 값을 모르는 주(null)는 막대 없이 '미확인'만 둔다(0으로 그리지 않는다). 글자는 화면 폭과 관계없이 같은 크기다(HTML 막대).
import {useEffect,useRef,useState} from 'react';
export type TrendPoint={label:string;value:number|null;display:string};
type Box={left:number;right:number};
export function TrendBars({title,points}:{title:string;points:readonly TrendPoint[]}){
 const [active,setActive]=useState<number|null>(null),[apart,setApart]=useState<boolean|null>(null),plot=useRef<HTMLUListElement>(null);
 const last=points.length-1;
 const peak=points.reduce((m,p,i)=>p.value!==null&&(points[m].value===null||p.value>(points[m].value as number))?i:m,0);
 const shape=points.map(p=>p.display).join('\n');
 // 두 표기(가장 큰 막대·마지막 막대)는 늘 글자를 그려 두고 숨길 때는 visibility만 끈다. 그래서 숨긴 표기도 실제 폭과 위치를 잴 수 있다.
 useEffect(()=>{
  const ul=plot.current;if(!ul||peak===last)return;
  const value=(i:number)=>ul.children[i]?.querySelector<HTMLElement>('.trend-value')??null;
  const measure=()=>{const a=value(peak),b=value(last);if(!a||!b||!ul.clientWidth)return;setApart(trendLabelsApart(a.getBoundingClientRect(),b.getBoundingClientRect()))};
  measure();
  if(typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(measure);observer.observe(ul);for(const el of [value(peak),value(last)])if(el)observer.observe(el);
  return()=>observer.disconnect();
 },[peak,last,shape]);
 if(points.length<2)return null;
 const max=Math.max(1,...points.map(p=>p.value===null?0:Math.max(0,p.value)));
 const showLast=last===peak||(apart??trendLabelGap(points.length)<=Math.abs(last-peak));
 return <figure className="trend-bars">
  <figcaption>{title}</figcaption>
  <ul className="trend-plot" aria-label={title} ref={plot}>{points.map((p,i)=>{const show=active===i||(active===null&&(i===peak||(i===last&&showLast))),drawn=p.value!==null&&(show||i===peak||i===last);
   return <li key={p.label} tabIndex={0} aria-label={`${p.label} ${p.display}`} title={`${p.label} ${p.display}`} onMouseEnter={()=>setActive(i)} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)}>
    <span className={'trend-value'+(show?'':' is-hidden')} aria-hidden="true">{drawn?p.display:''}</span>
    <span className="trend-track" aria-hidden="true">{p.value===null?<span className="trend-muted">미확인</span>:<span className={'trend-bar'+(active===i?' is-active':'')} style={{height:`${Math.max(2,Math.max(0,p.value)/max*100)}%`}}/>}</span>
    <span className="trend-label" aria-hidden="true">{p.label}</span>
   </li>})}</ul>
 </figure>;
}
// 폭을 재기 전 기준: 값 표기 두 개 사이에 둘 최소 막대 간격. 표기 하나는 최대 60px 안팎이고 좁은 화면(본문 288px)에서 막대 칸은 288/n px다.
export function trendLabelGap(count:number){return Math.max(1,Math.ceil(count/4));}
// 그려진 두 표기 상자가 gap(px) 이상 떨어져 있으면 둘 다 보인다.
export function trendLabelsApart(a:Box,b:Box,gap=8){return a.right+gap<=b.left||b.right+gap<=a.left;}
