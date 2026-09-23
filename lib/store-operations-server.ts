import type {Campaign} from './agency';
import {ApiError,database,listRecords,readRecord,recordStatement,requireAdminActor,str,num,stamp,uid} from './server';
import {checkedVersion,localDate,option} from './store-server';
import {publicationLabels,type Publication} from './execution';
import {channelCatalog,type Store,type StoreExperiment} from './store-marketing';
import {diagnosisCatalog,orderCostFields,orderModes,orderSources,orderStates,koreaToday,recentPeriod,type StoreDiagnostic,type StoreOrder,type StoreSpend,type StoreOperations} from './store-operations';
import {isEnabled} from './feature-flags';
import {generateCode,isTrackingCodeType,isValidCode,normalizeCode,normalizeUtmCampaign,codeTokens,type TrackingCode,type TrackingCodeType} from './tracking-codes';
import {ImportError,personalDataKind,prepareImport,suggestMapping,type ColumnMapping,type ImportRow} from './order-import';
import {ATTRIBUTION_NOT_INCREMENTAL,addDays,attributeByCodes,attributionBreakdown,autoEvidence,creativeLabel,incrementalityLite,northStar,orderMetrics,publicationGate,publicationGateView,publicationRefusal,publicationRowLabel,regateDays,unitEconomics,weekStart,weeklyCompletenessFromDays,weeksBetween,type DayTotal,type Economics,type PosWeeklyTotal} from './store-attribution';

