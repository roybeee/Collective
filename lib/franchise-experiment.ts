// 트랙 R R6d-2 모집 소재 실험 선별 순수 모듈. 같은 채널·같은 기간에 한 변수만 바꾼 두 모집 자료 판(recruitment_asset)의 플랫폼 보고 수치를
// 사람이 입력하면 lib/viral-stats.ts를 수정 없이 불러 판정한다. 가설·바꾼 변수·주지표·판정 기준(팔당 최소 표본 100, lib/learning-server.ts experimentPlan과 같음)은
// 기간 시작 전에 적는다(시작일이 오늘보다 이르면 409). 결과에는 '플랫폼 보고, 원장 리드 아님'을 붙이고, 확인 층(원장 코드 귀속 리드·설명회 참석)은 건수로만 보이고
// n<20이면 비율을 숨긴다. 적격 판정 기록은 아직 없어 적격 리드 칸은 비운다. 시계·조회·모델 호출이 없다(LLM 0). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {isDate,addDays,kstMidnight,parseInstant} from './franchise-rules';
import {GATE_DISCLAIMER} from './franchise-gates';
import {isRecruitmentChannel,PLATFORM_REPORTED_NOTE,type RecruitmentChannel} from './franchise-recruitment';
import {summarizeResult,type ViralStats,type Judgement} from './viral-stats';
import {scanText} from './pii-scan';

export const EXPERIMENT_VERSION='fr-exp@2026-09-27.1';
// 팔당 최소 표본(lib/learning-server.ts experimentPlan 'minSample<100' 거부와 같은 값). 관찰 시간·목표 개선율 범위도 같다.
export const EXPERIMENT_MIN_SAMPLE=100,EXPERIMENT_MAX_HOURS=2160,EXPERIMENT_MAX_LIFT=1000,EXPERIMENT_MAX_DAYS=92,EXPERIMENT_HISTORY=10;
// 확인 층: 원장 건수가 이보다 작으면 비율을 숨긴다(H12 작은 표본 규칙).
export const LEDGER_RATE_MIN=20;
export const EXPERIMENT_METRICS={ctr:{label:'클릭률',numerator:'클릭',denominator:'노출'},form_rate:{label:'양식 제출률',numerator:'양식 제출',denominator:'클릭'}} as const;
export type ExperimentMetric=keyof typeof EXPERIMENT_METRICS;
export const QUALIFIED_NOTE='적격 판정 기록이 아직 없어 적격 리드 수는 비웁니다.';
export const EXPERIMENT_NOTES=[
 `수치는 ${PLATFORM_REPORTED_NOTE}입니다. 원장 리드·계약과 섞지 않습니다.`,
 '가설·바꾼 변수·판정 기준은 기간 시작 전에 적었고 바꾸지 않습니다.',
 '두 판은 각각 승인(R2 판정)을 거친 모집 자료입니다. 수익 수치를 넣은 변형은 만들지 않습니다(H6).',
 '확인 층의 원장 리드·설명회 참석은 건수로 보이고 20건 미만이면 비율을 숨깁니다. 귀속≠증분입니다.',
] as const;

export const EXPERIMENT_CODES=['invalid_input','channel_unknown','metric_unknown','text_invalid','text_pii','arm_invalid','arms_same','asset_other_brand','asset_type_mismatch','plan_invalid','period_invalid',
 'observed_invalid','arm_counts_invalid','comparable_required','period_started','asset_not_approved','asset_review_needed','experiment_not_started','experiment_closed'] as const;
export type ExperimentCode=typeof EXPERIMENT_CODES[number];
export const EXPERIMENT_CODE_STATUS:Readonly<Record<ExperimentCode,400|409>>={invalid_input:400,channel_unknown:400,metric_unknown:400,text_invalid:400,text_pii:400,arm_invalid:400,arms_same:400,asset_other_brand:400,asset_type_mismatch:400,
 plan_invalid:400,period_invalid:400,observed_invalid:400,arm_counts_invalid:400,comparable_required:400,period_started:409,asset_not_approved:409,asset_review_needed:409,experiment_not_started:409,experiment_closed:409};
