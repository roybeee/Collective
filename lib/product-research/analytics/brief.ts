// 결정형 MD 선정 메모(순수). 계획 4.3: 모든 주장은 점수표 근거(evidence) 스냅샷의 관측 '행'을 인용하고, 주장 속 숫자는 그 행의 관측값 그대로다.
// 파생 수치(점수·성장률)는 주장(claims)에 넣지 않고 요약(summary)에만 쓴다. 그래야 citation-check가 주장 전체를 엄격히 채점할 수 있다.
// 평가 3회차 H-3: 주장은 구조(상품·행·종류·비교 행)로 정하고 문장은 서버가 고정 틀(renderClaim)로 만든다. 결정형 메모와 모델 메모(server-brief.ts)가
// 같은 틀·같은 검사(gradeClaims: 행·상품·종류 확인 → 틀 문장 → 인용 채점기)를 지난다. 숫자·단위·기간·방향은 행 값에서 나오므로 틀릴 수 없다.
import type {ClaimRef,KeywordGroup,MdBrief,MetricKey,Observation,ResearchProduct,ScoreCard,Snapshot} from '../types';
import {sourceSpec} from '../sources';
import {checkCitations,COUNT_METRICS,MONEY_METRICS,rowId} from './citation-check';
import {koNumber} from './format';
import {shortId} from './hash';
import {normalizeKeyword} from './normalize';
import {subjectKey,timeOf} from './series';

const TIER_ORDER:Record<ScoreCard['tier'],number>={adopt:0,watch:1,needs_data:2,reject:3};
export const TIER_LABEL:Record<ScoreCard['tier'],string>={adopt:'도입 검토',watch:'관찰',needs_data:'자료 보강',reject:'제외'};
// 주장 틀: 지표 이름과 단위. 값은 관측값 그대로(koNumber: 쉼표만 더함) 적는다. 여기 없는 지표는 주장으로 만들지 않는다.
const CLAIM_METRICS:Partial<Record<MetricKey,{label:string;unit:string}>>={
 search_volume_month:{label:'월간 검색수',unit:'회'},
 search_trend:{label:'검색 추세 상대값',unit:''},
 seller_count:{label:'판매처',unit:'곳'},
 product_count:{label:'쇼핑 검색 상품',unit:'개'},
 ad_competition:{label:'광고 경쟁 지수',unit:''},
 price_min:{label:'최저가',unit:'원'},
 price_median:{label:'중간 가격',unit:'원'},
 video_count:{label:'관련 영상',unit:'개'},
 video_views:{label:'추적 영상 누적 조회수',unit:'회'},
 rank:{label:'순위',unit:'위'},
 review_count:{label:'리뷰',unit:'개'},
 rating:{label:'평점',unit:''},
 sales_estimate:{label:'판매 추정',unit:'개'},
};
// 주장 종류. value는 어떤 지표든, count·price·rank는 그 갈래의 지표만, change는 같은 대상·지표·범위의 두 시점 행(compareRow)을 잇는다.
export const CLAIM_KINDS=['value','change','rank','price','count'] as const;
export type ClaimKind=typeof CLAIM_KINDS[number];
export type StructuredClaim={productId:string;row:string;kind:ClaimKind;compareRow?:string};
// 주장 틀이 읽는 관측표 행(서버 관측표 ObservationRow와 같은 칸).
export type ClaimRow={row:string;snapshotId:string;source:string;productId:string;subject:string;subjectKey:string;metric:MetricKey;value:number;periodTo:string;scope:string|null};
export const claimKindFits=(kind:ClaimKind,metric:MetricKey):boolean=>{
 if(!CLAIM_METRICS[metric])return false;
 if(kind==='rank')return metric==='rank';
 if(kind==='price')return MONEY_METRICS.has(metric);
 if(kind==='count')return metric!=='rank'&&(COUNT_METRICS.has(metric)||metric==='sales_estimate');
 return true;
};
export const defaultKind=(metric:MetricKey):ClaimKind=>metric==='rank'?'rank':MONEY_METRICS.has(metric)?'price':claimKindFits('count',metric)?'count':'value';
const metricLabel=(r:ClaimRow)=>r.metric==='rank'&&r.scope?`${r.scope} 순위`:CLAIM_METRICS[r.metric]!.label;
const valueText=(r:ClaimRow)=>`${koNumber(r.value)}${CLAIM_METRICS[r.metric]!.unit}`;
// 고정 틀. 한 시점: [상품] '대상' 지표 값단위 (출처, 기간 기준). 두 시점: [상품] '대상' 지표 값(기간 기준) → 값(기간 기준), 상승|하락|변화 없음 (출처).
// 방향은 서버가 두 행 값으로 정한다(순위는 숫자가 작아지면 상승).
export function renderClaim(productName:string,kind:ClaimKind,row:ClaimRow,compare?:ClaimRow):string{
 if(kind!=='change'||!compare)return `[${productName}] '${row.subject}' ${metricLabel(row)} ${valueText(row)} (${row.source}, ${row.periodTo} 기준)`;
 const [a,b]=timeOf(row.periodTo)<=timeOf(compare.periodTo)?[row,compare]:[compare,row];
 let delta=b.value-a.value;if(a.metric==='rank')delta=-delta;
 const dir=delta>0?'상승':delta<0?'하락':'변화 없음';
 const src=a.source===b.source?a.source:`${a.source}·${b.source}`;
 return `[${productName}] '${b.subject}' ${metricLabel(b)} ${valueText(a)}(${a.periodTo} 기준) → ${valueText(b)}(${b.periodTo} 기준), ${dir} (${src})`;
}

