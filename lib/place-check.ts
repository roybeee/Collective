import {effectiveBrandFacts,type BrandFact} from './brand-facts';
import {canonicalFactKey,factLabel} from './fact-catalog';
import {krwAmounts} from './graders/ledger';
import type {StoreTask} from './store-marketing';

// 플레이스 정보 대조(A6-2): 관리자가 수동으로 옮겨 적은 플랫폼 정보(스냅샷)를 확정 사실과 결정론으로 대조한다. 순수 모듈이다(모델 호출·네트워크 0, URL을 열지 않는다).
// 저장·스위치·권한은 lib/place-check-server.ts, 규칙과 근거는 docs/PLACE-CHECK.ko.md. 정본은 확정 사실이다.
// 공식 호스트는 lib/archive-research.ts officialHosts의 네이버 플레이스·지도 호스트와 같다(tests/place-check.test.mjs가 대조한다).
export const PLACE_PLATFORMS={naver_place:{label:'네이버 플레이스',hosts:['place.naver.com','map.naver.com'],channel:'naver_place'}} as const;
export type PlacePlatform=keyof typeof PLACE_PLATFORMS;
export const PLACE_FIELDS=['address','hours','closed_days','phone','menu_price'] as const;
export type PlaceField=typeof PLACE_FIELDS[number];
// 항목당 글자 상한과 이력 판 수. 스냅샷 입력은 다섯 항목뿐이다.
export const PLACE_LIMITS={url:500,history:10,field:{address:200,hours:300,closed_days:100,phone:40,menu_price:1000}} as const;
export type PlaceCheckState='match'|'conflict'|'place_missing'|'fact_missing'|'both_missing';
export type PlaceCheckResult={field:PlaceField;state:PlaceCheckState;placeValue?:string;factId?:string;factVersion?:number;factValue?:string};
export type PlaceActor={id:string;role:'owner'|'admin'|'member'};
export type PlaceSnapshotVersion={id:string;storeId:string;brandId:string;platform:PlacePlatform;url:string;checkedAt:string;checkedBy:PlaceActor;fields:Record<PlaceField,string>;result:PlaceCheckResult[];version:number;updatedAt:string};
export type PlaceSnapshot=PlaceSnapshotVersion&{history:PlaceSnapshotVersion[]};
export type PlaceTaskSource={kind:'place_check';platform:PlacePlatform;field:PlaceField;snapshotVersion:number;factId?:string;factVersion?:number;placeValue?:string;factValue?:string};

