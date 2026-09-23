import {ApiError,str,readRecord,listRecords,recordStatement,database,uid,stamp,type Actor} from './server';
import type {Brand,Campaign,Artifact} from './agency';
import type {Store} from './store-marketing';
import {effectiveBrandFacts,scopedBrandFacts,evidenceFactRefs,sameEvidenceFactRefs,type BrandFact} from './brand-facts';
import {canonicalFactKey,factCatalogItem} from './fact-catalog';

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
 // 중복 검사는 새로 만들 때와 수정으로 항목(canonical key)이 바뀔 때만 한다. 표기만 다른 이전 중복도 각각 수정·철회할 수 있다(R1).
 if((!old||canonicalFactKey(old.key)!==parsed.key)&&existing.some(f=>f.id!==id&&f.storeId===storeId&&canonicalFactKey(f.key)===parsed.key))throw new ApiError(409,'같은 범위의 사실 항목이 이미 있습니다. 기존 항목을 수정하세요.');
 const decision:FactDecision=parsed.status==='candidate'?{}:{confirmedBy:{id:who.id,email:who.email},confirmedAt:stamp()};
 const fact:BrandFact&FactDecision={...parsed,id,brandId,...(storeId?{storeId}:{}),...decision,version:(old?.version||0)+1,updatedAt:stamp()};
 const writes=[recordStatement(owner,'brand_fact',id,fact,brandId)];
 if(old)writes.push(recordStatement(owner,'brand_fact_history',`${id}:${old.version}`,old,id));
 writes.push(...await factsChangedWrites(owner,brandId,[...existing.filter(f=>f.id!==id),fact]));
 await database().batch(writes);
 // 지점마다 다른 항목을 브랜드 공통으로 저장하면 막지 않고 경고한다. 철회·값 변경·유효 기한 단축은 이미 준비된 발행의 재검토 대상이다. 기한 연장은 게시 내용과 유효성을 해치지 않는다(R9).
 const item=factCatalogItem(parsed.key),warnings=item?.storeScoped&&!storeId?[`${item.label}은(는) 지점마다 다른 항목입니다. 브랜드 공통으로 저장하면 모든 지점의 제작물에 쓰입니다. 범위가 맞는지 확인하세요.`]:[];
 const shortened=!!old?.validUntil&&!(Date.parse(parsed.validUntil)>=Date.parse(old.validUntil));
 const affectsPublications=!!old&&(old.status==='confirmed'&&parsed.status!=='confirmed'||parsed.status==='rejected'&&old.status!=='rejected'||parsed.value!==old.value||shortened);
 return {id,version:fact.version,fact,warnings,affectsPublications};
}
