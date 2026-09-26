import {effectiveBrandFacts,type BrandFact} from './brand-facts';
import {canonicalFactKey,factCatalogItem,franchiseFactKey} from './fact-catalog';

// 자료 요청(A6-1): 저장된 작업물의 '자료 필요' 표지를 결정론으로 뽑아 data_request(열림)로 만들고, 같은 항목의 유효 사실이 생기면 닫는다. 순수 모듈이다(모델 호출 0).
// 저장·스위치·권한은 lib/data-requests-server.ts, 규칙과 근거는 docs/DATA-REQUESTS.ko.md.
// 카피 팩(lib/copy-pack.ts)은 타입을 가져오지 않고 형식을 직접 확인해 읽는다(needsCheck는 선택 필드이고, 팩 형식이 바뀌어도 이 모듈은 읽을 수 있는 것만 읽는다).
export type DataRequestActor={id:string;role:'owner'|'admin'|'member'};
export type DataRequestOrigin=
 {kind:'artifact_marker';artifactId:string;artifactVersion:number;role:string;excerpt:string}|
 {kind:'copy_pack';artifactId:string;artifactVersion:number;channel:string;variantId:string};
export type DataRequestResolution=
 {kind:'fact_confirmed';factId:string;factVersion:number;by:DataRequestActor;at:string}|
 {kind:'answered'|'dismissed';note:string;by:DataRequestActor;at:string};
// scopeWarning store_link_needed: 지점 없는 캠페인이 지점마다 다른 항목(storeScoped)을 요청했다. 브랜드 범위로 만들고 '지점 연결 필요'를 보인다(data-truth-3).
export type DataRequest={id:string;brandId:string;storeId?:string;campaignId?:string;status:'open'|'closed';factKey:string|null;label:string;text:string;assignee?:string;scopeWarning?:'store_link_needed';
 origins:DataRequestOrigin[];createdBy:DataRequestActor;createdAt:string;resolution?:DataRequestResolution;version:number;updatedAt:string};
// 상한: 수집 1회 새 요청 20건, 캠페인당 열린 요청 30건, 요청당 출처 10개. 발췌는 200자, 라벨은 60자, 원문은 200자.
export const DATA_REQUEST_LIMITS={perCollect:20,openPerCampaign:30,origins:10,excerpt:200,label:60,text:200,note:500} as const;
export const STORE_LINK_WARNING='지점 연결 필요: 지점마다 다른 항목이라 캠페인에 지점을 연결해야 지점 사실로 닫힙니다. 지금은 브랜드 공통 사실로만 닫힙니다.';

// 작업물에서 뽑은 '자료 필요' 한 건. item은 요청 항목(예: '영업시간'), text는 표지 원문, excerpt는 표지가 있는 줄(200자).
export type ExtractedNeed={item:string;assignee?:string;text:string;excerpt:string;source:'marker'|'copy_pack';channel?:string;variantId?:string};

