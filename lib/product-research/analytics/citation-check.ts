// 인용 채점기(순수·엄격). 계획 ⑨·4.3: 선정 메모의 모든 주장은 관측 '행'을 1개 이상 인용하고, 주장 안의 모든 숫자는 그 숫자 앞에서 말한 대상의 인용 행 값과 맞아야 한다.
// 결정형 메모와 모델이 쓴 메모를 같은 기준으로 채점한다(평가 1회차 H2: 스냅샷 단위 인용·부호 무시·숫자 없는 주장 무검사를 막는다).
// 행 인용 형식(셋 중 하나):
//  1) refs: [{snapshotId, subject(kw:…·ls:…), metric, period?}] — 결정형 메모가 쓴다.
//  2) citations: ['<스냅샷ID>#<관측 번호>'] — 관측표 행 번호(모델 프롬프트가 이 형식을 요구한다).
//  3) citations: ['<스냅샷ID>'] — 하위 호환. 그 스냅샷에서 '주장이 이름을 말한 대상'의 행만 인용한 것으로 좁힌다(말하지 않은 대상의 값은 근거가 아니다).
// 행 단위 규칙:
//  - 인용한 행의 대상(키워드·상품 제목·별칭)은 주장 문장에 나와야 한다.
//  - 숫자는 그 숫자 앞에서 가장 가까이 말한 대상의 인용 행과만 맞춘다(대상을 앞에서 말하지 않았으면 인용 행 전체).
//    맞음: 개수 지표는 정확히 같음, 그 밖은 ±1%. '%'는 개수 지표에 쓸 수 없고(비율·상대값만, 값 그대로 또는 ×100), 음수 부호는 값이 음수일 때만, 단위(회·곳·개·원·위·점)는 지표와 맞아야 한다.
//  - 증가·감소·상승·하락 같은 방향 말은 같은 대상·지표의 두 시점 행을 인용하고 그 변화 방향이 같을 때만 쓴다(순위는 숫자가 작아지면 상승).
//  - 인증·허가·식약처·특허·최초·유일·독점·'경쟁이 없다' 같은 단정은 관측값으로 뒷받침할 수 없어 거절한다('1위'는 인용한 순위 행 값이 1일 때만).
//  - 날짜(YYYY-MM-DD, YYYY년 M월 D일)는 인용 행의 관측 기간이나 그 스냅샷 수집일과 같아야 한다.
// 상품·키워드 이름 안의 숫자는 allowedTerms(와 인용 행의 대상 이름)로만 뺀다.
import type {ClaimRef,MetricKey,Observation,Snapshot} from '../types';
import {normalizeKeyword} from './normalize';

export const COUNT_METRICS:ReadonlySet<MetricKey>=new Set<MetricKey>(['search_volume_month','search_volume_pc','search_volume_mobile','product_count','seller_count','video_views','video_count','rank','review_count','own_orders']);
// 단위 → 그 단위로 말할 수 있는 지표.
const UNIT_METRICS:Record<string,readonly MetricKey[]>={
 '회':['search_volume_month','search_volume_pc','search_volume_mobile','video_views','video_view_velocity'],
 '곳':['seller_count'],
 '개':['product_count','video_count','review_count','own_orders','sales_estimate'],
 '건':['review_count','own_orders','sales_estimate'],
 '원':['price_min','price_median','own_revenue'],
 '위':['rank'],
 '점':['rating','search_trend','shopping_click_trend'],
 '명':[],
};
export type ExtractedNumber={raw:string;value:number;percent:boolean;scaled:boolean;negative:boolean;unit:string|null;index:number};
export type ExtractedDate={raw:string;prefix:string;index:number};

