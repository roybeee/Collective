// 상품 리서치 저장 계층(서버 전용). records 표의 pr_* kind만 쓴다(kinds.ts). 모든 조회·쓰기는 소유자(owner) 범위다.
// 원칙: 스냅샷은 불변(INSERT만, 덮어쓰기 없음), 점수표 판도 불변, 자격증명은 봉인(lib/credential-crypto-server.ts)해서만 저장한다.
// D1은 한 질의의 바인드 값 수와 호출당 질의 수에 한도가 있어, 여러 행 쓰기·지우기는 JSON 배열 하나를 json_each로 펼쳐 한 문장으로 보낸다.
import {ApiError,acquireLock,database,readRecord,releaseLock,stamp} from '../server';
import {openRecordSecret,sealRecordSecret} from '../credential-crypto-server';
import {isEnabled} from '../feature-flags';
import {focusCategories,CATEGORIES} from './categories';
import {FOCUS_TEMPERATURES} from './categories';
import {PR_KINDS} from './kinds';
import {CREDENTIAL_KEYS,PRICE_MAX_MAX,PRICE_MAX_MIN,QUESTION_MAX,type CredentialKey,type ResearchSettings} from './api';
import {parseResearchCredential,credentialAccount,type ResearchCredential} from './credentials';
import {dailyCap,quotaDayKey} from './collectors/quota';
import {subjectKey} from './analytics/series';
import type {MetricKey,Snapshot,SourceId,Temperature} from './types';

export const K=PR_KINDS;
export const MAX_SNAPSHOTS=20000,MAX_PRODUCTS=2000,SNAPSHOT_RETENTION_DAYS=400,MAX_REQUESTS=20000,MAX_SCORES=50000;
const DAY=86400000;
// json_each로 넘기는 한 문장의 JSON 크기 상한(D1 행·문자열 한도 2MB보다 여유 있게).
const BULK_BYTES=700_000;

export const flagOff=()=>new ApiError(409,'상품 리서치 기능이 꺼져 있습니다. 소유자가 기능 스위치 product_research를 켠 뒤 다시 시도하세요.');
export async function researchEnabled(owner:string){try{return await isEnabled(owner,'product_research')}catch{return false}}
export async function collectEnabled(owner:string){try{return await isEnabled(owner,'product_research_collect')}catch{return false}}
export async function requireResearch(owner:string){if(!await researchEnabled(owner))throw flagOff()}

