// 상품 리서치 저장 계층(서버 전용). records 표의 pr_* kind만 쓴다(kinds.ts). 모든 조회·쓰기는 소유자(owner) 범위다.
// 원칙: 스냅샷은 불변(INSERT만, 덮어쓰기 없음), 점수표 판도 불변, 자격증명은 봉인(lib/credential-crypto-server.ts)해서만 저장한다.
// D1은 한 질의의 바인드 값 수와 호출당 질의 수에 한도가 있어, 여러 행 쓰기·지우기는 JSON 배열 하나를 json_each로 펼쳐 한 문장으로 보낸다.
import {ApiError,database,readRecord,stamp} from '../server';
import {openRecordSecret,sealRecordSecret} from '../credential-crypto-server';
import {isEnabled} from '../feature-flags';
import {focusCategories,CATEGORIES} from './categories';
import {FOCUS_TEMPERATURES} from './categories';
import {PR_KINDS} from './kinds';
import {CREDENTIAL_KEYS,type CredentialKey,type ResearchSettings} from './api';
import {parseResearchCredential,credentialAccount,type ResearchCredential} from './credentials';
import {sourceSpec} from './sources';
import {quotaDayKey} from './collectors/quota';
import type {Snapshot,SourceId,Temperature} from './types';

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
 if(priceMax!==null&&(typeof priceMax!=='number'||!Number.isInteger(priceMax)||priceMax<100||priceMax>10_000_000))throw new ApiError(400,'가격 상한은 100원~1,000만 원 사이 정수로 입력하거나 비워 두세요.');
 const question=typeof v.question==='string'?v.question.trim():'';
 if(question.length>200||hasControl(question))throw new ApiError(400,'조사 질문은 200자 이내 한 줄로 입력하세요.');
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
export type QuotaRow={sourceId:SourceId;day:string;used:number;calls:number};
export async function quotaUsed(owner:string,sourceId:SourceId,now:Date){
 return (await optional<QuotaRow>(owner,K.quota,`${sourceId}:${quotaDayKey(sourceId,now)}`))?.used??0;
}
export async function reserveQuota(owner:string,sourceId:SourceId,units:number,now:Date):Promise<boolean>{
 const day=quotaDayKey(sourceId,now),limit=sourceSpec(sourceId).dailyQuota??Number.MAX_SAFE_INTEGER,key=`${sourceId}:${day}`;
 const r=await database().prepare(`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,?,?,json_object('sourceId',?,'day',?,'used',?,'calls',1),? WHERE ?<=? ON CONFLICT(id) DO UPDATE SET data=json_set(records.data,'$.used',json_extract(records.data,'$.used')+?,'$.calls',json_extract(records.data,'$.calls')+1),updated_at=excluded.updated_at WHERE records.owner=excluded.owner AND json_extract(records.data,'$.used')+?<=?`)
  .bind(rowId(owner,K.quota,key),owner,K.quota,sourceId,sourceId,day,units,now.toISOString(),units,limit,units,units,limit).run();
 return r.meta.changes>0;
}
export async function refundQuota(owner:string,sourceId:SourceId,units:number,now:Date){
 const key=`${sourceId}:${quotaDayKey(sourceId,now)}`;
 await database().prepare(`UPDATE records SET data=json_set(data,'$.used',max(0,json_extract(data,'$.used')-?),'$.calls',max(0,json_extract(data,'$.calls')-1)) WHERE id=? AND owner=? AND kind=?`).bind(units,rowId(owner,K.quota,key),owner,K.quota).run();
}
export async function pruneQuota(owner:string,now:Date){
 await database().prepare('DELETE FROM records WHERE owner=? AND kind=? AND updated_at<?').bind(owner,K.quota,new Date(now.getTime()-60*DAY).toISOString()).run();
}

// ── 스냅샷(pr_snapshot). parent_id=출처, updated_at=수집 시각(오래된 순 정리에 쓴다).
export function snapshotStatement(owner:string,s:Snapshot){return appendStatement(owner,K.snapshot,s.id,s,s.sourceId,s.fetchedAt)}
export async function readSnapshots(owner:string,ids:readonly string[]){return readMany<Snapshot>(owner,K.snapshot,ids)}
// 최근 스냅샷을 쪽 단위로 읽는다(한 응답이 너무 커지지 않게). since 이후·최대 limit개, 최신순.
export async function recentSnapshots(owner:string,sinceIso:string,limit:number):Promise<Snapshot[]>{
 const out:Snapshot[]=[];let before='9999-12-31T23:59:59.999Z',beforeId='￿';
 while(out.length<limit){
  const page=Math.min(200,limit-out.length);
  const r=await database().prepare('SELECT id,data,updated_at FROM records WHERE owner=? AND kind=? AND updated_at>=? AND (updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC, id DESC LIMIT ?').bind(owner,K.snapshot,sinceIso,before,before,beforeId,page).all<{id:string;data:string;updated_at:string}>();
  for(const row of r.results)out.push(JSON.parse(row.data) as Snapshot);
  if(r.results.length<page)break;
  const last=r.results[r.results.length-1];before=last.updated_at;beforeId=last.id;
 }
 return out;
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

// ── 요청 멱등(pr_request)
export const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type RequestRow={id:string;action:string;digest:string;resultId:string|null;at:string;status?:'done'|'pending'|'rejected'|'failed';job?:Record<string,unknown>;error?:{status:number;message:string;unsupported?:string[]}};
export function requestStatement(owner:string,row:RequestRow){return putStatement(owner,K.request,row.id,row,row.action,row.at)}
export async function ensureRequestRoom(owner:string,now:Date){
 if(await countKind(owner,K.request)<MAX_REQUESTS)return;
 await database().prepare('DELETE FROM records WHERE owner=? AND kind=? AND updated_at<?').bind(owner,K.request,new Date(now.getTime()-90*DAY).toISOString()).run();
 if(await countKind(owner,K.request)>=MAX_REQUESTS)throw new ApiError(409,'상품 리서치 요청 기록 한도에 도달했습니다. 잠시 후 다시 시도하세요.');
}
