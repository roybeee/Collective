// A8-1 사실 지식 팩 순수 모듈 회귀(docs/CUSTOMER-REPORT.ko.md 2절·5절 RED 목록): effectiveBrandFacts만 담기, 지점 사실이 브랜드 사실을 대신하기,
// 가맹 항목(카탈로그 key·별칭·sourceRef·cost) 제외와 건수, 후보·만료·근거 없음 건수, confirmedBy.email 없음, 세 형식의 사실 id·판 집합 일치,
// 출처 가림(확정 값 허용), CSV 수식 방지, 바이트 동일. 근거: mocked(순수 함수, 외부 호출 0회).
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let calls=0;
const rt=testRuntime(async()=>{calls++;throw new Error('외부 호출 금지')});
const fp=await rt.load('lib/fact-pack.ts'),bf=await rt.load('lib/brand-facts.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));

const now=Date.parse('2026-09-20T03:00:00.000Z'),EMAIL='owner.secret@example.com',PHONE='010-2345-6789';
const day=n=>new Date(now+n*86400000).toISOString();
const by={confirmedBy:{id:'u1',email:EMAIL},confirmedAt:day(-3)};
const fact=(id,over={})=>({id,brandId:'b1',key:'signature_menu',value:'떡볶이',status:'confirmed',source:'점주 확인',verifiedAt:day(-5),validUntil:day(60),version:1,updatedAt:day(-3),...by,...over});
const facts=[
 fact('f01',{key:'hours',value:'10:00~21:00'}),
 fact('f02',{storeId:'s1',key:'영업시간',value:'11:00~22:00',version:3}),
 fact('f03',{key:'menu_price',value:'떡볶이 5,000원',source:`점주 ${PHONE} 통화 확인`,validUntil:day(10)}),
 fact('f04',{key:'parking',status:'candidate',source:'',verifiedAt:'',validUntil:''}),
 fact('f05',{key:'delivery',validUntil:day(-1)}),
 fact('f06',{key:'seating',source:'  '}),
 fact('f07',{key:'promotion',value:'업계 1위',status:'rejected',source:'대표 거절'}),
 fact('f08',{key:'franchise_fee',value:'500만원',cost:{storeType:'일반',includes:[],excludes:[],areaM2:null}}),
 fact('f09',{key:'가입비',value:'300만원'}),
 fact('f10',{key:'official_account',value:'@oda',sourceRef:{disclosureVersionId:'dv1',fiscalYear:2025,page:3}}),
 fact('f11',{brandId:'b2',key:'hours',value:'다른 브랜드'}),
 fact('f12',{storeId:'s2',key:'hours',value:'다른 지점'}),
 fact('f13',{key:'공헌이익',value:'월 900만원'}),
 fact('f14',{key:'monthly_sales',value:'3,000만원',status:'rejected'}),
 fact('f15',{storeId:'s1',key:'address',value:'서울 동대문구 이문로 12',source:'사업자등록증 서울 동대문구 이문로 12'}),
 fact('f16',{key:'cooking_method',value:'=1+1 직접 조리',source:'@매장 확인'}),
 fact('f17',{key:'interior_cost',status:'candidate',source:'',verifiedAt:'',validUntil:''}),
];
const scope={brandId:'b1',brandName:'오다',storeId:'s1',storeName:'오다 이문점',storeAddress:'서울 동대문구 이문로 12'};
const build=list=>fp.buildFactPack({scope,now,...fp.factPackInput(list,'b1','s1',now)});
const pack=plain(build(facts)),json=JSON.stringify(pack),md=fp.factPackMarkdown(pack),csv=fp.factPackCsv(pack);
const idsOf=list=>list.map(f=>f.factId).sort().join();

check('payload carries the schema id and the as-of instant',pack.schema==='collective.fact-pack.v1'&&pack.asOf==='2026-09-20T03:00:00.000Z');
// ── 1) effectiveBrandFacts만, 지점 사실이 같은 항목의 브랜드 사실을 대신한다 ──
const franchise=new Set(['f08','f09','f10','f13']);
const effective=plain(bf.effectiveBrandFacts(facts,'b1','s1',now)).map(f=>f.id).filter(id=>!franchise.has(id)).sort().join();
check('fact pack = effectiveBrandFacts only (minus franchise items)',idsOf(pack.facts)===effective&&idsOf(pack.facts)==='f02,f03,f15,f16');
check('store fact overrides brand fact of the same catalog item',pack.facts.some(f=>f.factId==='f02'&&f.scope==='store'&&f.key==='hours')&&!json.includes('"f01"'));
check('another brand and another store are not in the pack or the counts',!json.includes('"f11"')&&!json.includes('"f12"')&&!json.includes('다른 브랜드')&&!json.includes('다른 지점'));
check('each fact carries scope, source, verified date, valid until, version and confirmed time',pack.facts.every(f=>['brand','store'].includes(f.scope)&&typeof f.source==='string'&&f.verifiedAt&&f.validUntil&&Number.isInteger(f.version)&&'confirmedAt' in f)&&pack.facts.find(f=>f.factId==='f02').version===3);
check('facts expiring within 14 days carry expiresInDays, others do not',pack.facts.find(f=>f.factId==='f03').expiresInDays===10&&!('expiresInDays' in pack.facts.find(f=>f.factId==='f02'))&&pack.counts.expiringSoon===1);
check('labels come from the fact catalog',pack.facts.find(f=>f.factId==='f02').label==='영업시간'&&pack.facts.find(f=>f.factId==='f03').label==='메뉴 가격');

// ── 2) 거절 사실은 별도 절, 후보·만료·근거 없음·가맹은 건수만 ──
check('rejected facts (ad-prohibited phrases) are a separate section',idsOf(pack.rejected)==='f07'&&pack.rejected[0].value==='업계 1위'&&pack.counts.rejected===1);
check('candidate, expired and unsupported facts are counted, not listed',JSON.stringify(pack.counts.excluded)===JSON.stringify({candidate:1,expired:1,unsupported:1,franchise:6})&&!json.includes('"f04"')&&!json.includes('"f05"')&&!json.includes('"f06"'));
check('franchise catalog keys, franchise aliases, sourceRef/cost facts are excluded and counted',['f08','f09','f10','f13','f14','f17'].every(id=>!json.includes(`"${id}"`))&&!json.includes('500만원')&&!json.includes('월 900만원')&&!json.includes('3,000만원')&&!json.includes('disclosureVersionId')&&!json.includes('areaM2'));
check('counts.effective equals the listed facts',pack.counts.effective===pack.facts.length);
const direct=plain(fp.buildFactPack({scope,now,confirmed:facts.filter(f=>['f02','f08','f10'].includes(f.id)),rejected:facts.filter(f=>['f07','f14'].includes(f.id)),excluded:{candidate:0,expired:0,unsupported:0,franchise:0}}));
check('the builder itself drops franchise items passed in as confirmed or rejected and counts them',idsOf(direct.facts)==='f02'&&idsOf(direct.rejected)==='f07'&&direct.counts.excluded.franchise===3);

// ── 3) confirmedBy.email은 어디에도 없다 ──
check('confirmedBy email never appears',[json,md,csv].every(t=>!t.includes(EMAIL)&&!t.includes('confirmedBy')&&!t.includes('"u1"')));

// ── 4) 가림: 출처는 가리고 확정 사실 값·지점 주소는 둔다 ──
check('fact sources are masked and recorded by field, kind and count',pack.facts.find(f=>f.factId==='f03').source==='점주 [전화번호] 통화 확인'&&pack.masking.some(m=>m.kind==='phone'&&m.count===1&&m.field.startsWith('facts.'))&&[json,md,csv].every(t=>!t.includes(PHONE)));
check('confirmed values and the store address stay unmasked',pack.facts.find(f=>f.factId==='f15').source==='사업자등록증 서울 동대문구 이문로 12'&&pack.facts.find(f=>f.factId==='f15').value==='서울 동대문구 이문로 12');

// ── 5) 세 형식의 factId·version 집합이 같다 ──
const set=pairs=>[...new Set(pairs)].sort().join();
const jsonIds=set([...pack.facts,...pack.rejected].map(f=>`${f.factId}@${f.version}`));
const mdIds=set([...md.matchAll(/\|\s*(f\d+)\s*\|\s*(\d+)\s*\|/g)].map(m=>`${m[1]}@${m[2]}`));
const parseCsv=raw=>{const text=raw.replace(/^\uFEFF/,''),rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c}else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else if(c!=='\r')cell+=c}if(cell||row.length){row.push(cell);rows.push(row)}return rows};
const rows=parseCsv(csv),head=rows[0];
const csvIds=set(rows.slice(1).map(r=>`${r[head.indexOf('factId')]}@${r[head.indexOf('version')]}`));
check('json, md, csv carry the same fact ids and versions',jsonIds===mdIds&&jsonIds===csvIds&&jsonIds==='f02@3,f03@1,f07@1,f15@1,f16@1');
check('csv rows are one per fact with the section column',rows.slice(1).every(r=>r.length===head.length&&['confirmed','rejected'].includes(r[head.indexOf('section')])));