export async function optional<T>(owner:string,kind:string,id:string):Promise<T|null>{
 try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}
}
export const rowId=(owner:string,kind:string,key:string)=>`${owner}:${kind}:${key}`;
export function putStatement(owner:string,kind:string,key:string,data:unknown,parent='',at=stamp()){
 return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at WHERE records.owner=excluded.owner').bind(rowId(owner,kind,key),owner,kind,parent,JSON.stringify(data),at);
}
// 불변 기록: 같은 id가 있으면 실패한다(덮어쓰기 없음).
export function appendStatement(owner:string,kind:string,key:string,data:unknown,parent='',at=stamp()){
 return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(rowId(owner,kind,key),owner,kind,parent,JSON.stringify(data),at);
}
function chunks<T>(rows:readonly T[],size:(r:T)=>number){
 const out:T[][]=[];let cur:T[]=[],bytes=0;
 for(const r of rows){const n=size(r);if(cur.length&&bytes+n>BULK_BYTES){out.push(cur);cur=[];bytes=0}cur.push(r);bytes+=n}
 if(cur.length)out.push(cur);
 return out;
}
// 여러 행 덮어쓰기(upsert). mode='insert_only'면 이미 있는 행은 그대로 둔다(불변 판).
export function bulkPut(owner:string,kind:string,rows:readonly {key:string;parent?:string;data:unknown;at?:string}[],mode:'upsert'|'insert_only'='upsert'){
 const items=rows.map(r=>({id:rowId(owner,kind,r.key),parent:r.parent??'',data:JSON.stringify(r.data),at:r.at??stamp()}));
 const conflict=mode==='upsert'?'DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at WHERE records.owner=excluded.owner':'DO NOTHING';
 return chunks(items,i=>i.data.length+i.id.length+64).map(c=>database().prepare(`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.parent'),json_extract(value,'$.data'),json_extract(value,'$.at') FROM json_each(?) WHERE true ON CONFLICT(id) ${conflict}`).bind(owner,kind,JSON.stringify(c)));
}
export function bulkDelete(owner:string,kind:string,keys:readonly string[]){
 const ids=keys.map(k=>rowId(owner,kind,k));
 return chunks(ids,i=>i.length+4).map(c=>database().prepare('DELETE FROM records WHERE owner=? AND kind=? AND id IN (SELECT value FROM json_each(?))').bind(owner,kind,JSON.stringify(c)));
}
export async function countKind(owner:string,kind:string){
 const r=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').bind(owner,kind).first<{n:number}>();
 return Number(r?.n)||0;
}
// 한도 있는 목록. 한도를 넘으면 잘라 읽지 않고 409로 알린다(부분 계산 금지).
export async function listKind<T>(owner:string,kind:string,limit:number,label:string):Promise<T[]>{
 const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC, id LIMIT ?').bind(owner,kind,limit+1).all<{data:string}>();
 if(r.results.length>limit)throw new ApiError(409,`${label} 기록이 조회 한도(${limit.toLocaleString('ko-KR')}건)를 넘었습니다. 관리자에게 정리를 요청하세요.`);
 return r.results.map(x=>JSON.parse(x.data) as T);
}
export async function readMany<T>(owner:string,kind:string,keys:readonly string[]):Promise<Map<string,T>>{
 const out=new Map<string,T>(),uniq=[...new Set(keys)];
 for(let i=0;i<uniq.length;i+=200){
  const part=uniq.slice(i,i+200).map(k=>rowId(owner,kind,k));
  const r=await database().prepare('SELECT id,data FROM records WHERE owner=? AND kind=? AND id IN (SELECT value FROM json_each(?))').bind(owner,kind,JSON.stringify(part)).all<{id:string;data:string}>();
  const prefix=rowId(owner,kind,'');
  for(const row of r.results)out.set(row.id.slice(prefix.length),JSON.parse(row.data) as T);
 }
 return out;
}

// ── 조사 방향(pr_settings)
export function defaultSettings():ResearchSettings{return {categories:focusCategories(),temperatures:[...FOCUS_TEMPERATURES],priceMax:null,question:'',version:0,updatedAt:null}}
export async function readSettings(owner:string):Promise<ResearchSettings>{return (await optional<ResearchSettings>(owner,K.settings,'current'))??defaultSettings()}
const TEMPS:readonly Temperature[]=['ambient','chilled','frozen'];
const hasControl=(s:string)=>[...s].some(c=>{const n=c.charCodeAt(0);return n<32||n===127});
export function parseSettings(value:unknown):Omit<ResearchSettings,'version'|'updatedAt'>{
 const v=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
 if(!v)throw new ApiError(400,'조사 방향 입력 형식을 확인하세요.');
 const cats=Array.isArray(v.categories)?[...new Set(v.categories)]:null;
 if(!cats||!cats.length||cats.length>CATEGORIES.length||!cats.every(c=>typeof c==='string'&&CATEGORIES.some(x=>x.id===c)))throw new ApiError(400,'조사할 카테고리를 1개 이상 목록에서 고르세요.');
 const temps=Array.isArray(v.temperatures)?[...new Set(v.temperatures)]:null;
 if(!temps||!temps.length||!temps.every(t=>TEMPS.includes(t as Temperature)))throw new ApiError(400,'보관 온도는 상온·냉장·냉동 중 1개 이상 고르세요.');
 const priceMax=v.priceMax===null||v.priceMax===undefined?null:v.priceMax;
 if(priceMax!==null&&(typeof priceMax!=='number'||!Number.isInteger(priceMax)||priceMax<PRICE_MAX_MIN||priceMax>PRICE_MAX_MAX))throw new ApiError(400,'가격 상한은 100원~1,000만 원 사이 정수로 입력하거나 비워 두세요.');
 const question=typeof v.question==='string'?v.question.trim():'';
 if(question.length>QUESTION_MAX||hasControl(question))throw new ApiError(400,`조사 질문은 ${QUESTION_MAX}자 이내 한 줄로 입력하세요.`);
 return {categories:cats as string[],temperatures:temps as Temperature[],priceMax:priceMax as number|null,question};
}

