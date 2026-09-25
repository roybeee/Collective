import {ApiError,str,readRecord,listRecords,recordStatement,database,uid,stamp,type Actor} from './server';
import type {Brand,Campaign,Artifact} from './agency';
import type {Store} from './store-marketing';
import {effectiveBrandFacts,scopedBrandFacts,evidenceFactRefs,sameEvidenceFactRefs,type BrandFact} from './brand-facts';
import {canonicalFactKey,factCatalogItem,franchiseFactKey,franchiseItem} from './fact-catalog';
import {isEnabled} from './feature-flags';
import {checkFranchiseFactSave,readCostDetail,readSourceRef,sameJson,versionStates,FRANCHISE_FACT_MESSAGES,type VersionLite} from './franchise-facts';
import {hasFranchiseContext,loadFranchiseContext,staleFranchiseFactIds,type FranchiseContext} from './franchise-facts-server';
import {GATE_DISCLAIMER} from './franchise-gates';

// 확정·거절한 사람과 시각. 이 필드가 생기기 전에 저장된 사실에는 없다.
export type FactDecision={confirmedBy?:{id:string;email:string|null};confirmedAt?:string};

async function factScope(owner:string,brandId?:string,storeId?:string){
 if(brandId)await readRecord<Brand>(owner,'brand',brandId);
 if(!storeId)return brandId;
 const store=await readRecord<Store>(owner,'store',storeId);
 if(brandId&&store.brandId!==brandId)throw new ApiError(404,'해당 브랜드의 지점이 아닙니다.');
 await readRecord<Brand>(owner,'brand',store.brandId);
 return store.brandId;
}

export async function getBrandFacts(owner:string,brandId?:string,storeId?:string):Promise<BrandFact[]>{
 const scopedBrand=await factScope(owner,brandId,storeId);
 const facts=await listRecords<BrandFact>(owner,'brand_fact',scopedBrand);
 return facts.filter(f=>!storeId||!f.storeId||f.storeId===storeId);
}

export async function confirmedFactContext(owner:string,brandId:string,storeId?:string):Promise<BrandFact[]>{
 return effectiveBrandFacts(await getBrandFacts(owner,brandId,storeId),brandId,storeId);
}

// 사실이 바뀌면 같은 브랜드의 현재 작업물 중 입력에 쓴 사실 스냅샷(factRefs: 확정·거절)이 달라진 것에 factsChanged만 표시한다. outdated로 바꾸지 않는다.
async function factsChangedWrites(owner:string,brandId:string,facts:BrandFact[]){
 const writes:D1PreparedStatement[]=[];
 for(const c of (await listRecords<Campaign>(owner,'campaign')).filter(c=>c.brandId===brandId)){
  const current=evidenceFactRefs(scopedBrandFacts(facts,brandId,c.storeId));
  for(const a of await listRecords<Artifact>(owner,'artifact',c.id)){
   if(a.status==='outdated'||!Array.isArray(a.factRefs))continue;
   const changed=!sameEvidenceFactRefs(a.factRefs,current);if(changed===!!a.factsChanged)continue;
   writes.push(recordStatement(owner,'artifact',a.id,{...a,factsChanged:changed||undefined},c.id));
  }
 }
 return writes;
}

function factDate(value:unknown,label:string){
 const raw=str(value??'',label,50);
 if(!raw)return '';
 if(!Number.isFinite(Date.parse(raw)))throw new ApiError(400,`${label}을 확인하세요.`);
 return new Date(raw).toISOString();
}

