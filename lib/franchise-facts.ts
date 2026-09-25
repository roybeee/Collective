// 트랙 R R1b 모집 팩트시트(순수). 가맹 사실의 정보공개서 근거(sourceRef)·창업비용 상세(cost) 검증, 정보공개서 버전 상태, 유효 기한 상한(다음 변경등록 기한),
// 사실 줄·각주(결정론), 사실 사용 게이트(H6 수익 항목·근거 없음·교체된 버전)를 계산한다. 시계를 읽지 않고(now 인자) 외부 호출이 없다.
// 결정 20(법률 검토 보류): 기한 상한·수익 항목 금지는 COLLECTIVE 휴리스틱이고 법률 자문이 아니다(GATE_DISCLAIMER). 법적 적합성을 주장하지 않는다.
// 모델 경계: 이 모듈은 lib/franchise.ts·lib/franchise-server.ts·lib/franchise-crypto.ts를 import하지 않는다(tests/franchise-model-boundary.test.mjs).
import {factLabel,franchiseItem,type FactCatalogItem} from './fact-catalog';
import type {BrandFact,FactSourceRef,FranchiseCostDetail} from './brand-facts';
import {isDate,isInstant,parseInstant,toKstDate,kstMidnight,addDays} from './franchise-rules';
import {amendmentDeadline,GATE_DISCLAIMER,type AmendmentItem} from './franchise-gates';

// 고정 문구. 입력 값을 끼워 넣지 않는다(기한 날짜만 예외).
export const FRANCHISE_FACT_MESSAGES={
 off:'가맹 모집 기능이 꺼져 있어 가맹 항목을 저장할 수 없습니다. 일반 사실 저장과 사용 거절은 그대로 할 수 있습니다.',
 notFranchiseItem:'정보공개서 근거·창업비용 상세는 해당 가맹 항목에만 입력할 수 있습니다.',
 sourceInvalid:'정보공개서 근거 입력을 확인하세요. 기준 사업연도는 네 자리 연도, 쪽은 1 이상 숫자입니다.',
 costInvalid:'창업비용 상세 입력을 확인하세요.',
 sourceRequired:'가맹 항목을 확정하려면 정보공개서 근거(등록 버전·기준 사업연도)를 입력하세요.',
 versionOtherBrand:'같은 브랜드의 정보공개서 버전이 아닙니다.',
 versionNotCurrent:'교체되었거나 사용 중지된 정보공개서 버전입니다. 현재 등록 버전을 고르세요.',
 fiscalYearInvalid:'기준 사업연도는 정보공개서 등록일 전에 끝난 사업연도여야 합니다.',
 asOfRequired:'매장 수 항목은 기준일(정보공개서 등록일 이전)을 입력하세요.',
 costRequired:'창업비용 항목은 매장 유형과 포함·불포함 항목을 입력하세요. 총 창업비용·인테리어 비용은 전용면적도 입력하세요.',
 fiscalYearEndMissing:'가맹 프로필에 사업연도 종료일을 입력해야 가맹 항목을 확정할 수 있습니다.',
 staleDuplicate:'같은 항목이 이전 정보공개서 버전으로 있습니다. 그 사실을 고치거나 새 버전으로 옮기세요.',
 rebaseAdminOnly:'가맹 사실을 새 정보공개서 버전으로 옮기는 일은 대표·관리자만 할 수 있습니다.',
 rebaseInvalid:'옮길 수 있는 가맹 사실이 아닙니다. 확정된 정보공개서 항목만 옮길 수 있습니다.',
 revenueNoAd:`평균매출·직영점 매출·공헌이익·월 매출·수익률은 광고·캡션·사실 카드에 쓸 수 없습니다(H6). ${GATE_DISCLAIMER}`,
 sourceMissingInUse:'정보공개서 근거(등록 버전·기준 사업연도)가 없는 가맹 사실은 카드·캡션에 쓸 수 없습니다. 사실에 근거를 입력하세요.',
 staleFact:'교체되었거나 사용 중지된 정보공개서 버전의 가맹 사실입니다. 사실을 새 버전으로 옮긴 뒤 새 소재를 만드세요.',
 footnoteMissing:'가맹 사실의 정보공개서 각주가 캡션에 없습니다. 이 발행을 취소하고 다시 준비하세요.',
 footnoteTooLong:'각주가 카드에 들어가지 않습니다. 사실을 적게 선택하세요.',
 capWarning:`상한은 다음 변경등록 기한 추정치입니다(신청일 미정). ${GATE_DISCLAIMER}`,
} as const;
export type FranchiseFactMessageKey=keyof typeof FRANCHISE_FACT_MESSAGES;
export const validUntilCapMessage=(deadline:string)=>`유효 기한은 다음 변경등록 기한(${deadline}) 이전이어야 합니다. ${GATE_DISCLAIMER}`;