// ── 자격증명(pr_credential). secret만 봉인 문자열이고 나머지는 화면에 보일 수 있는 메타데이터다.
export type StoredCredential={key:CredentialKey;secret:string;account:string;createdAt:string;updatedAt:string;verifiedAt:string|null};
export async function credentialStatus(owner:string){
 const rows=await listKind<StoredCredential>(owner,K.credential,CREDENTIAL_KEYS.length+5,'자격증명');
 return CREDENTIAL_KEYS.map(key=>{const r=rows.find(x=>x.key===key);return {key,connected:!!r,account:r?.account??null,updatedAt:r?.updatedAt??null}});
}
export async function sealCredential(owner:string,credential:ResearchCredential,old:StoredCredential|null){
 const at=stamp(),key=credential.kind as CredentialKey;
 const row:StoredCredential={key,secret:await sealRecordSecret(owner,K.credential,key,JSON.stringify(credential)),account:credentialAccount(credential),createdAt:old?.createdAt??at,updatedAt:at,verifiedAt:at};
 return putStatement(owner,K.credential,key,row);
}
// 저장된 자격증명을 연다. 풀 수 없으면 409(다시 등록 안내), 모양이 틀리면 null 대신 409로 알린다.
export async function loadCredential(owner:string,key:CredentialKey):Promise<ResearchCredential|null>{
 const row=await optional<StoredCredential>(owner,K.credential,key);
 if(!row)return null;
 const plain=await openRecordSecret(owner,K.credential,key,row.secret);
 try{return parseResearchCredential(key,JSON.parse(plain) as Record<string,unknown>)}catch{throw new ApiError(409,'저장된 출처 자격증명을 읽지 못했습니다. 출처 연결에서 다시 등록하세요.')}
}

// ── 쿼터 원장(pr_quota). 호출 전에 원자적으로 예약하고(한도를 넘으면 예약되지 않음), 호출 전에 막힌 입력 오류만 되돌린다.
// 한도는 앱 상한(collectors/quota.ts dailyCap)이다. 공급자가 한도를 공개하지 않은 출처도 보수 상한으로 막는다(평가 1회차 H4).
// ok: 정상 응답을 받은 호출 수(30일 성공률 = ok/calls, 신선도 ②).
export type QuotaRow={sourceId:SourceId;day:string;used:number;calls:number;ok?:number};
export async function quotaUsed(owner:string,sourceId:SourceId,now:Date){
 return (await optional<QuotaRow>(owner,K.quota,`${sourceId}:${quotaDayKey(sourceId,now)}`))?.used??0;
}
export async function reserveQuota(owner:string,sourceId:SourceId,units:number,now:Date):Promise<boolean>{
 const day=quotaDayKey(sourceId,now),limit=dailyCap(sourceId),key=`${sourceId}:${day}`;
 if(limit<=0||units>limit)return false;
 const r=await database().prepare(`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,?,?,json_object('sourceId',?,'day',?,'used',?,'calls',1),? WHERE ?<=? ON CONFLICT(id) DO UPDATE SET data=json_set(records.data,'$.used',json_extract(records.data,'$.used')+?,'$.calls',json_extract(records.data,'$.calls')+1),updated_at=excluded.updated_at WHERE records.owner=excluded.owner AND json_extract(records.data,'$.used')+?<=?`)
  .bind(rowId(owner,K.quota,key),owner,K.quota,sourceId,sourceId,day,units,now.toISOString(),units,limit,units,units,limit).run();
 return r.meta.changes>0;
}
export async function refundQuota(owner:string,sourceId:SourceId,units:number,now:Date){
 const key=`${sourceId}:${quotaDayKey(sourceId,now)}`;
 await database().prepare(`UPDATE records SET data=json_set(data,'$.used',max(0,json_extract(data,'$.used')-?),'$.calls',max(0,json_extract(data,'$.calls')-1)) WHERE id=? AND owner=? AND kind=?`).bind(units,rowId(owner,K.quota,key),owner,K.quota).run();
}
export async function markQuotaOk(owner:string,sourceId:SourceId,now:Date){
 const key=`${sourceId}:${quotaDayKey(sourceId,now)}`;
 await database().prepare(`UPDATE records SET data=json_set(data,'$.ok',coalesce(json_extract(data,'$.ok'),0)+1) WHERE id=? AND owner=? AND kind=?`).bind(rowId(owner,K.quota,key),owner,K.quota).run();
}
export async function pruneQuota(owner:string,now:Date){
 await database().prepare('DELETE FROM records WHERE owner=? AND kind=? AND updated_at<?').bind(owner,K.quota,new Date(now.getTime()-60*DAY).toISOString()).run();
}