// 고정 문구. 입력 값을 끼워 넣지 않는다.
export const EXPERIMENT_MESSAGES:Readonly<Record<ExperimentCode,string>>={
 invalid_input:'입력 형식을 확인하세요.',
 channel_unknown:'모집 채널을 확인하세요.',
 metric_unknown:'주지표는 클릭률(클릭 ÷ 노출)이나 양식 제출률(양식 제출 ÷ 클릭) 가운데 하나입니다.',
 text_invalid:'바꾼 변수는 1~200자, 가설은 1~1000자로 적어 주세요. 제어 문자는 넣을 수 없습니다.',
 text_pii:'가설·바꾼 변수에 개인정보로 보이는 값이 있습니다. 지우고 다시 입력하세요.',
 arm_invalid:'대조안·실험안은 모집 자료 id와 판 번호로 골라 주세요.',
 arms_same:'대조안과 실험안은 서로 다른 자료 판이어야 합니다.',
 asset_other_brand:'이 브랜드의 모집 자료 판이 아닙니다.',
 asset_type_mismatch:'대조안과 실험안은 같은 유형의 모집 자료여야 합니다(한 변수만 바꿉니다).',
 plan_invalid:`팔당 최소 표본은 ${EXPERIMENT_MIN_SAMPLE} 이상의 정수, 최소 관찰 시간은 1~${EXPERIMENT_MAX_HOURS}시간, 목표 개선율은 0 초과 ${EXPERIMENT_MAX_LIFT}% 이하로 적어 주세요.`,
 period_invalid:`기간은 YYYY-MM-DD 시작 ≤ 끝이고 ${EXPERIMENT_MAX_DAYS}일 이하여야 합니다.`,
 observed_invalid:'측정 끝 날짜는 기간 안이고 오늘(KST)을 넘을 수 없습니다.',
 arm_counts_invalid:'분모와 반응 수는 0 이상의 정수이고 반응 수는 분모를 넘을 수 없습니다(분모 10억 이하).',
 comparable_required:'두 판의 대상·기간·배포 조건이 비교 가능한지 적어 주세요.',
 period_started:'가설과 판정 기준은 기간 시작 전에 적습니다. 시작일을 오늘(KST) 이후로 고르세요.',
 asset_not_approved:'승인된 모집 자료 판만 실험에 쓸 수 있습니다(각 판이 R2 판정을 거쳐야 합니다).',
 asset_review_needed:'재검토가 걸린 모집 자료 판은 실험에 쓸 수 없습니다.',
 experiment_not_started:'기간이 시작되기 전에는 결과를 적을 수 없습니다.',
 experiment_closed:'이미 끝났거나 취소한 실험입니다.',
};

export type ExperimentArm={assetId:string;version:number};
export type ExperimentPlan={channel:RecruitmentChannel;metric:ExperimentMetric;variable:string;hypothesis:string;control:ExperimentArm;treatment:ExperimentArm;minSample:number;minHours:number;minLift:number;period:{from:string;to:string}};
export type ArmCounts={denominator:number;numerator:number};
export type ExperimentResult={control:ArmCounts;treatment:ArmCounts;comparable:boolean;observedUntil:string};
export type ExperimentAssessment={status:Judgement;label:string;controlRate:number|null;treatmentRate:number|null;lift:number|null;reasons:string[]};
export type ExperimentLook={result:ExperimentResult;assessment:ExperimentAssessment;stats:ViralStats|null;recordedAt:string};
export type ExperimentStatus='planned'|'evaluated'|'cancelled';
export type ExperimentLite={status:ExperimentStatus;plan:ExperimentPlan;looks:readonly ExperimentLook[]};
export type AssetVersionLite={id:string;version:number;brandId:string;type:string;status:string;review?:{needed?:boolean}|null};
export type ExperimentDecision<T>=|{ok:true;status:200;value:T;ruleVersion:string;disclaimer:string}|{ok:false;status:400|409;reasons:ExperimentCode[];message:string;ruleVersion:string;disclaimer:string};

const HIDDEN=/[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}\u2028\u2029]/u;
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const DAY_MS=86400000;
function fail<T>(codes:readonly ExperimentCode[]):ExperimentDecision<T>{
 const reasons=[...new Set(codes)].sort((a,b)=>EXPERIMENT_CODE_STATUS[a]-EXPERIMENT_CODE_STATUS[b]||(a<b?-1:1));
 return {ok:false,status:EXPERIMENT_CODE_STATUS[reasons[0]],reasons,message:EXPERIMENT_MESSAGES[reasons[0]],ruleVersion:EXPERIMENT_VERSION,disclaimer:GATE_DISCLAIMER};
}
const pass=<T>(value:T):ExperimentDecision<T>=>({ok:true,status:200,value,ruleVersion:EXPERIMENT_VERSION,disclaimer:GATE_DISCLAIMER});
// 판정 함수는 던지지 않는다. 예상하지 못한 예외는 invalid_input으로 닫는다.
function guarded<T>(run:()=>ExperimentDecision<T>):ExperimentDecision<T>{try{return run()}catch{return fail(['invalid_input'])}}
const textOk=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>=1&&v.length<=max&&!HIDDEN.test(v.replace(/\n/g,''));
const armOf=(v:unknown):ExperimentArm|null=>isRecord(v)&&typeof v.assetId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v.assetId)&&Number.isSafeInteger(v.version)&&(v.version as number)>=1?{assetId:v.assetId,version:v.version as number}:null;
const intIn=(v:unknown,min:number,max:number):v is number=>Number.isSafeInteger(v)&&(v as number)>=min&&(v as number)<=max;
const PLAN_KEYS=['channel','metric','variable','hypothesis','control','treatment','minSample','minHours','minLift','period'];

