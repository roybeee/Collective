// MD 선정 메모 작성(서버). template: 결정형(analytics/brief.ts). model: AI 팀 '상품 MD' 역할을 HERMES로 1회 실행.
// 모델에는 관측표(스냅샷 ID + 관측값)만 보낸다. 완료 출력은 인용 채점기로 검사하고, 관측표 밖 숫자·없는 인용이 하나라도 있으면 저장하지 않는다(409, 근거 없는 목록).
// HERMES는 비동기 실행이라 한 요청 안에서 짧게 기다리고(최대 약 20초), 끝나지 않으면 같은 requestId로 다시 요청해 이어서 확인한다.
// 토큰 예산(lib/token-budget.ts)은 submitHermes가 요청 전에 예약하고, 사용량(lib/usage-ledger.ts)은 pollHermes가 종료 때 기록한다.
import {ApiError,connection} from '../server';
import {hermesSubmissionStatement,submitHermes,pollHermes} from '../hermes';
import {markUsageOutcomeSafely} from '../usage-outcome';
import type {UsageContext} from '../usage-ledger';
import {buildBrief} from './analytics/brief';
import {checkCitations} from './analytics/citation-check';
import {shortId} from './analytics/hash';
import {normalizeKeyword} from './analytics/normalize';
import {timeOf} from './analytics/series';
import {sourceSpec} from './sources';
import {mdSubmission,MD_PROMPT_VERSION,type ObservationRow} from './md-prompt';
import {K,optional,readSnapshots} from './server-store';
import {loadGroups,loadScores,type StoredProduct} from './server-pipeline';
import type {KeywordGroup,MdBrief,MetricKey,Observation,ScoreCard,Snapshot} from './types';

// 응답에 근거 목록(unsupported)·형식 오류(issues)를 함께 싣는 오류.
export class ResearchError extends ApiError{constructor(status:number,message:string,public extra:Record<string,unknown>={}){super(status,message)}}

const TIER_LABEL:Record<ScoreCard['tier'],string>={adopt:'도입 검토',watch:'관찰',needs_data:'자료 보강',reject:'제외'};
const TABLE_METRICS:readonly MetricKey[]=['search_volume_month','rank','seller_count','product_count','video_count','price_min','price_median','ad_competition','review_count','rating','search_trend','sales_estimate'];
const MAX_ROWS_PER_PRODUCT=12,MAX_ROWS=60;

export type BriefInputs={products:StoredProduct[];cards:ScoreCard[];snapshots:Snapshot[];groups:KeywordGroup[]};
export async function briefInputs(owner:string,productIds:readonly string[]):Promise<BriefInputs>{
 const products:StoredProduct[]=[];
 for(const id of productIds){const p=await optional<StoredProduct>(owner,K.product,id);if(!p)throw new ApiError(404,'상품을 찾을 수 없습니다. 화면을 새로 고친 뒤 다시 고르세요.');products.push(p)}
 if(products.some(p=>!p.scoreId))throw new ApiError(409,'점수표가 없는 상품이 있습니다. 재계산 뒤 다시 시도하세요.');
 const scores=await loadScores(owner,products.map(p=>p.scoreId as string)),cards=products.map(p=>scores.get(p.scoreId as string)).filter((c):c is ScoreCard=>!!c);
 if(cards.length!==products.length)throw new ApiError(409,'현재 점수표를 찾지 못했습니다. 재계산 뒤 다시 시도하세요.');
 const ids=[...new Set(cards.flatMap(c=>c.subScores.flatMap(s=>s.evidence)))];
 const [snaps,groups]=await Promise.all([readSnapshots(owner,ids),loadGroups(owner)]);
 return {products,cards,snapshots:[...snaps.values()],groups};
}

export function templateBrief(question:string,inp:BriefInputs,at:string):MdBrief{
 const brief=buildBrief({question,products:inp.products,cards:inp.cards,snapshots:inp.snapshots,keywordGroups:inp.groups,createdAt:at,maxProducts:inp.products.length});
 if(!brief.citationCheck.passed)throw new ResearchError(409,'선정 메모의 인용 검사를 통과하지 못해 저장하지 않았습니다.',{unsupported:brief.citationCheck.unsupported});
 return brief;
}