const clip=(s:string,n:number)=>s.length>n?s.slice(0,n):s;
const oneLine=(s:string)=>s.replace(/\s+/g,' ').trim();
// 금지·삭제를 말하는 줄(lib/campaign-policy.ts unverifiedClaims와 같은 기준). 규칙을 되풀이한 문장에서 요청을 만들지 않는다.
const PROHIBITION=/(?:쓰지|사용하지|넣지|표기하지)\s?(?:않|말)|금지|제외|삭제/;
// 지시 문구의 틀('[자료 필요: 확인 담당/항목]')을 모델이 그대로 되풀이한 경우.
const PLACEHOLDER=/^(?:항목|확인\s?항목|담당|확인\s?담당|자료|내용|미정|없음|-)$/;
const BRACKET=/\[\s*자료\s*필요\s*[:：]\s*([^\[\]\n]{1,160})\]/g;
const LINE=/^\s*(?:[-*•]\s+|\d+[.)]\s+)?(?:\*\*)?\s*자료\s*필요\s*(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.+)$/;
const SECTION=/^\s*(?:#{1,6}\s*(?:\d+[.)]\s*)?|\*\*)\s*(?:추가\s*)?자료\s*필요\s*(?:\*\*)?\s*(?:목록|항목)?\s*(?:[(（][^)）]*[)）])?\s*[:：]?\s*$/;
const HEADING=/^\s*#{1,6}\s/;
const LIST_ITEM=/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/;
// '[X 확인 필요]'의 X. 맨 '[확인 필요]'(X 없음)는 광고 표현 신호(unverifiedClaims)라 뽑지 않는다. X에 쌍점이 있으면('[가설: … 확인 필요]'·'[자료 필요: …]') 다른 표지다.
const CHECK=/\[([^\[\]\n]{0,120}?)\s*확인\s*필요\s*\]/g;

function cleanItem(s:string){return oneLine(s.replace(/\*\*/g,'').replace(/^[\s\-–—:：·]+|[\s\-–—:：.,·]+$/g,''))}
// '담당/항목, 항목' → 담당과 항목 목록. 빗금이 없으면 모두 항목이다. 쉼표·세미콜론으로 여러 항목을 나눈다(가운뎃점은 '배달·포장' 같은 한 항목이라 나누지 않는다).
export function parseNeed(raw:string):{assignee?:string;items:string[]}{
 const parts=raw.replace(/\*\*/g,'').split('/').map(p=>p.trim()).filter(Boolean);
 const assignee=parts.length>1?cleanItem(parts[0]):'';
 const rest=parts.length>1?parts.slice(1).join('/'):parts[0]??'';
 const items=rest.split(/[,，、;]/).map(cleanItem).filter(i=>!!i&&!PLACEHOLDER.test(i));
 return {...(assignee&&!PLACEHOLDER.test(assignee)?{assignee:clip(assignee,40)}:{}),items};
}
const needsOf=(raw:string,text:string,line:string):ExtractedNeed[]=>{
 const {assignee,items}=parseNeed(raw);
 return items.map(item=>({item:clip(item,120),...(assignee?{assignee}:{}),text:clip(oneLine(text),DATA_REQUEST_LIMITS.text),excerpt:clip(oneLine(line),DATA_REQUEST_LIMITS.excerpt),source:'marker' as const}));
};

// 작업물 본문의 '자료 필요' 표지: 항목이 적힌 [자료 필요: 담당/항목], '자료 필요:'로 시작하는 줄, '## 자료 필요' 섹션의 목록, [X 확인 필요]의 X.
// 금지 문장과 맨 [확인 필요]는 뽑지 않는다.
export function extractMarkers(content:string):ExtractedNeed[]{
 const out:ExtractedNeed[]=[];let inSection=false;
 for(const line of content.split('\n')){
  if(SECTION.test(line)){inSection=true;continue}
  if(HEADING.test(line))inSection=false;
  if(!line.trim()||PROHIBITION.test(line))continue;
  // 섹션 목록 줄에 다른 표지가 없으면 줄 전체가 요청이다. '항목: 설명'이면 쌍점 앞이 항목이다.
  const listed=inSection&&!/\[[^\]]*필요[^\]]*\]/.test(line)?LIST_ITEM.exec(line):null;
  if(listed){out.push(...needsOf(listed[1].split(/[:：]/)[0],'자료 필요: '+listed[1],line));continue}
  const brackets=[...line.matchAll(BRACKET)];
  brackets.forEach(m=>out.push(...needsOf(m[1],m[0],line)));
  const rest=line.replace(BRACKET,' '),started=brackets.length?null:LINE.exec(rest);
  if(started)out.push(...needsOf(started[1],'자료 필요: '+started[1],line));
  for(const m of rest.matchAll(CHECK)){
   const x=cleanItem(m[1]);
   if(x&&!/[:：]/.test(x)&&!PLACEHOLDER.test(x))out.push({item:clip(x,120),text:clip(oneLine(m[0]),DATA_REQUEST_LIMITS.text),excerpt:clip(oneLine(line),DATA_REQUEST_LIMITS.excerpt),source:'marker'});
  }
 }
 return out;
}

