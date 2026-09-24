import {ApiError,database,eventStatement,listRecords,readRecord,recordStatement,str,stamp,type EventActor} from './server';
import {partialDay,type MeasurementDraft,type MeasurementSource} from './measurement-collection';
import type {CollectionWindow} from './connectors/types';
import type {ViralExperiment} from './learning';
import type {Store} from './store-marketing';
import type {StoreSpend} from './store-operations';

// 네이버 검색광고 수집 광고비를 비용 장부(store_spend)로 옮긴다(PR 4b-2, loop-3 권고). 라우팅·권한은 lib/store-operations-server.ts measurementAction이 한다.
// 미리보기(transfer_preview)는 이 지점 캠페인(지점 전용·브랜드 공통)의 바이럴 실험 수집 초안(measurement_draft)에서 arm별 광고비·수집 기간·수집 시각을 읽기만 한다.
// 옮기기(transfer_spend)는 사람이 확인해 보낸 금액·기간·수집 시각이 지금 초안과 같을 때만 한 건을 쓴다. 금액은 수집값 그대로이고 모르는 값(null)을 0으로 바꾸지 않는다.
// 커넥터는 기간 합계 한 값만 주므로 기간 종료일 한 건으로 쓰고 출처(source)에 수집값·수집 기간·실험·광고 대상을 적는다(store_spend 모양은 그대로).
// 중복: 비용 id가 광고 대상·시작일로 정해진다. 같은 광고 대상의 겹치는 기간을 이미 옮겼으면(같은 실험·같은 기간 포함, 다른 arm·실험·지점이어도) 같은 돈이라 409다.
// 롤링 수집(R1): 진행 중 실험은 시작일을 고정한 채 종료일만 늘려 다시 수집한다. 같은 광고 대상·같은 시작일에 종료일만 늘어난 창은 옮긴 한 건을 확인 뒤 새 누적값·기간·출처로 바꾼다(version 증가, 이중 계상 없음).
// 옮긴 뒤 사람이 비용 기록에서 금액·비용일·출처를 고친 기록과 다른 지점 장부의 기록은 바꾸지 않는다(409, 직접 고친다). 옮기기·바꾸기는 캠페인 이벤트에 관리자를 남긴다.
export type SpendTransferred={id:string;storeId:string;date:string;from:string;to:string;message:string};
export type SpendReplaced={id:string;from:string;to:string;adSpend:number;experimentId:string;version:number};
export type SpendCandidate={experimentId:string;experimentTitle:string;campaignId:string;scope:'store'|'brand';arm:'control'|'treatment'|null;armLabel:string;target:string|null;adSpend:number|null;window:CollectionWindow;fetchedAt:string;date:string;source:string;limitations:string[];blocked:string|null;transferred:SpendTransferred|null;replaces:SpendReplaced|null};
type Entry={arm:SpendCandidate['arm'];target:string|null;window:CollectionWindow;fetchedAt:string;value:unknown;limitations:string[]};
const armLabels={control:'대조안',treatment:'실험안'} as const;
// naver- 비용 id는 옮기기 전용이다. 기존 비용 입력(save_spend)은 이 접두사로 새 기록을 만들지 못한다(옮긴 표식 위조 방지, SEC-4b2-1).
export const TRANSFER_PREFIX='naver-';
const PREFIX=TRANSFER_PREFIX,ID=/^naver-([0-9a-f]{24})-(\d{4}-\d{2}-\d{2})$/;
// 출처 문구 앞머리의 수집값·수집 기간. 옮긴 뒤 금액·비용일·출처를 사람이 고쳤는지 이것과 견준다.
const SOURCE=/^naver_ads 수집 · 네이버 검색광고 광고비\(salesAmt\) 수집값 (\S+)원 · 수집 기간 (\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})\(/;
const seoulDay=(at:string)=>new Date(at).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),seoulTime=(at:string)=>new Date(at).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,16);
async function targetKey(target:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('naver_ads\u0000'+target));return Array.from(new Uint8Array(hash).slice(0,12),x=>x.toString(16).padStart(2,'0')).join('')}
const spendId=(key:string,w:CollectionWindow)=>`${PREFIX}${key}-${w.from}`,won=(n:number)=>n.toLocaleString('ko-KR')+'원';

