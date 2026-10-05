import {productResearchPolicy,scoreResearchPolicy,snapshotIdsResearchPolicy,requireResearchPolicy,SOURCE_POLICY_VERSION} from './server-policy';
// MD 선정 메모 작성(서버). template: 결정형(analytics/brief.ts). model: AI 팀 '상품 MD' 역할을 HERMES로 1회 실행.
// 모델에는 관측표(행 ID·스냅샷 ID·관측값)만 보낸다. 외부·운영자 글(상품명·키워드·질문)은 md-prompt.ts sanitizeData로 다듬어 자료 칸에만 넣는다(지시문에는 들어가지 않는다).
// 출력 계약 v4(평가 3회차 H-3): 모델은 주장 문장을 쓰지 않는다. 주장은 구조({productId,row,kind,compareRow?})로만 내고, 서버가 그 행의 값·단위·기간으로
// 고정 틀 문장을 만든다(analytics/brief.ts gradeClaims — 결정형 메모와 같은 틀·같은 검사). 모델 자유 글은 호환성 검사만 하고 버린다. 요약·리스크도 서버가 만든다.
// 권고는 recommendation 칸으로만 내고 점수표 분류를 넘지 못한다(tierCeilingErrors). 하나라도 어긋나면 저장하지 않는다(409, 근거 없는 목록).
// HERMES는 비동기 실행이라 한 요청 안에서 짧게 기다리고(최대 약 20초), 끝나지 않으면 같은 requestId로 다시 요청해 이어서 확인한다.
// 토큰 예산(lib/token-budget.ts)은 submitHermes가 요청 전에 예약하고, 사용량(lib/usage-ledger.ts)은 pollHermes가 종료 때 기록한다.
import {ApiError,connection} from '../server';
import {hermesSubmissionStatement,submitHermes,pollHermes} from '../hermes';
import {markUsageOutcomeSafely} from '../usage-outcome';
import type {UsageContext} from '../usage-ledger';
import {buildBrief,BRIEF_UNVERIFIED_RISKS,CLAIM_KINDS,defaultKind,gradeClaims,scorecardRisks,TIER_LABEL,type ClaimKind,type ClaimRow,type StructuredClaim} from './analytics/brief';
import {checkCitations,checkFreeText,checkTierCeiling,rowId,TIER_LEVEL} from './analytics/citation-check';
import {shortId} from './analytics/hash';
import {normalizeKeyword} from './analytics/normalize';
import {subjectKey,timeOf} from './analytics/series';
import {sourceSpec} from './sources';
import {mdSubmission,sanitizeData,DATA_LIMITS,MD_PROMPT_VERSION,FREE_TEXT_LIMITS,type ObservationRow} from './md-prompt';
import {K,optional,readSnapshots} from './server-store';
import {loadGroups,loadScores,type StoredProduct} from './server-pipeline';
import type {KeywordGroup,MdBrief,MetricKey,Observation,ScoreCard,Snapshot} from './types';

// 응답에 근거 목록(unsupported)·형식 오류(issues)를 함께 싣는 오류.
export class ResearchError extends ApiError{constructor(status:number,message:string,public extra:Record<string,unknown>={}){super(status,message)}}

const TABLE_METRICS:readonly MetricKey[]=['search_volume_month','rank','seller_count','product_count','video_count','price_min','price_median','ad_competition','review_count','rating','search_trend','sales_estimate'];
// 상품마다 최근 행 12개와, 변화(change) 주장에 쓸 바로 앞 기간 행 6개까지. 표 전체는 최근 행 60개 + 앞 기간 행 24개까지.
const MAX_ROWS_PER_PRODUCT=12,MAX_ROWS=60,MAX_PREV_PER_PRODUCT=6,MAX_PREV_ROWS=24;

