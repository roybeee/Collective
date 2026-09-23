// A4 점포 실측 화면(app/store-operations-panel.tsx)의 표시 판정. 판정·저장·권한은 서버(lib/store-operations-server.ts measurementAction)가 정본이다:
// list, create_tracking_code, import_orders(dryRun 미리보기 → 확정), set_pos_total, attribution_report.
// 순수 모듈이라 상대 import만 쓴다(tests/store-operations-view.test.mjs).
import {trackingCodeTypes,isTrackingCodeType,normalizeUtmCampaign,utmQuery,type TrackingCode} from './tracking-codes';
import {importFields as orderImportFields,suggestMapping,checkMapping} from './order-import';
import {ATTRIBUTION_NOT_INCREMENTAL} from './store-attribution';
import {orderSources,orderModes} from './store-operations';

export {trackingCodeTypes,type TrackingCode};
export const AUTO_ATTRIBUTION_OFF='자동 귀속 꺼짐 — 소유자가 기능 스위치에서 켤 수 있음';
export const AUTO_ATTRIBUTION_ON='자동 귀속 켜짐 — 추적 코드가 맞는 주문은 가져올 때 코드의 캠페인에 자동으로 귀속합니다.';
// '귀속≠증분' 경고는 서버 보고서와 같은 문구(lib/store-attribution.ts)를 화면에 늘 먼저 보인다.
export const NOT_INCREMENTAL=ATTRIBUTION_NOT_INCREMENTAL;
export type PreviewSample={line:number;orderNumber:string;orderDate:string;source:string;mode:string;paidAmount:number;discountAmount:number;trackingCodes:string[];campaignId:string|null;arm:string|null;conflict:boolean};
export type ImportPreview={dryRun?:boolean;ready:number;duplicates:number;sourceConflicts?:number;sourceConflictLines?:number[];identifiableOrders:number;errorCount?:number;errors?:{line:number;message:string}[];rejected?:{row:number;reason:string}[];sample?:PreviewSample[];autoAttribution?:{enabled:boolean;label?:string;attributed:number;conflicts?:number;unknownCodes?:number;unavailable?:number}};
export type UnitRow={key:string;label?:string;orders:number;netRevenue:number;contribution:number|null;unknownCostOrders?:number;estimatedOrders?:number;newCustomers?:number|null;spendTotal?:number|null;costPerOrder?:number|null;costPerNewCustomer?:number|null};
export type ReportWeek={weekStart:string;weekEnd?:string;status:'pass'|'fail'|'missing_pos';ledgerNet:number;posNet:number|null;posVersion?:number|null;reason?:string};
export type ReportEconomics={variableCostRate:number};
export type NorthStar={passedWeeks:number;excludedWeeks:number;attributedOrders:number;attributedContribution:number|null;weeks?:string[]};
export type Incrementality={metric?:'orders'|'netRevenue';baseline:{average:number|null;weeks:string[]};campaign:{average:number|null;weeks:string[]};change:number|null;changeRate:number|null;excluded?:string[];disclaimer?:string;warnings?:string[]};
export type AttributionReport={period?:{from:string;to:string};weeks:ReportWeek[];baselineWeeks?:ReportWeek[];byCode:UnitRow[];byArm:UnitRow[];byCreative:UnitRow[];byCampaign:UnitRow[];byChannel:UnitRow[];bySource:UnitRow[];northStar:NorthStar;incrementality:Incrementality;economics?:ReportEconomics|null;autoAttribution?:{enabled:boolean;label?:string};notes?:string[]};

const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const whole=(x:unknown)=>finite(x)&&x>=0?Math.floor(x):0;
export const won=(v:number|null|undefined)=>finite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:0})+'원':'미확인';
const count=(n:number,unit='건')=>n.toLocaleString('ko-KR',{maximumFractionDigits:1})+unit;
const unique=(list:string[])=>[...new Set(list.map(x=>x.trim()).filter(Boolean))];

// 스위치 상태는 불리언(list) 또는 {enabled,label}(미리보기·보고서)로 온다. 진짜 true만 켜짐이다(기본 꺼짐).
export function autoAttributionNotice(state:unknown){
 const on=state===true||(typeof state==='object'&&state!==null&&(state as {enabled?:unknown}).enabled===true);
 return {on,text:on?AUTO_ATTRIBUTION_ON:AUTO_ATTRIBUTION_OFF};
}

