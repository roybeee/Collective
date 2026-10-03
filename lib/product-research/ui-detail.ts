// 상품 리서치 화면용 순수 계산(평가 1회차 화면). 서버 계약(api.ts·types.ts)과 같은 키·한도를 써서 화면이 서버와 같은 기준으로 판단한다.
// - 시계열 대상 키: analytics/series.ts subjectKey()와 같은 모양(kw:정규형 키워드, ls:출처:외부ID). 상품 ID(prp_…)·묶음 ID(kg_…)와 비교하지 않는다(평가 H1).
// - 입력 검사: api.ts 상수(QUESTION_MAX·REASON_MIN·REASON_MAX…)만 쓴다(평가 M8). 막힐 이유를 한국어 한 문장으로 돌려주고, 통과면 빈 문자열이다.
// - 승인 관문: analytics/score.ts reviewApprovalError와 같은 규칙(규칙마다 사유에 그 위험을 말하는 낱말 하나 이상, 상표 규칙은 상표 이름도 인정).
import {normalizeKeyword} from './analytics/normalize';
import {groupDigits,koWon} from './analytics/format';
import {reviewApprovalError} from './analytics/score';
import {BRAND_FIT_MAX,BRAND_FIT_MIN,BRAND_FIT_REASON_MAX,CLEAR_REASON_MAX,IMPORT_MAX_AGE_DAYS,IMPORT_SCOPE_MAX,LABEL_THRESHOLD_MAX,LABEL_THRESHOLD_MIN,PRICE_MAX_MAX,PRICE_MAX_MIN,QUESTION_MAX,REASON_MAX,REASON_MIN,RISK_NOTE_MAX,RISK_RULE_MAX,RISK_RULES_MAX} from './api';
import type {CalibrationView,CampaignCatalogItem,LaunchOutcome,RiskRule,WeightsProposalView} from './api';
import type {KeywordGroup,MetricKey,ResearchProduct,ScoreCard,Series,SeriesPoint,SourceId,SubScoreKey} from './types';
import {SUB_SCORES} from './types';

// ── 시계열
export const listingKey=(l:{sourceId:SourceId;externalId:string})=>`ls:${l.sourceId}:${l.externalId}`;
export const keywordKey=(text:string)=>`kw:${normalizeKeyword(text)}`;
// 상품이 가리키는 시계열 대상: 묶인 판매 목록 전부 + 연결된 키워드 묶음의 이름과 키워드 전부. 서버(researchView)가 시계열을 고르는 기준과 같다.
export function productSubjects(product:Pick<ResearchProduct,'listings'|'keywordGroupIds'>,groups:readonly KeywordGroup[]):Map<string,string>{
 const out=new Map<string,string>();
 for(const l of product.listings)out.set(listingKey(l),l.title);
 for(const g of groups){
  if(!product.keywordGroupIds.includes(g.id))continue;
  for(const k of [g.label,...g.keywords]){const key=keywordKey(k);if(key!=='kw:'&&!out.has(key))out.set(key,k)}
 }
 return out;
}
export function productSeries(all:readonly Series[]|undefined,subjects:ReadonlyMap<string,string>):Series[]{
 return (all??[]).filter(s=>subjects.has(s.subjectKey)&&s.points.length>0)
  .sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.metric.localeCompare(b.metric)||a.subjectKey.localeCompare(b.subjectKey));
}
const dayOf=(at:string)=>at.slice(0,10);
// 같은 시간축: 모든 계열의 날짜 합집합에서 최근 max개.
export function seriesAxis(series:readonly Series[],max=12):string[]{
 return [...new Set(series.flatMap(s=>s.points.map(p=>dayOf(p.at))))].sort().slice(-max);
}
// 그 날짜의 값(같은 날 여러 점이면 마지막 점). 없으면 null(그날 관측 없음), 있는데 값이 null이면 미확인.
export function pointOn(series:Series,day:string):SeriesPoint|null{
 for(let i=series.points.length-1;i>=0;i--)if(dayOf(series.points[i].at)===day)return series.points[i];
 return null;
}
// 근거 스냅샷 하나가 이 상품에 준 관측 행(시계열 점 중 그 스냅샷을 가리키는 것).
export type SnapshotRow={subjectKey:string;subject:string;metric:MetricKey;at:string;value:number|null};
export function snapshotRows(series:readonly Series[],subjects:ReadonlyMap<string,string>,snapshotId:string):SnapshotRow[]{
 const out:SnapshotRow[]=[];
 for(const s of series){
  if(!subjects.has(s.subjectKey))continue;
  for(const p of s.points)if(p.snapshotId===snapshotId)out.push({subjectKey:s.subjectKey,subject:subjects.get(s.subjectKey)??s.subjectKey,metric:s.metric,at:p.at,value:p.value});
 }
 return out.sort((a,b)=>a.subject.localeCompare(b.subject)||a.metric.localeCompare(b.metric)||a.at.localeCompare(b.at));
}