// 구조 주장 채점·틀 문장 만들기(결정형·모델 공통). 행·상품·종류를 확인한 뒤 틀로 문장을 만들고, 그 문장을 인용 채점기로 다시 확인한다(틀 자체의 회귀 방지).
// products: 고른 상품(id·이름). table: 근거로 인정할 관측표 행. 통과한 주장만 claims에 싣는다(하나라도 어긋나면 unsupported가 비지 않는다).
export function gradeClaims(input:readonly StructuredClaim[],table:readonly ClaimRow[],products:readonly {id:string;name:string;names?:readonly string[]}[],snapshots:readonly Snapshot[],tagOf:(i:number)=>string=i=>`주장 ${i+1}`):{unsupported:string[];claims:MdBrief['claims']}{
 const unsupported:string[]=[],claims:MdBrief['claims']=[],byProduct=new Map(products.map(p=>[p.id,p])),seen=new Set<string>();
 // 같은 행이 두 상품의 관측표에 함께 있을 수 있다(같은 키워드 묶음). 주장한 상품의 행을 먼저 찾는다.
 const byRow=new Map<string,ClaimRow[]>();for(const r of table)byRow.set(r.row,[...(byRow.get(r.row)??[]),r]);
 const find=(id:string,productId:string)=>{const xs=byRow.get(id);return xs?xs.find(r=>r.productId===productId)??xs[0]:undefined};
 const aliases:Record<string,string[]>={};for(const r of table)aliases[r.subjectKey]=[...new Set([...(aliases[r.subjectKey]??[]),r.subject])];
 const productNames=products.flatMap(p=>[p.name,...(p.names??[])]);
 input.forEach((c,i)=>{
  const tag=tagOf(i),errs:string[]=[];
  const p=byProduct.get(c.productId),row=find(c.row,c.productId),cmp=c.compareRow===undefined?undefined:find(c.compareRow,c.productId);
  if(!p)errs.push(`${tag}: 상품 '${c.productId}'은 고른 상품이 아닙니다.`);
  if(!row)errs.push(`${tag}: 행 ${c.row}이 관측표에 없습니다.`);
  else if(p&&row.productId!==p.id)errs.push(`${tag}: 행 ${c.row}은 상품 '${p.name}'의 행이 아닙니다.`);
  if(!(CLAIM_KINDS as readonly string[]).includes(c.kind))errs.push(`${tag}: 주장 종류 '${c.kind}'는 없습니다(value·change·rank·price·count).`);
  else if(row&&!claimKindFits(c.kind==='change'?'value':c.kind,row.metric))errs.push(`${tag}: '${c.kind}' 종류는 지표 ${row.metric}에 쓸 수 없습니다.`);
  if(c.kind==='change'){
   if(c.compareRow===undefined)errs.push(`${tag}: 변화(change) 주장은 비교 행(compareRow)이 필요합니다.`);
   else if(!cmp)errs.push(`${tag}: 비교 행 ${c.compareRow}이 관측표에 없습니다.`);
   else if(row&&(cmp.productId!==row.productId||cmp.subjectKey!==row.subjectKey||cmp.metric!==row.metric||(cmp.scope??'')!==(row.scope??'')))errs.push(`${tag}: 비교 행 ${c.compareRow}은 같은 상품·대상·지표·범위의 행이 아닙니다.`);
   else if(row&&cmp.periodTo===row.periodTo)errs.push(`${tag}: 비교 행 ${c.compareRow}은 같은 기간의 행이라 변화를 말할 수 없습니다.`);
  }else if(c.compareRow!==undefined)errs.push(`${tag}: 비교 행(compareRow)은 변화(change) 주장에만 씁니다.`);
  const key=`${c.productId}|${c.row}|${c.kind}|${c.compareRow??''}`;if(seen.has(key))errs.push(`${tag}: 같은 주장이 두 번 있습니다.`);seen.add(key);
  if(errs.length||!p||!row){unsupported.push(...errs);return}
  const text=renderClaim(p.name,c.kind,row,cmp);
  const res=checkCitations([{text,citations:[row.row,...(cmp?[cmp.row]:[])]}],snapshots,{allowedRows:new Set(table.map(r=>r.row)),subjectAliases:aliases,allowedTerms:productNames,names:productNames,serverRendered:true});
  if(!res.passed){unsupported.push(...res.unsupported.map(u=>u.replace(/^주장 1/,tag)));return}
  const refs:ClaimRef[]=res.refs[0]??[];
  claims.push({text,citations:[...new Set(refs.map(r=>r.snapshotId))],refs});
 });
 return {unsupported,claims};
}