// ── 정보공개서 버전 상태 ──
// R1a VersionRow(lib/franchise-server.ts)에서 판정에 쓰는 필드만 옮긴 모양.
export type VersionLite={id:string;brandId:string;label:string;registeredAt:string|null;validFrom:string;validUntil:string;status:'active'|'retired'};
export type VersionState='current'|'superseded'|'retired'|'expired'|'pending'|'unregistered';
export const VERSION_STATE_LABELS:Readonly<Record<VersionState,string>>=Object.freeze({current:'현재 등록 버전',superseded:'교체됨',retired:'사용 중지',expired:'유효 기간 지남',pending:'유효 기간 전',unregistered:'등록일 없음'});
const msOf=(v:unknown)=>isInstant(v)?parseInstant(v):NaN;
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
// 현재 등록 버전: 같은 브랜드·사용 중·등록일 있음·유효 기간 [validFrom, validUntil) 안. 가장 늦은 validFrom, 같으면 늦은 등록 시각, 같으면 id ASCII가 큰 쪽.
export function currentDisclosureVersion<V extends VersionLite>(versions:readonly V[],brandId:string,now:string):V|null{
 const t=msOf(now);
 const live=versions.filter(v=>v.brandId===brandId&&v.status==='active'&&v.registeredAt!==null&&msOf(v.validFrom)<=t&&t<msOf(v.validUntil));
 return live.sort((a,b)=>msOf(b.validFrom)-msOf(a.validFrom)||msOf(b.registeredAt)-msOf(a.registeredAt)||ascii(b.id,a.id))[0]??null;
}
export function versionState(v:VersionLite,versions:readonly VersionLite[],now:string):VersionState{
 if(currentDisclosureVersion(versions,v.brandId,now)?.id===v.id)return 'current';
 if(v.status==='retired')return 'retired';
 if(v.registeredAt===null)return 'unregistered';
 const t=msOf(now);
 if(msOf(v.validUntil)<=t)return 'expired';
 if(msOf(v.validFrom)>t)return 'pending';
 return 'superseded';
}
// 버전 id → 상태. 사실 사용 게이트와 화면이 같이 쓴다.
export function versionStates(versions:readonly VersionLite[],now:string):Record<string,VersionState>{return Object.fromEntries(versions.map(v=>[v.id,versionState(v,versions,now)]))}

// ── 입력 형식 ──
// undefined: 입력 없음(수정이면 이전 값 유지), null: 지움, 'invalid': 형식 오류.
const isObj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const intIn=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
export function readSourceRef(v:unknown):FactSourceRef|null|undefined|'invalid'{
 if(v===undefined)return undefined;
 if(v===null)return null;
 if(!isObj(v))return 'invalid';
 const id=typeof v.disclosureVersionId==='string'?v.disclosureVersionId.trim():'';
 if(!id||id.length>100||!intIn(v.fiscalYear,2000,2199))return 'invalid';
 const page=v.page===undefined||v.page===null||v.page===''?null:intIn(v.page,1,5000)?v.page as number:NaN;
 if(Number.isNaN(page))return 'invalid';
 const asOf=v.asOf===undefined||v.asOf===null||v.asOf===''?undefined:isDate(v.asOf)?v.asOf:'invalid';
 if(asOf==='invalid')return 'invalid';
 return {disclosureVersionId:id,fiscalYear:v.fiscalYear as number,page,...(asOf?{asOf}:{})};
}
function labelList(v:unknown):string[]|null{
 if(!Array.isArray(v)||v.length<1||v.length>20||!v.every(x=>typeof x==='string'))return null;
 const list=[...new Set((v as string[]).map(x=>x.trim()))];
 return list.every(x=>x.length>=1&&x.length<=40)?list:null;
}
export function readCostDetail(v:unknown):FranchiseCostDetail|null|undefined|'invalid'{
 if(v===undefined)return undefined;
 if(v===null)return null;
 if(!isObj(v))return 'invalid';
 const storeType=typeof v.storeType==='string'?v.storeType.trim():'';
 const includes=labelList(v.includes),excludes=labelList(v.excludes);
 const areaM2=v.areaM2===undefined||v.areaM2===null||v.areaM2===''?null:typeof v.areaM2==='number'&&Number.isFinite(v.areaM2)&&v.areaM2>0&&v.areaM2<=10000?v.areaM2:NaN;
 if(!storeType||storeType.length>30||!includes||!excludes||Number.isNaN(areaM2))return 'invalid';
 return {storeType,includes,excludes,areaM2};
}
export const sameJson=(a:unknown,b:unknown)=>JSON.stringify(a??null)===JSON.stringify(b??null);