// ── 스냅샷(pr_snapshot). parent_id=출처, updated_at=수집 시각(오래된 순 정리에 쓴다).
export function snapshotStatement(owner:string,s:Snapshot){return appendStatement(owner,K.snapshot,s.id,s,s.sourceId,s.fetchedAt)}
export async function readSnapshots(owner:string,ids:readonly string[]){return readMany<Snapshot>(owner,K.snapshot,ids)}
// ── 이상치 격리(pr_quarantine). 격리된 관측(스냅샷·대상·지표·기간 끝)은 사람이 해제하기 전까지 점수 계산 재료에서 뺀다(스냅샷 자체는 불변).
// 평가 2회차 M1: 격리 단위는 관측 한 점(기간 끝 periodTo)이다. 데이터랩 104주 시계열 전체를 빼지 않는다. periodTo가 없는 옛 행은 예전처럼 그 스냅샷의 대상·지표 전체를 뺀다.
// status 'flagged': 상대값(데이터랩) 급등처럼 다른 출처가 반박하지 않아 빼지 않고 표시만 한 관측(점수에 그대로 들어간다).
export type QuarantineRow={id:string;sourceId:SourceId;snapshotId:string;subjectKey:string;metric:string;periodTo:string;value:number;median:number;robustZ:number;window:number[];status:'active'|'cleared'|'flagged';createdAt:string;cleared:{by:{id:string;email:string|null};at:string;reason:string}|null;
 // 추가 필드(선택): 표시·격리 판단 근거(두 번째 출처 대조 결과).
 basis?:string|null};
export const MAX_ACTIVE_QUARANTINE=5000;
export const quarantineKey=(subject:string,metric:string,periodTo:string|null)=>`${subject}|${metric}|${periodTo??'*'}`;
// 상대값(데이터랩)은 매일 같은 주를 다시 받으므로, 격리한 기간은 같은 출처의 다른 스냅샷에서도 뺀다(지도 키 `*:출처`). 절대값은 그 스냅샷만.
const RELATIVE=new Set(['search_trend','shopping_click_trend']);
export async function activeQuarantine(owner:string):Promise<Map<string,Set<string>>>{
 const r=await database().prepare("SELECT json_extract(data,'$.snapshotId') s,json_extract(data,'$.sourceId') src,json_extract(data,'$.subjectKey') k,json_extract(data,'$.metric') m,json_extract(data,'$.periodTo') p FROM records WHERE owner=? AND kind=? AND json_extract(data,'$.status')='active' LIMIT ?").bind(owner,K.quarantine,MAX_ACTIVE_QUARANTINE).all<{s:string;src:string;k:string;m:string;p:string|null}>();
 const out=new Map<string,Set<string>>(),add=(key:string,v:string)=>{const set=out.get(key)??new Set<string>();set.add(v);out.set(key,set)};
 for(const x of r.results){const p=typeof x.p==='string'&&x.p?x.p:null,v=quarantineKey(x.k,x.m,p);add(x.s,v);if(p&&RELATIVE.has(x.m))add(`*:${x.src}`,v)}
 return out;
}
// 격리 표를 스냅샷 묶음에 적용한다. 바뀐 스냅샷만 새 객체로 만들고 한계(limitations)에 사유를 더한다.
export function applyQuarantine(snapshots:readonly Snapshot[],q:ReadonlyMap<string,ReadonlySet<string>>):Snapshot[]{
 if(!q.size)return [...snapshots];
 return snapshots.map(s=>{
  const hit=q.get(s.id),any=q.get(`*:${s.sourceId}`);if(!hit&&!any)return s;
  const kept=s.observations.filter(o=>{const k=subjectKey(o.subject),v=quarantineKey(k,o.metric,o.period.to);return !hit?.has(v)&&!hit?.has(quarantineKey(k,o.metric,null))&&!(any?.has(v)&&RELATIVE.has(o.metric))});
  return kept.length===s.observations.length?s:{...s,observations:kept,limitations:[...s.limitations,`이상치로 격리된 관측 ${s.observations.length-kept.length}개는 사람이 해제하기 전까지 점수 계산에서 뺐습니다.`]};
 });
}