export function operationDate(v:unknown,label:string){const date=localDate(v,label,true);if(date>koreaToday())throw new ApiError(400,label+'은 오늘까지 입력하세요.');return date}
export function diagnosisInput(raw:any,store:Store,old?:StoreDiagnostic):StoreDiagnostic{
 const key=option(raw.key,diagnosisCatalog.map(x=>x.key),'진단 항목'),status=option(raw.status,['unknown','todo','done'] as const,'확인 상태');
 const checkedAt=raw.checkedAt?operationDate(raw.checkedAt,'확인일'):'',evidence=str(raw.evidence??'','확인 근거',3000,status==='done'),observation=str(raw.observation??'','확인한 내용',4000,status==='done');
 if(status==='done'&&!checkedAt)throw new ApiError(400,'확인 완료에는 실제 확인일이 필요합니다.');
 return {id:store.id+'-'+key,storeId:store.id,key,status,evidence,checkedAt,observation,nextAction:str(raw.nextAction??'','다음 행동',2000),assignee:str(raw.assignee??'','담당자',100),storeVersion:store.version,version:(old?.version||0)+1,updatedAt:stamp()};
}
const amount=(value:unknown,label:string,nullable=false)=>{if(nullable&&(value===null||value===undefined||value===''))return null;const v=typeof value==='string'&&/^\d+(\.\d+)?$/.test(value)?Number(value):value;return num(v,label)};
export async function orderInput(raw:any,storeId:string):Promise<Omit<StoreOrder,'version'|'createdAt'|'updatedAt'>>{
 const source=option(raw.source,Object.keys(orderSources) as StoreOrder['source'][],'주문 출처'),orderNumber=str(raw.orderNumber,'주문번호',100,true),orderDate=operationDate(raw.orderDate,'주문일');
 const key=JSON.stringify([storeId,source,orderDate,orderNumber]);const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));const id=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
 const paidAmount=amount(raw.paidAmount,'할인 후 결제액')!,refundAmount=amount(raw.refundAmount,'환불액')!;
 if(refundAmount>paidAmount)throw new ApiError(400,'환불액은 결제액을 초과할 수 없습니다.');
 const status=option(raw.status,Object.keys(orderStates) as StoreOrder['status'][],'주문 상태');
 if(status==='paid'&&paidAmount>0&&refundAmount===paidAmount)throw new ApiError(400,'결제액을 모두 환불했다면 상태를 전액 환불 또는 취소로 변경하세요.');
 if(status!=='paid'&&paidAmount!==refundAmount)throw new ApiError(400,'취소·전액 환불 주문은 결제액 전체의 환불을 반영하세요. 결제 전 취소는 두 금액을 0으로 입력하세요.');
 const campaignId=str(raw.campaignId??'','캠페인',100)||undefined,creativeId=str(raw.creativeId??'','소재',100)||undefined;
 if(creativeId&&!campaignId)throw new ApiError(400,'소재 귀속에는 캠페인이 필요합니다.');
 const channel=option(raw.channel||'unknown',['unknown',...channelCatalog.map(c=>c.key)] as const,'유입 채널');
 return {campaignId,creativeId,id,storeId,source,orderNumber,orderDate,mode:option(raw.mode,Object.keys(orderModes) as StoreOrder['mode'][],'주문 방식'),status,paidAmount,refundAmount,costs:Object.fromEntries(Object.entries(orderCostFields).map(([k,label])=>[k,amount(raw.costs?.[k]??raw[k],label,true)])) as StoreOrder['costs'],channel,experimentId:str(raw.experimentId??'','실험',100),attributionEvidence:str(raw.attributionEvidence??'','유입 확인 근거',2000,channel!=='unknown'||!!campaignId||!!creativeId),note:str(raw.note??'','출처 메모',2000)};
}
export async function validateOrderExperiment(owner:string,storeId:string,experimentId:string,date:string,channel:string){if(!experimentId)return;const e=await readRecord<StoreExperiment>(owner,'store_experiment',experimentId);if(e.storeId!==storeId)throw new ApiError(400,'다른 지점의 실험에는 연결할 수 없습니다.');if(e.status==='draft'||!e.startDate||!e.endDate||date<e.startDate||date>e.endDate)throw new ApiError(400,'시작한 실험의 기간 안에서 연결하세요.');if(e.channel!==channel)throw new ApiError(400,'유입 채널과 실험 채널이 일치해야 합니다.');}
export function spendInput(raw:any,storeId:string,old?:StoreSpend):StoreSpend{return {id:str(raw.id,'비용 기록',100,true),storeId,date:operationDate(raw.date,'비용일'),channel:option(raw.channel,channelCatalog.map(c=>c.key),'채널'),experimentId:str(raw.experimentId??'','실험',100),adSpend:amount(raw.adSpend,'광고비')!,productionCost:amount(raw.productionCost,'제작·협찬비')!,source:str(raw.source,'비용 출처',2000,true),version:(old?.version||0)+1,createdAt:old?.createdAt||stamp(),updatedAt:stamp()}}
export async function getStoreOperations(owner:string,storeId:string,from?:string,to?:string):Promise<StoreOperations>{
 const period=recentPeriod(),start=operationDate(from||period.from,'조회 시작일'),end=operationDate(to||period.to,'조회 종료일');if(start>end)throw new ApiError(400,'조회 기간을 확인하세요.');
 const query=async<T>(kind:string,dateKey:string)=>{const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? AND json_extract(data, '$.${dateKey}') >= ? AND json_extract(data, '$.${dateKey}') <= ? ORDER BY json_extract(data, '$.${dateKey}') DESC, updated_at DESC LIMIT 5001`).bind(owner,kind,storeId,start,end).all<{data:string}>();if(rows.results.length>5000)throw new ApiError(400,'조회 결과가 5,000건을 초과합니다. 기간을 좁혀 주세요.');return rows.results.map(r=>JSON.parse(r.data) as T)};
 const [diagnostics,orders,spend]=await Promise.all([listRecords<StoreDiagnostic>(owner,'store_diagnostic',storeId),query<StoreOrder>('store_order','orderDate'),query<StoreSpend>('store_spend','date')]);return {diagnostics,orders,spend,from:start,to:end};
}
// 주문 기록 창(save_order)은 기존 입력 항목만 보낸다. 가져오기가 남긴 필드(가져오기 기록·할인액·읽은 코드·신규 여부)는 이어받는다.
// 코드 자동 귀속 사본은 캠페인·소재가 그대로일 때만 둔다. 사람이 캠페인·소재를 바꾸면 수동 귀속이 우선이다.
export function carryImportFields<T extends Pick<StoreOrder,'campaignId'|'creativeId'>>(old:StoreOrder|undefined,input:T):T&Pick<StoreOrder,'importId'|'discountAmount'|'trackingCodes'|'newCustomer'|'codeAttribution'>{
 if(!old)return input;
 const sameTarget=(old.campaignId||'')===(input.campaignId||'')&&(old.creativeId||'')===(input.creativeId||'');
 return {...input,...(old.importId?{importId:old.importId}:{}),...(old.discountAmount!==undefined?{discountAmount:old.discountAmount}:{}),...(old.trackingCodes?{trackingCodes:old.trackingCodes}:{}),...(old.newCustomer!==undefined?{newCustomer:old.newCustomer}:{}),...(old.codeAttribution&&sameTarget?{codeAttribution:old.codeAttribution}:{})};
}
// 기존 장부 양식 가져오기(rows)도 POS CSV 가져오기와 같은 개인정보 패턴을 거부한다. 주문번호는 긴 POS 번호가 흔해 휴대폰 번호만 본다. 값은 문구에 싣지 않는다.
export function rejectPersonalData(order:Pick<StoreOrder,'orderNumber'|'note'|'attributionEvidence'>){
 for(const [label,value,card] of [['주문번호',order.orderNumber,false],['출처 메모',order.note,true],['유입 확인 근거',order.attributionEvidence,true]] as const){const kind=personalDataKind(value,card);if(kind)throw new ApiError(400,`${label}에 ${kind==='phone'?'휴대폰 번호':'카드번호로 보이는 숫자열'}가 있어 가져오지 않았습니다. 개인정보는 저장하지 않습니다.`)}
}
// 주문 기록 창에서 고칠 때 이어받는 코드 귀속 사본(carryImportFields)도 게시 관문을 지금 게시 상태로 다시 본다(A4-2). 규칙은 귀속 보고와 같다(publicationGateView):
// 게시가 지워졌거나 취소·발행 실패거나 주문일이 예약일 전이면 사본을 지우고, 근거가 가져오기 자동 문구 그대로면 가져올 때 거절한 주문처럼 미귀속으로 저장한다.
// 사람이 근거를 새로 적었으면 그 캠페인·소재는 수동 귀속으로 남는다. 게시 상태 확인 전(pending)이면 되돌릴 수 있는 상태라 사본을 그대로 둔다(보고서는 그동안 귀속에서 뺀다).
// 실험에 연결한 주문을 미귀속(유입 미확인)으로 바꾸면 실험 채널과 어긋나므로 409로 사람이 고르게 한다. 게시에 묶이지 않은 코드 귀속은 그대로 둔다.
export async function keepPublicationAttribution<T extends Pick<StoreOrder,'orderDate'|'codeAttribution'|'campaignId'|'creativeId'|'channel'|'attributionEvidence'|'experimentId'>>(owner:string,order:T):Promise<T>{
 const id=order.codeAttribution?.publicationId;if(!id)return order;
 const gates=gatesOf(await recordsByIds<Publication>(owner,'execution_publication',[id]));
 if(publicationRefusal({publicationId:id},order.orderDate,gates)==='pending')return order;
 const next=publicationGateView(order,gates);
 if(order.experimentId&&next.channel!==order.channel)throw new ApiError(409,'게시가 취소·발행 실패 등으로 바뀌어 이 주문의 추적 코드 귀속을 유지할 수 없습니다. 실험 연결을 풀어 미귀속으로 저장하거나, 유입 확인 근거를 직접 적어 저장하세요.');
 return next;
}
export function requireVersion(old:{version:number}|undefined,version:unknown){if(old)checkedVersion(old,version);else if(version!==undefined&&version!==null)throw new ApiError(409,'기록이 변경되었습니다. 다시 불러오세요.')}

export async function validateOrderAttribution(owner:string,store:Pick<Store,'id'|'brandId'>,order:Pick<StoreOrder,'campaignId'|'creativeId'|'experimentId'>){
 if(!order.campaignId)return;
 const campaign=await readRecord<Campaign>(owner,'campaign',order.campaignId);
 if(campaign.brandId!==store.brandId||(campaign.storeId&&campaign.storeId!==store.id))throw new ApiError(400,'이 지점 또는 같은 브랜드의 캠페인에만 연결하세요.');
 if(order.creativeId){
  const creative=await readRecord<{id:string;campaignId:string;brandId:string;storeId?:string;version:number}>(owner,'execution_creative',order.creativeId);
  if(creative.campaignId!==campaign.id||creative.brandId!==store.brandId||(creative.storeId&&creative.storeId!==store.id))throw new ApiError(400,'소재의 캠페인·브랜드·지점이 주문과 일치하지 않습니다.');
 }
 if(order.experimentId){
  const experiment=await readRecord<StoreExperiment>(owner,'store_experiment',order.experimentId);
  if(experiment.campaignId&&experiment.campaignId!==campaign.id)throw new ApiError(400,'실험에 연결된 캠페인과 주문의 캠페인이 다릅니다.');
 }
}

// ---- A4 점포 실측: 추적 코드·주문 CSV 가져오기·POS 주간 합계·귀속 보고서 ----
// 권한: 코드 생성·가져오기 확정·POS 합계 입력은 관리자(requireAdminActor). 목록·가져오기 미리보기·보고서는 로그인 사용자(호출하는 라우트가 identity로 확인한다).
// 자동 귀속은 기능 스위치 a4_auto_attribution이 켜졌을 때만 한다. 꺼져 있으면 가져온 주문은 미귀속으로 두고(코드 문자열만 보존) 수동 귀속만 쓴다.
export const measurementActions=['create_tracking_code','list','import_orders','set_pos_total','attribution_report'] as const;
// 행 배열을 보내는 기존 import_orders(주문 장부 양식)는 라우트가 그대로 처리한다. csv 문자열이 있을 때만 이 가져오기다.
export function isMeasurementAction(b:Record<string,unknown>){return b.action==='import_orders'?typeof b.csv==='string':(measurementActions as readonly unknown[]).includes(b.action)}
// 저장하지 않는 작업(목록·귀속 보고·가져오기 미리보기). 라우트는 이 작업에 워크스페이스 쓰기 잠금을 잡지 않는다.
export function isMeasurementRead(b:Record<string,unknown>){return b.action==='list'||b.action==='attribution_report'||(b.action==='import_orders'&&typeof b.csv==='string'&&b.dryRun!==false)}
export type OrderImport={id:string;storeId:string;fileName:string;rows:number;created:number;duplicates:number;sourceConflicts:number;attributed:number;conflicts:number;identifiableOrders:number;autoAttribution:boolean;mapping:ColumnMapping;weeks:string[];importedAt:string;importedBy:{id:string;email:string|null}};
const autoLabel=(on:boolean)=>on?'자동 귀속 켜짐':'자동 귀속 꺼짐';
async function adminOf(req:Request,owner:string){const who=await requireAdminActor(req);if(who.owner!==owner)throw new ApiError(403,'이 워크스페이스의 관리자만 변경할 수 있습니다.');return who}
const blank=(v:unknown)=>v===undefined||v===null||v==='';

async function codeTaken(owner:string,code:string){return !!await database().prepare('SELECT 1 AS found FROM records WHERE id=? AND owner=?').bind(`${owner}:tracking_code:${code}`,owner).first()}
// 코드는 워크스페이스 안에서 유일하다(레코드 id=코드). 직접 정한 코드는 정규화해 검사하고, 비우면 유형 접두어+난수로 만든다. 게시별 코드 발급(lib/publication-codes.ts)도 쓴다.
export async function freeCode(owner:string,type:TrackingCodeType,custom:unknown){
 if(!blank(custom)){const code=normalizeCode(custom);if(!isValidCode(code))throw new ApiError(400,'코드는 혼동 문자(0·O·1·I·L)를 뺀 대문자 영숫자 4~12자로 입력하세요.');if(await codeTaken(owner,code))throw new ApiError(409,'이미 쓰는 코드입니다. 다른 코드를 정하세요.');return code}
 for(let i=0;i<5;i++){const code=generateCode(type,crypto.getRandomValues(new Uint8Array(32)));if(!await codeTaken(owner,code))return code}
 throw new ApiError(409,'코드를 만들지 못했습니다. 다시 시도하세요.');
}
// 읽은 게시의 게시 관문(상태·한국 예약일). 없는 게시는 들어가지 않아 관문에서 거절된다.
const gatesOf=(found:ReadonlyMap<string,Publication>)=>new Map([...found].map(([id,p])=>[id,publicationGate(p)]));
// D1 바인드 한도(100) 안에서 나누어 id로 레코드를 읽는다. 없는 id는 결과에 없다.
async function recordsByIds<T>(owner:string,kind:string,ids:readonly string[]){
 const prefix=`${owner}:${kind}:`,keys=[...new Set(ids)].map(id=>prefix+id),chunks=Array.from({length:Math.ceil(keys.length/90)},(_,i)=>keys.slice(i*90,i*90+90));
 const found=await Promise.all(chunks.map(c=>database().prepare(`SELECT id,data FROM records WHERE owner=? AND kind=? AND id IN (${c.map(()=>'?').join(',')})`).bind(owner,kind,...c).all<{id:string;data:string}>()));
 return new Map(found.flatMap(r=>r.results.map(x=>[x.id.slice(prefix.length),JSON.parse(x.data) as T] as const)));
}
// 코드의 게시(publication) 연결(A4-2, exec-loop-4 권고 (1)): 게시는 코드와 같은 캠페인·같은 소재여야 한다. 게시 상태·예약일은 코드를 만들 때가 아니라 귀속할 때 본다(게시 전에 만든 코드를 캡션에 넣으므로).
// saved=false(발행 캡션 코드)면 아직 저장하지 않은 게시를 허용한다. 끝내 저장되지 않은 게시의 코드는 귀속하지 않는다(codeBook).
export async function linkedPublication(owner:string,publicationId:string,campaignId:string,creativeId?:string,saved=true){
 const p=saved?await readRecord<Publication>(owner,'execution_publication',publicationId):(await recordsByIds<Publication>(owner,'execution_publication',[publicationId])).get(publicationId)||null;
 if(p&&(p.campaignId!==campaignId||(!!creativeId&&p.creativeId!==creativeId)))throw new ApiError(400,'게시의 캠페인·소재가 코드와 일치하지 않습니다.');
 return p;
}
async function createTrackingCode(req:Request,owner:string,store:Store,b:Record<string,unknown>){
 const who=await adminOf(req,owner);
 if(!isTrackingCodeType(b.type))throw new ApiError(400,'코드 유형(쿠폰·QR·POS 태그·UTM)을 선택하세요.');
 // 게시를 고르면 그 게시의 소재로 묶는다. 게시 전·취소된 게시의 주문은 귀속할 때 걸러진다(attributeByCodes 게시 관문).
 const type=b.type,campaignId=str(b.campaignId,'캠페인',100,true),chosen=str(b.creativeId??'','소재',100)||undefined,publicationId=str(b.publicationId??'','게시',100)||undefined;
 const creativeId=publicationId?(await linkedPublication(owner,publicationId,campaignId,chosen))!.creativeId:chosen;
 await validateOrderAttribution(owner,store,{campaignId,creativeId,experimentId:''});
 const channel=blank(b.channel)?undefined:option(b.channel,channelCatalog.map(c=>c.key),'유입 채널'),arm=str(b.arm??'','팔(arm)',40)||undefined,utmCampaign=type==='utm'?normalizeUtmCampaign(b.utmCampaign):'';
 if(type==='utm'&&!utmCampaign)throw new ApiError(400,'UTM 코드에는 utm_campaign 값(영문 소문자·숫자·_ . -, 60자 이하)이 필요합니다.');
 const validFrom=blank(b.validFrom)?koreaToday():operationDate(b.validFrom,'적용 시작일'),label=str(b.label??'','코드 설명',100),code=await freeCode(owner,type,b.code);
 const record:TrackingCode={id:code,code,type,storeId:store.id,campaignId,...(creativeId?{creativeId}:{}),...(publicationId?{publicationId}:{}),...(arm?{arm}:{}),...(channel?{channel}:{}),...(utmCampaign?{utmCampaign}:{}),label,validFrom,createdAt:stamp(),createdBy:{id:who.id,email:who.email},version:1};
 await recordStatement(owner,'tracking_code',code,record,store.id).run();
 return {code:record};
}
async function measurementList(owner:string,store:Store){
 const [codes,imports,posTotals,auto]=await Promise.all([listRecords<TrackingCode>(owner,'tracking_code',store.id),listRecords<OrderImport>(owner,'order_import',store.id),listRecords<PosWeeklyTotal>(owner,'pos_weekly_total',store.id),isEnabled(owner,'a4_auto_attribution')]);
 return {codes,imports:imports.slice(0,20),posTotals:[...posTotals].sort((a,b)=>b.weekStart.localeCompare(a.weekStart)),autoAttribution:auto,autoAttributionLabel:autoLabel(auto)};
}

// 자동 귀속에 쓸 코드와 게시 관문. 캠페인이 삭제됐거나 지점·브랜드가 맞지 않게 된 코드, 게시가 삭제됐거나 게시의 캠페인·소재와 어긋난 코드(보존 정책으로 남은 코드)는 귀속하지 않는다.
async function codeBook(owner:string,store:Store){
 const all=await listRecords<TrackingCode>(owner,'tracking_code',store.id),found=await recordsByIds<Publication>(owner,'execution_publication',all.flatMap(c=>c.publicationId?[c.publicationId]:[]));
 const linked=(c:TrackingCode)=>{if(!c.publicationId)return true;const p=found.get(c.publicationId);return !!p&&p.campaignId===c.campaignId&&(!c.creativeId||p.creativeId===c.creativeId)};
 const ok=await Promise.all(all.map(c=>linked(c)&&validateOrderAttribution(owner,store,{campaignId:c.campaignId,creativeId:c.creativeId,experimentId:''}).then(()=>true,e=>{if(e instanceof ApiError)return false;throw e})));
 return {usable:all.filter((_,i)=>ok[i]),unavailable:new Set(all.filter((_,i)=>!ok[i]).map(c=>c.code)),publications:gatesOf(found)};
}
type Built={row:ImportRow;order:StoreOrder;attributed:boolean;conflict:boolean;unknown:boolean;unavailable:boolean;beforePublication:boolean;unpublished:boolean;pendingPublication:boolean};
async function orderFromRow(store:Store,row:ImportRow,book:Awaited<ReturnType<typeof codeBook>>|null,importId:string):Promise<Built>{
 const tokens=codeTokens(row.codeCell),match=book?attributeByCodes(tokens,book.usable,{storeId:store.id,orderDate:row.orderDate},book.publications):null,code=match?.code||null;
 const gone=match?match.unknown.filter(c=>book!.unavailable.has(c)):[];
 const input=await orderInput({source:row.source,orderNumber:row.orderNumber,orderDate:row.orderDate,mode:row.mode,status:'paid',paidAmount:row.amount,refundAmount:0,channel:code?.channel||'unknown',...(code?{campaignId:code.campaignId,creativeId:code.creativeId,attributionEvidence:autoEvidence(code)}:{})},store.id);
 const codeAttribution=code?{codeId:code.id,code:code.code,...(code.arm?{arm:code.arm}:{}),...(code.publicationId?{publicationId:code.publicationId}:{}),conflictCodeIds:match!.conflict?match!.matched.filter(id=>id!==code.id):[]}:undefined,now=stamp();
 const order:StoreOrder={...input,importId,...(row.discount?{discountAmount:row.discount}:{}),...(tokens.length?{trackingCodes:tokens.map(t=>t.code).slice(0,5)}:{}),...(row.newCustomer===undefined?{}:{newCustomer:row.newCustomer}),...(codeAttribution?{codeAttribution}:{}),version:1,createdAt:now,updatedAt:now};
 const refused=code?[]:match?.refused.map(r=>r.reason)||[];
 return {row,order,attributed:!!code,conflict:!!code&&match!.conflict,unknown:(match?.unknown.length||0)>gone.length,unavailable:!code&&gone.length>0,beforePublication:refused.includes('before_publication'),unpublished:refused.includes('not_live'),pendingPublication:refused.includes('pending')};
}
// D1 바인드 한도(100) 안에서 나누어 이미 있는 주문 id를 찾는다.
async function storedOrderIds(owner:string,ids:readonly string[]){
 const prefix=`${owner}:store_order:`,keys=ids.map(id=>prefix+id),chunks=Array.from({length:Math.ceil(keys.length/90)},(_,i)=>keys.slice(i*90,i*90+90));
 const found=await Promise.all(chunks.map(c=>database().prepare(`SELECT id FROM records WHERE owner=? AND kind='store_order' AND id IN (${c.map(()=>'?').join(',')})`).bind(owner,...c).all<{id:string}>()));
 return new Set(found.flatMap(r=>r.results.map(x=>x.id.slice(prefix.length))));
}
// 출처만 다른 같은 주문(같은 지점·주문일·주문번호)을 찾는다. 열 매핑(주문 채널)만 바꿔 같은 파일을 다시 올리면 출처가 달라져 장부 id 중복 검사를 지나가기 때문이다.
async function sourceTwins(owner:string,storeId:string,rows:readonly Built[]){
 if(!rows.length)return [];
 const dates=rows.map(x=>x.order.orderDate).sort(),numbers=[...new Set(rows.map(x=>x.order.orderNumber))],chunks=Array.from({length:Math.ceil(numbers.length/90)},(_,i)=>numbers.slice(i*90,i*90+90));
 const found=await Promise.all(chunks.map(c=>database().prepare(`SELECT DISTINCT json_extract(data,'$.orderDate') AS d, json_extract(data,'$.orderNumber') AS n FROM records WHERE owner=? AND kind='store_order' AND parent_id=? AND json_extract(data,'$.orderDate') >= ? AND json_extract(data,'$.orderDate') <= ? AND json_extract(data,'$.orderNumber') IN (${c.map(()=>'?').join(',')})`).bind(owner,storeId,dates[0],dates[dates.length-1],...c).all<{d:string;n:string}>()));
 const keys=new Set(found.flatMap(r=>r.results.map(x=>x.d+'\u0000'+x.n)));
 return rows.filter(x=>keys.has(x.order.orderDate+'\u0000'+x.order.orderNumber));
}
// dryRun(기본값)은 저장 없이 미리보기, dryRun:false는 관리자 확정. 같은 주문(출처·주문일·주문번호)이 이미 있으면 건너뛰어 같은 파일을 다시 올려도 장부가 늘지 않는다.
// 확정은 원자적이다: 오류 행이 하나라도 있으면 아무것도 저장하지 않는다. 고객 ID 값과 CSV 원문은 저장하지 않는다.
// 출처만 다른 같은 주문이 장부에 있으면 미리보기에 세고, 확정은 allowSourceConflicts:true(화면의 확인)일 때만 한다.
// 게시 상태 확인 전 게시의 코드가 있는 주문도 미리보기에 세고, 확정은 allowPendingPublications:true일 때만 한다(저장하면 다시 가져와도 건너뛰어 게시별로 귀속되지 않는다).
async function importOrders(req:Request,owner:string,store:Store,b:Record<string,unknown>){
 const dryRun=b.dryRun!==false,who=dryRun?null:await adminOf(req,owner);
 const plan=(()=>{try{return prepareImport(String(b.csv??''),b.mapping,koreaToday())}catch(e){if(e instanceof ImportError)throw new ApiError(400,e.message);throw e}})();
 const auto=await isEnabled(owner,'a4_auto_attribution'),book=auto?await codeBook(owner,store):null,importId=uid(),built:Built[]=[],errors=[...plan.errors];
 for(const row of plan.rows){try{built.push(await orderFromRow(store,row,book,importId))}catch(e){if(e instanceof ApiError&&e.status===400)errors.push({line:row.line,message:e.message});else throw e}}
 const stored=await storedOrderIds(owner,built.map(x=>x.order.id)),fresh=built.filter(x=>!stored.has(x.order.id)),count=(k:'attributed'|'conflict'|'unknown'|'unavailable'|'beforePublication'|'unpublished'|'pendingPublication')=>fresh.filter(x=>x[k]).length;
 const twins=await sourceTwins(owner,store.id,fresh),sourceConflicts=twins.length,sourceConflictLines=twins.slice(0,20).map(x=>x.row.line);
 const duplicates=built.length-fresh.length,weeks=[...new Set(fresh.map(x=>weekStart(x.order.orderDate)))].sort(),attribution={enabled:auto,label:autoLabel(auto),attributed:count('attributed'),conflicts:count('conflict'),unknownCodes:count('unknown'),unavailable:count('unavailable'),beforePublication:count('beforePublication'),unpublished:count('unpublished'),pendingPublication:count('pendingPublication')};
 if(dryRun)return {dryRun:true,headers:plan.headers,mapping:plan.mapping,suggested:suggestMapping(plan.headers),ready:fresh.length,duplicates,sourceConflicts,sourceConflictLines,errorCount:errors.length,errors:errors.slice(0,50),identifiableOrders:plan.identifiableOrders,autoAttribution:attribution,weeks,sample:fresh.slice(0,20).map(({row,order})=>({line:row.line,orderNumber:order.orderNumber,orderDate:order.orderDate,source:order.source,mode:order.mode,paidAmount:order.paidAmount,discountAmount:order.discountAmount??0,trackingCodes:order.trackingCodes??[],campaignId:order.campaignId??null,arm:order.codeAttribution?.arm??null,conflict:!!order.codeAttribution?.conflictCodeIds.length}))};
 if(errors.length)throw new ApiError(400,`오류가 있는 행이 ${errors.length}개 있어 가져오지 않았습니다. 첫 오류: ${errors[0].line}행 ${errors[0].message}`);
 if(sourceConflicts&&b.allowSourceConflicts!==true)throw new ApiError(409,`출처(주문 채널)만 다른 같은 주문일·주문번호의 주문이 장부에 ${sourceConflicts}건 있습니다(첫 행 ${sourceConflictLines[0]}행). 열 매핑만 바꿔 같은 파일을 다시 올린 것이면 확정하지 마세요. 서로 다른 주문이 맞으면 미리보기에서 확인한 뒤 확정하세요.`);
 if(attribution.pendingPublication&&b.allowPendingPublications!==true)throw new ApiError(409,`게시 상태 확인 전(승인 전·실행 승인·접수 확인 중·접수 여부 미확인·공급자 확인 필요) 게시의 코드가 있는 주문이 ${attribution.pendingPublication}건 있습니다. 지금 확정하면 이 주문은 게시가 나중에 확인돼도 게시별로 귀속되지 않습니다. 실행 화면에서 게시 상태를 확인한 뒤 가져오거나, 미리보기에서 확인한 뒤 확정하세요.`);
 const record:OrderImport={id:importId,storeId:store.id,fileName:str(b.fileName??'','파일 이름',200),rows:built.length,created:fresh.length,duplicates,sourceConflicts,attributed:attribution.attributed,conflicts:attribution.conflicts,identifiableOrders:plan.identifiableOrders,autoAttribution:auto,mapping:plan.mapping,weeks,importedAt:stamp(),importedBy:{id:who!.id,email:who!.email}};
 await database().batch([...fresh.map(x=>recordStatement(owner,'store_order',x.order.id,x.order,store.id)),recordStatement(owner,'order_import',importId,record,store.id)]);
 return {dryRun:false,importId,created:fresh.length,duplicates,sourceConflicts,attributed:attribution.attributed,conflicts:attribution.conflicts,beforePublication:attribution.beforePublication,unpublished:attribution.unpublished,pendingPublication:attribution.pendingPublication,identifiableOrders:plan.identifiableOrders,autoAttribution:{enabled:auto,label:autoLabel(auto)}};
}
// 끝난 주(월~일)의 POS 합계만 받는다. 주마다 1행이고 버전으로 겹쳐 쓰기를 막는다.
async function setPosTotal(req:Request,owner:string,store:Store,b:Record<string,unknown>){
 const who=await adminOf(req,owner),start=operationDate(b.weekStart,'주 시작일');
 if(weekStart(start)!==start)throw new ApiError(400,'주 시작일은 월요일로 입력하세요.');
 if(addDays(start,6)>koreaToday())throw new ApiError(400,'끝난 주(일요일까지)의 POS 합계만 입력하세요.');
 const id=`${store.id}-${start}`,row=await database().prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:pos_weekly_total:${id}`,owner,'pos_weekly_total').first<{data:string}>(),old=row?JSON.parse(row.data) as PosWeeklyTotal:undefined;
 requireVersion(old,b.version);
 const netSales=amount(b.netSales,'POS 순매출 합계')!,orderCount=blank(b.orderCount)?null:amount(b.orderCount,'POS 주문 수')!;
 if(orderCount!==null&&!Number.isInteger(orderCount))throw new ApiError(400,'POS 주문 수는 정수로 입력하세요.');
 const now=stamp(),total:PosWeeklyTotal={id,storeId:store.id,weekStart:start,netSales,orderCount,source:str(b.source,'합계 출처',200,true),note:str(b.note??'','메모',1000),version:(old?.version||0)+1,createdAt:old?.createdAt||now,updatedAt:now,updatedBy:{id:who.id,email:who.email}};
 await recordStatement(owner,'pos_weekly_total',id,total,store.id).run();
 return {total};
}
// 주문 행을 읽지 않고 하루 단위 장부 합계를 낸다. lib/store-attribution.ts dayTotals와 같은 정의다(countedOrder·isAttributed·orderContribution).
export async function ledgerDays(owner:string,storeId:string,from:string,to:string):Promise<DayTotal[]>{
 const f=(path:string)=>`json_extract(data,'$.${path}')`,net=`(${f('paidAmount')}-${f('refundAmount')})`,counted=`(${f('status')}='paid' AND (${f('paidAmount')}=0 OR ${f('refundAmount')}<${f('paidAmount')}))`;
 const attributed=`(${counted} AND (${f('channel')}<>'unknown' OR COALESCE(${f('campaignId')},'')<>'' OR COALESCE(${f('creativeId')},'')<>''))`,costs=Object.keys(orderCostFields).map(k=>f('costs.'+k)),known=`(${costs.map(c=>c+' IS NOT NULL').join(' AND ')})`;
 const rows=await database().prepare(`SELECT ${f('orderDate')} AS day, SUM(${net}) AS net, SUM(CASE WHEN ${counted} THEN 1 ELSE 0 END) AS orders, SUM(CASE WHEN ${attributed} THEN 1 ELSE 0 END) AS attributedOrders, SUM(CASE WHEN ${attributed} AND ${known} THEN ${net}-(${costs.join('+')}) ELSE 0 END) AS attributedKnown, SUM(CASE WHEN ${attributed} AND NOT ${known} THEN 1 ELSE 0 END) AS attributedUnknown, SUM(CASE WHEN ${attributed} AND NOT ${known} THEN ${net} ELSE 0 END) AS attributedUnknownNet FROM records WHERE owner=? AND kind='store_order' AND parent_id=? AND ${f('orderDate')} >= ? AND ${f('orderDate')} <= ? GROUP BY day`).bind(owner,storeId,from,to).all<DayTotal>();
 return rows.results;
}
// 조회 기간의 코드·팔·소재·캠페인·출처별 집계, 주간 완전성, north-star(통과 주만), 기준 기간(기본: 조회 시작 주 앞 4주) 대비 incrementality-lite.
// 조회 기간은 182일(26주), 기준 기간은 84일(12주)까지다. 주간 완전성은 일별 합계(ledgerDays)로 판정하므로 주문 행 조회 상한(5,000건)은 조회 기간의 행에만 걸린다.
export const REPORT_LIMITS={periodDays:182,baselineDays:84} as const;
// 귀속 보고의 소재·게시 표시 이름. 소재는 제목(없으면 만든 한국 시각·첫 사실 줄의 대체 라벨), 게시는 소재 이름·예약 시각(한국)·상태다. 지워진 게시는 id로 보인다.
type CreativeName={id:string;title?:string;caption?:string;createdAt?:string};
async function reportLabels(owner:string,orders:readonly StoreOrder[],found:ReadonlyMap<string,Publication>){
 const used=new Set(orders.flatMap(o=>o.codeAttribution?.publicationId?[o.codeAttribution.publicationId]:[])),publications=new Map([...found].filter(([id])=>used.has(id)));
 const creatives=await recordsByIds<CreativeName>(owner,'execution_creative',[...orders.flatMap(o=>o.creativeId?[o.creativeId]:[]),...[...publications.values()].map(p=>p.creativeId)]);
 const creativeLabels=Object.fromEntries([...creatives].map(([id,c])=>[id,creativeLabel(c)]));
 const publicationNames=Object.fromEntries([...publications].map(([id,p])=>[id,publicationRowLabel(p,creativeLabels[p.creativeId]||'소재 '+p.creativeId,publicationLabels[p.status]||p.status)]));
 return {creativeLabels,publicationNames};
}
// 게시 코드로 귀속된 주문(기준 기간 시작부터 조회 기간 끝까지). 보고서는 이 주문들의 게시 관문을 지금 게시 상태로 다시 본다(A4-2, publicationGateView).
async function publicationOrders(owner:string,storeId:string,from:string,to:string){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='store_order' AND parent_id=? AND json_extract(data,'$.orderDate') >= ? AND json_extract(data,'$.orderDate') <= ? AND json_extract(data,'$.codeAttribution.publicationId') IS NOT NULL").bind(owner,storeId,from,to).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as StoreOrder);
}
// 게시 관문은 지금 게시 상태로 다시 본다. 가져온 뒤 게시가 취소·발행 실패·확인 전 상태로 바뀐 주문은 주문 기록에서 고쳤을 때와 같은 모양(publicationGateView)으로 집계한다.
// 그래서 같은 사실 상태면 주문을 고쳤든 안 고쳤든 코드·팔·소재·캠페인·게시·채널별 표와 주간 귀속(north-star)이 같다.
async function attributionReport(owner:string,store:Store,b:Record<string,unknown>){
 const period=recentPeriod(),from=operationDate(b.from||period.from,'조회 시작일'),to=operationDate(b.to||period.to,'조회 종료일');if(from>to)throw new ApiError(400,'조회 기간을 확인하세요.');
 if(addDays(from,REPORT_LIMITS.periodDays-1)<to)throw new ApiError(400,`조회 기간은 ${REPORT_LIMITS.periodDays}일(26주) 이하로 정하세요.`);
 const first=weekStart(from),baseTo=blank(b.baselineTo)?addDays(first,-1):operationDate(b.baselineTo,'기준 종료일'),baseFrom=blank(b.baselineFrom)?addDays(first,-28):operationDate(b.baselineFrom,'기준 시작일');
 if(baseFrom>baseTo||baseTo>=first)throw new ApiError(400,'기준 기간은 조회 기간이 시작하는 주보다 앞으로 정하세요.');
 if(addDays(baseFrom,REPORT_LIMITS.baselineDays-1)<baseTo)throw new ApiError(400,`기준 기간은 ${REPORT_LIMITS.baselineDays}일(12주) 이하로 정하세요.`);
 const rate=blank(b.variableCostRate)?undefined:num(b.variableCostRate,'변동비율');if(rate!==undefined&&rate>1)throw new ApiError(400,'변동비율은 0~1 사이로 입력하세요.');
 const economics:Economics|undefined=rate===undefined?undefined:{variableCostRate:rate},baseWeeks=weeksBetween(baseFrom,baseTo),periodWeeks=weeksBetween(from,to),lastDay=[addDays(weekStart(to),6),koreaToday()].sort()[0];
 const [{orders:stored,spend},baseDays,periodDays,codes,posTotals,auto,coded]=await Promise.all([getStoreOperations(owner,store.id,from,to),ledgerDays(owner,store.id,baseWeeks[0],addDays(baseWeeks[baseWeeks.length-1],6)),ledgerDays(owner,store.id,periodWeeks[0],lastDay),listRecords<TrackingCode>(owner,'tracking_code',store.id),listRecords<PosWeeklyTotal>(owner,'pos_weekly_total',store.id),isEnabled(owner,'a4_auto_attribution'),publicationOrders(owner,store.id,baseWeeks[0],lastDay)]);
 const found=await recordsByIds<Publication>(owner,'execution_publication',coded.flatMap(o=>o.codeAttribution?.publicationId?[o.codeAttribution.publicationId]:[])),gates=gatesOf(found);
 const orders=stored.map(o=>publicationGateView(o,gates)),outside=orders.filter((o,i)=>o!==stored[i]).length,moved=coded.filter(o=>publicationGateView(o,gates)!==o),regate=(days:readonly DayTotal[])=>regateDays(days,moved,moved.map(o=>publicationGateView(o,gates)));
 const {creativeLabels,publicationNames}=await reportLabels(owner,orders,found),periodSet=new Set(periodWeeks),baseSet=new Set(baseWeeks),checks=weeklyCompletenessFromDays([...baseWeeks,...periodWeeks],[...regate(baseDays),...regate(periodDays)],posTotals,economics),weeks=checks.filter(c=>periodSet.has(c.weekStart));
 const notes=[ATTRIBUTION_NOT_INCREMENTAL,'north-star는 POS 합계와 1% 이내로 맞는 주의 귀속 주문·공헌이익만 셉니다.',...(economics?[`원가를 적지 않은 주문의 공헌이익은 변동비율 ${rate}로 추정했습니다.`]:[]),...(auto?[]:['자동 귀속 꺼짐: 앞으로 가져오는 주문은 코드로 자동 귀속하지 않습니다. 이미 코드로 귀속된 주문은 집계에 남습니다.']),...(outside?[`게시 관문 밖 ${outside}건: 가져온 뒤 게시가 취소·발행 실패·확인 전 상태로 바뀌어 게시·코드 귀속에서 뺐습니다. 근거를 직접 적지 않은 자동 귀속은 캠페인·소재·채널·north-star 귀속에서도 뺐습니다(주문 기록에서 고쳐 저장해도 같은 결과입니다). 확인 전 게시가 예약 접수·게시 확인되면 다시 셉니다.`]:[])];
 return {period:{from,to},baseline:{from:baseFrom,to:baseTo},autoAttribution:{enabled:auto,label:autoLabel(auto)},economics:economics??null,totals:orderMetrics(orders,economics),...attributionBreakdown(orders,codes,economics,publicationNames),creativeLabels,...unitEconomics(orders,spend,economics),weeks,baselineWeeks:checks.filter(c=>baseSet.has(c.weekStart)),northStar:northStar(weeks),incrementality:incrementalityLite(checks,baseWeeks,periodWeeks),notes};
}
// 라우트(app/api/store-operations/route.ts)가 지점을 읽은 뒤 부른다. 쓰기 작업은 잠금을 잡은 뒤, 읽기 작업(isMeasurementRead)은 잠금 없이 부른다. 반환값은 JSON으로 그대로 보낸다.
export async function measurementAction(req:Request,owner:string,store:Store,b:Record<string,unknown>){
 if(b.action!=='list'&&b.action!=='attribution_report'&&store.status!=='active')throw new ApiError(409,'보관한 지점입니다.');
 switch(b.action){
  case 'create_tracking_code':return createTrackingCode(req,owner,store,b);
  case 'list':return measurementList(owner,store);
  case 'import_orders':return importOrders(req,owner,store,b);
  case 'set_pos_total':return setPosTotal(req,owner,store,b);
  case 'attribution_report':return attributionReport(owner,store,b);
  default:throw new ApiError(400,'지원하지 않는 점포 실측 작업입니다.');
 }
}