// ── 유효 기한 상한(다음 변경등록 기한, COLLECTIVE 휴리스틱) ──
// 가맹 disclosure 항목 → 변경등록 항목(별표 1의2 분류, lib/franchise-gates.ts AMENDMENT_ITEMS).
export const AMENDMENT_ITEM_OF:Readonly<Record<string,AmendmentItem>>=Object.freeze({
 franchise_fee:'franchisee_burden',education_fee:'franchisee_burden',franchise_deposit:'franchisee_burden',interior_cost:'franchisee_burden',other_startup_cost:'franchisee_burden',startup_cost_total:'franchisee_burden',royalty_fee:'franchisee_burden',
 franchise_store_count:'store_counts',direct_store_count:'store_counts',new_openings:'store_changes',terminations:'store_changes',cancellations:'store_changes',
 regional_avg_sales:'regional_avg_sales',direct_store_sales:'direct_store_status',direct_store_contribution:'direct_store_status',monthly_sales:'regional_avg_sales',profit_rate:'financials',
 disclosure_registration_no:'financials',disclosure_registered_on:'financials',disclosure_registrar:'financials',base_fiscal_year:'financials',escrow_insurance:'financials',
 required_items:'franchisee_burden',required_items_pricing:'franchisee_burden',margin_fee:'franchisee_burden',
 production_method:'business_terms',sales_channels:'business_terms',store_types:'business_terms',ip_registration:'ip',territory_clause:'business_terms',
} satisfies Record<string,AmendmentItem>);
const lastDayOf=(y:number,m:number)=>new Date(Date.UTC(y,m,0)).getUTCDate();
// 기준 사업연도 Y = 종료일이 달력 연도 Y에 있는 사업연도. 종료일은 가맹 프로필 fiscalYearEnd의 달 말일(없으면 12월 31일).
export function fyEndOf(year:number,fiscalYearEnd:string|null):string{
 const m=fiscalYearEnd&&isDate(fiscalYearEnd)?Number(fiscalYearEnd.slice(5,7)):12;
 return `${String(year).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(lastDayOf(year,m)).padStart(2,'0')}`;
}
export type ValidUntilCap={ok:true;cap:string;deadline:string;warnings:string[]}|{ok:false;code:'fiscal_year_end_missing'|'invalid'};
// 신청일을 모르므로 amendmentDeadline이 성립하는 규칙 버전 중 이른 기한을 쓴다(application_date_unknown 경고를 그대로 싣는다).
// 상한 = min(기한 다음 날 0시 KST, 버전 유효 기간 끝).
export function franchiseValidUntilCap(i:{key:string;sourceRef:FactSourceRef;verifiedAt:string;fiscalYearEnd:string|null;version:Pick<VersionLite,'validUntil'>}):ValidUntilCap{
 const item=AMENDMENT_ITEM_OF[i.key];
 if(!item)return {ok:false,code:'invalid'};
 if(!i.fiscalYearEnd||!isDate(i.fiscalYearEnd))return {ok:false,code:'fiscal_year_end_missing'};
 try{
  const r=amendmentDeadline(fyEndOf(i.sourceRef.fiscalYear+1,i.fiscalYearEnd),{item,occurredOn:toKstDate(i.verifiedAt)},null);
  if(!r.deadline)return {ok:false,code:'invalid'};
  const byDeadline=kstMidnight(addDays(r.deadline,1));
  return {ok:true,cap:msOf(byDeadline)<=msOf(i.version.validUntil)?byDeadline:i.version.validUntil,deadline:r.deadline,warnings:[...r.warnings]};
 }catch{return {ok:false,code:'invalid'}}
}

