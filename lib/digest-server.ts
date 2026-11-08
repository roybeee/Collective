// G3 일일 요약 전송. 스위치 digest_mail(기본 꺼짐)과 설정된 전송 어댑터가 모두 있을 때만 하루 1회 digest_sent 1행을 기록한다.
// 이 PR의 mail 어댑터는 스텁이다: 네트워크를 쓰지 않고 기록만 남긴다. 알림톡 어댑터는 같은 DigestTransport 계약으로 뒤에 붙인다(docs/AUTONOMY.ko.md).
import {agenda} from './agenda-server';
import {buildDigest,type Digest,type DigestInput,type DigestRun} from './digest';
import {isEnabled} from './feature-flags';
import {SCHEDULE_KIND_LABELS,kstParts,scheduleTitle,type ScheduledRun,type Schedule} from './scheduled-runs';
import {ApiError,database,readRecord,recordStatement,runtime,stamp,type Actor} from './server';

export type DigestDelivery={status:'recorded'|'skipped';reason?:string};
// 전송 어댑터 계약. configured가 false면 보내지 않는다. deliver는 외부 결과를 돌려주되 이 PR에서는 실제 전송이 없다.
export type DigestTransport={name:'mail'|'alimtalk';configured:boolean;target:string|null;deliver(digest:Digest):Promise<DigestDelivery>};
export type DigestSentRecord={id:string;day:string;transport:DigestTransport['name'];target:string|null;subject:string;text:string;status:DigestDelivery['status'];reason:string|null;recordedAt:string};
const mask=(to:string)=>to.replace(/^(.).*(@.*)$/,'$1***$2');
// mail 스텁: 받는 주소는 환경변수 DIGEST_MAIL_TO. 주소가 없으면 미설정이다. 실제 발송 연동은 별도 PR(그때도 이 함수의 결과 모양은 유지한다).
export function mailTransport(env:{DIGEST_MAIL_TO?:string}=runtime as {DIGEST_MAIL_TO?:string}):DigestTransport{
 const to=(env.DIGEST_MAIL_TO||'').trim();
 return {name:'mail',configured:!!to,target:to?mask(to):null,async deliver(){return {status:'recorded',reason:'mail 어댑터 스텁: 기록만 남기고 실제 메일은 보내지 않았습니다.'}}};
}
async function costToday(owner:string,dayStartIso:string){
 const row=await database().prepare("SELECT COUNT(*) AS runs,SUM(CASE WHEN json_extract(data,'$.costAmount') IS NULL THEN 1 ELSE 0 END) AS unknownRuns,SUM(json_extract(data,'$.costAmount')) AS amount,MAX(json_extract(data,'$.currency')) AS currency FROM records WHERE owner=? AND kind='provider_usage' AND json_extract(data,'$.observedAt')>=?").bind(owner,dayStartIso).first<{runs:number;unknownRuns:number|null;amount:number|null;currency:string|null}>();
 return {runs:Number(row?.runs??0),unknownRuns:Number(row?.unknownRuns??0),amount:row?.amount===null||row?.amount===undefined?null:Number(row.amount),currency:row?.currency??null};
}
async function runsToday(owner:string,day:string):Promise<DigestRun[]>{
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='scheduled_run_execution' AND json_extract(data,'$.period')=? ORDER BY updated_at LIMIT 50").bind(owner,day).all<{data:string}>();
 const schedules=new Map((await database().prepare("SELECT data FROM records WHERE owner=? AND kind='scheduled_run'").bind(owner).all<{data:string}>()).results.map(r=>{const s=JSON.parse(r.data) as Schedule;return [s.id,s]}));
 return rows.results.map(r=>JSON.parse(r.data) as ScheduledRun).map(r=>({title:schedules.has(r.scheduleId)?scheduleTitle(schedules.get(r.scheduleId)!):SCHEDULE_KIND_LABELS[r.kind]??r.kind,status:r.status,reason:r.reason}));
}
export async function collectDigestInput(owner:string,now=Date.now()):Promise<DigestInput>{
 const day=kstParts(now).day,who:Actor={owner,id:'daily_digest',email:null,role:'owner'};
 const dayStart=new Date(Date.parse(`${day}T00:00:00+09:00`)).toISOString();
 const [today,runs,cost]=await Promise.all([agenda(who,now),runsToday(owner,day),costToday(owner,dayStart)]);
 return {day,agenda:{counts:today.counts,items:today.items.map(i=>({title:i.title,campaignTitle:i.campaignTitle,due:i.due})),total:today.total},runs,cost};
}
async function sentToday(owner:string,day:string){
 try{return await readRecord<DigestSentRecord>(owner,'digest_sent',day)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}
}
// 하루 1회(KST). 스위치 꺼짐·어댑터 미설정·이미 보냄이면 쓰기 0으로 idle이다. 전송 자체는 어댑터가 하고 결과를 기록한다.
export async function sendDailyDigest(owner:string,now=Date.now(),transport:DigestTransport=mailTransport()){
 if(!await isEnabled(owner,'digest_mail'))return {status:'idle' as const,reason:'disabled' as const};
 if(!transport.configured)return {status:'idle' as const,reason:'unconfigured' as const};
 const day=kstParts(now).day;
 if(await sentToday(owner,day))return {status:'idle' as const,reason:'sent' as const};
 const digest=buildDigest(await collectDigestInput(owner,now)),delivery=await transport.deliver(digest);
 const row:DigestSentRecord={id:day,day,transport:transport.name,target:transport.target,subject:digest.subject,text:digest.text,status:delivery.status,reason:delivery.reason??null,recordedAt:stamp()};
 await recordStatement(owner,'digest_sent',day,row).run();
 return {status:'processed' as const,day,delivery:delivery.status};
}
export async function digestView(who:Actor,now=Date.now()){
 const transport=mailTransport(),day=kstParts(now).day;
 return {enabled:await isEnabled(who.owner,'digest_mail'),transport:{name:transport.name,configured:transport.configured,target:who.role==='member'?null:transport.target},today:await sentToday(who.owner,day),preview:buildDigest(await collectDigestInput(who.owner,now))};
}
