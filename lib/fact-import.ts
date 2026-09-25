import {ApiError,recordStatement,stamp,uid,type Actor} from './server';
import type {Brand,Campaign} from './agency';
import type {BrandResearch} from './archive';
import type {BriefDraft} from './brief';
import type {Store} from './store-marketing';
import {effectiveBrandFacts,type BrandFact} from './brand-facts';
import {canonicalFactKey,factLabel} from './fact-catalog';
import {krwAmounts} from './graders/ledger';

// 사실 원장 후보 가져오기: 브리프의 '확정 사실(사용자 직접 제공)' 표현·브리프 초안 사실 후보·지점 레코드 필드·브랜드 조사 주장을 확인 후보(candidate)로 한 번에 등록한다.
// 같은 범위에 같은 카탈로그 항목이 이미 있으면 건너뛰고 보고한다. 확정은 관리자가 원장에서 한다.
export type FactCandidateInput={key:string;value:string;source:string;storeId?:string};
export type FactImportSkip=FactCandidateInput&{label:string;reason:string};
export type LedgerCheckState='unverified'|'candidate'|'conflict'|'prohibited';
export type LedgerCheck={id:string;origin:'brand'|'store';storeId?:string;storeName?:string;field:string;key:string;label:string;claim:string;value:string;source:string;state:LedgerCheckState;ledgerValue?:string};
type LedgerInputs={brand:Brand;facts:BrandFact[];stores:Store[];research:BrandResearch[];campaigns:Campaign[];drafts:BriefDraft[]};

const briefMarker=/확정\s*사실\s*[(（]\s*사용자\s*직접\s*제공\s*[)）]\s*[:：]?\s*/g;
export function briefFactExpressions(text:string):string[]{
 return [...text.matchAll(briefMarker)].map(m=>text.slice(m.index!+m[0].length).split(/[.。](?=\s|$)|\n/)[0].trim().slice(0,1000)).filter(Boolean);
}
const keyPatterns:[string,RegExp][]=[
 ['hours',/\d{1,2}\s*:\s*\d{2}\s*[~\-–]\s*\d{1,2}\s*:\s*\d{2}|영업\s*시간/],
 ['menu_price',/\d[\d,]*\s*원|₩\s*\d/],
 ['opening_date',/오픈일|개점일|(\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}).{0,10}(오픈|개점)/],
 ['phone',/0\d{1,2}-\d{3,4}-\d{4}/],
 ['address',/[가-힣](시|도|구|군|읍|면|동|리|로|길)\s*\d+|\d+\s*(호|층)(?![가-힣])/],
];
// 가맹 금액 문장(트랙 R R1b): 가맹 문맥 표지가 있거나, 소비자와 겹치는 비용 낱말 뒤 금액이 100만원 이상일 때만이다. 메뉴 가격으로 분류하지 않는다.
// 소비자 문장('일회용컵 보증금 300원'·'베이킹 클래스 교육비 35,000원'·'멤버십 가입비 10,000원'·'로열티 카드 적립 시 …')의 분류는 이전과 같다.
const FRANCHISE_ANCHOR=/가맹\s?(?:비|금|가입비|보증금|교육비)|계약\s?이행\s?보증금|창업\s?(?:비용|자금)|총\s?투자|개설\s?비용|로열티\s?(?:월|매월|매출|\d)/;
const SHARED_COST=/가입비|교육비|보증금|인테리어\s?(?:비|비용|공사비)/;
export const isFranchiseMoney=(s:string)=>FRANCHISE_ANCHOR.test(s)||SHARED_COST.test(s)&&krwAmounts(s).some(v=>Number(v)>=1_000_000);
export function guessFactKey(value:string):string|undefined{return keyPatterns.find(([key,re])=>!(key==='menu_price'&&isFranchiseMoney(value))&&re.test(value))?.[0]}
// 카탈로그 항목을 추정할 수 없으면 문장 앞부분을 자유 항목으로 쓴다. 같은 문장은 다시 가져와도 같은 항목이 되어 건너뛴다.
const freeKey=(text:string)=>{const t=text.normalize('NFKC').replace(/\s+/g,' ').trim();return canonicalFactKey(t.length>40?t.slice(0,40)+'…':t)};
const placeholder=/^(미정|미확정|미확인|확인 필요|조사 필요|없음|-)$/;
const storeImportFields:[keyof Store,string][]=[['address','address'],['hours','hours'],['menu','menu_price'],['access','access'],['capacity','seating']];
const campaignText=(c:Campaign):[string,string][]=>[...(['title','goal','audience','channels','stores','products','constraints','sources'] as const).map(k=>[k,String(c[k]??'')] as [string,string]),...Object.entries(c.plan||{}).map(([k,v])=>['plan.'+k,String(v??'')] as [string,string])];