// 열 매핑용으로 CSV 첫 줄(열 이름)만 읽는다. 값 검증·중복·개인정보 거부는 서버 미리보기가 한다.
export function csvHeaders(text:string):string[]{
 const src=text.replace(/^\uFEFF/,''),cells:string[]=[];let cell='',quoted=false;
 for(let i=0;i<src.length;i++){const c=src[i];
  if(quoted){if(c==='"'){if(src[i+1]==='"'){cell+='"';i++}else quoted=false}else cell+=c;continue}
  if(c==='"')quoted=true;else if(c===','){cells.push(cell);cell=''}else if(c==='\n'||c==='\r')break;else cell+=c;
 }
 if(quoted)throw new Error('CSV 첫 줄의 따옴표가 닫히지 않았습니다.');
 // 서버(lib/order-import.ts parseCsv)처럼 표 계산기가 붙이는 끝의 빈 머리글은 버린다.
 const raw=[...cells,cell].map(x=>x.trim()),headers=raw.slice(0,raw.map(Boolean).lastIndexOf(true)+1);
 if(!headers.some(Boolean))throw new Error('CSV 첫 줄에 열 이름이 필요합니다.');
 if(headers.some(h=>!h))throw new Error('빈 열 이름이 있습니다. 첫 줄의 열 이름을 모두 채워 주세요.');
 const dup=headers.find((h,i)=>headers.indexOf(h)!==i);if(dup)throw new Error('같은 열 이름이 두 번 있습니다: '+dup);
 return headers;
}

// 열 이름·추천·매핑 검증은 서버와 같은 순수 모듈(lib/order-import.ts)을 쓴다. 화면 메시지와 서버 거절 문구가 같다.
const REQUIRED:readonly string[]=['orderNumber','orderedAt','amount'];
export const importFields=Object.entries(orderImportFields).map(([key,label])=>({key,label,required:REQUIRED.includes(key)}));
export const guessMapping=(headers:readonly string[]):Record<string,string>=>({...suggestMapping(headers)});
export function mappingProblems(mapping:Record<string,string>,headers:readonly string[]):string[]{
 try{checkMapping(headers,cleanMapping(mapping));return []}catch(e){return [(e as Error).message]}
}
export const cleanMapping=(mapping:Record<string,string>)=>Object.fromEntries(importFields.filter(f=>mapping[f.key]).map(f=>[f.key,mapping[f.key]]));

// 미리보기 결과. 오류 행이 하나라도 있으면 서버가 확정을 거부하므로(원자 저장) 확정 버튼을 막는다. 고객 식별 값은 건수만 보인다.
// campaigns는 캠페인 id → 이름(표본 표의 귀속 칸).
export function previewView(p:Partial<ImportPreview>|undefined,campaigns:Record<string,string>={}){
 const raw=Array.isArray(p?.errors)?p.errors.map(e=>({line:whole(e?.line),message:e?.message})):Array.isArray(p?.rejected)?p.rejected.map(r=>({line:whole(r?.row),message:r?.reason})):[];
 const errors=raw.filter((e):e is {line:number;message:string}=>typeof e.message==='string').sort((a,b)=>a.line-b.line);
 const ready=whole(p?.ready),auto=p?.autoAttribution,attributed=whole(auto?.attributed),customers=whole(p?.identifiableOrders),errorCount=Math.max(whole(p?.errorCount),errors.length);
 const notes=[[whole(auto?.conflicts),'코드 충돌 %건(첫 유효 코드로 귀속)'],[whole(auto?.unknownCodes),'등록되지 않은 코드 %건'],[whole(auto?.unavailable),'쓸 수 없는 코드 %건(캠페인 삭제 등)']] as const;
 return {cards:[{label:'저장 가능',value:count(ready)},{label:'이미 있음',value:count(whole(p?.duplicates))},{label:'오류 행',value:count(errorCount)},{label:'자동 귀속',value:count(attributed)},{label:'미귀속',value:count(Math.max(ready-attributed,0))}],
  errors,codeNotes:notes.filter(([n])=>n>0).map(([n,text])=>text.replace('%',n.toLocaleString('ko-KR'))).join(' · ')||null,
  privacy:customers?`고객 식별 열 값이 있는 주문 ${customers.toLocaleString('ko-KR')}건은 원문을 저장하지 않고 건수만 셉니다.`:null,
  sample:(Array.isArray(p?.sample)?p.sample:[]).map(r=>({line:whole(r.line),orderNumber:r.orderNumber,orderDate:r.orderDate,route:`${orderSources[r.source as keyof typeof orderSources]||r.source} · ${orderModes[r.mode as keyof typeof orderModes]||r.mode}`,amount:won(r.paidAmount),discount:won(r.discountAmount),codes:r.trackingCodes?.length?r.trackingCodes.join(', '):'없음',attribution:r.campaignId?[campaigns[r.campaignId]||r.campaignId,...(r.arm?['팔 '+r.arm]:[]),...(r.conflict?['코드 충돌']:[])].join(' · '):'미귀속'})),
  sourceConflicts:whole(p?.sourceConflicts)?`출처(주문 채널)만 다른 같은 주문일·주문번호의 주문이 장부에 ${whole(p?.sourceConflicts).toLocaleString('ko-KR')}건 있습니다(${(Array.isArray(p?.sourceConflictLines)?p.sourceConflictLines.map(whole):[]).join(', ')}행). 열 매핑만 바꿔 같은 파일을 다시 올린 것이면 확정하지 마세요.`:null,
  canConfirm:ready>0&&!errorCount,blocked:errorCount?'오류 행이 있으면 파일 전체를 저장하지 않습니다. 고친 뒤 다시 미리보기 하세요.':'',confirmLabel:`확정 · ${ready.toLocaleString('ko-KR')}건 저장`};
}