// 재계산 한 번 안에서 같은 범위의 스냅샷을 두 번 읽지 않게 한다(이상치 검사·자사 판매·재계산이 같은 원본을 쓴다). 범위 밖에서는 캐시가 없다.
let reuse:Map<string,Snapshot[]>|null=null,reuseDepth=0;
export async function withSnapshotReuse<T>(fn:()=>Promise<T>):Promise<T>{
 if(reuseDepth++===0)reuse=new Map();
 try{return await fn()}finally{if(--reuseDepth===0)reuse=null}
}
export function forgetSnapshotReuse(owner:string){if(reuse)for(const k of [...reuse.keys()])if(k.startsWith(owner+'|'))reuse.delete(k)}
// 최근 스냅샷(격리 적용). 재계산·백테스트·매칭 확인이 이 함수로 읽어 격리된 관측이 점수에 들어가지 않는다.
export async function recentSnapshots(owner:string,sinceIso:string,limit:number):Promise<Snapshot[]>{
 const [raw,q]=await Promise.all([recentSnapshotsRaw(owner,sinceIso,limit),activeQuarantine(owner)]);
 return applyQuarantine(raw,q);
}
// 최근 스냅샷 원본을 쪽 단위로 읽는다(한 응답이 너무 커지지 않게). since 이후·최대 limit개, 최신순.
export async function recentSnapshotsRaw(owner:string,sinceIso:string,limit:number):Promise<Snapshot[]>{
 const cacheKey=`${owner}|${sinceIso}|${limit}`,hit=reuse?.get(cacheKey);if(hit)return hit;
 const out:Snapshot[]=[];let before='9999-12-31T23:59:59.999Z',beforeId='￿';
 while(out.length<limit){
  const page=Math.min(200,limit-out.length);
  const r=await database().prepare('SELECT id,data,updated_at FROM records WHERE owner=? AND kind=? AND updated_at>=? AND (updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC, id DESC LIMIT ?').bind(owner,K.snapshot,sinceIso,before,before,beforeId,page).all<{id:string;data:string;updated_at:string}>();
  for(const row of r.results)out.push(JSON.parse(row.data) as Snapshot);
  if(r.results.length<page)break;
  const last=r.results[r.results.length-1];before=last.updated_at;beforeId=last.id;
 }
 reuse?.set(cacheKey,out);
 return out;
}

