// 읽기 전용 보존 현황. 원문·키·개별 ID는 반환하지 않으며 운영 삭제를 실행하지 않는다.
import {database} from '../server';
import {snapshotResearchPolicy,SOURCE_POLICY_VERSION} from './source-policy';
import type {Snapshot} from './types';
const KINDS=['pr_snapshot','pr_quarantine','pr_collect_state','pr_product','pr_keyword_group','pr_score','pr_brief','pr_backtest','pr_score_index','pr_request','pr_decision','hermes_submission','growth_signal','growth_history','growth_need','growth_offer','growth_sourcing_candidate','growth_sourcing_history'] as const;
const PAGE=250,MAX_ROWS=10000,MAX_ROW_BYTES=512000,MAX_TOTAL_BYTES=32000000,DAY=86400000;
type InventoryRow={kind:string;records:number;youtubeRecords:number;expiredRecords:number;invalidTimeRecords:number;oldestFetchedAt:string|null};
export type ResearchRetentionInventory={checkedAt:string;complete:boolean;scanned:number;rows:InventoryRow[];externalDeletion:'unverified'|'not_applicable';automaticDeletion:boolean};
export type StoredRow={id:string;kind:string;data:string|null;bytes:number};
export type Entry={row:StoredRow;aliases:Set<string>;references:{kind:string;id:string}[];times:Set<number>;invalidTime:boolean;youtube:boolean;valid:boolean};
export function retentionEntry(row:StoredRow,now:number):Entry{
 const out:Entry={row,aliases:new Set([row.id]),references:[],times:new Set(),invalidTime:false,youtube:false,valid:true};
 let count=0;
 const referenceKind=(key:string,path:string):string|undefined=>{
  if(['snapshotId','snapshotIds','sourceSnapshotIds','riskEvidence'].includes(key))return 'pr_snapshot';
  if(key==='evidence'&&(row.kind==='pr_score'||path.includes('.subScores.')))return 'pr_snapshot';
  if(key==='citations'&&(row.kind==='pr_brief'||row.kind==='pr_request'||row.kind==='hermes_submission'))return 'pr_snapshot';
  if(['scoreId','scoreCardId','scoreCardIds'].includes(key))return 'pr_score';
  if(['productId','productIds'].includes(key))return 'pr_product';
  if(key==='briefId')return 'pr_brief';
  if(key==='decisionId')return 'pr_decision';
  if(key==='signalId')return 'growth_signal';
  if(key==='candidateId'&&row.kind==='growth_sourcing_history')return 'growth_sourcing_candidate';
  if(row.kind==='pr_score_index'&&key==='id'&&path.endsWith('.entries.id'))return 'pr_score';
  if(row.kind==='hermes_submission'&&row.id.includes(':hermes_submission:prmd-')){
   if(key==='row')return 'pr_snapshot';
   if(key==='id'&&path.endsWith('.products.id'))return 'pr_product';
  }
  if(key==='id'&&path.endsWith('.evidenceRefs.id')){
   if(row.kind==='growth_need')return 'growth_signal';
   if(row.kind==='growth_offer')return 'growth_need';
  }
  return undefined;
 };
 const walk=(value:unknown,key='',depth=0,path=''):void=>{
  if(++count>20000||depth>20){out.valid=false;return}
  if(typeof value==='string'){
   if(value==='youtube_data')out.youtube=true;
   const kind=referenceKind(key,path);if(kind)out.references.push({kind,id:kind==='pr_snapshot'?value.split('#')[0]:value});
   if(['fetchedAt','lastFetchedAt','addedAt'].includes(key)){
    // 시각 검증은 MD 공통 규칙을 사용하고 금지 출처 판정과 분리한다.
    const check=snapshotResearchPolicy({sourceId:'own_sales',fetchedAt:value} as Snapshot,now);
    if(check.allowed)out.times.add(Date.parse(value));else out.invalidTime=true;
   }
   if(['body','input','payload','result'].includes(key)&&/^[\s]*[\[{]/.test(value)){try{walk(JSON.parse(value),key,depth+1,path)}catch{out.valid=false}}
  }else if(Array.isArray(value)){for(const v of value)walk(v,key,depth+1,path)}
  else if(value&&typeof value==='object'){
   for(const [k,v] of Object.entries(value)){
    if(k==='videos'&&row.kind==='pr_collect_state'&&Array.isArray(v)&&v.length)out.youtube=true;
    if(['fetchedAt','lastFetchedAt','addedAt'].includes(k)&&typeof v!=='string')out.invalidTime=true;
    walk(v,k,depth+1,path+'.'+k);
   }
  }
 };
 try{if(row.data===null)throw new Error('bounded row');const data=JSON.parse(row.data);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('invalid record');if(typeof data.id==='string')out.aliases.add(data.id);out.aliases.add(row.id.slice(row.id.indexOf(`:${row.kind}:`)+row.kind.length+2));walk(data)}catch{out.valid=false}
 if(out.times.size)out.times=new Set([Math.min(...out.times)]);
 return out;
}
export function inheritRetention(entries:Entry[]):boolean{
 const index=new Map<string,Entry[]>();for(const e of entries)for(const id of e.aliases)index.set(id,[...(index.get(id)??[]),e]);
 // Reverse edges allow transitive copies to be marked in one bounded work queue.
 const parents=new Map<Entry,Set<Entry>>();let complete=true,edges=0;
 for(const e of entries){
  for(const ref of e.references){
   const targets=(index.get(ref.id)??[]).filter(r=>r.row.kind===ref.kind);if(targets.length!==1)complete=false;
   for(const target of targets){if(target===e)continue;if(++edges>200000)return false;const set=parents.get(target)??new Set<Entry>();set.add(e);parents.set(target,set)}
  }
 }
 const queue=entries.filter(e=>e.youtube);const queued=new Set(queue);let visits=0;
 for(let cursor=0;cursor<queue.length;cursor++){
  const child=queue[cursor];queued.delete(child);
  for(const parent of parents.get(child)??[]){
   if(++visits>200000)return false;
   const before=parent.times.values().next().value,wasYoutube=parent.youtube,wasInvalid=parent.invalidTime;
   const oldest=Math.min(before??Infinity,child.times.values().next().value??Infinity);
   parent.youtube=true;if(Number.isFinite(oldest))parent.times=new Set([oldest]);parent.invalidTime ||= child.invalidTime;
   if((!wasYoutube||before!==parent.times.values().next().value||wasInvalid!==parent.invalidTime)&&!queued.has(parent)){queue.push(parent);queued.add(parent)}
  }
 }
 return complete;
}
export async function researchRetentionInventory(owner:string,now:Date=new Date()):Promise<ResearchRetentionInventory>{
 const at=now.getTime();if(!Number.isFinite(at)||!owner)throw new Error('보존 현황의 소유자와 확인 시각이 필요합니다.');
 const stored=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='pr_retention_settings' AND id=?").bind(owner,`${owner}:pr_retention_settings:current`).first<{data:string}>();
 const setting=stored?JSON.parse(stored.data):null,automaticDeletion=setting?.automaticEnabled===true&&!!setting.confirmedBy&&setting.confirmationVersion===SOURCE_POLICY_VERSION;
 const result:ResearchRetentionInventory={checkedAt:now.toISOString(),complete:true,scanned:0,rows:KINDS.map(kind=>({kind,records:0,youtubeRecords:0,expiredRecords:0,invalidTimeRecords:0,oldestFetchedAt:null})),externalDeletion:'not_applicable',automaticDeletion};
 const entries:Entry[]=[];let cursor='',bytes=0;
 try{
  while(true){
   const remaining=MAX_ROWS-result.scanned;
   const page=await database().prepare('SELECT id,kind,CASE WHEN length(CAST(data AS BLOB))<=? THEN data ELSE NULL END data,length(CAST(data AS BLOB)) bytes FROM records WHERE owner=? AND EXISTS (SELECT 1 FROM json_each(?) kinds WHERE kinds.value=records.kind) AND id>? ORDER BY id LIMIT ?').bind(MAX_ROW_BYTES,owner,JSON.stringify(KINDS),cursor,Math.min(PAGE,remaining+1)).all<StoredRow>();
   if((Reflect.get(page,'success') as unknown)===false||!Array.isArray(page.results)){result.complete=false;break}
   if(!page.results.length)break;
   for(const row of page.results){
    if(result.scanned===MAX_ROWS||bytes+row.bytes>MAX_TOTAL_BYTES){result.complete=false;break}
    result.scanned++;bytes+=row.bytes;cursor=row.id;const e=retentionEntry(row,at);entries.push(e);if(!e.valid)result.complete=false;
   }
   if(result.scanned===MAX_ROWS&&page.results.length>remaining)break;
   if(bytes>MAX_TOTAL_BYTES||cursor!==page.results.at(-1)?.id)break;
  }
 }catch{result.complete=false}
 if(!inheritRetention(entries))result.complete=false;
 const byKind=new Map(result.rows.map(r=>[r.kind,r]));
 for(const e of entries){
  const row=byKind.get(e.row.kind)!;row.records++;
  if(!e.youtube)continue;
  row.youtubeRecords++;
  if(e.invalidTime||!e.times.size)row.invalidTimeRecords++;
  const oldest=e.times.size?Math.min(...e.times):null;
  if(oldest!==null){if(at-oldest>=30*DAY)row.expiredRecords++;const iso=new Date(oldest).toISOString();if(!row.oldestFetchedAt||iso<row.oldestFetchedAt)row.oldestFetchedAt=iso}
  if(e.row.kind==='hermes_submission')result.externalDeletion='unverified';
 }
 if(!result.complete)result.externalDeletion='unverified';
 return result;
}
