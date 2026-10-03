// 연결 자격증명 암호문 쓰기·지연 재암호화·전체 재암호화(security-ops-6). 스위치 crypto_v1_write(기본 꺼짐)는 여기서만 읽고, 읽기 실패는 꺼짐이다.
// 대상: AI 연결(settings), 성과 수집 채널(channel_credential), Buffer 발행(publisher_credential), 상품 리서치 출처(pr_credential). AAD는 암호문이 놓인 자리(lib/credential-crypto.ts)다.
// 꺼짐: 옛 형식으로 쓰고 읽을 때 다시 쓰지 않는다(이전 코드로 롤백해도 읽힌다). 켜짐: 현재 키·AAD로 v1을 쓰고, 옛 형식·이전 키 암호문은 읽을 때 현재 키로 다시 쓴다.
// 다시 쓰기는 읽은 행과 같을 때만 바꾼다(CAS, updated_at·다른 필드 유지). 실패해도 읽기는 성공하고 로그에는 고정 코드와 kind만 남긴다(키·평문·암호문 없음).
import {ApiError,database,encrypt,openSealed,SecretUnreadableError} from './server';
import {recordAad,settingsAad} from './credential-crypto';
import {isEnabled} from './feature-flags';

export const SEALED_RECORD_KINDS=['channel_credential','publisher_credential','pr_credential'] as const;
export type SealedRecordKind=typeof SEALED_RECORD_KINDS[number];
type SealedKind='settings'|SealedRecordKind;
export type ResealSummary={resealed:number;current:number;changed:number;failed:Record<SealedKind,number>;reasons:Record<string,number>};

async function v1Writes(owner:string){try{return await isEnabled(owner,'crypto_v1_write')}catch{return false}}
async function sealFor(owner:string,aad:string,value:string){return encrypt(value,await v1Writes(owner)?{aad}:undefined)}
export const sealRecordSecret=(owner:string,kind:SealedRecordKind,id:string,value:string)=>sealFor(owner,recordAad(owner,kind,id),value);
export const sealSettingsSecret=(owner:string,value:string)=>sealFor(owner,settingsAad(owner),value);

async function resealRecord(owner:string,kind:SealedRecordKind,id:string,sealed:string,plain:string){
 const rowId=recordAad(owner,kind,id);
 const row=await database().prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=?').bind(rowId,owner,kind).first<{data:string}>();
 const data=row?JSON.parse(row.data) as {secret?:unknown}:null;
 if(!row||data?.secret!==sealed)return false;
 const next=JSON.stringify({...data,secret:await encrypt(plain,{aad:rowId})});
 return !!(await database().prepare('UPDATE records SET data=? WHERE id=? AND owner=? AND kind=? AND data=?').bind(next,rowId,owner,kind,row.data).run()).meta.changes;
}
async function resealSettings(owner:string,sealed:string,plain:string){
 const next=await encrypt(plain,{aad:settingsAad(owner)});
 return !!(await database().prepare('UPDATE settings SET secret=? WHERE owner=? AND secret=?').bind(next,owner,sealed).run()).meta.changes;
}

// 레코드 암호문을 풀고, 켜짐이면 현재 키가 아닌 암호문을 다시 쓴다. 풀지 못하면 409(SecretUnreadableError)다.
export async function openRecordSecret(owner:string,kind:SealedRecordKind,id:string,sealed:string){
 const opened=await openSealed(sealed,recordAad(owner,kind,id));
 if(!opened.fresh&&await v1Writes(owner))await resealRecord(owner,kind,id,sealed,opened.plain).catch(()=>console.error('credential_reseal_failed',kind));
 return opened.plain;
}

type Item={kind:SealedKind;aad:string;sealed:string;write:(plain:string)=>Promise<boolean>};
async function sealedItems(owner:string){
 const items:Item[]=[];
 const settings=await database().prepare('SELECT secret FROM settings WHERE owner=?').bind(owner).first<{secret:string|null}>();
 const settingsSecret=settings?.secret;
 if(settingsSecret)items.push({kind:'settings',aad:settingsAad(owner),sealed:settingsSecret,write:plain=>resealSettings(owner,settingsSecret,plain)});
 for(const kind of SEALED_RECORD_KINDS){
  const rows=await database().prepare('SELECT id,data FROM records WHERE owner=? AND kind=?').bind(owner,kind).all<{id:string;data:string}>();
  const prefix=recordAad(owner,kind,'');
  for(const row of rows.results){
   const secret=(JSON.parse(row.data) as {secret?:unknown}).secret,id=row.id.slice(prefix.length);
   if(row.id.startsWith(prefix)&&typeof secret==='string')items.push({kind,aad:row.id,sealed:secret,write:plain=>resealRecord(owner,kind,id,secret,plain)});
  }
 }
 return items;
}
// 대표 전용 전체 재암호화. 스위치가 켜져 있을 때만 한다. 응답은 건수·종류·사유 코드뿐이다.
// resealed: 현재 키로 다시 씀, current: 이미 현재 키, changed: 읽는 사이 바뀌어 건너뜀(다시 실행), failed: 풀지 못함(다시 등록 필요).
export async function resealAll(owner:string):Promise<ResealSummary>{
 if(!await v1Writes(owner))throw new ApiError(409,'기능 스위치 crypto_v1_write를 켠 뒤 전체 재암호화를 실행하세요.');
 const summary:ResealSummary={resealed:0,current:0,changed:0,failed:{settings:0,channel_credential:0,publisher_credential:0,pr_credential:0},reasons:{}};
 for(const item of await sealedItems(owner)){
  try{
   const opened=await openSealed(item.sealed,item.aad);
   if(opened.fresh)summary.current++;
   else if(await item.write(opened.plain))summary.resealed++;
   else summary.changed++;
  }catch(error){
   if(!(error instanceof SecretUnreadableError))throw error;
   summary.failed[item.kind]++;
   summary.reasons[error.reason]=(summary.reasons[error.reason]||0)+1;
  }
 }
 return summary;
}