export type BriefInputs={products:StoredProduct[];cards:ScoreCard[];snapshots:Snapshot[];groups:KeywordGroup[]};
export async function briefInputs(owner:string,productIds:readonly string[]):Promise<BriefInputs>{
 const products:StoredProduct[]=[];
 for(const id of productIds){const p=await optional<StoredProduct>(owner,K.product,id);if(!p)throw new ApiError(404,'상품을 찾을 수 없습니다. 화면을 새로 고친 뒤 다시 고르세요.');products.push(p)}
 if(products.some(p=>!p.scoreId))throw new ApiError(409,'점수표가 없는 상품이 있습니다. 재계산 뒤 다시 시도하세요.');
 const scores=await loadScores(owner,products.map(p=>p.scoreId as string)),cards=products.map(p=>scores.get(p.scoreId as string)).filter((c):c is ScoreCard=>!!c);
 if(cards.length!==products.length)throw new ApiError(409,'현재 점수표를 찾지 못했습니다. 재계산 뒤 다시 시도하세요.');
 for(const product of products)requireResearchPolicy(await productResearchPolicy(owner,product));
 for(const card of cards)requireResearchPolicy(await scoreResearchPolicy(owner,card));
 const ids=[...new Set(cards.flatMap(c=>c.subScores.flatMap(s=>s.evidence)))];
 const [snaps,groups]=await Promise.all([readSnapshots(owner,ids),loadGroups(owner)]);
 return {products,cards,snapshots:[...snaps.values()],groups};
}

export function templateBrief(question:string,inp:BriefInputs,at:string):MdBrief{
 const brief=buildBrief({question,products:inp.products,cards:inp.cards,snapshots:inp.snapshots,keywordGroups:inp.groups,createdAt:at,maxProducts:inp.products.length});
 if(!brief.citationCheck.passed)throw new ResearchError(409,'선정 메모의 인용 검사를 통과하지 못해 저장하지 않았습니다.',{unsupported:brief.citationCheck.unsupported});
 return {...brief,sourcePolicyVersion:SOURCE_POLICY_VERSION,scoreCardIds:inp.cards.map(c=>c.id)};
}