export const reportSections=[{key:'byCode',title:'추적 코드별',column:'코드'},{key:'byArm',title:'팔(arm)별',column:'캠페인·팔'},{key:'byCreative',title:'소재별',column:'캠페인·소재'},{key:'byCampaign',title:'캠페인별',column:'캠페인'},{key:'byChannel',title:'채널별 단위경제',column:'유입 채널'},{key:'bySource',title:'주문 출처별',column:'출처'}] as const;
// 모르는 값(null)은 0으로 바꾸지 않고 미확인으로 보인다. 광고비는 채널 비용 기록으로만 잇고 코드·팔·캠페인·출처에는 배분하지 않는다.
// 화면이 아는 이름(캠페인 제목 등)을 서버 label(캠페인 id)보다 먼저 쓴다. 미귀속('' 키)처럼 이름이 없으면 서버 label을 쓴다.
export function unitRows(rows:readonly UnitRow[]|undefined,names:Record<string,string>={}){
 return (rows||[]).map(r=>({key:r.key,label:names[r.key]||r.label||r.key,orders:count(whole(r.orders)),netRevenue:won(r.netRevenue),contribution:won(r.contribution),
  contributionNote:whole(r.estimatedOrders)?`변동비율 추정 ${whole(r.estimatedOrders)}건`:whole(r.unknownCostOrders)?`원가 미확인 ${whole(r.unknownCostOrders)}건`:'',
  spend:finite(r.spendTotal)?won(r.spendTotal):'배분 안 함',newCustomers:finite(r.newCustomers)?count(r.newCustomers,'명'):'미확인',costPerNewCustomer:won(r.costPerNewCustomer)}));
}

// 팔·소재 행의 키는 `${campaignId}·${arm|creativeId}`다(lib/store-attribution.ts attributionBreakdown). 캠페인 id를 제목으로 바꿔 보인다. 소재 제목은 아직 없어 id를 쓴다.
const splitPair=(key:string)=>{const i=key.indexOf('·');return i<0?[key,'']:[key.slice(0,i),key.slice(i+1)]};
export const armNames=(rows:readonly Pick<UnitRow,'key'>[]|undefined,titles:Record<string,string>)=>Object.fromEntries((rows||[]).map(r=>{const [id,arm]=splitPair(r.key);return [r.key,`${titles[id]||id} · ${arm==='팔 없음'?arm:'팔 '+arm}`]}));
export const creativeNames=(rows:readonly Pick<UnitRow,'key'>[]|undefined,titles:Record<string,string>)=>Object.fromEntries((rows||[]).map(r=>{const [id,creative]=splitPair(r.key);return [r.key,`${titles[id]||id} · 소재 ${creative}`]}));
// 보고서 요청. 변동비율(0~1)은 입력했을 때만 보내고 검증은 서버가 한다. 원가를 적지 않은 주문의 공헌이익을 이 비율로 추정한다.
export const reportRequest=({from,to,rate}:{from:string;to:string;rate:string})=>({from,to,...(rate.trim()?{variableCostRate:Number(rate.trim())}:{})});
export const contributionBasis=(economics:ReportEconomics|null|undefined)=>economics&&finite(economics.variableCostRate)?`원가 없는 주문은 변동비율 ${economics.variableCostRate}로 추정`:'원가를 모르면 미확인';

