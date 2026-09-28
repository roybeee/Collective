import type {Brand,Campaign} from './agency';
import type {BrandFact} from './brand-facts';
import {factLabel} from './fact-catalog';
import {factCaption,type VersionLite} from './franchise-facts';
import type {ExecutionCreative,FactRef} from './execution';
import {storefrontDigest} from './storefront-orders';

// Shared by publishing and Meta learning; no publishing/server data loaders.
export const creativeCaption=(facts:BrandFact[],versions:readonly VersionLite[])=>facts.some(f=>!!f.sourceRef||!!f.cost)?factCaption(facts,versions):facts.map(f=>factLabel(f.key)+': '+f.value).join('\n');
export const materialHash=(brand:Pick<Brand,'name'|'color'>,refs:FactRef[],caption:string)=>storefrontDigest([brand.name,brand.color,refs.map(r=>[r.id,r.version]),caption]);
export async function creativeCurrent(campaign:Campaign,brand:Brand|null,facts:BrandFact[],c:ExecutionCreative,versions:readonly VersionLite[]){
 const used=c.factRefs.map(r=>facts.find(f=>f.id===r.id&&f.version===r.version));
 if(used.some(f=>!f)||!brand||c.storeId!==campaign.storeId)return false;
 if(!c.materialHash)return c.campaignVersion===campaign.version;
 const caption=creativeCaption(used as BrandFact[],versions);
 return caption!==null&&c.materialHash===await materialHash(brand,c.factRefs,caption);
}
