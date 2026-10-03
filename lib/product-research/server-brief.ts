// MD 선정 메모 작성(서버). template: 결정형(analytics/brief.ts). model: AI 팀 '상품 MD' 역할을 HERMES로 1회 실행.
// 모델에는 관측표(행 ID·스냅샷 ID·관측값)만 보낸다. 외부·운영자 글(상품명·키워드·질문)은 md-prompt.ts sanitizeData로 다듬어 자료 칸에만 넣는다(지시문에는 들어가지 않는다).
// 완료 출력은 인용 채점기로 행 단위 검사하고(대상·지표·값·부호·방향·단정 금지), 요약·리스크의 숫자는 통과한 주장에 나온 것만 허용한다. 하나라도 어긋나면 저장하지 않는다(409, 근거 없는 목록).
// HERMES는 비동기 실행이라 한 요청 안에서 짧게 기다리고(최대 약 20초), 끝나지 않으면 같은 requestId로 다시 요청해 이어서 확인한다.
// 토큰 예산(lib/token-budget.ts)은 submitHermes가 요청 전에 예약하고, 사용량(lib/usage-ledger.ts)은 pollHermes가 종료 때 기록한다.
import {ApiError,connection} from '../server';
import {hermesSubmissionStatement,submitHermes,pollHermes} from '../hermes';
import {markUsageOutcomeSafely} from '../usage-outcome';
import type {UsageContext} from '../usage-ledger';
import {buildBrief} from './analytics/brief';
import {checkCitations,checkProse,rowId} from './analytics/citation-check';
import {shortId} from './analytics/hash';
import {normalizeKeyword} from './analytics/normalize';
import {subjectKey,timeOf} from './analytics/series';
import {sourceSpec} from './sources';
import {mdSubmission,sanitizeData,DATA_LIMITS,MD_PROMPT_VERSION,type ObservationRow} from './md-prompt';
import {K,optional,readSnapshots} from './server-store';
import {loadGroups,loadScores,type StoredProduct} from './server-pipeline';
import type {ClaimRef,KeywordGroup,MdBrief,MetricKey,Observation,ScoreCard,Snapshot} from './types';

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
// 행마다 row(스냅샷ID#관측 번호)를 붙인다. 모델은 이 row로 인용하고, 채점기는 이 표의 행만 근거로 인정한다. 대상 이름은 다듬은 글(sanitizeData)이다.
export function observationTable(inp:BriefInputs):ObservationRow[]{
 const byId=new Map(inp.snapshots.map(s=>[s.id,s])),rows:ObservationRow[]=[];
 for(const card of inp.cards){
  const p=inp.products.find(x=>x.id===card.productId)!;
  const kws=new Set(inp.groups.filter(g=>p.keywordGroupIds.includes(g.id)).flatMap(g=>g.keywords.map(normalizeKeyword))),ls=new Set(p.listings.map(l=>`${l.sourceId}:${l.externalId}`));
  const mine=(o:Observation)=>o.subject.type==='keyword'?kws.has(normalizeKeyword(o.subject.text)):ls.has(`${o.subject.sourceId}:${o.subject.externalId}`);
  const latest=new Map<string,{o:Observation;s:Snapshot;i:number}>();
  for(const id of new Set(card.subScores.flatMap(s=>s.evidence))){const s=byId.get(id);if(!s||s.status==='failed')continue;
   s.observations.forEach((o,i)=>{if(typeof o.value!=='number'||!TABLE_METRICS.includes(o.metric)||!mine(o))return;
    const label=o.subject.type==='keyword'?o.subject.text:o.subject.title,k=`${label}|${o.metric}|${o.scope??''}`,prev=latest.get(k);
    if(!prev||timeOf(o.period.to)>timeOf(prev.o.period.to)||(o.period.to===prev.o.period.to&&s.id>prev.s.id))latest.set(k,{o,s,i})})}
  const picked=[...latest.values()].sort((a,b)=>TABLE_METRICS.indexOf(a.o.metric)-TABLE_METRICS.indexOf(b.o.metric)||(a.s.id<b.s.id?-1:1)).slice(0,MAX_ROWS_PER_PRODUCT);
  for(const {o,s,i} of picked)rows.push({row:rowId(s.id,i),subjectKey:subjectKey(o.subject),snapshotId:s.id,source:sourceSpec(s.sourceId).label,productId:p.id,
   subject:sanitizeData(o.subject.type==='keyword'?o.subject.text:o.subject.title,DATA_LIMITS.subject),metric:o.metric,value:o.value as number,periodTo:o.period.to,scope:o.scope?sanitizeData(o.scope,DATA_LIMITS.scope):null});
 }
 return rows.slice(0,MAX_ROWS);
}
// 행 ID: 새 관측표는 row를 갖는다. 예전 대기 작업의 행(row 없음)은 스냅샷 안에서 같은 지표·기간·값의 관측 번호를 찾아 붙인다.
function rowOf(r:ObservationRow,byId:ReadonlyMap<string,Snapshot>):string|null{
 if(r.row)return r.row;
 const s=byId.get(r.snapshotId);if(!s)return null;
 const i=s.observations.findIndex(o=>o.metric===r.metric&&o.period.to===r.periodTo&&o.value===r.value);
 return i<0?null:rowId(s.id,i);
}
function allowedTerms(rows:readonly ObservationRow[],inp:BriefInputs){
 return [...new Set([...inp.products.flatMap(p=>[p.name,sanitizeData(p.name,DATA_LIMITS.name),p.brand??'',...p.listings.map(l=>l.title)]),...rows.flatMap(r=>[r.subject,r.scope??'',r.source]),...inp.groups.flatMap(g=>g.keywords)].filter(Boolean))];
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
// 모델 출력 채점: 주장은 관측표 행 단위로(인용 행의 대상·지표·값·부호·방향, 단정 금지), 요약·리스크는 통과한 주장에 나온 숫자·날짜만 허용하고 단정을 금지한다.
// 통과하면 주장마다 채점기가 확인한 행(refs)과 그 스냅샷 ID(citations)를 돌려준다(저장되는 메모는 항상 행 인용을 갖는다).
export function gradeModelOutput(out:ModelOutput,rows:readonly ObservationRow[],inp:BriefInputs){
 const byId=new Map(inp.snapshots.map(s=>[s.id,s])),terms=allowedTerms(rows,inp);
 const allowedRows=new Set(rows.map(r=>rowOf(r,byId)).filter((x):x is string=>!!x));
 const aliases:Record<string,string[]>={};
 for(const r of rows){const key=r.subjectKey??null;if(!key)continue;const p=inp.products.find(x=>x.id===r.productId);aliases[key]=[...new Set([...(aliases[key]??[]),r.subject,...(p&&key.startsWith('ls:')?[p.name,sanitizeData(p.name,DATA_LIMITS.name)]:[])])]}
 const claims=checkCitations(out.claims,inp.snapshots,{allowedTerms:terms,allowedRows,subjectAliases:aliases});
 const prose=checkProse([{tag:'요약',text:out.summary},...out.risks.map((text,i)=>({tag:`리스크 ${i+1}`,text}))],out.claims.map(c=>c.text),{allowedTerms:terms});
 const unsupported=[...claims.unsupported,...prose];
 const graded=out.claims.map((c,i)=>{const refs:ClaimRef[]=claims.refs[i]??[];return {text:c.text,citations:[...new Set(refs.map(r=>r.snapshotId))],refs}});
 return {passed:unsupported.length===0,unsupported,claims:graded};
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
   const brief:MdBrief={id:shortId('prbf',{q:job.question,products:job.productIds,run:job.providerId}),productIds:job.productIds,question:job.question,summary:out.summary,recommendation:out.recommendation,claims:grade.claims,risks:out.risks,
    author:{kind:'model',jobId:job.providerId as string},citationCheck:{passed:true,unsupported:[]},createdAt:at};
   return {brief,job};
  }
  if(r.status==='failed'||r.status==='cancelled'){await markUsageOutcomeSafely(owner,'hermes',job.providerId as string,r.status==='cancelled'?'cancelled':'provider_failed');throw new ApiError(502,r.failureReason||'HERMES가 선정 메모를 끝내지 못했습니다. 다시 요청하세요.')}
  if(Date.now()>=deadline||typeof setTimeout!=='function')return {pending:job};
  await sleep(2000);
 }
}