const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const str=(v:unknown)=>typeof v==='string'?v.trim():'';
// 카피 팩 안의 needsCheck. 팩을 만든 작업물 판(copyPackArtifactVersion)이 지금 판과 같을 때만 읽는다(사람이 고친 판의 팩은 옛 판의 것이다).
export function extractCopyPackNeeds(a:{version:number;copyPack?:unknown;copyPackArtifactVersion?:unknown}):ExtractedNeed[]{
 const pack=obj(a.copyPack);
 if(!pack||a.copyPackArtifactVersion!==a.version||!Array.isArray(pack.channels))return [];
 return pack.channels.flatMap(ch=>{
  const c=obj(ch),channel=clip(str(c?.channel),60);
  return (Array.isArray(c?.variants)?c.variants:[]).flatMap(v=>{
   const x=obj(v),variantId=clip(str(x?.id),20),checks=Array.isArray(x?.needsCheck)?x.needsCheck:[];
   return checks.map(str).filter(Boolean).map(check=>cleanItem(check)).filter(item=>!!item&&!PLACEHOLDER.test(item)).map(item=>({item:clip(item,120),text:clip('확인 필요: '+item,DATA_REQUEST_LIMITS.text),excerpt:'',source:'copy_pack' as const,channel,variantId}));
  });
 });
}

// 이름 → 사실 카탈로그 key(가맹 항목 포함). 카탈로그에 없으면 null이다.
function catalogKey(name:string):string|null{
 if(!name.trim())return null;
 return factCatalogItem(name)?.key??franchiseFactKey(name)??null;
}
// 요청 항목 → 사실 항목 key. 괄호 설명, 앞의 '매장·지점·점포·가게·정확한·최신' 같은 범위 말, 끝의 '확인·정보·자료·여부·수집'을 뗀 나머지 전체가 카탈로그 항목(라벨·key·별칭)일 때만 그 key다.
// 낱말 하나만 맞는 경우('포장 용기 규격'의 '포장')는 고르지 않는다(null). null인 요청은 자동으로 닫히지 않는다.
const FILLER_HEAD=/^(?:매장|지점|점포|가게|우리|정확한|최신|현재)\s+/,FILLER_TAIL=/\s*(?:확인|정보|자료|여부|수집|내용)\s*$/;
export function factKeyOf(item:string):string|null{
 let stripped=oneLine(item.replace(/[(（][^)）]*[)）]/g,' '));
 for(let prev='';prev!==stripped;){prev=stripped;stripped=stripped.replace(FILLER_HEAD,'').replace(FILLER_TAIL,'').trim()}
 return catalogKey(item)??catalogKey(stripped);
}
// 사실의 항목 key: 카탈로그 항목이면 그 key, 아니면 자유 key(canonicalFactKey).
export const factKeyOfFact=(key:string)=>catalogKey(key)??canonicalFactKey(key);
export function requestLabel(item:string,factKey:string|null){return clip(factKey?factCatalogItem(factKey)?.label??item:item,DATA_REQUEST_LIMITS.label)}
// 결정적 id의 씨앗: 캠페인|지점|항목 key(없으면 정규화 문구 60자). 서버가 sha256으로 'dr-' + 12자 id를 만든다.
export const normalizedItem=(item:string)=>item.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'').slice(0,60);
export const requestSeed=(campaignId:string,storeId:string|undefined,factKey:string|null,item:string)=>`${campaignId}|${storeId??''}|${factKey??normalizedItem(item)}`;
// 캠페인 범위의 요청 초안(id 없음). 지점 캠페인은 모든 요청이 그 지점 범위다. 지점 없는 캠페인의 지점 항목은 브랜드 범위와 '지점 연결 필요'다.
export type NeedDraft={brandId:string;storeId?:string;campaignId?:string;factKey:string|null;label:string;text:string;assignee?:string;scopeWarning?:'store_link_needed'};
export function draftFor(need:Pick<ExtractedNeed,'item'|'text'|'assignee'>,scope:{brandId:string;storeId?:string;campaignId?:string}):NeedDraft{
 const factKey=factKeyOf(need.item),storeScoped=!!factKey&&!!factCatalogItem(factKey)?.storeScoped;
 return {brandId:scope.brandId,...(scope.storeId?{storeId:scope.storeId}:{}),...(scope.campaignId?{campaignId:scope.campaignId}:{}),factKey,label:requestLabel(need.item,factKey),text:need.text,
  ...(need.assignee?{assignee:need.assignee}:{}),...(storeScoped&&!scope.storeId?{scopeWarning:'store_link_needed' as const}:{})};
}