function factInput(data:Record<string,unknown>,confirmed:unknown):Pick<BrandFact,'key'|'value'|'status'|'source'|'verifiedAt'|'validUntil'>{
 const key=canonicalFactKey(str(data.key,'사실 항목',120,true));
 const value=str(data.value,'사실 내용',5000,true);
 const status=data.status??'candidate';
 if(status!=='candidate'&&status!=='confirmed'&&status!=='rejected')throw new ApiError(400,'사실 상태를 확인하세요.');
 const source=str(data.source??'','확인 근거',3000);
 const verifiedAt=factDate(data.verifiedAt,'확인 시점'),validUntil=factDate(data.validUntil,'유효 기한');
 if(status==='confirmed'){
  if(confirmed!==true)throw new ApiError(400,'확인 사실로 저장하려면 명시적으로 확인하세요.');
  if(!source||!verifiedAt||!validUntil)throw new ApiError(400,'확인 근거·확인 시점·유효 기한이 필요합니다.');
  if(Date.parse(verifiedAt)>Date.now()||Date.parse(validUntil)<=Date.now())throw new ApiError(400,'확인 시점은 현재 이전, 유효 기한은 현재 이후여야 합니다.');
 }
 return {key,value,status,source,verifiedAt,validUntil};
}

// 가맹 사실 식별(트랙 R R1b): 가맹 문맥 브랜드에서는 옛 자유 key('가맹비')도 가맹 항목으로 보고, 창업비용 항목은 매장 유형까지 본다. 비가맹 브랜드는 canonical key 그대로다.
function factIdentity(f:Pick<BrandFact,'key'|'cost'>,ctx:boolean){
 const fk=ctx?franchiseFactKey(f.key):undefined;
 return fk?fk+(franchiseItem(fk)?.storeType?'\u0000'+(f.cost?.storeType??''):''):canonicalFactKey(f.key);
}
const given=(v:unknown)=>v!==undefined&&v!==null;
// 가맹 입력: undefined면 이전 값 유지, null이면 지움. 형식 오류는 400.
function franchiseInput(fields:Record<string,unknown>,old:BrandFact|undefined){
 const ref=readSourceRef(fields.sourceRef),cost=readCostDetail(fields.cost);
 if(ref==='invalid')throw new ApiError(400,FRANCHISE_FACT_MESSAGES.sourceInvalid);
 if(cost==='invalid')throw new ApiError(400,FRANCHISE_FACT_MESSAGES.costInvalid);
 return {sourceRef:ref===undefined?old?.sourceRef:ref??undefined,cost:cost===undefined?old?.cost:cost??undefined};
}