// arm별 광고비(수집 때 arm 기록에 남긴 storeValues). 이전 초안은 최상위 광고비가 마지막으로 수집한 arm의 것이라, 같은 배치로 쓴 수집 대상(수집 시각·기간이 같음)에서 arm·광고 대상을 찾는다.
async function entriesOf(owner:string,draft:MeasurementDraft):Promise<Entry[]>{
 const arms=draft.arms||{};
 if(Object.values(arms).some(e=>e?.storeValues))return (['control','treatment'] as const).flatMap(a=>{const e=arms[a];return e?.storeValues&&'adSpend' in e.storeValues?[{arm:a,target:e.target??null,window:e.window,fetchedAt:e.fetchedAt,value:e.storeValues.adSpend,limitations:e.limitations}]:[]});
 if(!draft.storeValues||!('adSpend' in draft.storeValues))return [];
 const source=(await listRecords<MeasurementSource>(owner,'measurement_source',draft.experimentId)).find(s=>s.lastFetchedAt===draft.fetchedAt&&s.window.from===draft.window.from&&s.window.to===draft.window.to);
 return [{arm:source?.arm??null,target:source?.target??null,window:draft.window,fetchedAt:draft.fetchedAt,value:draft.storeValues.adSpend,limitations:draft.limitations}];
}
function refusal(e:Entry){
 if(e.value===null||e.value===undefined)return '네이버 검색광고가 이 기간의 광고비를 돌려주지 않았습니다(미확인). 0으로 바꿔 옮기지 않습니다. 다시 수집하거나 비용 기록에 직접 입력하세요.';
 if(typeof e.value!=='number'||!Number.isFinite(e.value)||e.value<0||e.value>1e12)return '수집한 광고비 값이 올바르지 않습니다(음수이거나 숫자가 아님). 장부로 옮기지 않습니다.';
 if(!e.arm||!e.target)return '이 수집값의 광고 대상을 확인할 수 없습니다(이전 형식 초안). 다시 수집한 뒤 옮기세요.';
 if(partialDay(e))return `당일 부분 집계입니다(수집 기간 ~${e.window.to}, 수집일 ${seoulDay(e.fetchedAt)}). 하루가 지난 뒤 다시 수집한 값을 옮기세요.`;
 return null;
}
const sourceText=(x:ViralExperiment,e:Entry)=>`naver_ads 수집 · 네이버 검색광고 광고비(salesAmt) 수집값 ${typeof e.value==='number'?e.value:'미확인'}원 · 수집 기간 ${e.window.from}~${e.window.to}(기간 합계를 종료일 한 건으로 기록) · 수집 시각 ${seoulTime(e.fetchedAt)}(한국) · 바이럴 실험 ${x.title.slice(0,150)}(${x.id.slice(0,200)}) ${e.arm?armLabels[e.arm]:''} · 광고 대상 ${(e.target||'미확인').slice(0,100)} · 부가세 기준은 네이버 검색광고 통계 정의를 따름`;
// 이미 옮긴 네이버 수집 광고비(id로 광고 대상·시작일, 출처 문구·비용일로 종료일을 안다). 다른 지점 장부에 옮긴 것도 본다.
// edited: 출처 문구의 수집값·수집 기간과 금액·비용일이 어긋나거나 제작비·채널이 바뀌면 사람이 고친 기록이다.
async function transfers(owner:string){
 const prefix=`${owner}:store_spend:`,rows=await database().prepare("SELECT id,parent_id,data FROM records WHERE owner=? AND kind='store_spend' AND substr(id,1,?)=?").bind(owner,prefix.length+PREFIX.length,prefix+PREFIX).all<{id:string;parent_id:string;data:string}>();
 return rows.results.flatMap(r=>{
  const id=r.id.slice(prefix.length),m=ID.exec(id);if(!m)return [];
  const s=JSON.parse(r.data) as StoreSpend,w=SOURCE.exec(s.source),edited=!w||Number(w[1])!==s.adSpend||w[2]!==m[2]||w[3]!==s.date||s.productionCost!==0||s.channel!=='naver_ads';
  return [{id,storeId:r.parent_id,date:s.date,key:m[1],from:m[2],to:w&&w[3]>s.date?w[3]:s.date,adSpend:s.adSpend,experimentId:s.experimentId,version:s.version,edited}];
 });
}
type Transfer=Awaited<ReturnType<typeof transfers>>[number];
// 같은 광고 대상의 옮긴 기록과 견준다: 시작일이 다른 겹침·같거나 짧은 창은 이미 옮김(409), 시작일이 같고 종료일만 늘어난 창은 그 한 건 바꾸기(replaces).
function priorOf(done:readonly Transfer[],key:string|null,w:CollectionWindow,storeId:string):Pick<SpendCandidate,'transferred'|'replaces'>{
 const overlapping=done.filter(t=>t.key===key&&t.from<=w.to&&t.to>=w.from),other=overlapping.find(t=>t.from!==w.from),same=overlapping.find(t=>t.from===w.from),where=(t:Transfer)=>t.storeId!==storeId?', 다른 지점 장부':'';
 const mark=(t:Transfer,message:string)=>({transferred:{id:t.id,storeId:t.storeId,date:t.date,from:t.from,to:t.to,message},replaces:null});
 if(other)return mark(other,`같은 광고 대상의 겹치는 기간(${other.from}~${other.to}${where(other)})을 이미 옮겼습니다. 겹치는 기간을 다시 옮기면 광고비가 두 번 들어갑니다. 차액은 비용 기록에서 직접 입력하세요.`);
 if(!same)return {transferred:null,replaces:null};
 if(same.to>=w.to)return mark(same,`이미 옮긴 수집 광고비입니다(${same.from}~${same.to}, 비용일 ${same.date}${where(same)}). 같은 광고비를 두 번 기록하지 않습니다.`);
 if(same.storeId!==storeId)return mark(same,`같은 광고 대상의 앞선 기간(${same.from}~${same.to})을 다른 지점 장부에 옮겼습니다. 늘어난 기간(~${w.to})은 그 지점 화면에서 기존 기록을 바꾸세요.`);
 if(same.edited)return mark(same,`옮긴 뒤 비용 기록에서 고친 기록입니다(${same.from}~${same.to}). 고친 값을 수집값으로 덮지 않습니다. 늘어난 기간(~${w.to})의 광고비는 그 비용 기록에서 직접 고치세요.`);
 return {transferred:null,replaces:{id:same.id,from:same.from,to:same.to,adSpend:same.adSpend,experimentId:same.experimentId,version:same.version}};
}

