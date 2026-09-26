// 사실 지식 팩(A8-1, docs/CUSTOMER-REPORT.ko.md 2절). 순수 모듈: 상대 import만 쓰고 서버·기능 스위치·모델·네트워크·시계에 의존하지 않는다(기준 시각은 입력 now).
// 담는 것: effectiveBrandFacts 결과(확정·근거 있음·유효기한 안, 같은 항목이면 지점 사실이 브랜드 사실을 대신)와 거절 사실(광고 금지 표현, 별도 절).
// 후보·만료·근거 없음·가맹 항목은 건수만 적는다. 가맹 항목은 v1에서 뺀다: 카탈로그 franchise 항목, franchiseFactKey 별칭, sourceRef·cost가 있는 사실(수익 항목을 밖으로 내보내지 않는다).
// confirmedBy(확정한 사람 id·이메일)는 싣지 않는다. 출처·거절 표현·이름은 maskFields로 가리고 확정 사실 값·지점 주소는 허용 목록으로 둔다.
// JSON(collective.fact-pack.v1)이 정본이고 Markdown·CSV는 그 payload에서만 만든다. 그래서 세 형식의 factId·version 집합이 같다.
import {scopedBrandFacts,type BrandFact} from './brand-facts';
import {canonicalFactKey,factCatalogItem,factLabel,franchiseFactKey} from './fact-catalog';
import {maskFields,type PiiFieldFinding} from './pii-scan';

export const FACT_PACK_SCHEMA='collective.fact-pack.v1';
// 유효기한이 이 일수 안에 끝나는 사실에 expiresInDays를 붙인다.
export const EXPIRING_DAYS=14;
const DAY_MS=86400000;
// 저장된 사실 행(lib/brand-facts-server.ts FactDecision 포함). confirmedAt만 읽고 confirmedBy는 읽지 않는다.
export type PackSourceFact=BrandFact&{confirmedAt?:string;confirmedBy?:unknown};
export type FactPackExcluded={candidate:number;expired:number;unsupported:number;franchise:number};
export type FactPackCounts={effective:number;expiringSoon:number;rejected:number;excluded:FactPackExcluded};
export type FactPackScope={brandId:string;brandName?:string;storeId?:string;storeName?:string;storeAddress?:string};
export type FactPackInput={confirmed:readonly PackSourceFact[];rejected:readonly PackSourceFact[];excluded:FactPackExcluded};
export type PackFact={factId:string;version:number;key:string;label:string;value:string;scope:'brand'|'store';source:string;verifiedAt:string;validUntil:string;confirmedAt:string|null;expiresInDays?:number};
export type PackRejectedFact={factId:string;version:number;key:string;label:string;value:string;scope:'brand'|'store';source:string};
export type FactPack={schema:typeof FACT_PACK_SCHEMA;scope:{brandId:string;brandName:string;storeId:string|null;storeName:string|null};asOf:string;facts:PackFact[];rejected:PackRejectedFact[];counts:FactPackCounts;notes:string[];masking:PiiFieldFinding[]};

export const FACT_PACK_NOTES:readonly string[]=[
 '확정 사실만 담았습니다: 확정됐고 근거가 있으며 유효기한 안인 사실이고, 같은 항목이면 지점 사실이 브랜드 사실을 대신합니다.',
 '거절 사실은 광고 금지 표현입니다. 광고·캡션·안내문에 쓰지 마세요.',
 '후보·만료·근거 없음 사실은 건수만 적었습니다.',
 '가맹 항목(정보공개서·창업비용·수익 항목, 근거·비용 상세가 있는 사실)은 v1 사실 팩에서 빼고 건수만 적었습니다.',
];
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
// 가맹 항목: 카탈로그 franchise 항목, 가맹 별칭(가입비·공헌이익 등), 정보공개서 근거(sourceRef)나 창업비용 상세(cost)가 있는 사실.
export const isFranchiseFact=(f:Pick<BrandFact,'key'|'sourceRef'|'cost'>)=>!!factCatalogItem(f.key)?.franchise||!!franchiseFactKey(f.key)||!!f.sourceRef||!!f.cost;
const unsupported=(f:BrandFact,now:number)=>!f.source.trim()||!Number.isFinite(Date.parse(f.verifiedAt))||Date.parse(f.verifiedAt)>now;