// 가져올 순서: 사용자가 직접 적은 브리프 표현 → 브리프 초안 후보 → 지점 레코드 → 조사 주장. 같은 항목이면 앞선 것을 남긴다.
function foundCandidates(d:LedgerInputs,storeId?:string):FactCandidateInput[]{
 const found:FactCandidateInput[]=[];
 for(const c of d.campaigns)for(const [field,text] of campaignText(c))briefFactExpressions(text).forEach(value=>found.push({key:canonicalFactKey(guessFactKey(value)??freeKey(value)),value,storeId:c.storeId||undefined,source:`캠페인 '${String(c.title??'').slice(0,100)}' (${c.id}) v${c.version} · ${field} · 확정 사실(사용자 직접 제공)`}));
 for(const draft of d.drafts)if(draft.status==='completed')(draft.result?.factCandidates||[]).forEach((f,i)=>{if(f?.key?.trim()&&f?.value?.trim())found.push({key:canonicalFactKey(f.key),value:f.value.trim().slice(0,5000),storeId:draft.input.storeId||undefined,source:`브리프 초안 ${draft.id} · factCandidates[${i}] · 사용자 브리프`})});
 for(const s of d.stores)for(const [field,key] of storeImportFields){const value=String(s[field]??'').trim();if(value&&!placeholder.test(value))found.push({key,value:value.slice(0,5000),storeId:s.id,source:`지점 '${s.name}' (${s.id}) v${s.version} · store.${field}`})}
 for(const r of d.research)if(r.status==='completed')(r.report?.review?.claims||[]).forEach((c,i)=>{const claim=typeof c?.claim==='string'?c.claim.trim():'';if(claim)found.push({key:freeKey(claim),value:claim.slice(0,5000),storeId:r.storeId||undefined,source:`브랜드 조사 ${r.id} (${String(r.createdAt).slice(0,10)}) · review.claims[${i}] · 근거 자료 ${(c.sourceIds||[]).join(', ')||'없음'}`.slice(0,3000)})});
 // 지점 범위를 주지 않으면 브랜드 공통 항목만, 주면 브랜드 공통과 그 지점 항목을 가져온다(캠페인이 받는 범위와 같다).
 // 저장 한도는 saveBrandFact와 같다(항목 120·내용 5,000·근거 3,000자). 그래야 관리자가 후보를 그대로 확정할 수 있다(SEC-5).
 return found.filter(f=>!f.storeId||f.storeId===storeId).map(f=>({...f,key:f.key.slice(0,120),value:f.value.slice(0,5000),source:f.source.slice(0,3000)}));
}
const scopeKey=(storeId:string|undefined,key:string)=>(storeId||'')+'\u0000'+key;
const statusLabel={candidate:'확인 후보',confirmed:'확인 사실',rejected:'사용 거절'};
export function planImport(found:FactCandidateInput[],existing:BrandFact[]){
 const ledger=new Map(existing.map(f=>[scopeKey(f.storeId,canonicalFactKey(f.key)),f] as const)),planned=new Set<string>();
 const candidates:FactCandidateInput[]=[],skipped:FactImportSkip[]=[];
 for(const c of found){
  const k=scopeKey(c.storeId,c.key),old=ledger.get(k);
  if(old||planned.has(k)){skipped.push({...c,label:factLabel(c.key),reason:old?`원장에 같은 항목(${statusLabel[old.status]})이 있습니다.`:'같은 항목을 이번 가져오기에서 먼저 가져왔습니다.'});continue}
  planned.add(k);candidates.push(c);
 }
 return {candidates,skipped};
}