// ── 계획(기간 시작 전) ──
export function planDecision(input:unknown,ctx:{brandId:string;today:string;assets:readonly AssetVersionLite[]}):ExperimentDecision<ExperimentPlan>{
 return guarded(()=>{
  if(!isRecord(input)||Object.keys(input).some(k=>!PLAN_KEYS.includes(k)))return fail(['invalid_input']);
  const bad:ExperimentCode[]=[];
  if(!isRecruitmentChannel(input.channel))bad.push('channel_unknown');
  if(typeof input.metric!=='string'||!Object.hasOwn(EXPERIMENT_METRICS,input.metric))bad.push('metric_unknown');
  const texts=textOk(input.variable,200)&&textOk(input.hypothesis,1000);
  if(!texts)bad.push('text_invalid');
  else if(scanText(input.variable as string).length||scanText(input.hypothesis as string).length)bad.push('text_pii');
  const control=armOf(input.control),treatment=armOf(input.treatment);
  if(!control||!treatment)bad.push('arm_invalid');
  else if(control.assetId===treatment.assetId&&control.version===treatment.version)bad.push('arms_same');
  const minLift=input.minLift;
  if(!intIn(input.minSample,EXPERIMENT_MIN_SAMPLE,1e9)||!intIn(input.minHours,1,EXPERIMENT_MAX_HOURS)||typeof minLift!=='number'||!Number.isFinite(minLift)||minLift<=0||minLift>EXPERIMENT_MAX_LIFT)bad.push('plan_invalid');
  const p=isRecord(input.period)?input.period:{},from=p.from,to=p.to;
  const periodOk=isDate(from)&&isDate(to)&&from<=to&&addDays(from,EXPERIMENT_MAX_DAYS-1)>=to;
  if(!periodOk)bad.push('period_invalid');
  const find=(a:ExperimentArm|null)=>a?ctx.assets.find(x=>x.id===a.assetId&&x.version===a.version&&x.brandId===ctx.brandId)??null:null;
  const c=find(control),t=find(treatment);
  if(control&&treatment&&(!c||!t))bad.push('asset_other_brand');
  if(c&&t&&c.type!==t.type)bad.push('asset_type_mismatch');
  if(bad.length)return fail(bad);
  const state:ExperimentCode[]=[];
  if((from as string)<ctx.today)state.push('period_started');
  if(c!.status!=='approved'||t!.status!=='approved')state.push('asset_not_approved');
  if(c!.review?.needed||t!.review?.needed)state.push('asset_review_needed');
  if(state.length)return fail(state);
  return pass({channel:input.channel as RecruitmentChannel,metric:input.metric as ExperimentMetric,variable:(input.variable as string).trim(),hypothesis:(input.hypothesis as string).trim(),control:control!,treatment:treatment!,
   minSample:input.minSample as number,minHours:input.minHours as number,minLift:minLift as number,period:{from:from as string,to:to as string}});
 });
}

// ── 판정(lib/learning.ts evaluateExperiment와 같은 기준, 가맹 쪽에서 따로 쓴다) ──
const LABELS:Readonly<Record<Judgement,string>>={insufficient:'근거 부족',promising:'관찰상 개선',not_supported:'개선 가설 미지지',inconclusive:'차이 불명확'};
const startOf=(plan:ExperimentPlan)=>kstMidnight(plan.period.from);
// 측정 끝 = 측정 끝 날짜 다음 날 0시(KST). 그날까지의 수치를 적은 것으로 본다.
const endOf=(observedUntil:string)=>kstMidnight(addDays(observedUntil,1));
export function assess(plan:ExperimentPlan,r:ExperimentResult):ExperimentAssessment{
 const rate=(x:ArmCounts)=>x.denominator>0?x.numerator/x.denominator:null,ar=rate(r.control),br=rate(r.treatment),reasons:string[]=[];
 const lift=ar!==null&&ar>0&&br!==null?(br/ar-1)*100:null;
 if(ar===null||br===null)reasons.push('주지표의 수치와 0보다 큰 분모가 필요합니다.');
 if(r.control.denominator<plan.minSample||r.treatment.denominator<plan.minSample)reasons.push('두 판 모두 사전에 정한 최소 표본에 도달해야 합니다.');
 if(parseInstant(endOf(r.observedUntil))-parseInstant(startOf(plan))<plan.minHours*3600000)reasons.push('사전에 정한 관찰 시간이 지나지 않았습니다.');
 if(!r.comparable)reasons.push('대상·기간·배포 조건의 비교 가능성을 확인해야 합니다.');
 if(ar===0)reasons.push('대조안의 반응이 0이므로 상대 개선율을 판정할 수 없습니다.');
 const status:Judgement=reasons.length?'insufficient':lift!==null&&lift>=plan.minLift?'promising':lift!==null&&lift<=-plan.minLift?'not_supported':'inconclusive';
 return {status,label:LABELS[status],controlRate:ar,treatmentRate:br,lift,reasons};
}
// 판정할 수 있는 결과(계획 충족·비교 가능)를 본 횟수. viral-stats가 반복 확인을 경고한다.
const completeLook=(l:ExperimentLook)=>l.assessment.status!=='insufficient';
const countsOf=(v:unknown):ArmCounts|null=>isRecord(v)&&intIn(v.denominator,0,1e9)&&intIn(v.numerator,0,1e9)&&(v.numerator as number)<=(v.denominator as number)?{denominator:v.denominator as number,numerator:v.numerator as number}:null;
const RESULT_KEYS=['control','treatment','comparable','observedUntil'];