// ── 저장 검증(§3.1 2~11) ──
// 스위치(1)·중복(12)은 서버(lib/brand-facts-server.ts)가 본다. item은 가맹 문맥이 있는 브랜드에서 franchiseFactKey로 찾은 가맹 항목(없으면 undefined).
export type FranchiseSaveCheck={ok:true;warnings:string[]}|{ok:false;status:400;message:string};
export function checkFranchiseFactSave(i:{item:FactCatalogItem|undefined;status:BrandFact['status'];sourceRef?:FactSourceRef;cost?:FranchiseCostDetail;oldSourceRef?:FactSourceRef;verifiedAt:string;validUntil:string;brandId:string;versions:readonly VersionLite[];fiscalYearEnd:string|null;now:string}):FranchiseSaveCheck{
 const fail=(key:FranchiseFactMessageKey):FranchiseSaveCheck=>({ok:false,status:400,message:FRANCHISE_FACT_MESSAGES[key]});
 const {item,sourceRef,cost}=i,confirmed=i.status==='confirmed';
 if((!item&&(sourceRef||cost))||(sourceRef&&!item?.disclosure)||(cost&&!item?.storeType))return fail('notFranchiseItem');
 if(sourceRef?.asOf&&!item?.asOf)return fail('sourceInvalid');
 if(!item)return {ok:true,warnings:[]};
 if(confirmed&&item.disclosure&&!sourceRef)return fail('sourceRequired');
 let registered:string|null=null,version:VersionLite|undefined;
 if(sourceRef){
  version=i.versions.find(v=>v.id===sourceRef.disclosureVersionId);
  if(!version||version.brandId!==i.brandId)return fail('versionOtherBrand');
  if((confirmed||!sameJson(sourceRef,i.oldSourceRef))&&versionState(version,i.versions.filter(v=>v.brandId===i.brandId),i.now)!=='current')return fail('versionNotCurrent');
  registered=version.registeredAt&&isInstant(version.registeredAt)?toKstDate(version.registeredAt):null;
  if(registered&&fyEndOf(sourceRef.fiscalYear,i.fiscalYearEnd)>=registered)return fail('fiscalYearInvalid');
 }
 if(item.asOf&&((confirmed&&!sourceRef?.asOf)||(sourceRef?.asOf&&registered&&sourceRef.asOf>registered)))return fail('asOfRequired');
 if(confirmed&&((item.storeType&&!cost)||(item.area&&!cost?.areaM2)))return fail('costRequired');
 if(!confirmed||!item.disclosure||!sourceRef||!version)return {ok:true,warnings:[]};
 if(!i.fiscalYearEnd)return fail('fiscalYearEndMissing');
 const cap=franchiseValidUntilCap({key:item.key,sourceRef,verifiedAt:i.verifiedAt,fiscalYearEnd:i.fiscalYearEnd,version});
 if(!cap.ok)return fail(cap.code==='fiscal_year_end_missing'?'fiscalYearEndMissing':'sourceInvalid');
 if(!(msOf(i.validUntil)<=msOf(cap.cap)))return {ok:false,status:400,message:validUntilCapMessage(cap.deadline)};
 return {ok:true,warnings:[FRANCHISE_FACT_MESSAGES.capWarning]};
}

