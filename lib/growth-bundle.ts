import {scanText} from './pii-scan';
import type {CatalogInput,CatalogStock} from './growth-catalog';
export class GrowthBundleError extends Error {}
export type BundleComponent={catalogId:string;catalogVersion:number;units:number};
export type BundleInput={title:string;components:BundleComponent[];price:number|null;priceApproved:boolean;plannedQuantity:number;landingUrl:string;purchaseReason:string};
export type BundleCatalog={id:string;version:number;input:CatalogInput;currentStock:CatalogStock|null;readiness:{missing:string[]}};
function fail(m:string):never{throw new GrowthBundleError(m)}
const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function text(v:unknown,label:string,max:number){if(v===undefined||v==='')return '';if(typeof v!=='string'||v.length>max||control.test(v))fail(`${label}: 최대 ${max}자 문자열입니다.`);if(scanText(v.normalize('NFKC')).length)fail(`${label}: 식별정보를 넣을 수 없습니다.`);return v.trim()}
const int=(v:unknown,label:string,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max?v:fail(`${label}: ${min}~${max} 정수입니다.`);
export function parseBundleInput(value:unknown):BundleInput{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('번들 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(!Array.isArray(b.components)||b.components.length<2||b.components.length>10)fail('번들 구성 상품은 2~10개입니다.');
 const components=(b.components as unknown[]).map((raw,i)=>{if(!raw||typeof raw!=='object')fail(`구성 ${i+1}을 확인하세요.`);const c=raw as Record<string,unknown>;const id=text(c.catalogId,'상품 ID',100);if(!/^[A-Za-z0-9_-]+$/.test(id))fail(`구성 ${i+1}: 상품 ID 형식을 확인하세요.`);return {catalogId:id,catalogVersion:int(c.catalogVersion,`구성 ${i+1} 상품 판`,1,1e9),units:int(c.units,`구성 ${i+1} 수량`,1,1000)}});
 if(new Set(components.map(c=>c.catalogId)).size!==components.length)fail('같은 상품은 한 번만 넣고 수량으로 조정하세요.');
 if(b.price!==null&&b.price!==undefined)int(b.price,'번들 가격',0,1e12);if(typeof b.priceApproved!=='boolean')fail('번들 가격 승인 여부를 선택하세요.');
 const landingUrl=text(b.landingUrl,'구매 링크',2048);if(landingUrl&&!/^https:\/\/[^\s?#@]+$/.test(landingUrl))fail('구매 링크는 쿼리 없는 HTTPS 주소여야 합니다.');
 return {title:text(b.title,'번들명',200),components,price:(b.price??null) as number|null,priceApproved:b.priceApproved,plannedQuantity:int(b.plannedQuantity,'계획 판매 수량',0,1_000_000),landingUrl,purchaseReason:text(b.purchaseReason,'구매 이유',1000)};
}
/**
 * Bundle economics and allocation from exact catalog versions. Cost is Σ units×(unit+variable cost) on one tax basis; any unknown
 * cost, mixed tax basis, unknown/held stock or unit mismatch leaves the value null instead of guessing.
 */
export function bundleAssessment(input:BundleInput,catalogs:BundleCatalog[],now=Date.now()){
 const missing:string[]=[],rows=input.components.map(c=>({c,cat:catalogs.find(x=>x.id===c.catalogId)}));
 for(const {c,cat} of rows){
  if(!cat){missing.push(`${c.catalogId}: 현재 캠페인 상품이 아닙니다.`);continue}
  if(cat.version!==c.catalogVersion)missing.push(`${c.catalogId}: 상품이 변경되었습니다. 최신 판을 선택하세요.`);
  if(!cat.input.rightsConfirmed)missing.push(`${c.catalogId}: 판매 권리를 확인하세요.`);
  if(!cat.input.validUntil||Date.parse(cat.input.validUntil+'T23:59:59Z')<=now)missing.push(`${c.catalogId}: 상품 근거가 만료되었거나 없습니다.`);
  if(!cat.input.fulfillment||!cat.input.refunds)missing.push(`${c.catalogId}: 배송·반품 조건을 확인하세요.`);
 }
 const known=rows.every(r=>r.cat),bases=new Set(rows.map(r=>r.cat?.input.taxBasis));
 if(known&&(bases.size!==1||bases.has('unknown')))missing.push('구성 상품의 세금 기준이 같아야 합니다.');
 const costs=rows.map(({c,cat})=>cat&&cat.input.unitCost!==null&&cat.input.variableCost!==null?c.units*(cat.input.unitCost+cat.input.variableCost):null);
 const cost=known&&costs.every(x=>x!==null)&&bases.size===1&&!bases.has('unknown')?(costs as number[]).reduce((a,b)=>a+b,0):null;
 if(cost===null)missing.push('번들 원가를 계산할 수 없습니다(원가·변동비·세금 기준 확인).');
 const contribution=cost!==null&&input.price!==null&&Number.isSafeInteger(input.price-cost)?input.price-cost:null;
 if(input.price===null)missing.push('번들 가격을 입력하세요.');if(!input.priceApproved)missing.push('번들 가격 승인이 필요합니다.');
 if(contribution!==null&&contribution<=0)missing.push('번들 공헌이익이 양수여야 합니다.');
 const listPrice=rows.every(r=>r.cat?.input.price!==null&&r.cat)?rows.reduce((n,{c,cat})=>n+c.units*(cat!.input.price as number),0):null;
 const allocation=rows.map(({c,cat})=>{const s=cat?.currentStock;const status=!s||s.status!=='known'||s.available===null||s.unit!==cat?.input.stockUnit?'held' as const:'known' as const;return {catalogId:c.catalogId,unitsPerBundle:c.units,available:status==='known'?s!.available:null,maxBundles:status==='known'?Math.floor(s!.available!/c.units):null,required:c.units*input.plannedQuantity,status,unit:cat?.input.stockUnit??'unknown'}});
 const maxBundles=allocation.every(a=>a.maxBundles!==null)?Math.min(...allocation.map(a=>a.maxBundles as number)):null;
 if(maxBundles===null)missing.push('구성 상품의 공유 재고를 확인하세요.');else if(maxBundles<input.plannedQuantity)missing.push(`계획 수량(${input.plannedQuantity})보다 만들 수 있는 번들(${maxBundles})이 적습니다.`);
 if(!input.title)missing.push('번들명을 입력하세요.');if(!input.landingUrl)missing.push('구매 링크를 입력하세요.');if(!input.purchaseReason)missing.push('구매 이유를 입력하세요.');
 return {missing:[...new Set(missing)],cost,contribution,listPrice,discountFromList:listPrice!==null&&input.price!==null?listPrice-input.price:null,maxBundles,allocation,mayExecute:false as const,mayReserve:false as const};
}