async function rows<T>(db:D1Database,owner:string,kind:string,parentId?:string){
 const q=parentId===undefined?db.prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC').bind(owner,kind):db.prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC').bind(owner,kind,parentId);
 return (await q.all<{data:string}>()).results.map(r=>JSON.parse(r.data) as T);
}
async function one<T>(db:D1Database,owner:string,kind:string,id:string){
 const row=await db.prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:${kind}:${id}`,owner,kind).first<{data:string}>();
 return row?JSON.parse(row.data) as T:null;
}
async function ledgerInputs(db:D1Database,owner:string,brandId:string,storeId?:string):Promise<LedgerInputs>{
 const brand=await one<Brand>(db,owner,'brand',brandId);if(!brand)throw new ApiError(404,'항목을 찾을 수 없습니다.');
 if(storeId){const store=await one<Store>(db,owner,'store',storeId);if(!store||store.brandId!==brandId)throw new ApiError(404,'해당 브랜드의 지점이 아닙니다.')}
 const [facts,stores,research,campaigns,drafts]=await Promise.all([rows<BrandFact>(db,owner,'brand_fact',brandId),rows<Store>(db,owner,'store',brandId),rows<BrandResearch>(db,owner,'brand_research',brandId),rows<Campaign>(db,owner,'campaign'),rows<BriefDraft>(db,owner,'brief_draft')]);
 return {brand,facts,stores:stores.filter(s=>s.status!=='archived'),research,campaigns:campaigns.filter(c=>c.brandId===brandId),drafts:drafts.filter(d=>d.input?.brandId===brandId)};
}
function readinessOf(d:LedgerInputs,brandId:string,storeId?:string){
 return {confirmed:effectiveBrandFacts(d.facts,brandId,storeId).length,candidates:d.facts.filter(f=>(!f.storeId||f.storeId===storeId)&&f.status==='candidate').length,importable:planImport(foundCandidates(d,storeId),d.facts).candidates.length};
}
// 제작에 쓸 확정 사실·검토할 후보·가져올 수 있는 후보 수. storeId가 없으면 브랜드 공통 범위다.
export async function factReadiness(db:D1Database,owner:string,brandId:string,storeId?:string):Promise<{confirmed:number;candidates:number;importable:number}>{
 return readinessOf(await ledgerInputs(db,owner,brandId,storeId),brandId,storeId);
}
export async function importFactCandidates(db:D1Database,owner:string,brandId:string,storeId:string|undefined,who:Pick<Actor,'id'|'email'>){
 const d=await ledgerInputs(db,owner,brandId,storeId),{candidates,skipped}=planImport(foundCandidates(d,storeId),d.facts);
 const room=Math.max(0,200-d.facts.length),accepted=candidates.slice(0,room),now=stamp();
 const limited=candidates.slice(room).map(c=>({...c,label:factLabel(c.key),reason:'브랜드 사실 보관 한도 200개에 도달했습니다.'}));
 if(accepted.length)await db.batch(accepted.map(c=>{const id=uid();return recordStatement(owner,'brand_fact',id,{id,brandId,...(c.storeId?{storeId:c.storeId}:{}),key:c.key,value:c.value,status:'candidate',source:c.source,verifiedAt:'',validUntil:'',version:1,updatedAt:now,importedBy:{id:who.id,email:who.email}},brandId)}));
 return {imported:accepted.length,skipped:[...skipped,...limited]};
}

// 원장 점검: 브랜드 소개·지점 필드의 핵심 주장(조리 방식·가격·주소·영업시간)이 원장의 확정 사실과 다르거나 원장에 없으면 표시한다.
const coreClaims:[string,RegExp][]=[
 ['cooking_method',/화덕|장작|참나무|숯불|직화|wood[\s-]*fired|저온\s*숙성/gi],
 ['menu_price',/\d+(?:\.\d+)?\s*만\s*원|\d[\d,]*\s*원|₩\s*[\d,]+/g],
 // 앞부분 한글 길이를 제한해 공백 없는 긴 한글에서 되돌림이 제곱으로 늘지 않게 한다(SEC-4).
 ['address',/[가-힣]{1,20}(?:시|구|군|읍|면|동|로|길)\s*\d+(?:-\d+)?(?:\s*[A-Za-z가-힣]동)?(?:\s*\d+\s*호)?/g],
];
const norm=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s,·~–\-.]/g,'');
function judge(scoped:BrandFact[],confirmed:BrandFact[],key:string,terms:string[],exact:boolean):Pick<LedgerCheck,'state'|'ledgerValue'>|null{
 const ledger=confirmed.find(f=>canonicalFactKey(f.key)===key),has=(v:string)=>terms.some(t=>norm(v).includes(norm(t)));
 if(ledger)return terms.every(t=>exact?norm(ledger.value)===norm(t):norm(ledger.value).includes(norm(t)))?null:{state:'conflict',ledgerValue:ledger.value};
 if(scoped.some(f=>f.status==='rejected'&&has(f.value)))return {state:'prohibited'};
 if(scoped.some(f=>f.status!=='rejected'&&(canonicalFactKey(f.key)===key||has(f.value))))return {state:'candidate'};
 return {state:'unverified'};
}
export function ledgerChecks(brand:Brand,stores:Store[],facts:BrandFact[]):LedgerCheck[]{
 const checks:LedgerCheck[]=[],brandFacts=facts.filter(f=>f.brandId===brand.id&&!f.storeId),brandConfirmed=effectiveBrandFacts(facts,brand.id);
 for(const field of ['description','knowledge'] as const)String(brand[field]||'').split(/(?<=[.!?。])\s+|\n+/).map(s=>s.trim()).filter(Boolean).forEach((sentence,i)=>{
  for(const [key,re] of coreClaims){const terms=key==='menu_price'&&isFranchiseMoney(sentence)?[]:[...new Set(sentence.match(re)||[])];const verdict=terms.length?judge(brandFacts,brandConfirmed,key,terms,false):null;if(verdict)checks.push({id:`brand:${field}:${i}:${key}`,origin:'brand',field,key,label:factLabel(key),claim:sentence.slice(0,1000),value:terms.join(', '),source:`브랜드 소개 (brand.${field})`,...verdict})}
 });
 for(const s of stores){
  const scoped=facts.filter(f=>f.brandId===brand.id&&(!f.storeId||f.storeId===s.id)),confirmed=effectiveBrandFacts(facts,brand.id,s.id),base={origin:'store' as const,storeId:s.id,storeName:s.name,source:`지점 '${s.name}' (${s.id}) v${s.version}`};
  for(const field of ['address','hours'] as const){const value=String(s[field]||'').trim();const verdict=value&&!placeholder.test(value)?judge(scoped,confirmed,field,[value],true):null;if(verdict)checks.push({...base,id:`store:${s.id}:${field}`,field,key:field,label:factLabel(field),claim:value,value,source:base.source+' · store.'+field,...verdict})}
  const menu=String(s.menu||'').trim();
  // 지점 메뉴는 줄 단위로 가맹 금액 줄을 뺀 뒤 가격을 찾는다(가맹 금액 줄이 없으면 이전과 같은 본문).
  for(const [key,re] of coreClaims.slice(0,2)){const text=key==='menu_price'?menu.split('\n').filter(l=>!isFranchiseMoney(l)).join('\n'):menu;const terms=[...new Set(text.match(re)||[])];const verdict=terms.length?judge(scoped,confirmed,key,terms,false):null;if(verdict)checks.push({...base,id:`store:${s.id}:menu:${key}`,field:'menu',key,label:factLabel(key),claim:menu.slice(0,1000),value:terms.join(', '),source:base.source+' · store.menu',...verdict})}
 }
 return checks;
}
// 사실 목록 화면용: 준비 상태·원장 점검·지점 목록. storeId가 있으면 그 지점만 점검한다.
export async function factOverview(db:D1Database,owner:string,brandId:string,storeId?:string){
 const d=await ledgerInputs(db,owner,brandId,storeId);
 return {readiness:readinessOf(d,brandId,storeId),checks:ledgerChecks(d.brand,d.stores.filter(s=>!storeId||s.id===storeId),d.facts),stores:d.stores.map(s=>({id:s.id,name:s.name}))};
}