// 이 지점에서 옮길 수 있는 후보. 지점 전용 캠페인과 같은 브랜드의 공통 캠페인 실험만 본다. 쓰지 않는다.
export async function transferCandidates(owner:string,store:Pick<Store,'id'|'brandId'>,experimentId?:string):Promise<SpendCandidate[]>{
 const rows=await database().prepare(`SELECT d.data AS draft, e.data AS experiment, json_extract(c.data,'$.storeId') AS campaignStore FROM records d JOIN records e ON e.id=d.owner||':viral_experiment:'||json_extract(d.data,'$.experimentId') AND e.owner=d.owner AND e.kind='viral_experiment' JOIN records c ON c.id=d.owner||':campaign:'||json_extract(e.data,'$.campaignId') AND c.owner=d.owner AND c.kind='campaign' WHERE d.owner=? AND d.kind='measurement_draft' AND json_extract(d.data,'$.channel')='naver_ads' AND json_extract(c.data,'$.brandId')=? AND COALESCE(json_extract(c.data,'$.storeId'),'') IN ('',?)${experimentId?" AND json_extract(d.data,'$.experimentId')=?":''} ORDER BY d.updated_at DESC`).bind(owner,store.brandId,store.id,...(experimentId?[experimentId]:[])).all<{draft:string;experiment:string;campaignStore:string|null}>();
 const found=(await Promise.all(rows.results.map(async r=>{const x=JSON.parse(r.experiment) as ViralExperiment,scope:SpendCandidate['scope']=r.campaignStore?'store':'brand';return (await entriesOf(owner,JSON.parse(r.draft) as MeasurementDraft)).map(e=>({x,e,scope}))}))).flat();
 const [keys,done]=await Promise.all([Promise.all(found.map(({e})=>e.target?targetKey(e.target):null)),transfers(owner)]);
 return found.map(({x,e,scope},i)=>({experimentId:x.id,experimentTitle:x.title,campaignId:x.campaignId,scope,arm:e.arm,armLabel:e.arm?armLabels[e.arm]:'arm 미확인',target:e.target,adSpend:typeof e.value==='number'?e.value:null,window:e.window,fetchedAt:e.fetchedAt,date:e.window.to,source:sourceText(x,e),limitations:e.limitations,blocked:refusal(e),...priorOf(done,keys[i],e.window,store.id)}));
}
export async function transferPreview(owner:string,store:Pick<Store,'id'|'brandId'>,b:Record<string,unknown>){
 const experimentId=b.experimentId===undefined||b.experimentId===''?undefined:str(b.experimentId,'실험',200,true),candidates=await transferCandidates(owner,store,experimentId);
 if(experimentId&&!candidates.length)throw new ApiError(404,'이 실험에는 이 지점으로 옮길 네이버 검색광고 수집 광고비가 없습니다.');
 return {candidates};
}
// checkLink: 고른 점포 실험 연결 검사(기존 비용 입력과 같은 validateOrderExperiment). 부르는 쪽이 관리자 확인과 쓰기 잠금을 먼저 하고 그 관리자(by)를 넘긴다.
// 바꾸기(replaces)는 화면이 확인한 기존 기록 버전(replacesVersion)이 지금과 같아야 한다. 새로 옮기는 후보에 버전을 보내도 409다(확인한 뒤 상태가 바뀜).
export async function transferSpend(owner:string,store:Pick<Store,'id'|'brandId'|'name'>,b:Record<string,unknown>,checkLink:(storeExperimentId:string,date:string)=>Promise<void>,by:EventActor){
 const c=(await transferCandidates(owner,store,str(b.experimentId,'실험',200,true))).find(x=>x.arm!==null&&x.arm===b.arm);
 if(!c)throw new ApiError(404,'이 실험·arm에는 이 지점으로 옮길 네이버 검색광고 수집 광고비가 없습니다.');
 if(c.blocked)throw new ApiError(400,c.blocked);
 if(b.adSpend!==c.adSpend||b.from!==c.window.from||b.to!==c.window.to||b.fetchedAt!==c.fetchedAt)throw new ApiError(409,'확인한 뒤 수집값이 바뀌었습니다(다시 수집됨). 금액·기간을 다시 확인하세요.');
 if(c.transferred)throw new ApiError(409,c.transferred.message);
 if((b.replacesVersion??null)!==(c.replaces?.version??null))throw new ApiError(409,c.replaces?`이미 옮긴 기록(${c.replaces.from}~${c.replaces.to})을 새 누적값으로 바꾸는지 확인한 뒤 저장하세요. 확인한 뒤 그 기록이 바뀌었으면 다시 불러오세요.`:'확인한 뒤 옮긴 기록 상태가 바뀌었습니다. 다시 불러와 확인하세요.');
 const storeExperimentId=str(b.storeExperimentId??'','연결할 점포 실험',100);await checkLink(storeExperimentId,c.date);
 const id=c.replaces?.id??spendId(await targetKey(c.target!),c.window),old=c.replaces?await readRecord<StoreSpend>(owner,'store_spend',id):null,now=stamp();
 const spend:StoreSpend={id,storeId:store.id,date:c.date,channel:'naver_ads',experimentId:storeExperimentId,adSpend:c.adSpend!,productionCost:0,source:c.source,version:(old?.version||0)+1,createdAt:old?.createdAt||now,updatedAt:now};
 const message=old?`${store.name} 비용 장부의 네이버 수집 광고비(${c.replaces!.from}~${c.replaces!.to}, ${won(old.adSpend)})를 늘어난 기간 ${c.window.from}~${c.window.to}의 누적 ${won(c.adSpend!)}으로 바꿨습니다`:`네이버 수집 광고비 ${won(c.adSpend!)}(${c.window.from}~${c.window.to})을 ${store.name} 비용 장부로 옮겼습니다`;
 await database().batch([recordStatement(owner,'store_spend',id,spend,store.id),eventStatement(owner,c.campaignId,`${message}(${c.experimentTitle.slice(0,100)} · ${c.armLabel}).`,by)]);
 return {id,spend};
}
