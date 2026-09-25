import {canonicalFactKey} from './fact-catalog';
export type BrandFact = {
 id:string;
 brandId:string;
 storeId?:string;
 key:string;
 value:string;
 status:'candidate'|'confirmed'|'rejected';
 source:string;
 verifiedAt:string;
 validUntil:string;
 version:number;
 updatedAt:string;
 // 가맹 항목(트랙 R R1b)만: 정보공개서 근거와 창업비용 상세. 없으면 키가 없다(기존 사실 JSON 불변). 모델 입력(lib/ai-context.ts confirmedItem)에는 들어가지 않는다.
 sourceRef?:FactSourceRef;
 cost?:FranchiseCostDetail;
};
// disclosureVersionId: 같은 브랜드의 franchise_disclosure_version id. fiscalYear: 종료일이 그 달력 연도에 있는 사업연도. page: 정보공개서 쪽(모르면 null). asOf: 매장 수 기준일(KST 'YYYY-MM-DD').
export type FactSourceRef={disclosureVersionId:string;fiscalYear:number;page:number|null;asOf?:string};
// 창업비용 구성: 매장 유형별 값과 포함·불포함 항목, 전용면적(㎡, 모르면 null).
export type FranchiseCostDetail={storeType:string;includes:string[];excludes:string[];areaM2:number|null};

// 지점 사실이 같은 항목의 브랜드 사실을 대신하는지는 카탈로그 key로 판단한다('주소'와 'address'는 같은 항목).
export function effectiveBrandFacts(facts:BrandFact[],brandId:string,storeId?:string,now=Date.now()):BrandFact[]{
 const eligible=facts.filter(f=>f.brandId===brandId&&(!f.storeId||f.storeId===storeId)&&f.status==='confirmed'&&!!f.source.trim()&&Number.isFinite(Date.parse(f.verifiedAt))&&Date.parse(f.verifiedAt)<=now&&Date.parse(f.validUntil)>now);
 const localKeys=new Set(eligible.filter(f=>f.storeId===storeId&&!!storeId).map(f=>canonicalFactKey(f.key)));
 return eligible.filter(f=>!!f.storeId||!localKeys.has(canonicalFactKey(f.key)));
}

// AI 입력용 분류: 확정(유효기한·범위 통과), 금지(거절 = 광고 금지 표현), 후보(미확인·만료). 지점 확정 사실은 같은 항목의 브랜드 사실을 대신한다.
export function scopedBrandFacts(facts:BrandFact[],brandId:string,storeId?:string,now=Date.now()){
 const confirmed=effectiveBrandFacts(facts,brandId,storeId,now),used=new Set(confirmed.map(f=>f.id));
 const localKeys=new Set(confirmed.filter(f=>!!storeId&&f.storeId===storeId).map(f=>canonicalFactKey(f.key)));
 const rest=facts.filter(f=>f.brandId===brandId&&(!f.storeId||f.storeId===storeId)&&!used.has(f.id)&&!(!f.storeId&&localKeys.has(canonicalFactKey(f.key))));
 return {confirmed,prohibited:rest.filter(f=>f.status==='rejected'),candidate:rest.filter(f=>f.status!=='rejected')};
}

// 작업물이 입력에 쓴 확정 사실의 {id, version}. 사실이 바뀌면 작업물에 factsChanged를 표시하는 기준이다.
export type FactRef={id:string;version:number};
export const factRefs=(facts:FactRef[]):FactRef[]=>facts.map(f=>({id:f.id,version:f.version})).sort((a,b)=>a.id.localeCompare(b.id));
export const sameFactRefs=(a:FactRef[],b:FactRef[])=>JSON.stringify(factRefs(a))===JSON.stringify(factRefs(b));
// AI 입력에 쓴 사실 스냅샷: 확정과 거절(광고 금지 표현) 사실의 {id, version, status}. 후보는 근거가 아니므로 제외한다.
// status가 없는 이전 기록은 확정 사실만 담았으므로 confirmed로 비교한다.
export type EvidenceFactRef=FactRef&{status?:'confirmed'|'rejected'};
export function evidenceFactRefs(scoped:{confirmed:FactRef[];prohibited:FactRef[]}):EvidenceFactRef[]{
 return [...scoped.confirmed.map(f=>({id:f.id,version:f.version,status:'confirmed' as const})),...scoped.prohibited.map(f=>({id:f.id,version:f.version,status:'rejected' as const}))].sort((a,b)=>a.id.localeCompare(b.id)||a.status.localeCompare(b.status));
}
const refKey=(r:EvidenceFactRef)=>`${r.id}:${r.version}:${r.status??'confirmed'}`;
export const sameEvidenceFactRefs=(a:EvidenceFactRef[],b:EvidenceFactRef[])=>JSON.stringify(a.map(refKey).sort())===JSON.stringify(b.map(refKey).sort());