// 모델에 보낼 관측표: 상품의 키워드 묶음 키워드와 그 상품 목록에 대한 점수표 근거 관측만, (대상·지표·범위)별 가장 최근 값 하나와 그 바로 앞 기간 값 하나.
// 행마다 row(스냅샷ID#관측 번호)를 붙인다. 모델은 이 row로 주장을 고르고, 채점기는 이 표의 행만 근거로 인정한다. 대상 이름은 다듬은 글(sanitizeData)이다.
export function observationTable(inp:BriefInputs):ObservationRow[]{
 const byId=new Map(inp.snapshots.map(s=>[s.id,s])),latestRows:ObservationRow[]=[],prevRows:ObservationRow[]=[];
 type Pick={o:Observation;s:Snapshot;i:number};
 const newer=(a:Pick,b:Pick)=>timeOf(a.o.period.to)>timeOf(b.o.period.to)||(a.o.period.to===b.o.period.to&&a.s.id>b.s.id);
 const toRow=(p:StoredProduct,{o,s,i}:Pick):ObservationRow=>({row:rowId(s.id,i),subjectKey:subjectKey(o.subject),snapshotId:s.id,source:sourceSpec(s.sourceId).label,productId:p.id,
  subject:sanitizeData(o.subject.type==='keyword'?o.subject.text:o.subject.title,DATA_LIMITS.subject),metric:o.metric,value:o.value as number,periodTo:o.period.to,scope:o.scope?sanitizeData(o.scope,DATA_LIMITS.scope):null});
 for(const card of inp.cards){
  const p=inp.products.find(x=>x.id===card.productId)!;
  const kws=new Set(inp.groups.filter(g=>p.keywordGroupIds.includes(g.id)).flatMap(g=>g.keywords.map(normalizeKeyword))),ls=new Set(p.listings.map(l=>`${l.sourceId}:${l.externalId}`));
  const mine=(o:Observation)=>o.subject.type==='keyword'?kws.has(normalizeKeyword(o.subject.text)):ls.has(`${o.subject.sourceId}:${o.subject.externalId}`);
  const all=new Map<string,Pick[]>();
  for(const id of new Set(card.subScores.flatMap(s=>s.evidence))){const s=byId.get(id);if(!s||s.status==='failed')continue;
   s.observations.forEach((o,i)=>{if(typeof o.value!=='number'||!TABLE_METRICS.includes(o.metric)||!mine(o))return;
    const label=o.subject.type==='keyword'?o.subject.text:o.subject.title,k=`${label}|${o.metric}|${o.scope??''}`;all.set(k,[...(all.get(k)??[]),{o,s,i}])})}
  const order=(a:Pick,b:Pick)=>TABLE_METRICS.indexOf(a.o.metric)-TABLE_METRICS.indexOf(b.o.metric)||(a.s.id<b.s.id?-1:1);
  const latest:Pick[]=[],prev:Pick[]=[];
  for(const xs of all.values()){
   const top=xs.reduce((a,b)=>newer(b,a)?b:a);latest.push(top);
   // 바로 앞 기간: 최근 행보다 이른 기간 중 가장 늦은 것(같은 기간이면 늦게 수집한 스냅샷).
   const before=xs.filter(x=>timeOf(x.o.period.to)<timeOf(top.o.period.to));if(before.length)prev.push(before.reduce((a,b)=>newer(b,a)?b:a));
  }
  const picked=latest.sort(order).slice(0,MAX_ROWS_PER_PRODUCT),keep=new Set(picked.map(x=>`${x.o.subject.type==='keyword'?x.o.subject.text:x.o.subject.title}|${x.o.metric}|${x.o.scope??''}`));
  for(const x of picked)latestRows.push(toRow(p,x));
  for(const x of prev.filter(x=>keep.has(`${x.o.subject.type==='keyword'?x.o.subject.text:x.o.subject.title}|${x.o.metric}|${x.o.scope??''}`)).sort(order).slice(0,MAX_PREV_PER_PRODUCT))prevRows.push(toRow(p,x));
 }
 return [...latestRows.slice(0,MAX_ROWS),...prevRows.slice(0,MAX_PREV_ROWS)];
}
// 행 ID: 새 관측표는 row를 갖는다. 예전 대기 작업의 행(row 없음)은 스냅샷 안에서 같은 지표·기간·값의 관측 번호를 찾아 붙인다.
function rowOf(r:ObservationRow,byId:ReadonlyMap<string,Snapshot>):string|null{
 if(r.row)return r.row;
 const s=byId.get(r.snapshotId);if(!s)return null;
 const i=s.observations.findIndex(o=>o.metric===r.metric&&o.period.to===r.periodTo&&o.value===r.value);
 return i<0?null:rowId(s.id,i);
}
// 채점이 쓰는 관측표(행 ID가 있는 행만, 틀 문장 칸으로).
function claimTable(rows:readonly ObservationRow[],byId:ReadonlyMap<string,Snapshot>):ClaimRow[]{
 const out:ClaimRow[]=[];
 for(const r of rows){const row=rowOf(r,byId),s=row?byId.get(r.snapshotId):null;if(!row||!s)continue;
  const o=s.observations[Number(row.slice(row.lastIndexOf('#')+1))];
  out.push({row,snapshotId:r.snapshotId,source:r.source,productId:r.productId,subject:r.subject,subjectKey:r.subjectKey??(o?subjectKey(o.subject):''),metric:r.metric as MetricKey,value:r.value,periodTo:r.periodTo,scope:r.scope})}
 return out;
}
// 고른 상품 자신의 이름(원래 이름과 다듬은 이름). 자유 글·권고 말 검사에서 빼 주는 이름은 이것뿐이다(평가 3회차 H-1: 키워드·다른 묶음·목록 제목은 빼 주지 않는다).
const ownNames=(inp:BriefInputs)=>[...new Set(inp.products.flatMap(p=>[p.name,sanitizeData(p.name,DATA_LIMITS.name)]).filter(x=>x.trim().length>=2))];

