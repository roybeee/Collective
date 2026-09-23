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
};

export function effectiveBrandFacts(facts:BrandFact[],brandId:string,storeId?:string,now=Date.now()):BrandFact[]{
 const eligible=facts.filter(f=>f.brandId===brandId&&(!f.storeId||f.storeId===storeId)&&f.status==='confirmed'&&!!f.source.trim()&&Number.isFinite(Date.parse(f.verifiedAt))&&Date.parse(f.verifiedAt)<=now&&Date.parse(f.validUntil)>now);
 const localKeys=new Set(eligible.filter(f=>f.storeId===storeId&&!!storeId).map(f=>f.key));
 return eligible.filter(f=>!!f.storeId||!localKeys.has(f.key));
}

// AI 입력용 분류: 확정(유효기한·범위 통과), 금지(거절 = 광고 금지 표현), 후보(미확인·만료). 지점 확정 사실은 같은 항목의 브랜드 사실을 대신한다.
export function scopedBrandFacts(facts:BrandFact[],brandId:string,storeId?:string,now=Date.now()){
 const confirmed=effectiveBrandFacts(facts,brandId,storeId,now),used=new Set(confirmed.map(f=>f.id));
 const localKeys=new Set(confirmed.filter(f=>!!storeId&&f.storeId===storeId).map(f=>f.key));
 const rest=facts.filter(f=>f.brandId===brandId&&(!f.storeId||f.storeId===storeId)&&!used.has(f.id)&&!(!f.storeId&&localKeys.has(f.key)));
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
