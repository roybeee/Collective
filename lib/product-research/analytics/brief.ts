// 결정형 MD 선정 메모(순수). 계획 4.3: 모든 주장은 점수표 근거(evidence) 스냅샷을 인용하고, 주장 속 숫자는 그 스냅샷의 관측값 그대로다.
// 파생 수치(점수·성장률)는 주장(claims)에 넣지 않고 요약(summary)에만 쓴다. 그래야 citation-check가 주장 전체를 엄격히 채점할 수 있다.
import type {KeywordGroup,MdBrief,MetricKey,Observation,ResearchProduct,ScoreCard,Snapshot} from '../types';
import {sourceSpec} from '../sources';
import {checkCitations} from './citation-check';
import {koNumber} from './format';
import {shortId} from './hash';
import {normalizeKeyword} from './normalize';
import {timeOf} from './series';

const TIER_ORDER:Record<ScoreCard['tier'],number>={adopt:0,watch:1,needs_data:2,reject:3};
const TIER_LABEL:Record<ScoreCard['tier'],string>={adopt:'도입 검토',watch:'관찰',needs_data:'자료 보강',reject:'제외'};
// 주장으로 옮길 지표와 문장 틀. 값은 관측값 그대로(koNumber: 쉼표만 더함) 적는다.
const CLAIM_METRICS:Partial<Record<MetricKey,(o:Observation,subject:string)=>string>>={
 search_volume_month:(o,s)=>`'${s}' 월간 검색수 ${koNumber(o.value as number)}회`,
 search_trend:(o,s)=>`'${s}' 검색 추세 상대값 ${koNumber(o.value as number)}`,
 seller_count:(o,s)=>`'${s}' 판매처 ${koNumber(o.value as number)}곳`,
 product_count:(o,s)=>`'${s}' 쇼핑 검색 상품 ${koNumber(o.value as number)}개`,
 ad_competition:(o,s)=>`'${s}' 광고 경쟁 지수 ${koNumber(o.value as number)}`,
 price_min:(o,s)=>`'${s}' 최저가 ${koNumber(o.value as number)}원`,
 video_count:(o,s)=>`'${s}' 관련 영상 ${koNumber(o.value as number)}개`,
 video_views:(o,s)=>`'${s}' 추적 영상 누적 조회수 ${koNumber(o.value as number)}회`,
 rank:(o,s)=>`'${s}' ${o.scope?`${o.scope} `:''}순위 ${koNumber(o.value as number)}위`,
 review_count:(o,s)=>`'${s}' 리뷰 ${koNumber(o.value as number)}개`,
 rating:(o,s)=>`'${s}' 평점 ${koNumber(o.value as number)}`,
};
const subjectLabel=(o:Observation)=>o.subject.type==='keyword'?o.subject.text:o.subject.title;