// ── 결과(사람이 입력한 플랫폼 보고 수치) ──
export function resultDecision(exp:ExperimentLite,input:unknown,ctx:{today:string;nowMs:number;recordedAt:string}):ExperimentDecision<ExperimentLook>{
 return guarded(()=>{
  if(!isRecord(input)||Object.keys(input).some(k=>!RESULT_KEYS.includes(k)))return fail(['invalid_input']);
  const plan=exp.plan,bad:ExperimentCode[]=[];
  const control=countsOf(input.control),treatment=countsOf(input.treatment);
  if(!control||!treatment)bad.push('arm_counts_invalid');
  if(typeof input.comparable!=='boolean')bad.push('comparable_required');
  const until=input.observedUntil;
  if(!isDate(until)||until<plan.period.from||until>plan.period.to||until>ctx.today)bad.push('observed_invalid');
  if(bad.length)return fail(bad);
  if(exp.status==='cancelled')return fail(['experiment_closed']);
  if(ctx.today<plan.period.from)return fail(['experiment_not_started']);
  const result:ExperimentResult={control:control!,treatment:treatment!,comparable:input.comparable as boolean,observedUntil:until as string};
  const assessment=assess(plan,result),looks=exp.looks.filter(completeLook).length;
  const stats=summarizeResult({minSample:plan.minSample,minHours:plan.minHours,startedAt:startOf(plan)},{control:result.control,treatment:result.treatment,observedUntil:endOf(result.observedUntil),comparable:result.comparable},looks,ctx.nowMs,assessment.status);
  return pass({result,assessment,stats,recordedAt:ctx.recordedAt});
 });
}
export function cancelDecision(exp:ExperimentLite):ExperimentDecision<true>{return exp.status==='cancelled'?fail(['experiment_closed']):pass(true)}

// ── 확인 층(원장): 판별 코드 귀속 리드·설명회 참석 건수. 비율은 원장 리드 20건 이상일 때만 ──
export type LedgerLead={assetRef:ExperimentArm|null;receivedDate:string};
export type LedgerEvent={assetRefs:readonly {id:string;version:number}[];startsDate:string;attended:number;cancelled:boolean};
export type LedgerArm={leads:number;attended:number;attendedPerLead:number|null;qualified:null};
export function ledgerConfirm(plan:ExperimentPlan,leads:readonly LedgerLead[],events:readonly LedgerEvent[]):{control:LedgerArm;treatment:LedgerArm;minForRate:number;qualifiedNote:string}{
 const inPeriod=(d:string)=>d>=plan.period.from&&d<=plan.period.to;
 const arm=(a:ExperimentArm):LedgerArm=>{
  const n=leads.filter(l=>l.assetRef?.assetId===a.assetId&&l.assetRef.version===a.version&&inPeriod(l.receivedDate)).length;
  const attended=events.filter(e=>!e.cancelled&&inPeriod(e.startsDate)&&e.assetRefs.some(r=>r.id===a.assetId&&r.version===a.version)).reduce((s,e)=>s+e.attended,0);
  return {leads:n,attended,attendedPerLead:n>=LEDGER_RATE_MIN?attended/n:null,qualified:null};
 };
 return {control:arm(plan.control),treatment:arm(plan.treatment),minForRate:LEDGER_RATE_MIN,qualifiedNote:QUALIFIED_NOTE};
}
export const periodDays=(p:{from:string;to:string})=>Math.round((Date.parse(p.to+'T00:00:00Z')-Date.parse(p.from+'T00:00:00Z'))/DAY_MS)+1;
