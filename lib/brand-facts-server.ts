import {ApiError,str,readRecord,listRecords,recordStatement,database,uid,stamp} from './server';
import type {Brand} from './agency';
import type {Store} from './store-marketing';
import {effectiveBrandFacts,type BrandFact} from './brand-facts';

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

function factDate(value:unknown,label:string){
 const raw=str(value??'',label,50);
 if(!raw)return '';
 if(!Number.isFinite(Date.parse(raw)))throw new ApiError(400,`${label}을 확인하세요.`);
 return new Date(raw).toISOString();
}

function factInput(data:Record<string,unknown>,confirmed:unknown):Pick<BrandFact,'key'|'value'|'status'|'source'|'verifiedAt'|'validUntil'>{
 const key=str(data.key,'사실 항목',120,true).normalize('NFKC').toLowerCase();
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
export async function saveBrandFact(owner:string,input:Record<string,unknown>){
 const data=input.data;
 if(!data||typeof data!=='object'||Array.isArray(data))throw new ApiError(400,'사실 내용을 입력하세요.');
 const fields=data as Record<string,unknown>;
 const brandId=str(fields.brandId,'브랜드',100,true),storeId=str(fields.storeId??'','지점',100)||undefined;
 await factScope(owner,brandId,storeId);
 const id=input.id?str(input.id,'사실',100,true):uid();
 const old=input.id?await readRecord<BrandFact>(owner,'brand_fact',id):undefined;
 if(old&&(old.version!==input.version||old.brandId!==brandId||old.storeId!==storeId))throw new ApiError(409,'사실의 버전이나 범위가 변경됐습니다. 새로고침하세요.');
 if(!old&&input.version!==undefined&&input.version!==0)throw new ApiError(409,'기존 사실을 다시 불러오세요.');
 const parsed=factInput(fields,input.confirmed);
 const existing=await listRecords<BrandFact>(owner,'brand_fact',brandId);
 if(!old&&existing.length>=200)throw new ApiError(409,'브랜드 사실은 200개까지 보관할 수 있습니다. 기존 사실을 검토하세요.');
 if(old&&old.version>=200&&!(old.status==='confirmed'&&parsed.status==='rejected'))throw new ApiError(409,'이 사실의 수정 한도에 도달했습니다. 확정 사실의 사용 거절은 가능합니다.');
 if(existing.some(f=>f.id!==id&&f.storeId===storeId&&f.key===parsed.key))throw new ApiError(409,'같은 범위의 사실 항목이 이미 있습니다. 기존 항목을 수정하세요.');
 const fact:BrandFact={...parsed,id,brandId,...(storeId?{storeId}:{}),version:(old?.version||0)+1,updatedAt:stamp()};
 const writes=[recordStatement(owner,'brand_fact',id,fact,brandId)];
 if(old)writes.push(recordStatement(owner,'brand_fact_history',`${id}:${old.version}`,old,id));
 await database().batch(writes);
 return {id,version:fact.version,fact};
}