// 저장된 사실 → 팩 입력. 확정은 effectiveBrandFacts, 거절은 scopedBrandFacts의 금지 사실, 나머지(후보·만료·근거 없음)는 건수만. 가맹 항목은 어느 쪽이든 franchise로 센다.
// 지점 사실이 대신한 브랜드 사실은 어디에도 세지 않는다(같은 항목의 유효한 지점 사실이 있다).
export function factPackInput(facts:readonly PackSourceFact[],brandId:string,storeId:string|undefined,now:number):FactPackInput{
 const scoped=scopedBrandFacts([...facts],brandId,storeId,now),rest=scoped.candidate,kept=rest.filter(f=>!isFranchiseFact(f)),stale=kept.filter(f=>f.status==='confirmed');
 return {confirmed:scoped.confirmed,rejected:scoped.prohibited,excluded:{candidate:kept.filter(f=>f.status==='candidate').length,expired:stale.filter(f=>!unsupported(f,now)).length,unsupported:stale.filter(f=>unsupported(f,now)).length,franchise:rest.length-kept.length}};
}

const scopeOf=(f:BrandFact):'brand'|'store'=>f.storeId?'store':'brand';
const byFact=(a:{key:string;factId:string},b:{key:string;factId:string})=>cmp(a.key,b.key)||cmp(a.factId,b.factId);
function packFact(f:PackSourceFact,now:number):PackFact{
 const days=Math.ceil((Date.parse(f.validUntil)-now)/DAY_MS);
 return {factId:f.id,version:f.version,key:canonicalFactKey(f.key),label:factLabel(f.key),value:f.value,scope:scopeOf(f),source:f.source,verifiedAt:f.verifiedAt,validUntil:f.validUntil,confirmedAt:f.confirmedAt??null,...(days<=EXPIRING_DAYS?{expiresInDays:days}:{})};
}
const rejectedFact=(f:PackSourceFact):PackRejectedFact=>({factId:f.id,version:f.version,key:canonicalFactKey(f.key),label:factLabel(f.key),value:f.value,scope:scopeOf(f),source:f.source});

// 팩 입력 → payload. 빌더도 가맹 항목을 다시 걸러 센다(입력을 만든 쪽이 빠뜨려도 새지 않게). 범위 밖(다른 브랜드·다른 지점) 사실은 싣지 않는다.
export function buildFactPack(input:FactPackInput&{scope:FactPackScope;now:number}):FactPack{
 const {scope,now}=input,inScope=(f:BrandFact)=>f.brandId===scope.brandId&&(!f.storeId||f.storeId===scope.storeId);
 const confirmed=input.confirmed.filter(inScope),rejected=input.rejected.filter(inScope),keptConfirmed=confirmed.filter(f=>!isFranchiseFact(f)),keptRejected=rejected.filter(f=>!isFranchiseFact(f));
 const franchise=confirmed.length-keptConfirmed.length+rejected.length-keptRejected.length;
 const body={scope:{brandId:scope.brandId,brandName:scope.brandName??'',storeId:scope.storeId??null,storeName:scope.storeName??null},facts:keptConfirmed.map(f=>packFact(f,now)).sort(byFact),rejected:keptRejected.map(rejectedFact).sort(byFact)};
 const masked=maskFields(body,['scope.brandName','scope.storeName','facts.*.source','rejected.*.value','rejected.*.source'],{allow:[...keptConfirmed.map(f=>f.value),scope.storeAddress]});
 const {facts,rejected:shownRejected}=masked.value,excluded={...input.excluded,franchise:input.excluded.franchise+franchise};
 return {schema:FACT_PACK_SCHEMA,scope:masked.value.scope,asOf:new Date(now).toISOString(),facts,rejected:shownRejected,counts:{effective:facts.length,expiringSoon:facts.filter(f=>f.expiresInDays!==undefined).length,rejected:shownRejected.length,excluded},notes:[...FACT_PACK_NOTES],masking:masked.findings};
}