const MULT:Record<string,number>={'천':1e3,'만':1e4,'억':1e8};
const blank=(m:string)=>' '.repeat(m.length);
// 이름(allowedTerms) 자리를 같은 길이 공백으로 지운 글(숫자 위치가 원문과 같다).
export function maskTerms(text:string,terms:readonly string[]):string{
 let s=String(text??'').normalize('NFC');
 for(const t of [...new Set(terms.filter(Boolean).map(x=>x.normalize('NFC')))].sort((a,b)=>b.length-a.length))s=s.split(t).join(blank(t));
 return s;
}
export function extractFigures(text:string,allowedTerms:readonly string[]=[]):{numbers:ExtractedNumber[];dates:ExtractedDate[]}{
 let s=maskTerms(text,allowedTerms);
 const dates:ExtractedDate[]=[];
 s=s.replace(/(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?/g,(m,y,mo,d,i:number)=>{dates.push({raw:m,prefix:`${y}-${mo}-${d}`,index:i});return blank(m)});
 s=s.replace(/(\d{4})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?/g,(m,y,mo,d,i:number)=>{dates.push({raw:m,prefix:`${y}-${String(mo).padStart(2,'0')}${d?'-'+String(d).padStart(2,'0'):''}`,index:i});return blank(m)});
 const numbers:ExtractedNumber[]=[],re=/([-−–]\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(천|만|억)?\s*(%|퍼센트)?\s*(회|곳|개|건|원|위|점|명)?/g;let m:RegExpExecArray|null;
 while((m=re.exec(s))){
  const base=Number(m[2].replace(/,/g,'')+(m[3]?'.'+m[3]:'')),mult=m[4]?MULT[m[4]]:1,prev=m.index>0?s[m.index-1]:'';
  // '1-2개' 같은 범위의 '-'는 부호가 아니다.
  const negative=!!m[1]&&!/\d/.test(prev);
  numbers.push({raw:m[0].trim(),value:Math.round(base*mult*1e6)/1e6,percent:!!m[5],scaled:!!m[4],negative,unit:m[6]??null,index:m.index});
 }
 return {numbers,dates};
}
const close=(a:number,b:number,exact:boolean)=>exact?Math.abs(a-b)<1e-9:(b===0?Math.abs(a)<1e-9:Math.abs(a-b)<=Math.abs(b)*0.01+1e-9);
// 숫자 하나가 관측 행 하나를 뒷받침하는가(값·부호·%·단위).
export function supports(n:ExtractedNumber,metric:MetricKey,value:number):boolean{
 if(n.unit!==null&&!(UNIT_METRICS[n.unit]??[]).includes(metric))return false;
 if(value<0!==n.negative&&!(value===0&&!n.negative))return false;
 const exact=COUNT_METRICS.has(metric),v=Math.abs(value);
 if(n.percent){if(exact)return false;return close(n.value,v,false)||(v<=1&&close(n.value,v*100,false))}
 return close(n.value,v,exact);
}

export const CLAIM_FORBIDDEN=/인증|허가|식약처|특허|최초|유일|독점|경쟁(?:이|자가|자는|자도|상품이|상품은|상품도)?\s*(?:없|전무)/;
export const PROSE_FORBIDDEN=/(?:인증|허가|특허|심사|등록)(?:을|를|도)?\s*(?:받았|받은|받아|획득|완료|보유|통과)|경쟁(?:이|자가|자는|자도|상품이|상품은|상품도)?\s*(?:없|전무)|유일|최초|독점|(?:^|[^\d,.])1\s*위/;
const UP=/증가|상승|늘었|늘어|늘고|늘었|올랐|오르|오름|급등|성장/,DOWN=/감소|하락|줄었|줄어|줄고|내렸|내려|떨어|급락/;
const ONE_RANK=/(?:^|[^\d,.])1\s*위/;

type Row={snap:Snapshot;obs:Observation;index:number;ref:ClaimRef;labels:string[]};
export const rowId=(snapshotId:string,index:number)=>`${snapshotId}#${index}`;
const obsSubjectKey=(o:Observation)=>o.subject.type==='keyword'?`kw:${normalizeKeyword(o.subject.text)}`:`ls:${o.subject.sourceId}:${o.subject.externalId}`;
const obsLabel=(o:Observation)=>o.subject.type==='keyword'?o.subject.text:o.subject.title;
const compact=(s:string)=>s.normalize('NFC').replace(/\s+/g,'');
// 대상 이름이 글에 나온 위치들(공백은 있어도 없어도 같다고 본다). 대소문자 무시.
function mentionPositions(text:string,labels:readonly string[]):number[]{
 const out:number[]=[];
 for(const l of labels){const c=compact(l);if(!c)continue;
  const re=new RegExp([...c].map(ch=>ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*'),'giu');let m:RegExpExecArray|null;
  while((m=re.exec(text))){out.push(m.index);if(m[0].length===0)re.lastIndex++}}
 return out.sort((a,b)=>a-b);
}

export type CitationClaim={text:string;citations:readonly string[];refs?:readonly ClaimRef[]};
export type CitationOptions={
 allowedTerms?:readonly string[];
 // 근거로 인정할 행(관측표). 주어지면 이 밖의 행은 인용해도 근거가 아니다. 형식: rowId(스냅샷ID, 관측 번호).
 allowedRows?:ReadonlySet<string>;
 // 대상 별칭(대상 키 → 이름들): 상품 이름·관측표에 실린 다듬은 제목 등.
 subjectAliases?:Readonly<Record<string,readonly string[]>>;
};
export type ClaimResult={unsupported:string[];refs:ClaimRef[];numbers:ExtractedNumber[];dates:ExtractedDate[]};

function labelsFor(o:Observation,key:string,opts:CitationOptions){
 return [...new Set([obsLabel(o),...(key.startsWith('kw:')?[key.slice(3)]:[]),...(opts.subjectAliases?.[key]??[])].filter(x=>compact(x).length>0))];
}
// 주장 하나 채점. tag는 메시지 머리(예: '주장 2').
export function checkClaim(c:CitationClaim,tag:string,byId:ReadonlyMap<string,Snapshot>,opts:CitationOptions={}):ClaimResult{
 const unsupported:string[]=[],text=String(c.text??'').normalize('NFC');
 const citations=[...(c.citations??[])],explicit=[...(c.refs??[])];
 if(!citations.length&&!explicit.length){unsupported.push(`${tag}: 인용이 없습니다 — "${c.text}"`);return {unsupported,refs:[],numbers:[],dates:[]}}
 const rows:Row[]=[],seen=new Set<string>();
 const allowed=(s:Snapshot,i:number)=>!opts.allowedRows||opts.allowedRows.has(rowId(s.id,i));
 const usable=(id:string)=>{const s=byId.get(id);if(!s){unsupported.push(`${tag}: 없는 스냅샷 ${id}을 인용했습니다.`);return null}if(s.status==='failed'){unsupported.push(`${tag}: 실패한 스냅샷 ${id}은 근거가 될 수 없습니다.`);return null}return s};
 const add=(s:Snapshot,i:number)=>{const k=rowId(s.id,i);if(seen.has(k))return;seen.add(k);const o=s.observations[i],key=obsSubjectKey(o);rows.push({snap:s,obs:o,index:i,ref:{snapshotId:s.id,subject:key,metric:o.metric,period:o.period.to},labels:labelsFor(o,key,opts)})};
 for(const r of explicit){
  const s=usable(r.snapshotId);if(!s)continue;let n=0;
  s.observations.forEach((o,i)=>{if(obsSubjectKey(o)===r.subject&&o.metric===r.metric&&(!r.period||o.period.to===r.period)&&allowed(s,i)){add(s,i);n++}});
  if(!n)unsupported.push(`${tag}: 인용한 행(${r.snapshotId} · ${r.subject} · ${r.metric}${r.period?` · ${r.period}`:''})이 스냅샷·관측표에 없습니다.`);
 }
 for(const cit of citations){
  const hash=cit.lastIndexOf('#'),id=hash>0?cit.slice(0,hash):cit,s=usable(id);if(!s)continue;
  if(hash>0){
   const i=Number(cit.slice(hash+1));
   if(!Number.isInteger(i)||i<0||i>=s.observations.length||!allowed(s,i)){unsupported.push(`${tag}: 인용한 행 ${cit}이 관측표에 없습니다.`);continue}
   add(s,i);continue;
  }
  if(explicit.some(r=>r.snapshotId===id)||rows.some(r=>r.snap.id===id))continue;
  // 스냅샷 단위 인용: 주장이 이름을 말한 대상의 행만.
  let n=0;s.observations.forEach((o,i)=>{if(!allowed(s,i))return;if(mentionPositions(text,labelsFor(o,obsSubjectKey(o),opts)).length){add(s,i);n++}});
  if(!n)unsupported.push(`${tag}: 스냅샷 ${id}에서 주장이 말한 대상의 관측 행을 찾지 못했습니다(대상 이름을 쓰거나 행 번호로 인용하세요).`);
 }
 if(!rows.length){if(!unsupported.length)unsupported.push(`${tag}: 인용한 관측 행이 없습니다.`);return {unsupported,refs:[],numbers:[],dates:[]}}
 // 인용 행의 대상은 문장에 나와야 한다.
 const bySubject=new Map<string,{rows:Row[];mentions:number[]}>();
 for(const r of rows){const e=bySubject.get(r.ref.subject)??{rows:[],mentions:[]};e.rows.push(r);bySubject.set(r.ref.subject,e)}
 for(const [key,e] of bySubject){e.mentions=mentionPositions(text,[...new Set(e.rows.flatMap(r=>r.labels))]);if(!e.mentions.length)unsupported.push(`${tag}: 인용한 행의 대상 '${obsLabel(e.rows[0].obs)}'(${key})이 주장 문장에 없습니다.`)}
 const terms=[...(opts.allowedTerms??[]),...rows.flatMap(r=>r.labels),...rows.map(r=>r.obs.scope??'')];
 const masked=maskTerms(text,terms);
 if(CLAIM_FORBIDDEN.test(masked))unsupported.push(`${tag}: 인증·허가·특허·최초·유일·'경쟁 없음' 같은 단정은 관측값으로 뒷받침할 수 없습니다 — "${c.text}"`);
 if(ONE_RANK.test(masked)&&!rows.some(r=>r.obs.metric==='rank'&&r.obs.value===1))unsupported.push(`${tag}: '1위'를 뒷받침하는 순위 행(값 1)이 없습니다.`);
 const {numbers,dates}=extractFigures(text,terms);
 for(const n of numbers){
  // 숫자 앞에서 가장 가까이 말한 대상의 행과만 맞춘다.
  let best=-1,cands:Row[]=[];
  for(const e of bySubject.values()){const p=e.mentions.filter(x=>x<n.index).pop();if(p===undefined)continue;if(p>best){best=p;cands=[...e.rows]}else if(p===best)cands.push(...e.rows)}
  if(best<0)cands=rows;
  const hit=cands.some(r=>typeof r.obs.value==='number'&&Number.isFinite(r.obs.value)&&supports(n,r.obs.metric,r.obs.value));
  if(!hit){
   const cited=new Set(rows.map(r=>r.snap.id));
   const elsewhere=[...byId.values()].some(s=>!cited.has(s.id)&&s.status!=='failed'&&s.observations.some(o=>typeof o.value==='number'&&supports(n,o.metric,o.value)));
   const sideways=!elsewhere&&rows.some(r=>!cands.includes(r)&&typeof r.obs.value==='number'&&supports(n,r.obs.metric,r.obs.value));
   unsupported.push(`${tag}: '${n.raw}'와 맞는 관측값이 그 앞에서 말한 대상의 인용 행에 없습니다${elsewhere?'(인용하지 않은 스냅샷에만 있음)':sideways?'(다른 대상의 값임)':''}.`);
  }
 }
 for(const d of dates){
  const hit=rows.some(r=>r.snap.fetchedAt.startsWith(d.prefix)||r.obs.period.from.startsWith(d.prefix)||r.obs.period.to.startsWith(d.prefix));
  if(!hit)unsupported.push(`${tag}: 날짜 '${d.raw}'가 인용한 행의 관측 기간·수집일과 다릅니다.`);
 }
 // 방향 말: 같은 대상·지표의 두 시점 행이 같은 방향으로 변해야 한다.
 const up=UP.test(masked),down=DOWN.test(masked);
 if(up&&down)unsupported.push(`${tag}: 증가와 감소를 함께 말해 방향을 확인할 수 없습니다.`);
 else if(up||down){
  const groups=new Map<string,Row[]>();for(const r of rows)if(typeof r.obs.value==='number'){const k=`${r.ref.subject}|${r.obs.metric}`;groups.set(k,[...(groups.get(k)??[]),r])}
  const ok=[...groups.values()].some(g=>{const s=[...g].sort((a,b)=>a.obs.period.to<b.obs.period.to?-1:a.obs.period.to>b.obs.period.to?1:0);if(s.length<2||s[0].obs.period.to===s[s.length-1].obs.period.to)return false;
   let delta=(s[s.length-1].obs.value as number)-(s[0].obs.value as number);if(s[0].obs.metric==='rank')delta=-delta;return up?delta>0:delta<0});
  if(!ok)unsupported.push(`${tag}: '${up?'증가·상승':'감소·하락'}'을 뒷받침하는 같은 대상·지표의 두 시점 관측 행(같은 방향 변화)이 없습니다.`);
 }
 return {unsupported,refs:rows.map(r=>r.ref),numbers,dates};
}

export function checkCitations(claims:readonly CitationClaim[],snapshots:readonly Snapshot[],opts:CitationOptions={}):{passed:boolean;unsupported:string[];refs:ClaimRef[][]}{
 const byId=new Map(snapshots.map(s=>[s.id,s])),unsupported:string[]=[],refs:ClaimRef[][]=[];
 claims.forEach((c,i)=>{const r=checkClaim(c,`주장 ${i+1}`,byId,opts);unsupported.push(...r.unsupported);refs.push(r.refs)});
 return {passed:unsupported.length===0,unsupported,refs};
}

// 요약·리스크 글(모델 메모): 숫자·날짜는 통과한 주장에 나온 것만, 인증·경쟁 없음 같은 단정은 금지.
export function checkProse(items:readonly {tag:string;text:string}[],claimTexts:readonly string[],opts:{allowedTerms?:readonly string[]}={}):string[]{
 const terms=opts.allowedTerms??[],out:string[]=[];
 const known=claimTexts.map(t=>extractFigures(t,terms)),nums=known.flatMap(k=>k.numbers),dates=new Set(known.flatMap(k=>k.dates.map(d=>d.prefix)));
 for(const {tag,text} of items){
  const masked=maskTerms(text,terms);
  if(PROSE_FORBIDDEN.test(masked))out.push(`${tag}: 인증·허가 획득·'경쟁 없음'·유일·최초·1위 같은 단정은 쓸 수 없습니다 — "${text}"`);
  const f=extractFigures(text,terms);
  for(const n of f.numbers)if(!nums.some(k=>close(n.value,k.value,true)&&k.negative===n.negative&&k.percent===n.percent))out.push(`${tag}: '${n.raw}'는 인용 검사를 통과한 주장에 없는 숫자입니다(요약·리스크에는 새 숫자를 쓰지 않습니다).`);
  for(const d of f.dates)if(!dates.has(d.prefix))out.push(`${tag}: 날짜 '${d.raw}'는 주장에 없는 날짜입니다.`);
 }
 return out;
}