// The caller holds the owner mutation lock for duplicate/version checks and the batch write.
// 직원(member)은 확인 후보만 제안한다. 확정·거절과 이미 확정·거절된 사실의 수정은 관리자(owner·admin)만 한다.
export async function saveBrandFact(owner:string,input:Record<string,unknown>,who:Pick<Actor,'id'|'email'|'role'>){
 const data=input.data;
 if(!data||typeof data!=='object'||Array.isArray(data))throw new ApiError(400,'사실 내용을 입력하세요.');
 const fields=data as Record<string,unknown>;
 const brandId=str(fields.brandId,'브랜드',100,true),storeId=str(fields.storeId??'','지점',100)||undefined;
 await factScope(owner,brandId,storeId);
 const id=input.id?str(input.id,'사실',100,true):uid();
 const old=input.id?await readRecord<BrandFact>(owner,'brand_fact',id):undefined;
 if(who.role!=='owner'&&who.role!=='admin'&&((fields.status??'candidate')!=='candidate'||old&&old.status!=='candidate'))throw new ApiError(403,'사실 확정·거절과 확정·거절된 사실 수정은 관리자만 할 수 있습니다. 확인 후보로 제안해 주세요.');
 if(old&&(old.version!==input.version||old.brandId!==brandId||old.storeId!==storeId))throw new ApiError(409,'사실의 버전이나 범위가 변경됐습니다. 새로고침하세요.');
 if(!old&&input.version!==undefined&&input.version!==0)throw new ApiError(409,'기존 사실을 다시 불러오세요.');
 const parsed=factInput(fields,input.confirmed);
 const existing=await listRecords<BrandFact>(owner,'brand_fact',brandId);
 if(!old&&existing.length>=200)throw new ApiError(409,'브랜드 사실은 200개까지 보관할 수 있습니다. 기존 사실을 검토하세요.');
 if(old&&old.version>=200&&!(old.status==='confirmed'&&parsed.status==='rejected'))throw new ApiError(409,'이 사실의 수정 한도에 도달했습니다. 확정 사실의 사용 거절은 가능합니다.');
 // 가맹 항목(트랙 R R1b). 가맹 문맥이 없는 브랜드의 자유 key('가맹비'·'월 매출')는 이 검사를 받지 않고 key도 이전과 같이 저장된다.
 const fr=await loadFranchiseContext(owner,brandId),ctx=hasFranchiseContext(fr);
 const fk=ctx?franchiseFactKey(parsed.key):undefined;
 const franchiseWrite=!!fk||given(fields.sourceRef)||given(fields.cost)||!!old?.sourceRef||!!old?.cost||(ctx&&!!old&&!!franchiseFactKey(old.key));
 const extra=franchiseWrite?franchiseInput(fields,old):{sourceRef:undefined,cost:undefined};
 // 스위치가 꺼져도 사용 거절(같은 항목·값·근거 그대로)은 받는다. 이때 저장 key 문자열도 바꾸지 않는다.
 const rejectOnly=franchiseWrite&&!!old&&parsed.status==='rejected'&&(parsed.key===old.key||(!!fk&&fk===franchiseFactKey(old.key)))&&parsed.value===old.value&&sameJson(extra.sourceRef,old.sourceRef)&&sameJson(extra.cost,old.cost);
 const key=rejectOnly?old!.key:fk??parsed.key;
 let franchiseWarnings:string[]=[];
 if(franchiseWrite){
  if(!rejectOnly&&!await isEnabled(owner,'r_franchise'))throw new ApiError(409,FRANCHISE_FACT_MESSAGES.off);
  const checked=checkFranchiseFactSave({item:fk?franchiseItem(fk):undefined,status:parsed.status,sourceRef:extra.sourceRef,cost:extra.cost,oldSourceRef:old?.sourceRef,verifiedAt:parsed.verifiedAt,validUntil:parsed.validUntil,brandId,versions:fr.versions,fiscalYearEnd:fr.profile?.fiscalYearEnd??null,now:stamp()});
  if(!checked.ok)throw new ApiError(checked.status,checked.message);
  franchiseWarnings=checked.warnings;
 }
 // 중복 검사는 새로 만들 때와 수정으로 항목(canonical key)이 바뀔 때만 한다. 표기만 다른 이전 중복도 각각 수정·철회할 수 있다(R1).
 const identity=factIdentity({key,cost:extra.cost},ctx);
 if(!old||factIdentity(old,ctx)!==identity){
  const dup=existing.find(f=>f.id!==id&&f.storeId===storeId&&factIdentity(f,ctx)===identity);
  if(dup)throw new ApiError(409,!old&&isStale(dup,fr)?FRANCHISE_FACT_MESSAGES.staleDuplicate:'같은 범위의 사실 항목이 이미 있습니다. 기존 항목을 수정하세요.');
 }
 const decision:FactDecision=parsed.status==='candidate'?{}:{confirmedBy:{id:who.id,email:who.email},confirmedAt:stamp()};
 const fact:BrandFact&FactDecision={...parsed,key,id,brandId,...(storeId?{storeId}:{}),...(extra.sourceRef?{sourceRef:extra.sourceRef}:{}),...(extra.cost?{cost:extra.cost}:{}),...decision,version:(old?.version||0)+1,updatedAt:stamp()};
 const writes=[recordStatement(owner,'brand_fact',id,fact,brandId)];
 if(old)writes.push(recordStatement(owner,'brand_fact_history',`${id}:${old.version}`,old,id));
 writes.push(...await factsChangedWrites(owner,brandId,[...existing.filter(f=>f.id!==id),fact]));
 await database().batch(writes);
 // 지점마다 다른 항목을 브랜드 공통으로 저장하면 막지 않고 경고한다. 철회·값 변경·유효 기한 단축은 이미 준비된 발행의 재검토 대상이다. 기한 연장은 게시 내용과 유효성을 해치지 않는다(R9).
 // 가맹 사실은 근거 버전·기준 사업연도·기준일·창업비용 상세가 바뀌어도 재검토 대상이다(각주·값의 근거가 바뀐다).
 const item=factCatalogItem(parsed.key),warnings=[...(item?.storeScoped&&!storeId?[`${item.label}은(는) 지점마다 다른 항목입니다. 브랜드 공통으로 저장하면 모든 지점의 제작물에 쓰입니다. 범위가 맞는지 확인하세요.`]:[]),...franchiseWarnings];
 const shortened=!!old?.validUntil&&!(Date.parse(parsed.validUntil)>=Date.parse(old.validUntil));
 const sourceChanged=franchiseWrite&&!!old&&(old.sourceRef?.disclosureVersionId!==extra.sourceRef?.disclosureVersionId||old.sourceRef?.fiscalYear!==extra.sourceRef?.fiscalYear||old.sourceRef?.asOf!==extra.sourceRef?.asOf||!sameJson(old.cost,extra.cost));
 const affectsPublications=!!old&&(old.status==='confirmed'&&parsed.status!=='confirmed'||parsed.status==='rejected'&&old.status!=='rejected'||parsed.value!==old.value||shortened||sourceChanged);
 return {id,version:fact.version,fact,warnings,affectsPublications};
}
// 근거 버전이 현재 등록 버전이 아닌 가맹 사실.
function isStale(f:BrandFact,fr:FranchiseContext){return !!f.sourceRef&&versionStates(fr.versions,stamp())[f.sourceRef.disclosureVersionId]!=='current'}

