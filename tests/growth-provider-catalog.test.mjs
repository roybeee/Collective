import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('external forbidden')});
const {catalogCeiling,parseCatalogSnapshot}=await load('lib/growth-provider-catalog.ts');
const at=new Date().toISOString(),snapshot={tenantId:'t',storeId:'s',productId:'mpd::1',state:'active',title:'상품',price:100,sellable:4,unit:'piece',observedAt:at};
let passed=0;const check=(v,m)=>{assert.ok(v,m);passed++};
check(parseCatalogSnapshot(snapshot).sellable===4,'valid provider sellable');
check(catalogCeiling(10,snapshot,0,Date.now())===4,'provider ceiling limits local availability');
check(catalogCeiling(2,snapshot,0,Date.now())===2,'local reservations preserved by minimum');
check(catalogCeiling(7,snapshot,3,Date.now())===1,'outstanding local obligations consume provider sellable');
check(catalogCeiling(5,snapshot,5,Date.now())===0,'reservations beyond sellable leave zero capacity');
for(const reserved of [null,undefined,-1,0.5,Number.NaN]){assert.throws(()=>catalogCeiling(7,snapshot,reserved,Date.now()));passed++;}
for(const s of [{...snapshot,state:'unknown',sellable:null},{...snapshot,state:'deleted',sellable:null},{...snapshot,observedAt:'2000-01-01T00:00:00.000Z'}]){assert.throws(()=>catalogCeiling(10,s,0,Date.now()));passed++;}
for(const s of [{...snapshot,sellable:-1},{...snapshot,sellable:1.5},{...snapshot,price:'100'},{...snapshot,unit:'pack'}]){assert.throws(()=>parseCatalogSnapshot(s));passed++;}
console.log(JSON.stringify({passed}));