// 스냅샷 요청 범위(snapshot.request)를 사람이 읽는 항목으로 바꾼다. 내부 호출 설정(operation·format·정렬 등)은 보이지 않는다.
const SCOPE_LABELS:Record<string,string>={keyword:'검색어',query:'검색어',keywords:'키워드',hintKeywords:'키워드',keywordGroups:'키워드 묶음',categories:'카테고리',categoryCode:'카테고리 코드',
 startDate:'시작일',endDate:'종료일',timeUnit:'단위',publishedAfter:'게시 이후',count:'영상 수',scope:'범위',observedDate:'기준일',fileName:'파일',rows:'행 수',weeks:'주 수',skus:'SKU 수',lines:'주문 줄 수'};
const UNIT_LABELS:Record<string,string>={date:'일',week:'주',month:'월'};
export function requestScope(request:Readonly<Record<string,string|number|boolean|null>>|null|undefined,max=80):string[]{
 if(!request)return [];
 const out:string[]=[];
 for(const [key,label] of Object.entries(SCOPE_LABELS)){
  const v=request[key];if(v===null||v===undefined||v==='')continue;
  let text=key==='timeUnit'?UNIT_LABELS[String(v)]??String(v):String(v);
  if(key==='keywordGroups'||key==='categories')text=text.split(';').map(x=>x.split(':')[0]).filter(Boolean).join(', ');
  if([...text].length>max)text=[...text].slice(0,max).join('')+'…';
  out.push(`${label} ${text}`);
 }
 return out;
}

// ── 지난주 대비(previousScore: 6일 이상 먼저 계산된 가장 최근 판)
export type WeekDelta={total:number|null;momentum:number|null;since:string};
type Scored={score:ScoreCard|null;previousScore?:{total:number|null;momentum:number|null;computedAt:string}|null};
const momentumOf=(card:ScoreCard|null)=>card?.subScores.find(x=>x.key==='momentum')?.value??null;
const diff=(now:number|null,before:number|null)=>now===null||before===null?null:Math.round((now-before)*10)/10;
export function weekDelta(p:Scored):WeekDelta|null{
 const prev=p.previousScore;if(!prev||!p.score)return null;
 return {total:diff(p.score.total,prev.total),momentum:diff(momentumOf(p.score),prev.momentum),since:prev.computedAt};
}
// 오른 후보·내린 후보(총점 변화 우선, 없으면 모멘텀 변화). 변화를 모르는 후보는 넣지 않는다.
export function movers<T extends Scored>(products:readonly T[],limit=10):{risers:(T&{delta:WeekDelta})[];fallers:(T&{delta:WeekDelta})[];compared:number}{
 const rows=products.flatMap(p=>{const delta=weekDelta(p);return delta&&(delta.total!==null||delta.momentum!==null)?[{...p,delta}]:[]});
 const key=(x:{delta:WeekDelta})=>x.delta.total??x.delta.momentum??0;
 return {risers:rows.filter(x=>key(x)>0).sort((a,b)=>key(b)-key(a)).slice(0,limit),fallers:rows.filter(x=>key(x)<0).sort((a,b)=>key(a)-key(b)).slice(0,limit),compared:rows.length};
}
export const signed=(v:number|null)=>v===null?'미확인':v>0?`+${v}`:v<0?`−${Math.abs(v)}`:'0';

