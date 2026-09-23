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