// 모델에 보낼 관측표: 상품의 키워드 묶음 키워드와 그 상품 목록에 대한 점수표 근거 관측만, (대상·지표)별 가장 최근 값 하나.
export function observationTable(inp:BriefInputs):ObservationRow[]{
 const byId=new Map(inp.snapshots.map(s=>[s.id,s])),rows:ObservationRow[]=[];
 for(const card of inp.cards){
  const p=inp.products.find(x=>x.id===card.productId)!;
  const kws=new Set(inp.groups.filter(g=>p.keywordGroupIds.includes(g.id)).flatMap(g=>g.keywords.map(normalizeKeyword))),ls=new Set(p.listings.map(l=>`${l.sourceId}:${l.externalId}`));
  const mine=(o:Observation)=>o.subject.type==='keyword'?kws.has(normalizeKeyword(o.subject.text)):ls.has(`${o.subject.sourceId}:${o.subject.externalId}`);
  const latest=new Map<string,{o:Observation;s:Snapshot}>();
  for(const id of new Set(card.subScores.flatMap(s=>s.evidence))){const s=byId.get(id);if(!s||s.status==='failed')continue;
   for(const o of s.observations){if(typeof o.value!=='number'||!TABLE_METRICS.includes(o.metric)||!mine(o))continue;
    const label=o.subject.type==='keyword'?o.subject.text:o.subject.title,k=`${label}|${o.metric}|${o.scope??''}`,prev=latest.get(k);
    if(!prev||timeOf(o.period.to)>timeOf(prev.o.period.to)||(o.period.to===prev.o.period.to&&s.id>prev.s.id))latest.set(k,{o,s})}}
  const picked=[...latest.values()].sort((a,b)=>TABLE_METRICS.indexOf(a.o.metric)-TABLE_METRICS.indexOf(b.o.metric)||(a.s.id<b.s.id?-1:1)).slice(0,MAX_ROWS_PER_PRODUCT);
  for(const {o,s} of picked)rows.push({snapshotId:s.id,source:sourceSpec(s.sourceId).label,productId:p.id,subject:o.subject.type==='keyword'?o.subject.text:o.subject.title,metric:o.metric,value:o.value as number,periodTo:o.period.to,scope:o.scope??null});
 }
 return rows.slice(0,MAX_ROWS);
}
// 채점용 스냅샷: 관측표에 실린 행만 남긴 사본(표 밖 관측값은 근거로 인정하지 않는다).
function tableSnapshots(rows:readonly ObservationRow[],inp:BriefInputs):Snapshot[]{
 const byId=new Map(inp.snapshots.map(s=>[s.id,s])),out=new Map<string,Snapshot>();
 for(const r of rows){const s=byId.get(r.snapshotId);if(!s)continue;const o:Observation={subject:{type:'keyword',text:r.subject},metric:r.metric as MetricKey,value:r.value,period:{from:r.periodTo,to:r.periodTo},...(r.scope?{scope:r.scope}:{})};
  const cur=out.get(s.id)??{...s,observations:[]};cur.observations.push(o);out.set(s.id,cur)}
 return [...out.values()];
}
function allowedTerms(rows:readonly ObservationRow[],inp:BriefInputs){
 return [...new Set([...inp.products.flatMap(p=>[p.name,p.brand??'',...p.listings.map(l=>l.title)]),...rows.flatMap(r=>[r.subject,r.scope??'',r.source]),...inp.groups.flatMap(g=>g.keywords)].filter(Boolean))];
}

type ModelOutput={summary:string;recommendation:MdBrief['recommendation'];claims:{text:string;citations:string[]}[];risks:string[]};
export function parseModelOutput(text:unknown):ModelOutput|null{
 if(typeof text!=='string')return null;
 const start=text.indexOf('{'),end=text.lastIndexOf('}');if(start<0||end<=start)return null;
 let v:unknown;try{v=JSON.parse(text.slice(start,end+1))}catch{return null}
 const o=v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;if(!o)return null;
 const str=(x:unknown,max:number)=>typeof x==='string'&&x.trim()&&x.length<=max?x.trim():null;
 const summary=str(o.summary,2000),rec=o.recommendation;
 if(!summary||!['adopt','watch','reject'].includes(String(rec))||!Array.isArray(o.claims)||!o.claims.length||o.claims.length>40||!Array.isArray(o.risks)||o.risks.length>20)return null;
 const claims:ModelOutput['claims']=[];
 for(const c of o.claims){const r=c&&typeof c==='object'?c as Record<string,unknown>:{};const t=str(r.text,400);if(!t||!Array.isArray(r.citations)||r.citations.length>5||!r.citations.every(x=>typeof x==='string'&&x.length<=80))return null;claims.push({text:t,citations:r.citations as string[]})}
 const risks:string[]=[];for(const r of o.risks){const t=str(r,300);if(!t)return null;risks.push(t)}
 return {summary,recommendation:rec as ModelOutput['recommendation'],claims,risks};
}
// 모델 출력 채점: 주장은 인용한 표 행과, 요약·리스크의 숫자는 표 전체와 맞아야 한다. 하나라도 어긋나면 unsupported에 담긴다.
export function gradeModelOutput(out:ModelOutput,rows:readonly ObservationRow[],inp:BriefInputs){
 const snaps=tableSnapshots(rows,inp),terms=allowedTerms(rows,inp),all=snaps.map(s=>s.id);
 const claims=checkCitations(out.claims,snaps,{allowedTerms:terms});
 const rest=checkCitations([{text:out.summary,citations:all},...out.risks.map(text=>({text,citations:all}))],snaps,{allowedTerms:terms});
 const unsupported=[...claims.unsupported,...rest.unsupported.map(u=>u.replace(/^주장 1:/,'요약:').replace(/^주장 (\d+):/,(_,n)=>`리스크 ${Number(n)-1}:`))];
 return {passed:unsupported.length===0,unsupported};
}