// ── 입력 검사(api.ts 상수). 서버 text()처럼 앞뒤 빈칸을 빼고 길이를 센다.
const len=(v:string)=>v.trim().length;
export function textWhy(value:string,label:string,min:number,max:number):string{
 const n=len(value);
 if(n<min)return min<=1?`${label}을 쓰세요.`:`${label}을 ${min}자 이상 쓰세요.`;
 if(n>max)return `${label}은 ${max}자까지 씁니다(지금 ${n}자).`;
 return '';
}
export const LIMITS={question:QUESTION_MAX,reasonMin:REASON_MIN,reasonMax:REASON_MAX,brandFitReasonMax:BRAND_FIT_REASON_MAX,clearReasonMax:CLEAR_REASON_MAX,importScopeMax:IMPORT_SCOPE_MAX,riskNoteMax:RISK_NOTE_MAX,riskRuleMax:RISK_RULE_MAX,riskRulesMax:RISK_RULES_MAX} as const;
export const questionWhy=(v:string,required:boolean)=>required?textWhy(v,'조사 질문',1,QUESTION_MAX):len(v)>QUESTION_MAX?`조사 질문은 ${QUESTION_MAX}자까지 씁니다(지금 ${len(v)}자).`:'';
export const decisionReasonWhy=(v:string)=>textWhy(v,'결정 사유',REASON_MIN,REASON_MAX);
export const brandFitReasonWhy=(v:string)=>textWhy(v,'판정 사유',REASON_MIN,BRAND_FIT_REASON_MAX);
export const clearReasonWhy=(v:string)=>textWhy(v,'해제 사유',REASON_MIN,CLEAR_REASON_MAX);
export const scopeWhy=(v:string)=>textWhy(v,'범위(카테고리 이름 등)',1,IMPORT_SCOPE_MAX);
export const riskNoteWhy=(v:string)=>len(v)>RISK_NOTE_MAX?`검토 메모는 ${RISK_NOTE_MAX}자까지 씁니다(지금 ${len(v)}자).`:'';
export function brandFitValueWhy(text:string):string{
 const n=text.trim()===''?NaN:Number(text);
 return Number.isFinite(n)&&n>=BRAND_FIT_MIN&&n<=BRAND_FIT_MAX?'':`적합성 점수는 ${BRAND_FIT_MIN}~${BRAND_FIT_MAX} 사이 숫자로 쓰세요.`;
}
// 가격 상한: 비우면 제한 없음, 아니면 100원~1,000만 원 정수(서버 parseSettings).
export function priceMaxWhy(text:string):string{
 const t=text.replace(/,/g,'').trim();if(!t)return '';
 const n=Number(t);
 return Number.isInteger(n)&&n>=PRICE_MAX_MIN&&n<=PRICE_MAX_MAX?'':`가격 상한은 ${PRICE_MAX_MIN.toLocaleString('ko-KR')}원~${(PRICE_MAX_MAX/10000).toLocaleString('ko-KR')}만 원 사이 정수로 쓰거나 비워 두세요.`;
}
export const thresholdWhy=(text:string)=>{const n=text.trim()===''?NaN:Number(text);return Number.isFinite(n)&&n>=LABEL_THRESHOLD_MIN&&n<=LABEL_THRESHOLD_MAX?'':`정답 기준(상승률 %)은 ${LABEL_THRESHOLD_MIN}~${LABEL_THRESHOLD_MAX} 사이로 쓰세요.`};
// 가져오기 기준일: 한국 날짜로 오늘부터 IMPORT_MAX_AGE_DAYS일 전까지(미래 거절). today는 YYYY-MM-DD(한국 날짜).
export function oldestImportDay(today:string):string{return new Date(Date.parse(`${today}T00:00:00Z`)-IMPORT_MAX_AGE_DAYS*86400000).toISOString().slice(0,10)}
export function observedWhy(day:string,today:string):string{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '관측 날짜를 고르세요.';
 if(day>today)return '관측 날짜가 오늘보다 늦습니다.';
 if(day<oldestImportDay(today))return `관측 날짜는 오늘부터 ${IMPORT_MAX_AGE_DAYS}일 전까지만 받습니다.`;
 return '';
}