// 플레이스 URL: https이고 호스트가 그 플랫폼의 공식 호스트(또는 하위 호스트)일 때만 받는다. 아니면 null이다.
export function placeUrl(platform:PlacePlatform,raw:unknown):string|null{
 if(typeof raw!=='string'||!raw.trim()||raw.length>PLACE_LIMITS.url)return null;
 try{
  const u=new URL(raw.trim()),hosts:readonly string[]=PLACE_PLATFORMS[platform].hosts;
  if(u.protocol!=='https:'||u.username||u.password||!hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return null;
  return u.href;
 }catch{return null}
}

const compact=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
const sameSet=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every(x=>b.includes(x));
const uniqSorted=(xs:string[])=>[...new Set(xs)].sort();

// 영업시간: 시각 구간('11:00-21:00', '11시~21시', '오전 11시 ~ 오후 9시', '11시 30분부터 21시까지')만 뽑아 'HH:MM-HH:MM' 집합으로 비교한다. 요일·구분자 표기는 보지 않는다.
const TIME='(?:(오전|오후)\\s*)?(\\d{1,2})\\s*(?::\\s*(\\d{2})|시(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?)';
const RANGE=new RegExp(`${TIME}\\s*(?:[~∼〜～–—-]|부터)\\s*${TIME}`,'g');
const clock=(ampm:string|undefined,h:string,colon:string|undefined,min:string|undefined,half:string|undefined)=>{
 const hour=Number(h)+(ampm==='오후'&&Number(h)<12?12:0)-(ampm==='오전'&&Number(h)===12?12:0),minute=Number(colon??min??(half?30:0));
 return hour<=30&&minute<60?`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`:null;
};
export function hoursRanges(s:string):string[]{
 return uniqSorted([...s.normalize('NFKC').matchAll(RANGE)].flatMap(m=>{const a=clock(m[1],m[2],m[3],m[4],m[5]),b=clock(m[6],m[7],m[8],m[9],m[10]);return a&&b?[`${a}-${b}`]:[]}));
}
// 둘 중 하나라도 구간을 읽지 못하면 공백·기호를 뺀 원문이 같을 때만 일치다.
export function sameHours(place:string,fact:string){
 const a=hoursRanges(place),b=hoursRanges(fact);
 return a.length&&b.length?sameSet(a,b):compact(place)===compact(fact);
}

// 휴무: 요일 집합. '연중무휴'·'휴무 없음'은 빈 집합, '평일'은 월~금, '주말'은 토·일이다. 요일 글자는 낱말 안('매월'·'공휴일'·'요일')이면 요일이 아니다.
const DAYS='월화수목금토일',NO_HOLIDAY=/연중\s*무휴|무휴|휴무\s*(?:일\s*)?없|없음/;
const hangul=(c:string|undefined)=>!!c&&c>='가'&&c<='힣';
export function closedDaySet(s:string):string[]|null{
 const t=s.normalize('NFKC'),out:string[]=[...(/평일/.test(t)?[...'월화수목금']:[]),...(/주말/.test(t)?['토','일']:[])];
 [...t].forEach((c,i,all)=>{
  if(!DAYS.includes(c))return;
  const prev=all[i-1],next=all[i+1];
  if(hangul(prev)&&!DAYS.includes(prev)&&prev!=='주')return;
  if(hangul(next)&&!DAYS.includes(next)&&next!=='요')return;
  out.push(c);
 });
 for(const m of t.matchAll(/([월화수목금토일])(?:요일)?\s*[~∼〜～–-]\s*([월화수목금토일])/g)){const a=DAYS.indexOf(m[1]),b=DAYS.indexOf(m[2]);if(a<b)out.push(...DAYS.slice(a,b+1))}
 if(out.length)return uniqSorted(out);
 return NO_HOLIDAY.test(t)?[]:null;
}
export function sameClosedDays(place:string,fact:string){
 const a=closedDaySet(place),b=closedDaySet(fact);
 return a&&b?sameSet(a,b):compact(place)===compact(fact);
}

// 전화: 번호마다 숫자만 남겨 집합으로 비교한다. 국가 번호 82는 0으로 바꾼다.
const phoneNumbers=(s:string)=>uniqSorted((s.normalize('NFKC').match(/\+?\d[\d\s\-().]{5,}\d/g)??[]).map(p=>p.replace(/\D/g,'')).map(d=>d.startsWith('82')&&d.length>=10?'0'+d.slice(2):d));
export function samePhone(place:string,fact:string){
 const a=phoneNumbers(place),b=phoneNumbers(fact);
 return a.length&&b.length?sameSet(a,b):compact(place)===compact(fact);
}

// 주소: 낱말(한글·숫자 경계와 기호에서 나눔)로 정규화한 뒤 짧은 쪽이 긴 쪽에 연속으로 들어 있으면 일치다. 짧은 쪽에 번지·건물 번호(숫자)가 없으면 일치로 보지 않는다.
const CITY=/^(서울|부산|대구|인천|광주|대전|울산|세종)(?:특별시|광역시|특별자치시|시)$/,PROVINCE=/^(경기|강원|제주)(?:특별자치도|도)$/;
const addressTokens=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/(\d)(\D)/g,'$1 $2').replace(/(\D)(\d)/g,'$1 $2').split(/[\s\p{P}\p{S}]+/u).filter(Boolean).map(t=>t.replace(CITY,'$1').replace(PROVINCE,'$1'));
const containsRun=(long:string[],short:string[])=>long.some((_,i)=>short.every((t,j)=>long[i+j]===t));
export function sameAddress(place:string,fact:string){
 const a=addressTokens(place),b=addressTokens(fact),[short,long]=a.length<=b.length?[a,b]:[b,a];
 return short.length>0&&short.some(t=>/^\d+$/.test(t))&&containsRun(long,short);
}

// 메뉴 가격: 플레이스에 적힌 금액 집합이 확정 사실 금액(여러 사실의 합집합)의 부분집합이어야 한다. 메뉴 이름은 대조하지 않는다.
export const placeAmounts=(s:string)=>uniqSorted(krwAmounts(s.normalize('NFKC')));
export function pricesWithin(place:string,factValues:readonly string[]){
 const a=placeAmounts(place),confirmed=new Set(factValues.flatMap(placeAmounts));
 return a.length>0&&a.every(x=>confirmed.has(x));
}

// 항목이 플레이스에 있는가: 메뉴 가격은 금액이 하나라도 있어야 하고, 나머지는 빈칸이 아니면 있다.
const present=(field:PlaceField,value:string)=>field==='menu_price'?placeAmounts(value).length>0:!!value.trim();
const matches=(field:PlaceField,place:string,facts:BrandFact[])=>field==='menu_price'?pricesWithin(place,facts.map(f=>f.value)):facts.some(f=>field==='hours'?sameHours(place,f.value):field==='closed_days'?sameClosedDays(place,f.value):field==='phone'?samePhone(place,f.value):sameAddress(place,f.value));
const factRef=(facts:BrandFact[],field:PlaceField)=>({factId:facts[0].id,factVersion:facts[0].version,factValue:field==='menu_price'?facts.map(f=>f.value).join(' / '):facts[0].value});