const subjectLabel=(o:Observation)=>o.subject.type==='keyword'?o.subject.text:o.subject.title;
// 주장 대상은 그 상품의 키워드 묶음 키워드와 그 상품의 플랫폼 목록뿐이다(근거 스냅샷 안의 경쟁 상품 행은 주장으로 옮기지 않는다).
function relatedTo(p:ResearchProduct,groups:readonly KeywordGroup[]){
 const kws=new Set(groups.filter(g=>p.keywordGroupIds.includes(g.id)).flatMap(g=>g.keywords.map(normalizeKeyword))),ls=new Set(p.listings.map(l=>`${l.sourceId}:${l.externalId}`));
 return (o:Observation)=>o.subject.type==='keyword'?kws.has(normalizeKeyword(o.subject.text)):ls.has(`${o.subject.sourceId}:${o.subject.externalId}`);
}
// 점수표에서 나온 리스크 문장(서버 글): 선정 금지 사유, 리스크 하위 점수 사유, 미확인 하위 점수. 결정형·모델 메모가 같이 쓴다.
export function scorecardRisks(name:string,card:ScoreCard):string[]{
 const out:string[]=[];
 if(card.blocked)out.push(`[${name}] 선정 금지: ${card.blocked.reason}`);
 const risk=card.subScores.find(s=>s.key==='risk');if(risk&&risk.value!==null&&risk.value<90&&!card.blocked)out.push(`[${name}] ${risk.reason}`);
 if(card.missing.length)out.push(`[${name}] 미확인 하위 점수: ${card.missing.join(', ')}(0으로 계산하지 않음)`);
 return out;
}
export function buildBrief(opts:{question:string;products:readonly ResearchProduct[];cards:readonly ScoreCard[];snapshots:readonly Snapshot[];keywordGroups:readonly KeywordGroup[];createdAt:string;maxProducts?:number;claimsPerProduct?:number}):MdBrief{
 const max=opts.maxProducts??5,per=opts.claimsPerProduct??4,byId=new Map(opts.snapshots.map(s=>[s.id,s])),prodById=new Map(opts.products.map(p=>[p.id,p]));
 const cards=[...opts.cards].filter(c=>prodById.has(c.productId)).sort((a,b)=>TIER_ORDER[a.tier]-TIER_ORDER[b.tier]||(b.total??-1)-(a.total??-1)||(a.productId<b.productId?-1:1));
 const top=cards.slice(0,max),structured:StructuredClaim[]=[],table:ClaimRow[]=[],risks:string[]=[];
 for(const card of top){
  const p=prodById.get(card.productId)!;
  // 근거 스냅샷 중 실패하지 않은 것만, 같은 (대상·지표)는 가장 최근 관측 하나만 주장으로 옮긴다.
  const ev=[...new Set(card.subScores.flatMap(s=>s.evidence))].map(id=>byId.get(id)).filter((s):s is Snapshot=>!!s&&s.status!=='failed');
  const latest=new Map<string,{o:Observation;snap:Snapshot;i:number}>(),mine=relatedTo(p,opts.keywordGroups);
  for(const snap of ev)snap.observations.forEach((o,i)=>{
   if(typeof o.value!=='number'||!CLAIM_METRICS[o.metric]||!mine(o))return;
   const k=`${subjectLabel(o)}|${o.metric}`,prev=latest.get(k);
   if(!prev||timeOf(o.period.to)>timeOf(prev.o.period.to)||(o.period.to===prev.o.period.to&&snap.id>prev.snap.id))latest.set(k,{o,snap,i});
  });
  const order:MetricKey[]=['search_volume_month','rank','seller_count','product_count','video_count','price_min','ad_competition','review_count','rating','video_views','search_trend'];
  const picked=[...latest.values()].sort((a,b)=>order.indexOf(a.o.metric)-order.indexOf(b.o.metric)||(subjectLabel(a.o)<subjectLabel(b.o)?-1:1)).slice(0,per);
  for(const {o,snap,i} of picked){
   const row:ClaimRow={row:rowId(snap.id,i),snapshotId:snap.id,source:sourceSpec(snap.sourceId).label,productId:p.id,subject:subjectLabel(o),subjectKey:subjectKey(o.subject),metric:o.metric,value:o.value as number,periodTo:o.period.to,scope:o.scope??null};
   table.push(row);structured.push({productId:p.id,row:row.row,kind:defaultKind(o.metric)});
  }
  risks.push(...scorecardRisks(p.name,card));
 }
 const graded=gradeClaims(structured,table,top.map(c=>({id:c.productId,name:prodById.get(c.productId)!.name})),opts.snapshots);
 const count=(t:ScoreCard['tier'])=>cards.filter(c=>c.tier===t).length;
 const recommendation:MdBrief['recommendation']=count('adopt')?'adopt':count('watch')?'watch':'reject';
 const lead=top[0],leadName=lead?prodById.get(lead.productId)!.name:null;
 const summary=`'${opts.question}'에 대해 후보 ${cards.length}개를 점수표 ${cards[0]?.weightsVersion??'w1'}로 비교했습니다. 도입 검토 ${count('adopt')}개, 관찰 ${count('watch')}개, 자료 보강 ${count('needs_data')}개, 제외 ${count('reject')}개입니다.`+
  (lead&&leadName?` 1순위는 ${leadName}(${TIER_LABEL[lead.tier]}, 총점 ${lead.total===null?'미확인':lead.total.toFixed(1)}, 신뢰도 ${lead.confidence.toFixed(2)})입니다.`:'')+' 발주·가격 승인은 하지 않으며 대표 승인 뒤 소싱 검토로 넘깁니다.';
 return {id:shortId('prbf',{q:opts.question,cards:top.map(c=>c.id)}),productIds:top.map(c=>c.productId),question:opts.question,summary,recommendation,claims:graded.claims,risks,author:{kind:'template'},
  citationCheck:{passed:graded.unsupported.length===0,unsupported:graded.unsupported},createdAt:opts.createdAt};
}
// 메모를 마크다운으로(화면·주간 리포트용). 인용은 스냅샷 ID 각주로 붙는다.
export function briefMarkdown(b:MdBrief):string{
 const rec={adopt:'도입 검토',watch:'관찰',reject:'제외'}[b.recommendation];
 return [`# MD 선정 메모`,``,`**질문**: ${b.question}`,``,`**권고**: ${rec}`,``,b.summary,``,`## 근거`,...b.claims.map(c=>`- ${c.text} [${c.citations.join(', ')}]`),``,`## 리스크`,...(b.risks.length?b.risks.map(r=>`- ${r}`):['- 확인된 리스크 없음']),``,`인용 검사: ${b.citationCheck.passed?'통과':`실패 ${b.citationCheck.unsupported.length}건`}`].join('\n');
}
