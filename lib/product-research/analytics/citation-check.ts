// 인용 채점기(순수·엄격). 계획 ⑨·4.3: 선정 메모의 모든 주장은 존재하는 스냅샷을 1개 이상 인용하고,
// 주장 안의 모든 숫자는 '인용한' 스냅샷의 관측값과 맞아야 한다. 결정형 메모와 모델이 쓴 메모를 같은 기준으로 채점한다.
// 맞음 기준: 개수 지표(검색수·판매처·상품 수·리뷰·순위 등)는 정확히 같아야 하고, 그 밖(가격·평점·상대값·지수)은 ±1%다.
// '%'가 붙은 숫자는 관측값 그대로 또는 ×100(비율 지표)과 비교한다. '만·천·억' 단위는 곱해서 비교한다(1.23만=12300).
// 날짜(YYYY-MM-DD, YYYY년 M월 D일)는 인용 스냅샷의 관측 기간이나 수집일과 같아야 한다. 상품·키워드 이름 안의 숫자는 allowedTerms로만 뺀다.
import type {MetricKey,Snapshot} from '../types';

export const COUNT_METRICS:ReadonlySet<MetricKey>=new Set<MetricKey>(['search_volume_month','search_volume_pc','search_volume_mobile','product_count','seller_count','video_views','video_count','rank','review_count','own_orders']);
export type ExtractedNumber={raw:string;value:number;percent:boolean;scaled:boolean};
export type ExtractedDate={raw:string;prefix:string};

const MULT:Record<string,number>={'천':1e3,'만':1e4,'억':1e8};
export function extractFigures(text:string,allowedTerms:readonly string[]=[]):{numbers:ExtractedNumber[];dates:ExtractedDate[]}{
 let s=String(text??'').normalize('NFC');
 for(const t of [...allowedTerms].filter(Boolean).sort((a,b)=>b.length-a.length))s=s.split(t.normalize('NFC')).join(' ');
 const dates:ExtractedDate[]=[];
 s=s.replace(/(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?/g,(m,y,mo,d)=>{dates.push({raw:m,prefix:`${y}-${mo}-${d}`});return ' '});
 s=s.replace(/(\d{4})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?/g,(m,y,mo,d)=>{dates.push({raw:m,prefix:`${y}-${String(mo).padStart(2,'0')}${d?'-'+String(d).padStart(2,'0'):''}`});return ' '});
 const numbers:ExtractedNumber[]=[],re=/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(천|만|억)?\s*(%|퍼센트)?/g;let m:RegExpExecArray|null;
 while((m=re.exec(s))){const base=Number(m[1].replace(/,/g,'')+(m[2]?'.'+m[2]:'')),mult=m[3]?MULT[m[3]]:1;numbers.push({raw:m[0].trim(),value:Math.round(base*mult*1e6)/1e6,percent:!!m[4],scaled:!!m[3]})}
 return {numbers,dates};
}
const close=(a:number,b:number,exact:boolean)=>exact?Math.abs(a-b)<1e-9:(b===0?Math.abs(a)<1e-9:Math.abs(a-b)<=Math.abs(b)*0.01+1e-9);
function supports(n:ExtractedNumber,metric:MetricKey,value:number){
 const exact=COUNT_METRICS.has(metric),v=Math.abs(value);
 if(n.percent)return close(n.value,v,exact)||close(n.value,v*100,false);
 return close(n.value,v,exact);
}

export type CitationClaim={text:string;citations:readonly string[]};
export function checkCitations(claims:readonly CitationClaim[],snapshots:readonly Snapshot[],opts:{allowedTerms?:readonly string[]}={}):{passed:boolean;unsupported:string[]}{
 const byId=new Map(snapshots.map(s=>[s.id,s])),unsupported:string[]=[];
 claims.forEach((c,i)=>{
  const tag=`주장 ${i+1}`;
  if(!c.citations?.length){unsupported.push(`${tag}: 인용이 없습니다 — "${c.text}"`);return}
  const cited:Snapshot[]=[];
  for(const id of c.citations){const s=byId.get(id);if(!s)unsupported.push(`${tag}: 없는 스냅샷 ${id}을 인용했습니다.`);else if(s.status==='failed')unsupported.push(`${tag}: 실패한 스냅샷 ${id}은 근거가 될 수 없습니다.`);else cited.push(s)}
  const {numbers,dates}=extractFigures(c.text,opts.allowedTerms);
  for(const n of numbers){
   const hit=cited.some(s=>s.observations.some(o=>typeof o.value==='number'&&Number.isFinite(o.value)&&supports(n,o.metric,o.value)));
   if(!hit){
    const elsewhere=snapshots.some(s=>!c.citations.includes(s.id)&&s.observations.some(o=>typeof o.value==='number'&&supports(n,o.metric,o.value)));
    unsupported.push(`${tag}: '${n.raw}'와 맞는 관측값이 인용한 스냅샷에 없습니다${elsewhere?'(인용하지 않은 스냅샷에만 있음)':''}.`);
   }
  }
  for(const d of dates){
   const hit=cited.some(s=>s.fetchedAt.startsWith(d.prefix)||s.observations.some(o=>o.period.from.startsWith(d.prefix)||o.period.to.startsWith(d.prefix)));
   if(!hit)unsupported.push(`${tag}: 날짜 '${d.raw}'가 인용한 스냅샷의 관측 기간·수집일과 다릅니다.`);
  }
 });
 return {passed:unsupported.length===0,unsupported};
}