// 대조: 다섯 항목 모두 고정 순서로 결과를 낸다. 유효 사실은 effectiveBrandFacts(확정·근거·유효 기간·지점 우선)를 그대로 쓰고 지점 사실을 앞에 둔다.
export function compareSnapshot({brandId,storeId,fields,facts,now=Date.now()}:{brandId:string;storeId:string;fields:Partial<Record<PlaceField,string>>;facts:BrandFact[];now?:number}):PlaceCheckResult[]{
 const effective=effectiveBrandFacts(facts,brandId,storeId,now);
 return PLACE_FIELDS.map(field=>{
  const place=(fields[field]??'').trim(),own=effective.filter(f=>canonicalFactKey(f.key)===field),ordered=[...own.filter(f=>!!f.storeId),...own.filter(f=>!f.storeId)];
  const has=present(field,place);
  if(!ordered.length)return has?{field,state:'fact_missing' as const}:{field,state:'both_missing' as const};
  if(!has)return {field,state:'place_missing' as const,...(place?{placeValue:place}:{}),...factRef(ordered,field)};
  if(!matches(field,place,ordered))return {field,state:'conflict' as const,placeValue:place,...factRef(ordered,field)};
  const hit=field==='menu_price'?ordered:ordered.filter(f=>matches(field,place,[f]));
  return {field,state:'match' as const,placeValue:place,...factRef(hit,field)};
 });
}

// 플레이스 할 일. id는 place:<지점>:<플랫폼>:<항목>이고 reportId는 ''라서 보고서 할 일(보고서 id-순번)과 겹치지 않는다.
export const placeTaskId=(storeId:string,platform:PlacePlatform,field:PlaceField)=>`place:${storeId}:${platform}:${field}`;
export const isPlaceTask=(t:Pick<StoreTask,'id'|'source'>)=>t.source?.kind==='place_check'&&t.id.startsWith('place:');
const josa=(word:string)=>{const c=word.charCodeAt(word.length-1)-0xac00;return c>=0&&c<11172&&c%28?'이':'가'};
export function placeTaskTitle(platform:PlacePlatform,field:PlaceField,state:'conflict'|'place_missing'){
 const name=PLACE_PLATFORMS[platform].label,label=factLabel(field);
 return state==='conflict'?`${name} ${label}${josa(label)} 확정 사실과 다릅니다`:`${name}에 ${label} 정보가 비어 있습니다`;
}
export const recheckEvidence=(snapshotVersion:number)=>`재대조 일치(스냅샷 v${snapshotVersion})`;
const sourceOf=(s:Pick<PlaceSnapshot,'platform'|'version'>,r:PlaceCheckResult):PlaceTaskSource=>({kind:'place_check',platform:s.platform,field:r.field,snapshotVersion:s.version,
 ...(r.factId?{factId:r.factId,factVersion:r.factVersion}:{}),...(r.placeValue!==undefined?{placeValue:r.placeValue}:{}),...(r.factValue!==undefined?{factValue:r.factValue}:{})});

// 할 일 계획: conflict·place_missing은 열고(이미 있으면 새 판으로 갱신, 끝난 것은 다시 연다), match는 열린 할 일을 닫는다. 그 밖(fact_missing·both_missing)은 그대로 둔다.
// closeOnly(사실 저장 뒤 재대조)는 닫기만 한다. note는 닫는 근거 뒤에 붙인다. 바뀐 할 일만 돌려준다.
export function planPlaceTasks({snapshot,result,tasks,now,closeOnly=false,note=''}:{snapshot:Pick<PlaceSnapshot,'storeId'|'platform'|'version'>;result:PlaceCheckResult[];tasks:StoreTask[];now:string;closeOnly?:boolean;note?:string}):StoreTask[]{
 const byId=new Map(tasks.map(t=>[t.id,t] as const));
 return result.flatMap((r):StoreTask[]=>{
  const id=placeTaskId(snapshot.storeId,snapshot.platform,r.field),old=byId.get(id),source=sourceOf(snapshot,r);
  if(r.state==='match')return old?.status==='open'&&isPlaceTask(old)?[{...old,status:'done' as const,evidence:recheckEvidence(snapshot.version)+note,source,version:old.version+1,updatedAt:now}]:[];
  if(closeOnly||(r.state!=='conflict'&&r.state!=='place_missing'))return [];
  const title=placeTaskTitle(snapshot.platform,r.field,r.state);
  if(old&&!isPlaceTask(old))return [];
  return [old?{...old,title,status:'open' as const,evidence:'',source,version:old.version+1,updatedAt:now}:{id,storeId:snapshot.storeId,reportId:'',title,channel:PLACE_PLATFORMS[snapshot.platform].channel,status:'open' as const,evidence:'',source,version:1,updatedAt:now}];
 });
}
// 이력: 새 판을 쓸 때 이전 판(이력 제외)을 뒤에 붙이고 최근 10판만 남긴다.
export const withHistory=(old:PlaceSnapshot|undefined):PlaceSnapshotVersion[]=>{
 if(!old)return [];
 const {history,...previous}=old;
 return [...history,previous].slice(-PLACE_LIMITS.history);
};
