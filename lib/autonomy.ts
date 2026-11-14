// G3 자율성 규칙(순수 모듈). 소유자가 행동별로 auto(사람 확인 없이 진행)·ask(사람이 누른다, 기본)·never(차단)를 정한다.
// 등급 어휘는 lib/growth-authority.ts의 AuthorityTier(T0~T4)를 그대로 쓴다. 그 모듈의 tier()는 publish를 T2로 두지만,
// 여기서는 외부로 나가는 발행 접수(publish_submit)를 광고 활성화·예산 변경·고객 발송과 같은 T3 묶음으로 올려 자동 실행을 금지한다(에픽 G3 "고위험은 never 고정" 요건의 완화형: ask 또는 never만).
// 이 모듈은 저장·권한을 모른다. 서버 적용은 lib/autonomy-server.ts, 화면은 app/autonomy-panel.tsx다.
import type {AuthorityTier} from './growth-authority';

export const AUTONOMY_ACTIONS=['role_run','meeting_start','brief_draft','research_run','data_collect','publish_submit','ad_activate','budget_change','customer_send','policy_change','conversion_send'] as const;
export type AutonomyAction=typeof AUTONOMY_ACTIONS[number];
export const AUTONOMY_MODES=['auto','ask','never'] as const;
export type AutonomyMode=typeof AUTONOMY_MODES[number];
export type AutonomySettings=Record<AutonomyAction,AutonomyMode>;
export type AutonomyDecision={action:AutonomyAction;mode:AutonomyMode;tier:AuthorityTier;reason:string;enabled:boolean};
export type AutonomyActionInfo={action:AutonomyAction;label:string;tier:AuthorityTier;allowedModes:readonly AutonomyMode[];disabledReason:string|null};

export class AutonomyError extends Error{constructor(message:string){super(message);this.name='AutonomyError'}}

export const AUTONOMY_TIERS:Record<AutonomyAction,AuthorityTier>={
 research_run:'T0',data_collect:'T0',
 role_run:'T1',meeting_start:'T1',brief_draft:'T1',
 publish_submit:'T3',ad_activate:'T3',budget_change:'T3',customer_send:'T3',
 policy_change:'T4',
 // 당근 전환 이벤트 전송(lib/daangn-conversions-server.ts). 레지스트리 daangn_ads.conversion.send가 T4라 자동이 없다(확인 후·금지만).
 conversion_send:'T4',
};
export const AUTONOMY_LABELS:Record<AutonomyAction,string>={
 role_run:'역할 실행(단독 역할·연속 실행)',meeting_start:'팀 회의 시작',brief_draft:'브리프 초안 작성',research_run:'브랜드 조사 실행',data_collect:'성과·주문 자료 수집',
 publish_submit:'발행 접수(Buffer 전송)',ad_activate:'광고 활성화(Meta)',budget_change:'예산 변경',customer_send:'고객 발송',policy_change:'정책·규칙 변경',
 conversion_send:'전환 이벤트 전송(당근 광고)',
};
export const AUTONOMY_MODE_LABELS:Record<AutonomyMode,string>={auto:'자동',ask:'확인 후',never:'금지'};
export const HIGH_TIER_REASON='T3 이상 행동(발행 접수·광고 활성화·예산 변경·고객 발송·정책 변경)은 자동으로 실행할 수 없습니다. 확인 후 또는 금지만 고를 수 있습니다.';
const DISABLED_REASON='자율성 규칙 스위치가 꺼져 있어 모든 행동은 사람이 확인한 뒤 진행합니다.';

export const isAutonomyAction=(value:unknown):value is AutonomyAction=>typeof value==='string'&&(AUTONOMY_ACTIONS as readonly string[]).includes(value);
export const isAutonomyMode=(value:unknown):value is AutonomyMode=>typeof value==='string'&&(AUTONOMY_MODES as readonly string[]).includes(value);
export const isHighTier=(action:AutonomyAction)=>Number(AUTONOMY_TIERS[action].slice(1))>=3;
export const allowedModes=(action:AutonomyAction):readonly AutonomyMode[]=>isHighTier(action)?['ask','never']:AUTONOMY_MODES;

export function defaultAutonomySettings():AutonomySettings{
 return Object.fromEntries(AUTONOMY_ACTIONS.map(action=>[action,'ask']))as AutonomySettings;
}
export function autonomyActionInfos():AutonomyActionInfo[]{
 return AUTONOMY_ACTIONS.map(action=>({action,label:AUTONOMY_LABELS[action],tier:AUTONOMY_TIERS[action],allowedModes:allowedModes(action),disabledReason:isHighTier(action)?HIGH_TIER_REASON:null}));
}
// 저장할 설정을 검사한다. 부분 입력은 base 위에 덮어 새 객체를 돌려준다. 모르는 행동·모드와 고위험 행동의 auto는 거부한다(한국어 사유).
export function parseAutonomySettings(value:unknown,base:AutonomySettings=defaultAutonomySettings()):AutonomySettings{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AutonomyError('행동별 자율성 설정 객체가 필요합니다.');
 const input=value as Record<string,unknown>;
 const next:AutonomySettings={...base};
 for(const [key,mode] of Object.entries(input)){
  if(!isAutonomyAction(key))throw new AutonomyError(`알 수 없는 행동입니다: ${key.slice(0,40)}`);
  if(!isAutonomyMode(mode))throw new AutonomyError(`${AUTONOMY_LABELS[key]}의 모드는 자동(auto)·확인 후(ask)·금지(never) 중 하나여야 합니다.`);
  if(mode==='auto'&&isHighTier(key))throw new AutonomyError(`${AUTONOMY_LABELS[key]}: ${HIGH_TIER_REASON}`);
  next[key]=mode;
 }
 return next;
}
// 저장된 값이 손상돼도 평가는 멈추지 않는다: 모르는 키는 버리고 고위험 auto는 ask로 읽는다.
export function sanitizeAutonomySettings(value:unknown):AutonomySettings{
 const base=defaultAutonomySettings();
 if(!value||typeof value!=='object'||Array.isArray(value))return base;
 const input=value as Record<string,unknown>;
 for(const action of AUTONOMY_ACTIONS){
  const mode=input[action];
  if(isAutonomyMode(mode)&&!(mode==='auto'&&isHighTier(action)))base[action]=mode;
 }
 return base;
}
// 결정: 스위치가 꺼져 있으면 무엇이든 ask(동작 변화 없음). 켜져 있으면 저장된 모드. 사유는 화면·403 응답에 그대로 쓴다.
export function evaluateAutonomy(settings:AutonomySettings|null|undefined,action:AutonomyAction,options:{enabled?:boolean}={}):AutonomyDecision{
 if(!isAutonomyAction(action))throw new AutonomyError('알 수 없는 행동입니다.');
 const tier=AUTONOMY_TIERS[action],label=AUTONOMY_LABELS[action],enabled=options.enabled!==false;
 if(!enabled)return {action,mode:'ask',tier,reason:DISABLED_REASON,enabled};
 const mode=sanitizeAutonomySettings(settings)[action];
 const reason=mode==='never'?`${label}은(는) 소유자의 자율성 규칙에서 금지되어 실행할 수 없습니다. 설정 > 자율성 규칙에서 바꿀 수 있습니다.`
  :mode==='auto'?`${label}은(는) 자율성 규칙에서 자동(${tier})으로 허용되었습니다.`
  :`${label}은(는) 사람이 확인한 뒤 진행합니다(${tier}).`;
 return {action,mode,tier,reason,enabled};
}
export const autonomyBlocked=(decision:AutonomyDecision)=>decision.mode==='never';