// ── 사실 줄·각주(결정론) ──
type LineFact=Pick<BrandFact,'key'|'value'>&Partial<Pick<BrandFact,'sourceRef'|'cost'|'verifiedAt'>>;
// 사실 카드·캡션 머리: 라벨 + ' · 매장 유형' + ' (기준일 기준)'. 근거·상세가 없으면 라벨만.
export function factHeading(f:Pick<LineFact,'key'|'sourceRef'|'cost'>):string{return factLabel(f.key)+(f.cost?` · ${f.cost.storeType}`:'')+(f.sourceRef?.asOf?` (${f.sourceRef.asOf} 기준)`:'')}
export const costDetailLine=(c:FranchiseCostDetail)=>`포함: ${c.includes.join(', ')} · 불포함: ${c.excludes.join(', ')}`+(c.areaM2!==null?` · 전용면적 ${c.areaM2}㎡`:'');
// 근거·상세가 없는 사실은 기존 캡션 줄(label + ': ' + value)과 바이트가 같다.
export function factLine(f:LineFact):string{
 if(!f.sourceRef&&!f.cost)return factLabel(f.key)+': '+f.value;
 return factHeading(f)+': '+f.value+(f.cost?'\n'+costDetailLine(f.cost):'');
}
type NoteVersion=Pick<VersionLite,'id'|'label'|'registeredAt'>;
const kstDay=(v:unknown)=>isInstant(v)?toKstDate(v):null;
// 사실 하나의 각주 줄. 참조 버전이 없거나 등록일·확인일이 없으면 null.
export function footnoteLine(f:Pick<BrandFact,'sourceRef'|'verifiedAt'>,versions:readonly NoteVersion[]):string|null{
 if(!f.sourceRef)return null;
 const v=versions.find(x=>x.id===f.sourceRef!.disclosureVersionId),registered=kstDay(v?.registeredAt),verified=kstDay(f.verifiedAt);
 if(!v||!registered||!verified)return null;
 return `※ 정보공개서 등록 버전 ${v.label}(등록일 ${registered}) · 기준 사업연도 ${f.sourceRef.fiscalYear}년 · 확인일 ${verified}`;
}
// 근거 있는 사실마다 (버전, 기준 사업연도, 확인일) 한 줄, 사실 순서의 첫 등장 순. 근거 있는 사실이 없으면 []. 참조 버전을 찾지 못하면 null.
export function footnoteLines(facts:readonly Pick<BrandFact,'sourceRef'|'verifiedAt'>[],versions:readonly NoteVersion[]):string[]|null{
 const lines:string[]=[];
 for(const f of facts){if(!f.sourceRef)continue;const line=footnoteLine(f,versions);if(line===null)return null;if(!lines.includes(line))lines.push(line)}
 return lines;
}
// 소재 캡션. 근거 있는 사실이 없으면 기존 캡션(사실 줄 join)과 바이트가 같아 기존 소재의 materialHash가 바뀌지 않는다.
export function factCaption(facts:readonly LineFact[],versions:readonly NoteVersion[]):string|null{
 const notes=footnoteLines(facts.map(f=>({sourceRef:f.sourceRef,verifiedAt:f.verifiedAt??''})),versions);
 if(notes===null)return null;
 return facts.map(factLine).join('\n')+(notes.length?'\n'+notes.join('\n'):'');
}
// 각주 검사: used(발행 소재의 근거 있는 사실)와 mentioned(캡션에 값이 나온 현재 가맹 사실, R2가 채운다)의 각주 줄이 캡션에 줄 단위로 그대로 있어야 한다.
// 빠진 각주 줄 목록을 돌려준다(없으면 []). 버전을 찾지 못해 각주를 만들 수 없으면 staleFact 문구를 넣는다.
export function footnoteIssues(caption:string,facts:{used:readonly Pick<BrandFact,'sourceRef'|'verifiedAt'>[];mentioned?:readonly Pick<BrandFact,'sourceRef'|'verifiedAt'>[]},versions:readonly NoteVersion[]):string[]{
 const lines=new Set(caption.split('\n')),missing:string[]=[];
 for(const f of [...facts.used,...(facts.mentioned??[])]){
  if(!f.sourceRef)continue;
  const line=footnoteLine(f,versions)??FRANCHISE_FACT_MESSAGES.staleFact;
  if(!lines.has(line)&&!missing.includes(line))missing.push(line);
 }
 return missing;
}

// ── 사실 사용 게이트(소재·발행) ──
// 가맹 문맥 브랜드에서 가맹 항목 사실(옛 자유 key '가맹비'·'월 매출' 포함)을 카드·캡션에 쓸 수 있는지. 순서: 수익 항목(H6) → 근거 없음 → 버전이 현재 아님.
export type FactUseKey='revenueNoAd'|'sourceMissingInUse'|'staleFact';
export function franchiseFactUseIssue(f:Pick<BrandFact,'key'|'sourceRef'>,states:Readonly<Record<string,VersionState>>):FactUseKey|null{
 const item=franchiseItem(f.key);
 if(!item)return null;
 if(item.adUse===false)return 'revenueNoAd';
 if(item.disclosure&&!f.sourceRef)return 'sourceMissingInUse';
 if(f.sourceRef&&states[f.sourceRef.disclosureVersionId]!=='current')return 'staleFact';
 return null;
}
export function franchiseFactUseIssues(facts:readonly Pick<BrandFact,'id'|'key'|'sourceRef'>[],versions:readonly VersionLite[],now:string):{id:string;key:FactUseKey;message:string}[]{
 const states=versionStates(versions,now);
 return facts.flatMap(f=>{const key=franchiseFactUseIssue(f,states);return key?[{id:f.id,key,message:FRANCHISE_FACT_MESSAGES[key]}]:[]});
}