// v3 꼴 주장({text,citations}): 판을 올리기 전에 시작한 대기 작업의 출력만을 위한 이행 경로다. 글은 강화된 인용 채점기로 확인만 하고 버린다 —
// 저장되는 문장은 언제나 서버 틀 문장이다(gradeModelOutput). 한 주장 안에 v3·v4 칸을 섞으면 받지 않는다.
export type LegacyClaim={text:string;citations:string[]};
export type ModelOutput={summary:string;recommendation:MdBrief['recommendation'];claims:(StructuredClaim|LegacyClaim)[];risks:string[]};
const isLegacy=(c:StructuredClaim|LegacyClaim):c is LegacyClaim=>'text' in c;
// 출력 계약 v4. 칸 밖의 키(예: 구조 주장에 붙인 text)는 받지 않는다: 모델 자유 글은 summary·risks뿐이다.
export function parseModelOutput(text:unknown):ModelOutput|null{
 if(typeof text!=='string')return null;
 const start=text.indexOf('{'),end=text.lastIndexOf('}');if(start<0||end<=start)return null;
 let v:unknown;try{v=JSON.parse(text.slice(start,end+1))}catch{return null}
 const o=v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;if(!o)return null;
 if(Object.keys(o).some(k=>!['summary','recommendation','claims','risks'].includes(k)))return null;
 const L=FREE_TEXT_LIMITS,str=(x:unknown,max:number)=>typeof x==='string'&&x.trim()&&x.trim().length<=max?x.trim():null;
 const id=(x:unknown)=>typeof x==='string'&&x.length>0&&x.length<=100?x:null;
 const summary=str(o.summary,L.summary),rec=o.recommendation;
 if(!summary||!['adopt','watch','reject'].includes(String(rec))||!Array.isArray(o.claims)||!o.claims.length||o.claims.length>40||!Array.isArray(o.risks)||o.risks.length>L.risks)return null;
 const claims:ModelOutput['claims']=[];
 for(const c of o.claims){
  const r=c&&typeof c==='object'&&!Array.isArray(c)?c as Record<string,unknown>:null;if(!r)return null;
  const keys=Object.keys(r);
  if(keys.length===2&&keys.includes('text')&&keys.includes('citations')){
   const t=str(r.text,400);if(!t||!Array.isArray(r.citations)||!r.citations.length||r.citations.length>5||!r.citations.every(x=>typeof x==='string'&&x.length<=80))return null;
   claims.push({text:t,citations:r.citations as string[]});continue;
  }
  if(keys.some(k=>!['productId','row','kind','compareRow'].includes(k)))return null;
  const productId=id(r.productId),row=id(r.row),kind=r.kind,compareRow=r.compareRow===undefined||r.compareRow===null?undefined:id(r.compareRow);
  if(!productId||!row||typeof kind!=='string'||!(CLAIM_KINDS as readonly string[]).includes(kind)||compareRow===null)return null;
  claims.push({productId,row,kind:kind as ClaimKind,...(compareRow?{compareRow}:{})});
 }
 const risks:string[]=[];for(const r of o.risks){const t=str(r,L.risk);if(!t)return null;risks.push(t)}
 return {summary,recommendation:rec as ModelOutput['recommendation'],claims,risks};
}
const REC_LEVEL:Record<MdBrief['recommendation'],number>={adopt:TIER_LEVEL.adopt,watch:TIER_LEVEL.watch,reject:TIER_LEVEL.reject};
const REC_LABEL:Record<MdBrief['recommendation'],string>={adopt:'도입 검토',watch:'관찰',reject:'제외'};
// 권고 상한(평가 2회차 H2): 메모 권고(recommendation)는 고른 상품 중 가장 높은 점수표 분류를 넘지 못한다(선정 금지·제외 → 제외, 자료 보강 → 제외, 관찰 → 관찰 이하).
// 자유 글(요약·리스크)은 허용 어휘에 권고 말이 없어 권고를 쓸 수 없지만, 이중 장치로 상품별 상한 검사(checkTierCeiling)도 원문에 돌린다(빼 주는 이름은 고른 상품 이름뿐).
export function tierCeilingErrors(out:Pick<ModelOutput,'summary'|'recommendation'|'risks'>,inp:BriefInputs,rows:readonly ObservationRow[]=[]):string[]{
 const errs:string[]=[],caps=inp.cards.map(c=>c.blocked?TIER_LEVEL.reject:TIER_LEVEL[c.tier]),best=caps.length?Math.min(...caps):TIER_LEVEL.reject;
 const bestTier=(Object.keys(TIER_LEVEL) as ScoreCard['tier'][]).find(t=>TIER_LEVEL[t]===best)??'reject';
 if(REC_LEVEL[out.recommendation]<best)errs.push(`권고: '${REC_LABEL[out.recommendation]}' 권고는 고른 상품의 가장 높은 점수표 분류('${TIER_LABEL[bestTier]}')보다 높아 쓸 수 없습니다.`);
 const products=inp.cards.map(c=>{const p=inp.products.find(x=>x.id===c.productId)!;
  const names=[p.name,sanitizeData(p.name,DATA_LIMITS.name),...p.listings.map(l=>l.title),...rows.filter(r=>r.productId===p.id&&r.subjectKey?.startsWith('ls:')).map(r=>r.subject)].filter(x=>x.trim().length>=2);
  return {names:[...new Set(names)],tier:c.tier,blocked:!!c.blocked,label:TIER_LABEL[c.tier]}});
 const items=[{tag:'요약',text:out.summary},...out.risks.map((text,i)=>({tag:`리스크 ${i+1}`,text}))];
 return [...errs,...checkTierCeiling(items,products,{allowedTerms:ownNames(inp)})];
}
// v3 꼴 주장 이행: 글을 강화된 인용 채점기(빼 주는 이름은 고른 상품 이름뿐, 바뀜 꼴 순서 확인)로 확인한 뒤, 확인된 행을 구조 주장으로 옮긴다.
// 행 하나 → 그 지표의 기본 종류, 같은 상품·대상·지표·범위의 두 시점 → change. 그 밖은 거절. 모델 글은 버린다.
function legacyToStructured(c:LegacyClaim,tag:string,table:readonly ClaimRow[],inp:BriefInputs,names:readonly string[]):{claim?:StructuredClaim;errors:string[]}{
 const aliases:Record<string,string[]>={};for(const r of table)aliases[r.subjectKey]=[...new Set([...(aliases[r.subjectKey]??[]),r.subject])];
 const res=checkCitations([{text:c.text,citations:c.citations}],inp.snapshots,{allowedRows:new Set(table.map(r=>r.row)),subjectAliases:aliases,allowedTerms:names,names});
 if(!res.passed)return {errors:res.unsupported.map(u=>u.replace(/^주장 1/,tag))};
 const hit=table.filter(t=>(res.refs[0]??[]).some(r=>r.snapshotId===t.snapshotId&&r.subject===t.subjectKey&&r.metric===t.metric&&(!r.period||r.period===t.periodTo)));
 const productId=hit[0]?.productId,mine=[...new Map(hit.filter(t=>t.productId===productId).map(t=>[t.row,t])).values()];
 const [a,b]=mine;
 if(mine.length===1)return {claim:{productId:a.productId,row:a.row,kind:defaultKind(a.metric)},errors:[]};
 if(mine.length===2&&a.subjectKey===b.subjectKey&&a.metric===b.metric&&(a.scope??'')===(b.scope??'')&&a.periodTo!==b.periodTo)return {claim:{productId:a.productId,row:a.row,kind:'change',compareRow:b.row},errors:[]};
 return {errors:[`${tag}: v3 꼴 주장은 행 하나(또는 같은 대상·지표의 두 시점)만 옮길 수 있습니다. 구조 주장({productId,row,kind})으로 내세요.`]};
}
// 모델 출력 채점(v4): 주장은 구조를 확인하고 서버 틀로 문장을 만든 뒤 인용 채점기로 확인한다(gradeClaims). 요약·리스크는 허용 어휘만(checkFreeText).
// 권고는 점수표 분류를 넘지 못한다(tierCeilingErrors). 운영자 질문 글은 자유 글 검사에서 빼 주지 않는다(v3까지는 빼 줬다).
// 허용 어휘 검사만으로 사실 여부를 보장할 수 없으므로 모델 요약·리스크는 버린다. 통과한 행 주장과 점수표만으로 저장용 글을 만든다(v3 이행도 동일).
export function gradeModelOutput(out:ModelOutput,rows:readonly ObservationRow[],inp:BriefInputs){
 const byId=new Map(inp.snapshots.map(s=>[s.id,s])),table=claimTable(rows,byId),names=ownNames(inp);
 const products=inp.cards.map(c=>{const p=inp.products.find(x=>x.id===c.productId)!;return {id:p.id,name:p.name,names:[sanitizeData(p.name,DATA_LIMITS.name)]}});
 const structured:StructuredClaim[]=[],tags:string[]=[],legacyErrs:string[]=[];
 out.claims.forEach((c,i)=>{const tag=`주장 ${i+1}`;if(!isLegacy(c)){structured.push(c);tags.push(tag);return}
  const r=legacyToStructured(c,tag,table,inp,names);legacyErrs.push(...r.errors);if(r.claim){structured.push(r.claim);tags.push(tag)}});
 const graded=gradeClaims(structured,table,products,inp.snapshots,i=>tags[i]);
 const claims={unsupported:[...legacyErrs,...graded.unsupported],claims:graded.claims};
 const free=checkFreeText([{tag:'요약',text:out.summary},...out.risks.map((text,i)=>({tag:`리스크 ${i+1}`,text}))],{names});
 const unsupported=[...claims.unsupported,...free,...tierCeilingErrors(out,inp,rows)];
 const lead=`점수표 분류: ${inp.cards.map(c=>`${inp.products.find(x=>x.id===c.productId)!.name}(${TIER_LABEL[c.tier]}${c.blocked?', 선정 금지':''})`).join(', ')}.`;
 const serverRisks=inp.cards.flatMap(c=>scorecardRisks(inp.products.find(x=>x.id===c.productId)!.name,c));
 return {passed:unsupported.length===0,unsupported,claims:claims.claims,summary:`${lead} ${claims.claims.map(c=>c.text).join(' ')}`,risks:serverRisks.length?serverRisks:[BRIEF_UNVERIFIED_RISKS]};
}