// ── 출처별 읽기 계획(평가 2회차 H4). 최신 N개(전 출처 합산)로 자르면 하루 수십 개씩 쌓여 두 달 남짓만 남는다(12주 백테스트의 기준 시점 이전 관측이 0개).
// 그래서 출처마다 따로 읽는다: range=기간 안 최신순 상한, latest_group=데이터랩처럼 한 스냅샷이 긴 이력을 싣는 출처는 묶음(그룹 이름)마다 가장 최근 1개, latest=최신 1개.
// metrics를 주면 그 지표 관측만 SQL에서 골라 읽는다(필요한 열만, 응답 크기 축소).
export type SourceLoad={sourceId:SourceId;mode:'range'|'latest_group'|'latest';from:string;to?:string;cap:number;metrics?:readonly MetricKey[]};
const FAR='9999-12-31T23:59:59.999Z';
// 데이터랩 요청 범위의 묶음 이름: keywordGroups·categories·keywords('이름:…;이름:…'), 없으면 keyword 하나. 모르면 빈 배열(그 스냅샷만의 묶음으로 본다).
export function snapshotGroups(request:Snapshot['request']|null|undefined):string[]{
 if(!request)return [];
 for(const key of ['keywordGroups','categories','keywords'] as const){const v=request[key];if(typeof v==='string'&&v)return v.split(';').map(x=>x.split(':')[0].trim()).filter(Boolean)}
 return typeof request.keyword==='string'&&request.keyword?[request.keyword]:[];
}
// 데이터랩 묶음 구성: 묶음 이름 → 그 묶음에 넣어 요청한 키워드(합산 대상). keywordGroups가 없으면 빈 지도.
export function snapshotGroupMembers(request:Snapshot['request']|null|undefined):Map<string,string[]>{
 const out=new Map<string,string[]>(),v=request?.keywordGroups;
 if(typeof v!=='string'||!v)return out;
 for(const part of v.split(';')){const i=part.indexOf(':');if(i<=0)continue;const name=part.slice(0,i).trim(),ks=part.slice(i+1).split('|').map(x=>x.trim()).filter(Boolean);if(name&&ks.length)out.set(name,ks)}
 return out;
}
async function rangeRows(owner:string,l:SourceLoad):Promise<Snapshot[]>{
 const expr=l.metrics?.length?"json_set(data,'$.observations',json((SELECT json_group_array(json(value)) FROM json_each(data,'$.observations') WHERE json_extract(value,'$.metric') IN (SELECT value FROM json_each(?)))))":'data';
 const out:Snapshot[]=[];let before=l.to??FAR,beforeId='￿',first=true;
 while(out.length<l.cap){
  const page=Math.min(200,l.cap-out.length),binds:unknown[]=l.metrics?.length?[JSON.stringify(l.metrics)]:[];
  // 첫 쪽은 to 시각을 포함한다(같은 시각 스냅샷 포함), 다음 쪽부터는 (시각, id) 커서로 이어 읽는다.
  const r=await database().prepare(`SELECT id,${expr} d,updated_at FROM records WHERE owner=? AND kind=? AND parent_id=? AND updated_at>=? AND (updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC, id DESC LIMIT ?`).bind(...binds,owner,K.snapshot,l.sourceId,l.from,first?before+'\u0000':before,before,beforeId,page).all<{id:string;d:string;updated_at:string}>();
  first=false;
  for(const row of r.results)out.push(JSON.parse(row.d) as Snapshot);
  if(r.results.length<page)break;
  const last=r.results[r.results.length-1];before=last.updated_at;beforeId=last.id;
 }
 return out;
}
// 묶음마다 가장 최근 스냅샷: 작은 열(요청 범위)만 최신순으로 훑어 새 묶음을 보탠 스냅샷만 고른 뒤 본문을 읽는다.
async function latestGroupRows(owner:string,l:SourceLoad):Promise<Snapshot[]>{
 const r=await database().prepare("SELECT id,json_extract(data,'$.request') q FROM records WHERE owner=? AND kind=? AND parent_id=? AND updated_at>=? AND updated_at<=? AND json_extract(data,'$.status')!='failed' ORDER BY updated_at DESC, id DESC LIMIT ?").bind(owner,K.snapshot,l.sourceId,l.from,l.to??FAR,Math.max(l.cap*20,500)).all<{id:string;q:string|null}>();
 const seen=new Set<string>(),pick:string[]=[],prefix=rowId(owner,K.snapshot,'');
 for(const x of r.results){
  if(pick.length>=l.cap)break;
  let req:Snapshot['request']|null=null;try{req=x.q?JSON.parse(x.q) as Snapshot['request']:null}catch{req=null}
  const groups=snapshotGroups(req),keys=groups.length?groups:[`id:${x.id}`];
  if(keys.every(k=>seen.has(k)))continue;
  for(const k of keys)seen.add(k);pick.push(x.id.slice(prefix.length));
 }
 const got=await readMany<Snapshot>(owner,K.snapshot,pick);
 return pick.map(id=>got.get(id)).filter((s):s is Snapshot=>!!s);
}
// 계획대로 읽는다(격리 미적용 원본). 같은 재계산 범위(withSnapshotReuse) 안에서는 같은 계획을 두 번 읽지 않는다.
export async function loadPlannedRaw(owner:string,plan:readonly SourceLoad[]):Promise<Snapshot[]>{
 const cacheKey=`${owner}|plan|${JSON.stringify(plan)}`,hit=reuse?.get(cacheKey);if(hit)return hit;
 const out:Snapshot[]=[],ids=new Set<string>();
 for(const l of plan){
  const rows=l.mode==='latest_group'?await latestGroupRows(owner,l):await rangeRows(owner,l.mode==='latest'?{...l,cap:1}:l);
  for(const s of rows)if(!ids.has(s.id)){ids.add(s.id);out.push(s)}
 }
 reuse?.set(cacheKey,out);
 return out;
}
export async function loadPlanned(owner:string,plan:readonly SourceLoad[]):Promise<Snapshot[]>{
 const [raw,q]=await Promise.all([loadPlannedRaw(owner,plan),activeQuarantine(owner)]);
 return applyQuarantine(raw,q);
}
// 가장 늦은 정상 스냅샷 시각(백테스트 기준 시점 추정용). 없으면 null.
export async function latestSnapshotAt(owner:string):Promise<string|null>{
 const r=await database().prepare("SELECT MAX(updated_at) t FROM records WHERE owner=? AND kind=? AND json_extract(data,'$.status')!='failed'").bind(owner,K.snapshot).first<{t:string|null}>();
 return r?.t??null;
}
// 스냅샷 한도: 넣을 자리가 없으면 400일이 지난 스냅샷 중 현재 점수표·메모·결정이 가리키지 않는 것을 오래된 순으로 지운다. 그래도 모자라면 409.
export async function ensureSnapshotRoom(owner:string,adding:number,now:Date,referenced:()=>Promise<Set<string>>){
 const count=await countKind(owner,K.snapshot);
 if(count+adding<=MAX_SNAPSHOTS)return;
 const need=count+adding-MAX_SNAPSHOTS,refs=await referenced(),cutoff=new Date(now.getTime()-SNAPSHOT_RETENTION_DAYS*DAY).toISOString();
 const r=await database().prepare('SELECT id FROM records WHERE owner=? AND kind=? AND updated_at<? ORDER BY updated_at ASC, id ASC LIMIT ?').bind(owner,K.snapshot,cutoff,need+Math.min(refs.size,5000)).all<{id:string}>();
 const prefix=rowId(owner,K.snapshot,''),victims=r.results.map(x=>x.id.slice(prefix.length)).filter(id=>!refs.has(id)).slice(0,need);
 if(victims.length<need)throw new ApiError(409,`스냅샷 저장 한도(${MAX_SNAPSHOTS.toLocaleString('ko-KR')}개)에 도달했고, ${SNAPSHOT_RETENTION_DAYS}일이 지난 정리 가능한 스냅샷이 부족합니다. 수집 범위를 줄이거나 관리자에게 정리를 요청하세요.`);
 await database().batch(bulkDelete(owner,K.snapshot,victims));
}

