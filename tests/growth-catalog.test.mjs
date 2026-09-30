import assert from 'node:assert/strict';
import {moduleRuntime} from '../scripts/eval/runtime.mjs';

const {load} = moduleRuntime(async () => { throw Error('No network'); });
const c = await load('lib/growth-catalog.ts');
let passed = 0;
function test(name, run) { run(); passed++; console.log('passed: ' + name); }
const now = Date.parse('2026-09-30T03:00:00Z');
const catalog = () => ({...c.emptyCatalogInput(), sku:'SKU-01', title:'상품 🎵', price:10000,
  unitCost:4000, variableCost:1000, stock:10, taxBasis:'included', fulfillment:'택배 3일',
  refunds:'수령 후 7일', rightsConfirmed:true, factIds:['fact-1'], validUntil:'2026-09-30'});
const offer = () => ({...c.emptyOfferInput(), title:'첫 구매', catalogId:'cat-1', catalogVersion:1,
  needId:'need-1', price:9000, quantity:2, landingUrl:'https://shop.example.com/p/1',
  purchaseReason:'확인된 수요', priceApproved:true});
const reference = () => ({id:'cat-1', version:1, input:catalog()});
const rejects = (fn) => assert.throws(fn, c.GrowthCatalogError);

test('empty catalog draft is accepted and incomplete', () => {
  assert.equal(c.parseCatalogInput({}).price, null);
  assert.ok(c.catalogReadiness(c.emptyCatalogInput(), now).missing.length > 0);
});
test('empty offer draft is accepted and incomplete', () => {
  assert.equal(c.parseOfferInput({}).price, null);
  assert.ok(c.offerReadiness(c.emptyOfferInput(), null, now).missing.length > 0);
});
test('catalog arrays are independently created', () => {
  const a=c.emptyCatalogInput(), b=c.emptyCatalogInput(); a.factIds.push('x'); assert.equal(b.factIds.length,0);
});
test('parse preserves caller input and copies evidence arrays', () => {
  const input=catalog(), before=JSON.stringify(input), parsed=c.parseCatalogInput(input);
  assert.equal(JSON.stringify(input),before); assert.notEqual(parsed.factIds,input.factIds);
});
test('valid catalog has positive unit contribution', () => {
  const r=c.catalogReadiness(c.parseCatalogInput(catalog()),now); assert.equal(r.missing.length,0); assert.equal(r.unitContribution,5000);
});
test('valid offer uses its approved unit price', () => {
  const r=c.offerReadiness(c.parseOfferInput(offer()),reference(),now); assert.equal(r.missing.length,0); assert.equal(r.unitContribution,4000);
});
for (const value of [null,undefined,[],42,'draft']) test('rejects non-object input '+String(value), () => rejects(()=>c.parseCatalogInput(value)));
for (const field of ['price','unitCost','variableCost','stock']) {
  for (const value of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,1.5,'12',true]) {
    test('rejects invalid '+field+' '+String(value),()=>rejects(()=>c.parseCatalogInput({...catalog(),[field]:value})));
  }
}
test('blank amount remains unknown',()=>assert.equal(c.parseCatalogInput({...catalog(),price:''}).price,null));
test('zero cost is known and allowed',()=>assert.equal(c.catalogReadiness({...catalog(),unitCost:0,variableCost:0},now).missing.length,0));
test('unknown cost blocks readiness',()=>assert.equal(c.catalogReadiness({...catalog(),unitCost:null},now).unitContribution,null));
test('unknown tax basis blocks readiness',()=>assert.ok(c.catalogReadiness({...catalog(),taxBasis:'unknown'},now).missing.length));
for(const price of [0,5000,4000]) test('nonpositive contribution blocks '+price,()=>assert.ok(c.catalogReadiness({...catalog(),price},now).missing.length));
test('missing rights blocks readiness',()=>assert.ok(c.catalogReadiness({...catalog(),rightsConfirmed:false},now).missing.length));
test('missing evidence blocks readiness',()=>assert.ok(c.catalogReadiness({...catalog(),factIds:[]},now).missing.length));
test('out of stock blocks readiness',()=>assert.ok(c.catalogReadiness({...catalog(),stock:0},now).missing.length));
test('date remains valid through Seoul end of day',()=>assert.equal(c.catalogReadiness(catalog(),Date.parse('2026-09-30T14:59:59.999Z')).missing.length,0));
test('date expires at next Seoul midnight',()=>assert.ok(c.catalogReadiness(catalog(),Date.parse('2026-09-30T15:00:00Z')).missing.length));
test('exact timestamp expiry is exclusive',()=>assert.ok(c.catalogReadiness({...catalog(),validUntil:'2026-09-30T03:00:00Z'},now).missing.length));
test('future explicit offset timestamp accepted',()=>assert.equal(c.catalogReadiness({...catalog(),validUntil:'2026-10-01T00:00:00+09:00'},now).missing.length,0));
test('valid leap day accepted',()=>assert.equal(c.parseCatalogInput({...catalog(),validUntil:'2028-02-29'}).validUntil,'2028-02-29'));
for(const validUntil of ['2026-02-29','2026-02-30','2026-13-01','2026-09-31T01:00:00Z','2026-09-30T24:00:00Z','2026-09-30T03:00:00','tomorrow']) {
  test('rejects invalid calendar date '+validUntil,()=>rejects(()=>c.parseCatalogInput({...catalog(),validUntil})));
}
test('rejects invalid boolean rather than treating text as consent',()=>rejects(()=>c.parseCatalogInput({...catalog(),rightsConfirmed:'true'})));
test('rejects unsupported currency',()=>rejects(()=>c.parseCatalogInput({...catalog(),currency:'USD'})));
test('rejects unsupported tax basis',()=>rejects(()=>c.parseCatalogInput({...catalog(),taxBasis:'tax-free'})));
test('rejects malformed evidence ids',()=>rejects(()=>c.parseCatalogInput({...catalog(),factIds:[{}]})));
test('rejects excessively large evidence list',()=>rejects(()=>c.parseCatalogInput({...catalog(),factIds:Array(101).fill('fact')})));
test('rejects overly long text',()=>rejects(()=>c.parseCatalogInput({...catalog(),title:'a'.repeat(201)})));
for(const landingUrl of ['javascript:alert(1)','http://shop.example.com','//shop.example.com','https://user:pass@example.com','https://localhost/p','https://127.0.0.1/p','https://[::1]/','https://shop.local/']) {
  test('rejects unsafe landing URL '+landingUrl,()=>rejects(()=>c.parseOfferInput({...offer(),landingUrl})));
}
for(const quantity of [0,-1,1.1,Number.MAX_SAFE_INTEGER+1]) test('rejects invalid quantity '+quantity,()=>rejects(()=>c.parseOfferInput({...offer(),quantity})));
test('rejects negative catalog version',()=>rejects(()=>c.parseOfferInput({...offer(),catalogVersion:-1})));
test('missing catalog blocks offer',()=>assert.ok(c.offerReadiness(offer(),null,now).missing.length));
test('wrong catalog reference blocks offer',()=>assert.ok(c.offerReadiness({...offer(),catalogId:'other'},reference(),now).missing.length));
test('stale catalog version blocks offer',()=>assert.ok(c.offerReadiness({...offer(),catalogVersion:2},reference(),now).missing.length));
test('insufficient inventory blocks offer',()=>assert.ok(c.offerReadiness({...offer(),quantity:11},reference(),now).missing.length));
test('exact inventory boundary is accepted',()=>assert.equal(c.offerReadiness({...offer(),quantity:10},reference(),now).missing.length,0));
test('price approval is required',()=>assert.ok(c.offerReadiness({...offer(),priceApproved:false},reference(),now).missing.length));
test('expired catalog blocks dependent offer',()=>assert.ok(c.offerReadiness(offer(),reference(),Date.parse('2026-10-01T00:00:00Z')).missing.length));
test('offer negative contribution blocks readiness',()=>assert.ok(c.offerReadiness({...offer(),price:4000},reference(),now).missing.length));
test('offer unknown price has unknown contribution',()=>assert.equal(c.offerReadiness({...offer(),price:null},reference(),now).unitContribution,null));
test('missing need blocks readiness',()=>assert.ok(c.offerReadiness({...offer(),needId:''},reference(),now).missing.length));
test('invalid evaluation clock fails closed',()=>rejects(()=>c.catalogReadiness(catalog(),NaN)));
test('readiness does not mutate caller data',()=>{
  const input=offer(), ref=reference(), before=JSON.stringify([input,ref]); c.offerReadiness(input,ref,now); assert.equal(JSON.stringify([input,ref]),before);
});
test('large bundle amount overflow blocks offer readiness',()=>assert.ok(c.offerReadiness({...offer(),price:Number.MAX_SAFE_INTEGER,quantity:2},reference(),now).missing.length));
test('combined cost overflow cannot produce a contribution',()=>assert.equal(c.catalogReadiness({...catalog(),unitCost:Number.MAX_SAFE_INTEGER,variableCost:1},now).unitContribution,null));
test('invalid evaluation clock blocks offer',()=>rejects(()=>c.offerReadiness(offer(),reference(),Infinity)));
test('offer consent must be a boolean',()=>rejects(()=>c.parseOfferInput({...offer(),priceApproved:'true'})));
test('offer rejects missing numeric quantity represented as null',()=>rejects(()=>c.parseOfferInput({...offer(),quantity:null})));
test('empty optional draft fields keep conservative defaults',()=>{
  const input=c.parseOfferInput({quantity:'',catalogVersion:'',landingUrl:''}); assert.equal(input.quantity,1); assert.equal(input.catalogVersion,0);
});
test('invalid direct readiness input is rejected',()=>rejects(()=>c.catalogReadiness({...catalog(),stock:-1},now)));
test('unsafe direct offer readiness input is rejected',()=>rejects(()=>c.offerReadiness({...offer(),landingUrl:'javascript:alert(1)'},reference(),now)));
test('cost tax basis excluded does not infer a tax rate',()=>assert.equal(c.catalogReadiness({...catalog(),taxBasis:'excluded'},now).unitContribution,5000));
for(const validUntil of ['0999-01-01','2026-09-30T12:00:00+15:00','2026-09-30T12:00:00+14:01','2026-09-30T12:60:00Z']) {
  test('rejects invalid year or ISO offset '+validUntil,()=>rejects(()=>c.parseCatalogInput({...catalog(),validUntil})));
}
for(const field of ['fulfillment','refunds','title','sku']) {
  test('missing '+field+' blocks preparation',()=>assert.ok(c.catalogReadiness({...catalog(),[field]:''},now).missing.length));
}
for(const field of ['title','purchaseReason','landingUrl']) {
  test('missing offer '+field+' blocks preparation',()=>assert.ok(c.offerReadiness({...offer(),[field]:''},reference(),now).missing.length));
}
test('rejects whitespace evidence IDs',()=>rejects(()=>c.parseCatalogInput({...catalog(),factIds:['fact one']})));
test('rejects control characters in product text',()=>rejects(()=>c.parseCatalogInput({...catalog(),title:'a\u0000b'})));
test('deduplicates evidence without modifying original list',()=>{
  const input={...catalog(),factIds:['f1','f1']}; assert.equal(c.parseCatalogInput(input).factIds.length,1); assert.equal(input.factIds.length,2);
});
test('trims human-entered names',()=>assert.equal(c.parseCatalogInput({...catalog(),title:'  상품  '}).title,'상품'));
test('invalid URL syntax is rejected',()=>rejects(()=>c.parseOfferInput({...offer(),landingUrl:'not a url'})));
test('backslash URL normalization is rejected',()=>rejects(()=>c.parseOfferInput({...offer(),landingUrl:'https://example.com\\path'})));
test('direct customer email in product text is rejected',()=>rejects(()=>c.parseCatalogInput({...catalog(),title:'고객 person@example.com'})));
test('direct phone number in offer copy is rejected',()=>rejects(()=>c.parseOfferInput({...offer(),purchaseReason:'010-1234-5678 고객 요청'})));
test('shopping URL query is rejected instead of retaining identifiers',()=>rejects(()=>c.parseOfferInput({...offer(),landingUrl:'https://shop.example.com/p?id=1'})));
test('shopping URL fragment is rejected',()=>rejects(()=>c.parseOfferInput({...offer(),landingUrl:'https://shop.example.com/p#customer'})));
test('encoded personal email in URL path is rejected',()=>rejects(()=>c.parseOfferInput({...offer(),landingUrl:'https://shop.example.com/customer/person%40example.com'})));
test('malformed percent encoding in URL path is rejected',()=>rejects(()=>c.parseOfferInput({...offer(),landingUrl:'https://shop.example.com/p/%zz'})));
console.log(JSON.stringify({passed,failed:0,integration:'pure functions; no external calls'}));