export type ModelJob={submissionId:string;providerId:string|null;question:string;productIds:string[];rows:ObservationRow[];startedAt:string;sourcePolicyVersion?:string;scoreCardIds?:string[]};
const usage=(job:ModelJob):UsageContext=>({kind:'research',submissionId:job.submissionId,outputContractVersion:MD_PROMPT_VERSION,promptVersion:MD_PROMPT_VERSION});
const sleep=(ms:number)=>typeof setTimeout==='function'?new Promise<void>(r=>setTimeout(r,ms)):Promise.resolve();
export const MODEL_WAIT_MS=20000;
async function modelJobPolicy(owner:string,job:ModelJob){
 if(job.sourcePolicyVersion!==SOURCE_POLICY_VERSION||!Array.isArray(job.scoreCardIds)||!job.scoreCardIds.length)throw new ApiError(409,'이전 정책의 모델 작업은 재사용할 수 없습니다. 새 요청으로 작성하세요.');
 const cards=await loadScores(owner,job.scoreCardIds);
 for(const id of job.scoreCardIds)requireResearchPolicy(await scoreResearchPolicy(owner,cards.get(id)));
 requireResearchPolicy(await snapshotIdsResearchPolicy(owner,job.rows.map(row=>row.snapshotId)));
}


// 모델 메모: 새로 시작하거나(prior 없음) 기다리던 실행을 이어서 확인한다. 끝나면 채점 통과분만 돌려주고, 아직이면 pending을 돌려준다.
// 판을 올리기 전(v3)에 시작한 대기 작업의 출력은 v4 계약이 아니므로 형식 오류(409)로 끝난다. 같은 질문으로 새 요청을 보내면 된다.
export async function modelBrief(owner:string,args:{question:string;productIds:string[];requestId:string},prior:ModelJob|null,at:string,waitMs=MODEL_WAIT_MS):Promise<{brief:MdBrief;job:ModelJob}|{pending:ModelJob}>{
 const inp=await briefInputs(owner,args.productIds);
 if(prior)await modelJobPolicy(owner,prior);
 const cfg=await connection(owner).catch((e:unknown)=>{if(e instanceof ApiError&&e.status===409)throw new ApiError(409,'모델 선정 메모는 AI 연결이 필요합니다. 연결 및 설정에서 HERMES를 연결하거나 결정형(template) 메모를 쓰세요.');throw e});
 if(cfg.provider!=='hermes')throw new ApiError(409,'모델 선정 메모는 HERMES 연결로만 작성합니다. 연결 및 설정에서 HERMES를 선택하거나 결정형(template) 메모를 쓰세요.');
 let job:ModelJob;
 if(prior?.providerId)job=prior;
 else{
  const rows=observationTable(inp);
  if(!rows.length)throw new ApiError(409,'고른 상품의 점수표 근거에 관측값이 없어 모델 메모를 쓸 수 없습니다. 수집·가져오기 뒤 다시 시도하세요.');
  job={submissionId:`prmd-${args.requestId}`,providerId:null,question:args.question,productIds:[...args.productIds],rows,startedAt:at,sourcePolicyVersion:SOURCE_POLICY_VERSION,scoreCardIds:inp.cards.map(c=>c.id)};
  const products=inp.cards.map(c=>{const p=inp.products.find(x=>x.id===c.productId)!;return {id:p.id,name:p.name,tier:TIER_LABEL[c.tier],blocked:c.blocked?.reason??null,missing:c.missing}});
  await hermesSubmissionStatement(owner,job.submissionId,mdSubmission({question:args.question,products,observations:rows})).run();
  await briefInputs(owner,args.productIds);
  await modelJobPolicy(owner,job);
  const r=await submitHermes(owner,job.submissionId,cfg);
  job={...job,providerId:r.id};
 }
 const deadline=Date.now()+waitMs;
 for(;;){
  await modelJobPolicy(owner,job);
  const r=await pollHermes(cfg,job.providerId as string,false,15000,owner,usage(job));
  if(r.status==='completed'){
   await briefInputs(owner,args.productIds);
   await modelJobPolicy(owner,job);
   const out=parseModelOutput(r.output[0]?.content[0]?.text);
   if(!out){await markUsageOutcomeSafely(owner,'hermes',job.providerId as string,'invalid_output');throw new ResearchError(409,'모델 출력이 정해진 JSON 형식(구조 주장·요약·리스크)이 아니어서 저장하지 않았습니다.',{unsupported:['출력 형식 오류']})}
   const grade=gradeModelOutput(out,job.rows,inp);
   if(!grade.passed){await markUsageOutcomeSafely(owner,'hermes',job.providerId as string,'invalid_output');throw new ResearchError(409,'모델 메모에 관측표로 확인되지 않는 행·허용 어휘 밖의 말·권고가 있어 저장하지 않았습니다.',{unsupported:grade.unsupported})}
   await markUsageOutcomeSafely(owner,'hermes',job.providerId as string,'completed');
   const brief:MdBrief={sourcePolicyVersion:SOURCE_POLICY_VERSION,scoreCardIds:job.scoreCardIds,id:shortId('prbf',{q:job.question,products:job.productIds,run:job.providerId}),productIds:job.productIds,question:job.question,summary:grade.summary,recommendation:out.recommendation,claims:grade.claims,risks:grade.risks,
    author:{kind:'model',jobId:job.providerId as string},citationCheck:{passed:true,unsupported:[]},createdAt:at};
   return {brief,job};
  }
  if(r.status==='failed'||r.status==='cancelled'){await markUsageOutcomeSafely(owner,'hermes',job.providerId as string,r.status==='cancelled'?'cancelled':'provider_failed');throw new ApiError(502,r.failureReason||'HERMES가 선정 메모를 끝내지 못했습니다. 다시 요청하세요.')}
  if(Date.now()>=deadline||typeof setTimeout!=='function')return {pending:job};
  await sleep(2000);
 }
}