// ── 6) CSV 수식 방지, 결정론 ──
const cells=rows.flat();
check('csv cells starting with = + - @ (and tab) are prefixed',cells.includes("'=1+1 직접 조리")&&cells.includes("'@매장 확인")&&cells.every(c=>!/^[=+@\t\r]/.test(c)&&(!c.startsWith('-')||/^-\d+$/.test(c))));
check('csv escapes quotes, commas and newlines',fp.csvCell('a,"b"\nc')==='"a,""b""\nc"'&&fp.csvCell(null)===''&&fp.csvCell(-3)==='-3'&&fp.csvCell('-3')==="'-3"&&fp.csvCell('\tx')==="'\tx");
const again=build(facts);
check('same input gives byte-identical JSON, markdown and csv',JSON.stringify(again)===json&&fp.factPackMarkdown(again)===md&&fp.factPackCsv(again)===csv);
check('input order does not change the bytes',JSON.stringify(build([...facts].reverse()))===json);
check('markdown states the pack is confirmed facts only and franchise items are left out of v1',md.includes('확정 사실')&&md.includes('가맹')&&md.includes('광고 금지'));
const brandOnly=plain(fp.buildFactPack({scope:{brandId:'b1',brandName:'오다'},now,...fp.factPackInput(facts,'b1',undefined,now)}));
check('a brand pack without a store holds brand facts only',brandOnly.scope.storeId===null&&brandOnly.facts.every(f=>f.scope==='brand')&&brandOnly.facts.some(f=>f.factId==='f01'));
check('no model or external call was made',calls===0);

console.log(JSON.stringify({passed:passed.length}));