// ── 상품 리서치 잠금(평가 1회차 H5). 작업자 수집·즉시 수집·가져오기·재계산·결정·넘기기 등 모든 상품 리서치 쓰기가 같은 키를 쓴다.
// 일반 소유자 잠금(acquireLock(owner))과 다른 행이라 상품 리서치가 다른 화면 저장을 오래 막지 않는다. waitMs 동안 기다린 뒤 409.
export const researchLockKey=(owner:string)=>`${owner}:product-research`;
export const RESEARCH_LOCK_BUSY='다른 상품 리서치 작업이 진행 중입니다. 잠시 후 다시 시도하세요.';
export const RESEARCH_LOCK_WAIT_MS=3000;
const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
// 이 실행 환경이 잡고 있는 잠금 토큰(소유자별). 긴 수집이 잠금 만료(lib/server.ts acquireLock, 120초) 전에 갱신할 때 쓴다(평가 2회차 M4).
const held=new Map<string,string>();
export const RESEARCH_LOCK_TTL_MS=120000;
export async function acquireResearchLock(owner:string,waitMs=RESEARCH_LOCK_WAIT_MS):Promise<string>{
 const key=researchLockKey(owner),deadline=Date.now()+Math.max(0,waitMs);
 for(;;){
  try{const token=await acquireLock(key);held.set(owner,token);return token}catch(e){
   if(!(e instanceof ApiError&&e.status===409))throw e;
   // 타이머가 없는 실행 환경(검사용 vm)에서는 기다리지 않고 바로 알린다.
   if(Date.now()>=deadline||typeof setTimeout!=='function')throw new ApiError(409,RESEARCH_LOCK_BUSY);
   await pause(Math.min(250,Math.max(1,deadline-Date.now())));
  }
 }
}
export async function releaseResearchLock(owner:string,token:string){if(held.get(owner)===token)held.delete(owner);await releaseLock(researchLockKey(owner),token)}
// 잠금 갱신: 이 실행 환경이 잡은 잠금이면 만료를 지금+120초로 민다. true=갱신, false=잠금을 잃음(만료 뒤 다른 실행이 가져감 → 상태를 저장하지 말고 멈춘다),
// null=이 실행 환경이 잡은 잠금이 없음(검사에서 직접 부른 경우 등, 판단하지 않는다).
export async function renewResearchLock(owner:string):Promise<boolean|null>{
 const token=held.get(owner);if(!token)return null;
 const r=await database().prepare('UPDATE mutation_locks SET expires_at=? WHERE owner=? AND token=?').bind(Date.now()+RESEARCH_LOCK_TTL_MS,researchLockKey(owner),token).run();
 if(r.meta.changes>0)return true;
 held.delete(owner);return false;
}
export const RESEARCH_LOCK_LOST='상품 리서치 잠금이 만료돼 다른 실행이 이어받았습니다. 이번 실행은 진행 상태를 저장하지 않고 멈췄습니다.';
export class ResearchLockLost extends Error{constructor(){super(RESEARCH_LOCK_LOST)}}
export async function withResearchLock<T>(owner:string,waitMs:number,fn:()=>Promise<T>):Promise<T>{
 const token=await acquireResearchLock(owner,waitMs);
 try{return await fn()}finally{await releaseResearchLock(owner,token)}
}

// ── 요청 멱등(pr_request)
export const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type RequestRow={id:string;action:string;digest:string;resultId:string|null;at:string;status?:'done'|'pending'|'rejected'|'failed';job?:Record<string,unknown>;error?:{status:number;message:string;unsupported?:string[]}};
export function requestStatement(owner:string,row:RequestRow){return putStatement(owner,K.request,row.id,row,row.action,row.at)}
export async function ensureRequestRoom(owner:string,now:Date){
 if(await countKind(owner,K.request)<MAX_REQUESTS)return;
 await database().prepare('DELETE FROM records WHERE owner=? AND kind=? AND updated_at<?').bind(owner,K.request,new Date(now.getTime()-90*DAY).toISOString()).run();
 if(await countKind(owner,K.request)>=MAX_REQUESTS)throw new ApiError(409,'상품 리서치 요청 기록 한도에 도달했습니다. 잠시 후 다시 시도하세요.');
}