// 새 정보공개서 버전으로 옮기기(트랙 R R1b rebase_facts). 값(value)·창업비용 상세(cost)는 바꾸지 않고 근거·확인 시점·유효 기한만 바꾼다(값이 다르면 save_fact로 고친다).
// 전부 통과해야 한 batch로 쓴다. 이미 대상 버전·같은 근거·같은 시점이면 쓰지 않고 unchanged로 센다(멱등). 호출자는 owner 변경 잠금을 가진다.
export async function rebaseFranchiseFacts(owner:string,input:Record<string,unknown>,who:Pick<Actor,'id'|'email'|'role'>){
 if(who.role!=='owner'&&who.role!=='admin')throw new ApiError(403,FRANCHISE_FACT_MESSAGES.rebaseAdminOnly);
 const brandId=str(input.brandId,'브랜드',100,true);
 await factScope(owner,brandId);
 if(!await isEnabled(owner,'r_franchise'))throw new ApiError(409,FRANCHISE_FACT_MESSAGES.off);
 const fr=await loadFranchiseContext(owner,brandId),now=stamp();
 const versionId=str(input.disclosureVersionId,'정보공개서 버전',100,true);
 const target=fr.versions.find(v=>v.id===versionId);
 if(!target)throw new ApiError(400,FRANCHISE_FACT_MESSAGES.versionOtherBrand);
 if(versionStates(fr.versions,now)[target.id]!=='current')throw new ApiError(400,FRANCHISE_FACT_MESSAGES.versionNotCurrent);
 const items=input.items;
 if(!Array.isArray(items)||items.length<1||items.length>50||!items.every(x=>!!x&&typeof x==='object'&&!Array.isArray(x)))throw new ApiError(400,FRANCHISE_FACT_MESSAGES.rebaseInvalid);
 const existing=await listRecords<BrandFact>(owner,'brand_fact',brandId),seen=new Set<string>();
 const planned:{old:BrandFact;next:BrandFact&FactDecision}[]=[];let unchanged=0;
 for(const raw of items as Record<string,unknown>[]){
  const factId=typeof raw.id==='string'?raw.id:'',old=existing.find(f=>f.id===factId),fk=old?franchiseFactKey(old.key):undefined,item=fk?franchiseItem(fk):undefined;
  if(!old||seen.has(factId)||old.brandId!==brandId||old.status!=='confirmed'||!item?.disclosure)throw new ApiError(400,FRANCHISE_FACT_MESSAGES.rebaseInvalid);
  seen.add(factId);
  if(old.version!==raw.version)throw new ApiError(409,'사실의 버전이나 범위가 변경됐습니다. 새로고침하세요.');
  const ref=readSourceRef({disclosureVersionId:target.id,fiscalYear:raw.fiscalYear,page:raw.page??null,asOf:raw.asOf});
  if(!ref||ref==='invalid')throw new ApiError(400,FRANCHISE_FACT_MESSAGES.sourceInvalid);
  const timing=factInput({key:old.key,value:old.value,status:'confirmed',source:old.source,verifiedAt:raw.verifiedAt,validUntil:raw.validUntil},true);
  if(old.sourceRef&&sameJson(old.sourceRef,ref)&&old.verifiedAt===timing.verifiedAt&&old.validUntil===timing.validUntil&&old.key===fk){unchanged++;continue}
  if(old.version>=200)throw new ApiError(409,'이 사실의 수정 한도에 도달했습니다. 확정 사실의 사용 거절은 가능합니다.');
  const checked=checkFranchiseFactSave({item,status:'confirmed',sourceRef:ref,cost:old.cost,oldSourceRef:old.sourceRef,verifiedAt:timing.verifiedAt,validUntil:timing.validUntil,brandId,versions:fr.versions,fiscalYearEnd:fr.profile?.fiscalYearEnd??null,now});
  if(!checked.ok)throw new ApiError(checked.status,checked.message);
  planned.push({old,next:{...old,key:fk!,sourceRef:ref,verifiedAt:timing.verifiedAt,validUntil:timing.validUntil,confirmedBy:{id:who.id,email:who.email},confirmedAt:now,version:old.version+1,updatedAt:now}});
 }
 if(!planned.length)return {rebased:0,unchanged,ids:[] as string[]};
 const ids=new Set(planned.map(p=>p.old.id)),after=[...existing.filter(f=>!ids.has(f.id)),...planned.map(p=>p.next)];
 const writes=planned.flatMap(p=>[recordStatement(owner,'brand_fact',p.old.id,p.next,brandId),recordStatement(owner,'brand_fact_history',`${p.old.id}:${p.old.version}`,p.old,p.old.id)]);
 writes.push(...await factsChangedWrites(owner,brandId,after));
 await database().batch(writes);
 return {rebased:planned.length,unchanged,ids:[...ids]};
}
// GET /api/brand-facts 가맹 블록(가맹 문맥 브랜드만). 버전 상태·현재 버전·옮길 사실·사업연도 종료일.
export async function franchiseFactsOverview(owner:string,brandId:string,facts:BrandFact[]){
 const fr=await loadFranchiseContext(owner,brandId);
 if(!hasFranchiseContext(fr))return null;
 const now=stamp(),states=versionStates(fr.versions,now),current=fr.versions.find(v=>states[v.id]==='current');
 return {enabled:await isEnabled(owner,'r_franchise'),fiscalYearEnd:fr.profile?.fiscalYearEnd??null,currentVersionId:current?.id??null,versions:fr.versions.map((v:VersionLite)=>({id:v.id,label:v.label,registeredAt:v.registeredAt,state:states[v.id]})),staleFactIds:staleFranchiseFactIds(facts.filter(f=>f.brandId===brandId),fr,now),disclaimer:GATE_DISCLAIMER};
}