// CSV 셀: 수식 주입을 막으려고 =·+·-·@·탭·CR로 시작하는 문자열 앞에 '를 붙인다(lib/usage-export.ts csvCell과 같은 규칙, A8 파일에 로컬로 둔다).
// 숫자는 수식이 될 수 없어 그대로 둔다(음수 포함). 모르는 값(null)은 빈 칸이다(0이 아니다).
export function csvCell(value:unknown):string{
 if(value===null||value===undefined)return '';
 const text=String(value),safe=typeof value==='string'&&/^[=+\-@\t\r]/.test(text)?"'"+text:text;
 return /[",\r\n]/.test(safe)?`"${safe.replace(/"/g,'""')}"`:safe;
}
// 엑셀이 한글을 깨뜨리지 않도록 UTF-8 BOM을 붙이고 줄은 CRLF로 끝낸다(usage-export와 같다).
export const csvText=(rows:readonly (readonly unknown[])[])=>'﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
// Markdown 표 칸: 줄바꿈은 공백으로, '|'는 이스케이프한다.
export const mdCell=(value:unknown)=>value===null||value===undefined||value===''?'-':String(value).replace(/\r?\n|\r/g,' ').replace(/\|/g,'\\|');

const SCOPE_LABEL={brand:'브랜드',store:'지점'} as const;
export function factPackMarkdown(pack:FactPack):string{
 const c=pack.counts,x=c.excluded,title=[pack.scope.brandName||pack.scope.brandId,pack.scope.storeName].filter(Boolean).join(' · ');
 const factRows=pack.facts.map(f=>`| ${mdCell(f.factId)} | ${f.version} | ${SCOPE_LABEL[f.scope]} | ${mdCell(f.label)} | ${mdCell(f.value)} | ${mdCell(f.source)} | ${mdCell(f.verifiedAt)} | ${mdCell(f.validUntil)}${f.expiresInDays!==undefined?` (${f.expiresInDays}일 남음)`:''} | ${mdCell(f.confirmedAt)} |`);
 const rejectedRows=pack.rejected.map(f=>`| ${mdCell(f.factId)} | ${f.version} | ${SCOPE_LABEL[f.scope]} | ${mdCell(f.label)} | ${mdCell(f.value)} | ${mdCell(f.source)} |`);
 return [`# 사실 팩 · ${mdCell(title)}`,'',`기준 시각: ${pack.asOf} · 형식: ${pack.schema}`,'',
  `## 확정 사실 (${c.effective}건, 유효기한 ${EXPIRING_DAYS}일 안 ${c.expiringSoon}건)`,'','| factId | 판 | 범위 | 항목 | 값 | 출처 | 확인일 | 유효기한 | 확정 시각 |','|---|---|---|---|---|---|---|---|---|',...factRows,'',
  `## 광고 금지 표현 · 거절 사실 (${c.rejected}건)`,'','| factId | 판 | 범위 | 항목 | 표현 | 출처 |','|---|---|---|---|---|---|',...rejectedRows,'',
  '## 담지 않은 사실 (건수만)','',`- 후보 ${x.candidate}건 · 만료 ${x.expired}건 · 근거 없음 ${x.unsupported}건 · 가맹 항목 ${x.franchise}건`,'',
  '## 가림 기록','',...(pack.masking.length?pack.masking.map(m=>`- ${mdCell(m.field)} · ${m.kind} ${m.count}건`):['- 없음']),'',
  '## 안내','',...pack.notes.map(n=>`- ${n}`),''].join('\n');
}
export const FACT_PACK_CSV_COLUMNS=['section','factId','version','scope','key','label','value','source','verifiedAt','validUntil','confirmedAt','expiresInDays'] as const;
export function factPackCsv(pack:FactPack):string{
 const confirmed=pack.facts.map(f=>['confirmed',f.factId,f.version,f.scope,f.key,f.label,f.value,f.source,f.verifiedAt,f.validUntil,f.confirmedAt,f.expiresInDays??null]);
 const rejected=pack.rejected.map(f=>['rejected',f.factId,f.version,f.scope,f.key,f.label,f.value,f.source,null,null,null,null]);
 return csvText([FACT_PACK_CSV_COLUMNS,...confirmed,...rejected]);
}