// 주 키는 월요일 시작일(YYYY-MM-DD)이다. 끝날이 없으면 +6일로 보이고, 모르는 형식은 그대로 보인다.
export function weekLabel(weekStart:string,weekEnd?:string){
 const start=/^\d{4}-\d{2}-\d{2}$/.test(weekStart)?Date.parse(weekStart+'T00:00:00Z'):NaN;if(!Number.isFinite(start))return weekStart;
 const end=weekEnd&&/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)?weekEnd:new Date(start+6*86400000).toISOString().slice(0,10);
 return weekStart+' ~ '+(end.slice(0,4)===weekStart.slice(0,4)?end.slice(5):end);
}
// POS 합계가 없으면 서버 판정과 상관없이 미입력이다. 미통과 사유는 서버 문구를 우선한다. 기준 주(incrementality-lite 비교용)는 표에 '기준 주'로 표시한다.
export function weekRows(weeks:readonly ReportWeek[]|undefined,baseline=false){
 return (weeks||[]).map(w=>{const pos=finite(w.posNet)?w.posNet:null,status=pos===null?'missing_pos':w.status==='pass'?'pass':'fail';
  return {weekStart:w.weekStart,label:weekLabel(w.weekStart,w.weekEnd)+(baseline?' · 기준 주':''),baseline,ledger:won(w.ledgerNet),pos:pos===null?'미입력':won(pos),status,
   statusLabel:status==='pass'?'통과':status==='missing_pos'?'미통과 · POS 합계 미입력':'미통과 · '+(w.reason?.trim()||'차이 '+won(Math.abs(pos!-(finite(w.ledgerNet)?w.ledgerNet:0))))};});
}
export function completenessSummary(weeks:readonly ReportWeek[]|undefined){
 const rows=weekRows(weeks),passed=rows.filter(r=>r.status==='pass').length;
 return {passed,total:rows.length,text:rows.length?`완전성 통과 ${passed}/${rows.length}주 · 통과한 주만 north-star에 집계합니다.`:'완전성 검사할 주가 없습니다. POS 합계를 입력하면 주별로 대조합니다.'};
}
// POS 합계는 끝난 주(일요일까지)만 받는다(서버 set_pos_total). 이미 저장한 합계는 보고서 주의 posVersion으로 고쳐 쓴다.
const weekEndOf=(w:Pick<ReportWeek,'weekStart'|'weekEnd'>)=>w.weekEnd||new Date(Date.parse(w.weekStart+'T00:00:00Z')+6*86400000).toISOString().slice(0,10);
export function posWeekOptions(weeks:readonly ReportWeek[]|undefined,today:string){
 return [...(weeks||[])].filter(w=>/^\d{4}-\d{2}-\d{2}$/.test(w.weekStart)&&weekEndOf(w)<=today).sort((a,b)=>b.weekStart.localeCompare(a.weekStart)).map(w=>({value:w.weekStart,label:weekLabel(w.weekStart,w.weekEnd),version:finite(w.posVersion)?w.posVersion:undefined}));
}
export function northStarView(ns:Partial<NorthStar>|undefined){
 if(!ns||!whole(ns.passedWeeks))return {orders:'미확인',contribution:'미확인',basis:'완전성 통과 주가 없어 north-star를 집계하지 않았습니다.'};
 return {orders:count(whole(ns.attributedOrders)),contribution:won(ns.attributedContribution),basis:`완전성 통과 ${whole(ns.passedWeeks)}주 기준 · 미통과·미입력 ${whole(ns.excludedWeeks)}주 제외`};
}

// incrementality-lite: 완전성 통과 주만으로 기준 주 평균과 캠페인 주 평균을 비교한다. '귀속은 증분이 아님' 경고가 항상 첫 줄이다.
export function incrementalityView(inc:Partial<Incrementality>|undefined,notes:readonly string[]=[]){
 const revenue=inc?.metric==='netRevenue',fmt=(v:number|null|undefined)=>!finite(v)?'미확인':revenue?won(v):count(v);
 const signed=(v:number)=>(v>=0?'+':'-')+fmt(Math.abs(v)),rate=finite(inc?.changeRate)?` (${inc.changeRate>=0?'+':''}${(inc.changeRate*100).toFixed(1)}%)`:'';
 return {metric:revenue?'주 평균 순매출':'주 평균 주문 수',baseline:fmt(inc?.baseline?.average),campaign:fmt(inc?.campaign?.average),baselineWeeks:`기준 ${inc?.baseline?.weeks?.length||0}주`,campaignWeeks:`캠페인 ${inc?.campaign?.weeks?.length||0}주`,
  change:finite(inc?.change)?signed(inc.change)+rate:'미확인',warnings:unique([NOT_INCREMENTAL,typeof inc?.disclaimer==='string'?inc.disclaimer:'',...(inc?.warnings||[]).filter(x=>typeof x==='string'),...notes])};
}

export function trackingCodeProblems(f:{type:string;campaignId:string;label:string;utmCampaign:string}){
 const problems:string[]=[];
 if(!isTrackingCodeType(f.type))problems.push('추적 코드 종류를 고르세요.');
 if(!f.campaignId)problems.push('캠페인을 고르세요.');
 if(!f.label.trim())problems.push('코드 이름을 입력하세요.');
 if(f.type==='utm'&&!normalizeUtmCampaign(f.utmCampaign))problems.push('utm_campaign은 영문 소문자·숫자·_ . - 로 60자 이하입니다.');
 return problems;
}
// UTM 코드는 링크에 붙일 쿼리(utm_campaign·utm_content)를, 나머지는 코드 자체를 복사한다.
export const trackingCopyText=(c:Pick<TrackingCode,'code'|'type'|'utmCampaign'>)=>utmQuery(c)||c.code;