// 주장 대상은 그 상품의 키워드 묶음 키워드와 그 상품의 플랫폼 목록뿐이다(근거 스냅샷 안의 경쟁 상품 행은 주장으로 옮기지 않는다).
function relatedTo(p:ResearchProduct,groups:readonly KeywordGroup[]){
 const kws=new Set(groups.filter(g=>p.keywordGroupIds.includes(g.id)).flatMap(g=>g.keywords.map(normalizeKeyword))),ls=new Set(p.listings.map(l=>`${l.sourceId}:${l.externalId}`));
 return (o:Observation)=>o.subject.type==='keyword'?kws.has(normalizeKeyword(o.subject.text)):ls.has(`${o.subject.sourceId}:${o.subject.externalId}`);
}
export function buildBrief(opts:{question:string;products:readonly ResearchProduct[];cards:readonly ScoreCard[];snapshots:readonly Snapshot[];keywordGroups:readonly KeywordGroup[];createdAt:string;maxProducts?:number;claimsPerProduct?:number}):MdBrief{
 const max=opts.maxProducts??5,per=opts.claimsPerProduct??4,byId=new Map(opts.snapshots.map(s=>[s.id,s])),prodById=new Map(opts.products.map(p=>[p.id,p]));
 const cards=[...opts.cards].filter(c=>prodById.has(c.productId)).sort((a,b)=>TIER_ORDER[a.tier]-TIER_ORDER[b.tier]||(b.total??-1)-(a.total??-1)||(a.productId<b.productId?-1:1));
 const top=cards.slice(0,max),claims:MdBrief['claims']=[],risks:string[]=[],allowed=new Set<string>();
 for(const card of top){
  const p=prodById.get(card.productId)!;allowed.add(p.name);
  // 근거 스냅샷 중 실패하지 않은 것만, 같은 (대상·지표)는 가장 최근 관측 하나만 주장으로 옮긴다.
  const ev=[...new Set(card.subScores.flatMap(s=>s.evidence))].map(id=>byId.get(id)).filter((s):s is Snapshot=>!!s&&s.status!=='failed');
  const latest=new Map<string,{o:Observation;snap:Snapshot}>(),mine=relatedTo(p,opts.keywordGroups);
  for(const snap of ev)for(const o of snap.observations){
   if(typeof o.value!=='number'||!CLAIM_METRICS[o.metric]||!mine(o))continue;
   const k=`${subjectLabel(o)}|${o.metric}`,prev=latest.get(k);
   if(!prev||timeOf(o.period.to)>timeOf(prev.o.period.to)||(o.period.to===prev.o.period.to&&snap.id>prev.snap.id))latest.set(k,{o,snap});
  }
  const order:MetricKey[]=['search_volume_month','rank','seller_count','product_count','video_count','price_min','ad_competition','review_count','rating','video_views','search_trend'];
  const picked=[...latest.values()].sort((a,b)=>order.indexOf(a.o.metric)-order.indexOf(b.o.metric)||(subjectLabel(a.o)<subjectLabel(b.o)?-1:1)).slice(0,per);
  for(const {o,snap} of picked){
   const subject=subjectLabel(o);allowed.add(subject);if(o.scope)allowed.add(o.scope);
   claims.push({text:`[${p.name}] ${CLAIM_METRICS[o.metric]!(o,subject)} (${sourceSpec(snap.sourceId).label}, ${o.period.to} 기준)`,citations:[snap.id]});
  }
  if(card.blocked)risks.push(`[${p.name}] 선정 금지: ${card.blocked.reason}`);
  const risk=card.subScores.find(s=>s.key==='risk');if(risk&&risk.value!==null&&risk.value<90&&!card.blocked)risks.push(`[${p.name}] ${risk.reason}`);
  if(card.missing.length)risks.push(`[${p.name}] 미확인 하위 점수: ${card.missing.join(', ')}(0으로 계산하지 않음)`);
 }
 const count=(t:ScoreCard['tier'])=>cards.filter(c=>c.tier===t).length;
 const recommendation:MdBrief['recommendation']=count('adopt')?'adopt':count('watch')?'watch':'reject';
 const lead=top[0],leadName=lead?prodById.get(lead.productId)!.name:null;
 const summary=`'${opts.question}'에 대해 후보 ${cards.length}개를 점수표 ${cards[0]?.weightsVersion??'w1'}로 비교했습니다. 도입 검토 ${count('adopt')}개, 관찰 ${count('watch')}개, 자료 보강 ${count('needs_data')}개, 제외 ${count('reject')}개입니다.`+
  (lead&&leadName?` 1순위는 ${leadName}(${TIER_LABEL[lead.tier]}, 총점 ${lead.total===null?'미확인':lead.total.toFixed(1)}, 신뢰도 ${lead.confidence.toFixed(2)})입니다.`:'')+' 발주·가격 승인은 하지 않으며 대표 승인 뒤 소싱 검토로 넘깁니다.';
 const allowedTerms=[...allowed];
 return {id:shortId('prbf',{q:opts.question,cards:top.map(c=>c.id)}),productIds:top.map(c=>c.productId),question:opts.question,summary,recommendation,claims,risks,author:{kind:'template'},
  citationCheck:checkCitations(claims,opts.snapshots,{allowedTerms}),createdAt:opts.createdAt};
}
// 메모를 마크다운으로(화면·주간 리포트용). 인용은 스냅샷 ID 각주로 붙는다.
export function briefMarkdown(b:MdBrief):string{
 const rec={adopt:'도입 검토',watch:'관찰',reject:'제외'}[b.recommendation];
 return [`# MD 선정 메모`,``,`**질문**: ${b.question}`,``,`**권고**: ${rec}`,``,b.summary,``,`## 근거`,...b.claims.map(c=>`- ${c.text} [${c.citations.join(', ')}]`),``,`## 리스크`,...(b.risks.length?b.risks.map(r=>`- ${r}`):['- 확인된 리스크 없음']),``,`인용 검사: ${b.citationCheck.passed?'통과':`실패 ${b.citationCheck.unsupported.length}건`}`].join('\n');
}