// ── 승인 관문(리스크 '높음' 점수표)
// 저장한 리스크 검토가 있으면: 모든 항목을 확인해야 승인. 없으면: 위험 확인 표시 + 규칙마다 그 위험을 말하는 사유.
export type ReviewState={checklist:{rule:string;checked:boolean}[]}|null|undefined;
export function approvalWhy(card:Pick<ScoreCard,'blocked'|'needsReview'|'review'>,reason:string,acknowledged:boolean,saved:ReviewState):string{
 if(card.blocked)return `선정 금지 후보라 승인할 수 없습니다: ${card.blocked.reason}`;
 if(!card.needsReview||!card.review)return '';
 if(saved){const open=saved.checklist.filter(x=>!x.checked).length;return open?`저장한 리스크 검토에 확인하지 않은 항목이 ${open}개 있습니다. 모두 확인해 다시 저장하세요.`:''}
 if(!acknowledged)return '리스크 높음 후보입니다. 리스크 검토를 저장하거나, 위험을 확인했다고 표시하고 사유에 그 위험을 적으세요.';
 // 평가 3회차: 서버 승인 관문(reviewApprovalError)을 그대로 불러 같은 기준으로 막는다(규칙마다 그 규칙의 말, 공백 빼고 최소 글자 수).
 return reviewApprovalError(card,reason,true)??'';
}
// 리스크 검토 체크리스트 항목(서버 검사: 1~RISK_RULES_MAX개, 항목 1~RISK_RULE_MAX자, 중복 없음).
export function riskChecklist(card:Pick<ScoreCard,'review'>,extra:readonly string[]):string[]{
 const items=[...(card.review?.reasons??[]),...extra].map(x=>x.trim().slice(0,RISK_RULE_MAX)).filter(Boolean);
 return [...new Set(items)].slice(0,RISK_RULES_MAX);
}

// ── 평가 2회차 화면 보조
// 리스크 체크리스트: 서버 필수 항목(riskChecklists, 승인에 세는 것)을 앞에 두고 점수표 사유·기본 항목을 잇는다. 저장 때 필수 항목은 ruleId를 같이 보낸다.
export function riskItemsWithIds(card:Pick<ScoreCard,'review'>,required:readonly RiskRule[]|undefined,extra:readonly string[]):{rule:string;ruleId:string|null}[]{
 const req=required??[];
 return riskChecklist(card,[...req.map(r=>r.text),...extra]).map(rule=>({rule,ruleId:req.find(r=>r.text.trim().slice(0,RISK_RULE_MAX)===rule)?.id??null}));
}
// 출시 뒤 결과 한 줄: 다 지난 가장 긴 창(없으면 진행 중인 가장 짧은 창). 값이 없으면 까닭을 적는다(0으로 채우지 않음).
export function launchOutcomeText(outcome:LaunchOutcome|null|undefined,handedOff:boolean):string{
 if(!handedOff)return '넘기지 않아 판매 결과 없음';
 if(!outcome)return '캠페인 시장 근거로 넘김, 다음 재계산 때 판매 결과를 셉니다';
 if(!outcome.sku)return `판매 결과 미확인: ${outcome.reason??'연결된 카탈로그 SKU가 없습니다'}`;
 const done=outcome.windows.filter(w=>w.complete).sort((a,b)=>b.weeks-a.weeks)[0],w=done??[...outcome.windows].sort((a,b)=>a.weeks-b.weeks)[0];
 if(!w)return `판매 결과 미확인: ${outcome.reason??'집계 창이 없습니다'}`;
 const parts=[w.orders===null?'주문 미확인':`주문 ${groupDigits(w.orders)}건`,w.units===null?'수량 미확인':`${groupDigits(w.units)}개`,w.revenue===null?'매출 미확인':`매출 ${koWon(w.revenue)}`];
 return `${w.weeks}주${w.complete?'':'(진행 중)'} ${parts.join(', ')}`;
}
// 데이터랩 보정 요약: 평균 절대 오차율(MAPE)과 묶음 수. 오차가 없으면 미확인. 보정하지 않은 묶음(평가 3회차 M3)이 있으면 그 수를 덧붙인다.
export function calibrationText(c:CalibrationView|null|undefined):string{
 if(!c)return '아직 보정 보고가 없습니다. 검색광고와 데이터랩을 함께 수집한 뒤 점수를 다시 계산하면 만들어집니다.';
 return `키워드 묶음 ${groupDigits(c.groups)}개, 평균 오차율 ${c.mape===null?'미확인':`${(c.mape*100).toFixed(1)}%`}.${c.uncalibrated?` 보정하지 않은 묶음 ${groupDigits(c.uncalibrated)}개(까닭은 아래 표).`:''}`;
}

