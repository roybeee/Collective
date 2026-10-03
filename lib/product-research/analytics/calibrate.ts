// 데이터랩 상대값(0~100) → 절대 검색량 보정(순수). 계획 ③: 검색광고 월간 검색수(최근 30일 실측)를 기준점으로 쓴다.
// 배율 = 기준점 값 / 같은 30일 창 안 상대값 평균. 기준점이 둘 이상이면 가장 최근 것으로 배율을 잡고 나머지로 오차를 잰다(보정 오차 ≤15%가 ③ 5점 조건).
// 오차 검증(M3): 검색광고는 매일 '최근 30일'을 다시 주므로 기준점 창이 서로 거의 겹친다. 겹친 창끼리 비교하면 같은 값을 두 번 재는 셈이라 오차가 낮게 나온다.
// 그래서 오차는 달력 월마다 기준점 하나만 쓰고(최근 것부터 고름), 30일 창이 배율 기준점·다른 검사 기준점과 겹치지 않는 것만 비교한다.
// 비교 = 그 기준점 값 vs 배율 × 같은 30일 창의 상대값 평균. 겹치지 않는 기준점이 2개(배율 1 + 검사 1) 미만이면 오차는 null이다.
import type {SeriesPoint} from '../types';
import {DAY_MS,timeOf} from './series';

export type CalibrationCheck={anchorAt:string;snapshotId:string;actual:number;predicted:number;relative:number;month?:string};
export type CalibrationResult={
 scale:number;
 anchor:{at:string;value:number;snapshotId:string;relativeMean:number;points:number};
 // 상대값 점마다 '그 시점의 30일 환산 검색량'. snapshotId는 상대값 스냅샷이고, 기준점 스냅샷은 evidence에 있다.
 points:SeriesPoint[];
 // 달력 월 검색량 추정 = 배율 × 월 평균 상대값 × (그 달 일수/30). 처음·마지막 달은 일부만 덮을 수 있어 complete=false.
 monthly:{month:string;volume:number;points:number;complete:boolean}[];
 // 서로 겹치지 않는 달력 월 기준점이 둘 이상일 때만 값이 있다. relative는 평균 상대 오차, max는 최대. skipped는 겹쳐서 뺀 기준점 수.
 error:{relative:number;max:number;checks:CalibrationCheck[];skipped?:number}|null;
 evidence:string[];
};
const WINDOW_DAYS=30;
function windowMean(relative:readonly SeriesPoint[],at:string,days:number){
 const end=timeOf(at),start=end-days*DAY_MS,vals=relative.filter(p=>p.value!==null&&timeOf(p.at)>start&&timeOf(p.at)<=end).map(p=>p.value as number);
 return {mean:vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null,points:vals.length};
}
// 기준점(anchor)은 search_volume_month 점이다: at=30일 창의 끝. 상대값이 그 창에 minPoints개 미만이거나 평균이 0이면 그 기준점은 쓰지 않는다.
// 쓸 기준점이 없으면 null(추정하지 않음).
export function calibrateTrend(relative:readonly SeriesPoint[],anchors:readonly SeriesPoint[],opts:{windowDays?:number;minPoints?:number}={}):CalibrationResult|null{
 const days=opts.windowDays??WINDOW_DAYS,minPoints=opts.minPoints??2;
 const rel=relative.filter(p=>p.value!==null).sort((a,b)=>timeOf(a.at)-timeOf(b.at));
 const usable=anchors.filter(a=>a.value!==null&&(a.value as number)>0).map(a=>({a,w:windowMean(rel,a.at,days)})).filter(x=>x.w.mean!==null&&x.w.mean>0&&x.w.points>=minPoints).sort((x,y)=>timeOf(x.a.at)-timeOf(y.a.at));
 if(!usable.length)return null;
 const main=usable[usable.length-1],scale=(main.a.value as number)/(main.w.mean as number);
 // 최근 것부터: 30일 창이 앞서 고른 창(배율 기준점 창 포함)과 겹치지 않고, 아직 쓰지 않은 달력 월의 기준점만 고른다(달마다 하나).
 const picked:typeof usable=[],usedMonths=new Set([main.a.at.slice(0,7)]);let edge=timeOf(main.a.at)-days*DAY_MS;
 for(const x of [...usable].reverse()){if(x===main)continue;const t=timeOf(x.a.at),mo=x.a.at.slice(0,7);if(t<=edge&&!usedMonths.has(mo)){picked.push(x);usedMonths.add(mo);edge=t-days*DAY_MS}}
 const checks=picked.reverse().map(x=>{const actual=x.a.value as number,predicted=scale*(x.w.mean as number);return {anchorAt:x.a.at,snapshotId:x.a.snapshotId,actual,predicted,relative:Math.abs(predicted-actual)/actual,month:x.a.at.slice(0,7)}});
 const points=rel.map(p=>({at:p.at,value:scale*(p.value as number),snapshotId:p.snapshotId}));
 const byMonth=new Map<string,number[]>();for(const p of rel){const m=p.at.slice(0,7);byMonth.set(m,[...(byMonth.get(m)??[]),p.value as number])}
 const months=[...byMonth.keys()].sort(),monthly=months.map((m,i)=>{const vs=byMonth.get(m)!,y=Number(m.slice(0,4)),mo=Number(m.slice(5,7)),dim=new Date(Date.UTC(y,mo,0)).getUTCDate();return {month:m,volume:scale*(vs.reduce((a,b)=>a+b,0)/vs.length)*dim/30,points:vs.length,complete:i>0&&i<months.length-1}});
 return {scale,anchor:{at:main.a.at,value:main.a.value as number,snapshotId:main.a.snapshotId,relativeMean:main.w.mean as number,points:main.w.points},points,monthly,
  error:checks.length?{relative:checks.reduce((s,c)=>s+c.relative,0)/checks.length,max:Math.max(...checks.map(c=>c.relative)),checks,skipped:usable.length-1-checks.length}:null,
  evidence:[...new Set([main.a.snapshotId,...rel.map(p=>p.snapshotId)])]};
}
// 기준 시점의 30일 환산 검색량: 마지막 30일 창의 상대값 평균 × 배율. 보정이 없으면 null.
export function currentVolume(c:CalibrationResult|null):number|null{
 if(!c||!c.points.length)return null;const last=c.points[c.points.length-1].at,w=windowMean(c.points,last,WINDOW_DAYS);return w.mean;
}
