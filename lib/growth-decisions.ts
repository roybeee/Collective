import {scanText} from './pii-scan';

export type DecisionInput = {
  title:string; decision:'maintain'|'modify'|'stop'|'explore'|'scale'; reason:string;
  observation:string; alternativeExplanation:string; missionId:string; missionVersion:number;
  journeyId:string; journeyVersion:number; nextAction:string; assignee:string; dueAt:string;
};
export type LessonInput = {
  title:string; method:string; hypothesis:string; scope:string; falsificationRule:string; lossLimit:number|null;
  sourceType:'market'|'execution'|'journey'|'decision'|'manual';
  evidenceLevel:'provisional'|'operational_observation'; missionId:string; missionVersion:number;
  journeyId:string; journeyVersion:number; decisionId:string; decisionVersion:number;
  sourceEvidence:string; counterEvidence:string; expiresAt:string;
  state:'candidate'|'testing'|'reusable'|'retired'; outcome:'not_tested'|'success'|'failure'|'invalid';
  testPlan:string; testResult:string; nextAction:string; assignee:string; dueAt:string; retirementReason:string;
};
export type DecisionAssessment = {missing:string[]; mayExecute:false; mayScale:false; causalStatus:'not_measured'};
export type LessonAssessment = {missing:string[]; canReuse:boolean; mayPromote:false; causalStatus:'not_measured'};
export class GrowthDecisionsError extends Error {
  constructor(message:string) { super(message); this.name='GrowthDecisionsError'; }
}
export function emptyDecisionInput():DecisionInput {
  return {title:'',decision:'maintain',reason:'',observation:'',alternativeExplanation:'',missionId:'',missionVersion:0,
    journeyId:'',journeyVersion:0,nextAction:'',assignee:'',dueAt:''};
}
export function emptyLessonInput():LessonInput {
  return {title:'',method:'',hypothesis:'',scope:'',falsificationRule:'',lossLimit:null,sourceType:'manual',evidenceLevel:'provisional',
    missionId:'',missionVersion:0,journeyId:'',journeyVersion:0,decisionId:'',decisionVersion:0,sourceEvidence:'',counterEvidence:'',
    expiresAt:'',state:'candidate',outcome:'not_tested',testPlan:'',testResult:'',nextAction:'',assignee:'',dueAt:'',retirementReason:''};
}
function object(value:unknown):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new GrowthDecisionsError('입력은 객체여야 합니다.');
  return value as Record<string,unknown>;
}
function safeText(value:unknown,field:string,max=2000):string {
  if (value===undefined) return '';
  if (typeof value!=='string' || value.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new GrowthDecisionsError(`${field}: 유효한 문자열을 입력하세요(최대 ${max}자).`);
  }
  const normalized=value.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g,'');
  if (scanText(normalized).length || /(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*\S+|\bsk-(?:proj-)?[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(normalized)) {
    throw new GrowthDecisionsError(`${field}: 식별정보와 인증정보를 넣을 수 없습니다.`);
  }
  return value.trim();
}
function identifier(value:unknown,field:string):string {
  const result=safeText(value,field,100);
  if (result && !/^[A-Za-z0-9_.:-]+$/.test(result)) throw new GrowthDecisionsError(`${field}: 내부 식별자를 입력하세요.`);
  return result;
}
function version(value:unknown,field:string):number {
  if (value===undefined) return 0;
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<0) throw new GrowthDecisionsError(`${field}: 0 이상의 안전한 정수를 입력하세요.`);
  return value;
}
function choice<T extends string>(value:unknown,values:readonly T[],fallback:T,field:string):T {
  if (value===undefined) return fallback;
  if (typeof value!=='string' || !values.includes(value as T)) throw new GrowthDecisionsError(`${field}: 지원하는 값을 선택하세요.`);
  return value as T;
}
function date(value:unknown,field:string):string {
  const result=safeText(value,field,10);
  if (!result) return '';
  const timestamp=Date.parse(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10)!==result) {
    throw new GrowthDecisionsError(`${field}: 실제 YYYY-MM-DD 날짜를 입력하세요.`);
  }
  return result;
}
function lossLimit(value:unknown):number|null {
  if (value===undefined || value===null) return null;
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<0 || value>1_000_000_000_000) {
    throw new GrowthDecisionsError('손실 한도: 0 이상 1조 이하의 정수를 입력하세요.');
  }
  return value;
}
export function parseDecisionInput(value:unknown):DecisionInput {
  const input=object(value);
  return {title:safeText(input.title,'제목',200),decision:choice(input.decision,['maintain','modify','stop','explore','scale'],'maintain','결정'),
    reason:safeText(input.reason,'이유'),observation:safeText(input.observation,'관측'),alternativeExplanation:safeText(input.alternativeExplanation,'대체 설명'),
    missionId:identifier(input.missionId,'미션 ID'),missionVersion:version(input.missionVersion,'미션 버전'),
    journeyId:identifier(input.journeyId,'구매 병목 ID'),journeyVersion:version(input.journeyVersion,'구매 병목 버전'),
    nextAction:safeText(input.nextAction,'다음 조치'),assignee:safeText(input.assignee,'담당'),dueAt:date(input.dueAt,'기한')};
}
export function parseLessonInput(value:unknown):LessonInput {
  const input=object(value);
  return {title:safeText(input.title,'제목',200),method:safeText(input.method,'방법'),hypothesis:safeText(input.hypothesis,'가설'),
    scope:safeText(input.scope,'적용 범위'),falsificationRule:safeText(input.falsificationRule,'폐기 조건'),lossLimit:lossLimit(input.lossLimit),
    sourceType:choice(input.sourceType,['market','execution','journey','decision','manual'],'manual','출처 유형'),
    evidenceLevel:choice(input.evidenceLevel,['provisional','operational_observation'],'provisional','근거 수준'),
    missionId:identifier(input.missionId,'미션 ID'),missionVersion:version(input.missionVersion,'미션 버전'),
    journeyId:identifier(input.journeyId,'구매 병목 ID'),journeyVersion:version(input.journeyVersion,'구매 병목 버전'),
    decisionId:identifier(input.decisionId,'결정 ID'),decisionVersion:version(input.decisionVersion,'결정 버전'),
    sourceEvidence:safeText(input.sourceEvidence,'출처 근거'),counterEvidence:safeText(input.counterEvidence,'반증'),expiresAt:date(input.expiresAt,'만료일'),
    state:choice(input.state,['candidate','testing','reusable','retired'],'candidate','상태'),
    outcome:choice(input.outcome,['not_tested','success','failure','invalid'],'not_tested','시험 결과'),
    testPlan:safeText(input.testPlan,'시험 계획'),testResult:safeText(input.testResult,'시험 결과 근거'),nextAction:safeText(input.nextAction,'다음 조치'),
    assignee:safeText(input.assignee,'담당'),dueAt:date(input.dueAt,'기한'),retirementReason:safeText(input.retirementReason,'폐기 사유')};
}
function required(fields:readonly (readonly [string,string])[]):string[] {
  return fields.filter(([value])=>!value).map(([,label])=>`${label}를 입력하세요.`);
}
function reference(id:string,version:number,label:string):string[] {
  return (id && version<1) || (!id && version>0)?[`${label} ID와 현재 버전을 함께 연결하세요.`]:[];
}
function overdue(value:string,label:string,now:number):string[] {
  return value && now>=Date.parse(`${value}T00:00:00+09:00`)+86_400_000?[`${label}가 지났습니다.`]:[];
}
export function decisionAssessment(value:DecisionInput,upstream:string[]=[],now=Date.now()):DecisionAssessment {
  const input=parseDecisionInput(value);
  const missing=[...upstream,...required([[input.title,'제목'],[input.reason,'이유'],[input.observation,'관측'],
    [input.alternativeExplanation,'대체 설명'],[input.nextAction,'다음 조치'],[input.assignee,'담당'],[input.dueAt,'기한']]),
    ...reference(input.missionId,input.missionVersion,'미션'),...reference(input.journeyId,input.journeyVersion,'구매 병목'),
    ...(!input.missionId && !input.journeyId?['미션 또는 구매 병목 근거를 연결하세요.']:[]),
    ...overdue(input.dueAt,'기한',now),...(!Number.isFinite(now)?['평가 시각이 유효하지 않습니다.']:[]),
    ...(input.decision==='scale'?['확대는 별도의 검증과 실행 권한 확인이 필요합니다.']:[])];
  return {missing:[...new Set(missing)],mayExecute:false,mayScale:false,causalStatus:'not_measured'};
}
function lessonSources(input:LessonInput):string[] {
  const sourceId=input.sourceType==='execution'?input.missionId:input.sourceType==='journey'?input.journeyId:input.sourceType==='decision'?input.decisionId:null;
  return [...reference(input.missionId,input.missionVersion,'미션'),...reference(input.journeyId,input.journeyVersion,'구매 병목'),
    ...reference(input.decisionId,input.decisionVersion,'결정'),...(sourceId===''?['출처 유형에 맞는 근거를 연결하세요.']:[])];
}
/** Local reuse eligibility never grants rule promotion, causal proof, or external execution authority. */
export function lessonAssessment(value:LessonInput,upstream:string[]=[],now=Date.now()):LessonAssessment {
  const input=parseLessonInput(value);
  const missing=[...upstream,...required([[input.title,'제목'],[input.method,'방법'],[input.hypothesis,'가설'],[input.scope,'적용 범위'],
    [input.sourceEvidence,'출처 근거'],[input.counterEvidence,'반증'],[input.falsificationRule,'폐기 조건'],[input.expiresAt,'만료일'],
    [input.nextAction,'다음 조치'],[input.assignee,'담당'],[input.dueAt,'기한']]),...lessonSources(input),
    ...(input.lossLimit===null?['손실 한도를 확인하세요.']:[]),...overdue(input.expiresAt,'만료일',now),...overdue(input.dueAt,'기한',now),
    ...(!Number.isFinite(now)?['평가 시각이 유효하지 않습니다.']:[])];
  if (input.state==='testing' || input.state==='reusable') missing.push(...required([[input.testPlan,'시험 계획']]));
  if (input.state==='reusable') {
    missing.push(...required([[input.testResult,'시험 결과 근거']]));
    if (input.evidenceLevel!=='operational_observation') missing.push('운영 관측 근거를 확인하세요.');
    if (input.outcome!=='success' && input.outcome!=='failure') missing.push('유효한 성공 또는 실패 시험 결과를 확인하세요.');
  }
  if (input.state==='retired') missing.push(...required([[input.retirementReason,'폐기 사유']]));
  return {missing:[...new Set(missing)],canReuse:input.state==='reusable' && missing.length===0,mayPromote:false,causalStatus:'not_measured'};
}