// ── 평가 3회차 화면 보조
// 보정 보고 한 행: 오차율(없으면 미확인)과 비고(보정·오차가 없는 까닭, "< 10" 범위 메모). 비고가 없으면 빈 문자열.
export const calibrationErrorText=(row:CalibrationView['rows'][number])=>row.error===null?'미확인':`${(row.error*100).toFixed(1)}%`;
export const calibrationNote=(row:CalibrationView['rows'][number])=>row.reason??(row.error===null?'오차를 잴 기준점이 모자랍니다.':'');
// 넘기기 칸의 카탈로그 상품: 고른 캠페인의 상품 목록, 고르기를 막는 까닭(없으면 빈 문자열), 하나뿐이면 자동으로 고를 ID(서버도 하나뿐이면 그것을 쓴다).
export function catalogChoice(catalogs:Readonly<Record<string,readonly CampaignCatalogItem[]>>|undefined,campaignId:string):{items:readonly CampaignCatalogItem[];why:string;auto:string|null}{
 if(!campaignId)return {items:[],why:'캠페인을 먼저 고르세요.',auto:null};
 const items=catalogs?.[campaignId]??[];
 if(!items.length)return {items,why:'이 캠페인에 카탈로그 상품이 없어 시장 근거와 고객 기회 초안만 넘깁니다. 성장 탭에서 상품을 먼저 만들면 소싱 후보·판매 오퍼 초안도 함께 생깁니다.',auto:null};
 return {items,why:'',auto:items.length===1?items[0].id:null};
}
export const catalogLabel=(x:CampaignCatalogItem)=>x.title&&x.sku?`${x.title} (${x.sku})`:x.title||x.sku||'이름 없는 상품';
// 가중치 재보정 후보 표의 행(하위 점수 9개, 순서 고정). 제안이 없으면 proposed는 null.
export type WeightRow={key:SubScoreKey;base:number;proposed:number|null;rho:number|null;n:number};
export function weightRows(p:WeightsProposalView|null|undefined):WeightRow[]{
 if(!p)return [];
 return SUB_SCORES.map(key=>{const c=p.correlations.find(x=>x.key===key);return {key,base:p.base[key]??0,proposed:p.proposed?.[key]??null,rho:c?.rho??null,n:c?.n??0}});
}
export const weightText=(v:number|null)=>v===null?'미확인':v.toFixed(3);
export const signedRho=(v:number|null)=>v===null?'미확인':v>0?`+${v.toFixed(2)}`:v<0?`−${Math.abs(v).toFixed(2)}`:'0.00';