export type ModelJob={submissionId:string;providerId:string|null;question:string;productIds:string[];rows:ObservationRow[];startedAt:string};
const usage=(job:ModelJob):UsageContext=>({kind:'research',submissionId:job.submissionId,outputContractVersion:MD_PROMPT_VERSION,promptVersion:MD_PROMPT_VERSION});
const sleep=(ms:number)=>typeof setTimeout==='function'?new Promise<void>(r=>setTimeout(r,ms)):Promise.resolve();
export const MODEL_WAIT_MS=20000;

// 모델 메모: 새로 시작하거나(prior 없음) 기다리던 실행을 이어서 확인한다. 끝나면 채점 통과분만 돌려주고, 아직이면 pending을 돌려준다.
export async function modelBrief(owner:string,args:{question:string;productIds:string[];requestId:string},prior:ModelJob|null,at:string,waitMs=MODEL_WAIT_MS):Promise<{brief:MdBrief;job:ModelJob}|{pending:ModelJob}>{
 const cfg=await connection(owner).catch((e:unknown)=>{if(e instanceof ApiError&&e.status===409)throw new ApiError(409,'모델 선정 메모는 AI 연결이 필요합니다. 연결 및 설정에서 HERMES를 연결하거나 결정형(template) 메모를 쓰세요.');throw e});
 if(cfg.provider!=='hermes')throw new ApiError(409,'모델 선정 메모는 HERMES 연결로만 작성합니다. 연결 및 설정에서 HERMES를 선택하거나 결정형(template) 메모를 쓰세요.');
 const inp=await briefInputs(owner,args.productIds);
 let job:ModelJob;
 if(prior?.providerId)job=prior;
 else{
  const rows=observationTable(inp);
  if(!rows.length)throw new ApiError(409,'고른 상품의 점수표 근거에 관측값이 없어 모델 메모를 쓸 수 없습니다. 수집·가져오기 뒤 다시 시도하세요.');
  job={submissionId:`prmd-${args.requestId}`,providerId:null,question:args.question,productIds:[...args.productIds],rows,startedAt:at};
  const products=inp.cards.map(c=>{const p=inp.products.find(x=>x.id===c.productId)!;return {id:p.id,name:p.name,tier:TIER_LABEL[c.tier],blocked:c.blocked?.reason??null,missing:c.missing}});
  await hermesSubmissionStatement(owner,job.submissionId,mdSubmission({question:args.question,products,observations:rows})).run();
  const r=await submitHermes(owner,job.submissionId,cfg);
  job={...job,providerId:r.id};
 }
 const deadline=Date.now()+waitMs;
 for(;;){
  const r=await pollHermes(cfg,job.providerId as string,false,15000,owner,usage(job));
  if(r.status==='completed'){
   const out=parseModelOutput(r.output[0]?.content[0]?.text);
   if(!out){await markUsageOutcomeSafely(owner,'hermes',job.providerId as string,'invalid_output');throw new ResearchError(409,'모델 출력이 정해진 JSON 형식이 아니어서 저장하지 않았습니다.',{unsupported:['출력 형식 오류']})}
   const grade=gradeModelOutput(out,job.rows,inp);
   if(!grade.passed){await markUsageOutcomeSafely(owner,'hermes',job.providerId as string,'invalid_output');throw new ResearchError(409,'모델 메모에 관측표로 확인되지 않는 숫자나 인용이 있어 저장하지 않았습니다.',{unsupported:grade.unsupported})}
   await markUsageOutcomeSafely(owner,'hermes',job.providerId as string,'completed');
   const brief:MdBrief={id:shortId('prbf',{q:job.question,products:job.productIds,run:job.providerId}),productIds:job.productIds,question:job.question,summary:out.summary,recommendation:out.recommendation,claims:out.claims,risks:out.risks,
    author:{kind:'model',jobId:job.providerId as string},citationCheck:{passed:true,unsupported:[]},createdAt:at};
   return {brief,job};
  }
  if(r.status==='failed'||r.status==='cancelled'){await markUsageOutcomeSafely(owner,'hermes',job.providerId as string,r.status==='cancelled'?'cancelled':'provider_failed');throw new ApiError(502,r.failureReason||'HERMES가 선정 메모를 끝내지 못했습니다. 다시 요청하세요.')}
  if(Date.now()>=deadline||typeof setTimeout!=='function')return {pending:job};
  await sleep(2000);
 }
}