// 요청을 닫는 사실(없으면 null). 유효 사실 판정은 effectiveBrandFacts(확정·근거·확인 시점 ≤ 지금 < 유효 기한·범위·지점 우선)를 그대로 쓴다.
// 지점 요청은 그 지점 사실과 브랜드 공통 사실로 닫히고, 브랜드 범위 요청은 브랜드 공통 사실로만 닫힌다. 항목 key가 없는 요청은 닫지 않는다.
export function closingFact(r:Pick<DataRequest,'brandId'|'storeId'|'factKey'>,facts:BrandFact[],now=Date.now()):BrandFact|null{
 if(!r.factKey)return null;
 const matches=effectiveBrandFacts(facts,r.brandId,r.storeId,now).filter(f=>factKeyOfFact(f.key)===r.factKey);
 return matches.find(f=>!!f.storeId)??matches[0]??null;
}
export const closedByFact=(r:DataRequest,f:Pick<BrandFact,'id'|'version'>,by:DataRequestActor,at:string):DataRequest=>({...r,status:'closed',resolution:{kind:'fact_confirmed',factId:f.id,factVersion:f.version,by,at},version:r.version+1,updatedAt:at});

const originKey=(o:DataRequestOrigin)=>o.kind==='copy_pack'?`c|${o.artifactId}|${o.artifactVersion}|${o.channel}|${o.variantId}`:`m|${o.artifactId}|${o.artifactVersion}|${o.excerpt}`;
// 출처 합치기: 같은 출처는 한 번만, 새 출처는 뒤에 붙이고 최근 10개만 남긴다. 바뀐 것이 없으면 같은 배열을 돌려준다.
export function mergeOrigins(existing:DataRequestOrigin[],incoming:DataRequestOrigin[]):DataRequestOrigin[]{
 const seen=new Set(existing.map(originKey)),added=incoming.filter(o=>{const k=originKey(o);if(seen.has(k))return false;seen.add(k);return true});
 return added.length?[...existing,...added].slice(-DATA_REQUEST_LIMITS.origins):existing;
}

// 수집 계획. needs는 id를 붙인 초안과 출처다. 같은 id는 출처만 합친다. 닫힌 요청은 다시 열지 않고, 이미 유효 사실이 있는 항목은 만들지 않는다.
// 새 요청은 수집 1회 20건, 캠페인의 열린 요청 30건까지다(넘치면 capped로 센다).
export type PlannedNeed={id:string;draft:NeedDraft;origins:DataRequestOrigin[]};
export function planCollect({existing,needs,facts,by,now}:{existing:DataRequest[];needs:PlannedNeed[];facts:BrandFact[];by:DataRequestActor;now:string}){
 const byId=new Map(existing.map(r=>[r.id,r] as const)),grouped=new Map<string,PlannedNeed>();
 for(const n of needs){const g=grouped.get(n.id);grouped.set(n.id,g?{...g,origins:[...g.origins,...n.origins]}:n)}
 const writes:DataRequest[]=[],skipped={closed:0,confirmed:0,capped:0};let created=0,merged=0,open=existing.filter(r=>r.status==='open').length;
 for(const n of grouped.values()){
  const old=byId.get(n.id);
  if(old?.status==='closed'){skipped.closed++;continue}
  if(old){const origins=mergeOrigins(old.origins,n.origins);if(origins!==old.origins){writes.push({...old,origins,version:old.version+1,updatedAt:now});merged++}continue}
  if(closingFact(n.draft,facts,Date.parse(now))){skipped.confirmed++;continue}
  if(created>=DATA_REQUEST_LIMITS.perCollect||open>=DATA_REQUEST_LIMITS.openPerCampaign){skipped.capped++;continue}
  writes.push({id:n.id,...n.draft,status:'open',origins:mergeOrigins([],n.origins),createdBy:by,createdAt:now,version:1,updatedAt:now});created++;open++;
 }
 return {writes,created,merged,skipped};
}
// 화면·응답 정렬: 열린 요청 먼저, 그 안에서 최근 갱신 순.
export const sortRequests=(rows:DataRequest[])=>[...rows].sort((a,b)=>(a.status===b.status?0:a.status==='open'?-1:1)||b.updatedAt.localeCompare(a.updatedAt));
