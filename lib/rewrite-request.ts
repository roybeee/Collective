// X6 선택 다시 쓰기 요청(순수 모듈, 화면·서버 공용). 제작·발행 캡션 편집기에서 고른 글 한 조각만 HERMES에 보내 다시 쓴 제안을 받는다.
// 이 모듈은 입력 검사·지시문 조립·출력 정리·토큰 추정·조각 바꿔 끼우기만 한다. 저장·전송·권한은 lib/rewrite-request-server.ts, 화면은 components/app/selection-toolbar.tsx다.
// 제안은 사람이 받기 전까지 어디에도 반영되지 않는다(편집기 글도 그대로). 받기·버리기 결정만 요청 기록에 남는다.
import {estimateInputTokens} from './token-estimate';

export const REWRITE_MODES=['rewrite','shorten','tone'] as const;
export const REWRITE_TONES=['friendly','firm'] as const;
export const REWRITE_CHANNELS=['instagram','threads'] as const;
export type RewriteMode=typeof REWRITE_MODES[number];
export type RewriteTone=typeof REWRITE_TONES[number];
export type RewriteChannel=typeof REWRITE_CHANNELS[number];
export type RewriteStatus='starting'|'queued'|'in_progress'|'uncertain'|'completed'|'failed'|'cancelled';
export type RewriteDecision='accepted'|'discarded';
export const REWRITE_ID=/^rw-[A-Za-z0-9_-]{6,60}$/;
export const SELECTION_MAX=2000,CONTEXT_MAX=4000,OUTPUT_MAX=6000;
// 출력 여유: 다시 쓴 글은 고른 글 길이 안팎이다. 지시문·입력 추정에 더한다(서버 예약은 lib/token-budget.ts가 같은 입력 추정식으로 따로 한다).
export const REWRITE_OUTPUT_ALLOWANCE=1000;
export const REWRITE_ACTIVE:readonly RewriteStatus[]=['starting','queued','in_progress','uncertain'];

export type RewriteInput={id:string;campaignId:string;mode:RewriteMode;tone?:RewriteTone;channel:RewriteChannel;selection:string;context:string};
// 요청 기록(kind rewrite_request, 부모 캠페인). 고른 글과 제안 원문은 기록하지만 편집기 전체 글은 남기지 않는다.
export type RewriteRequest={id:string;campaignId:string;mode:RewriteMode;tone?:RewriteTone;channel:RewriteChannel;selection:string;status:RewriteStatus;providerId?:string;suggestion:string|null;
 decision?:RewriteDecision;decidedAt?:string;error?:string;model:string;createdAt:string;updatedAt:string;by:{id:string;role:string}};

export class RewriteInputError extends Error{constructor(message:string){super(message);this.name='RewriteInputError'}}
const isOneOf=<T extends string>(list:readonly T[],value:unknown):value is T=>typeof value==='string'&&(list as readonly string[]).includes(value);

export const REWRITE_LABELS:Record<RewriteMode,string>={rewrite:'다시 쓰기',shorten:'줄이기',tone:'톤 바꾸기'};
export const TONE_LABELS:Record<RewriteTone,string>={friendly:'친근하게',firm:'단정하게'};
export const rewriteLabel=(mode:RewriteMode,tone?:RewriteTone)=>mode==='tone'&&tone?`${REWRITE_LABELS.tone}(${TONE_LABELS[tone]})`:REWRITE_LABELS[mode];

// 요청 본문 검사. 모르는 값·빈 선택·길이 초과는 한국어 사유로 거절한다(서버 400).
export function parseRewriteInput(value:unknown):RewriteInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new RewriteInputError('다시 쓰기 요청 본문이 필요합니다.');
 const v=value as Record<string,unknown>;
 if(typeof v.id!=='string'||!REWRITE_ID.test(v.id))throw new RewriteInputError('요청 번호 형식이 올바르지 않습니다.');
 if(typeof v.campaignId!=='string'||!v.campaignId.trim()||v.campaignId.length>100)throw new RewriteInputError('캠페인을 확인하세요.');
 if(!isOneOf(REWRITE_MODES,v.mode))throw new RewriteInputError('다시 쓰기·줄이기·톤 바꾸기 중 하나를 고르세요.');
 if(v.mode==='tone'&&!isOneOf(REWRITE_TONES,v.tone))throw new RewriteInputError('바꿀 톤(친근하게·단정하게)을 고르세요.');
 if(v.mode!=='tone'&&v.tone!==undefined)throw new RewriteInputError('톤은 톤 바꾸기에서만 고릅니다.');
 const channel=v.channel===undefined?'instagram':v.channel;
 if(!isOneOf(REWRITE_CHANNELS,channel))throw new RewriteInputError('미리보기 채널을 확인하세요.');
 if(typeof v.selection!=='string'||!v.selection.trim())throw new RewriteInputError('다시 쓸 글을 먼저 고르세요.');
 if(v.selection.length>SELECTION_MAX)throw new RewriteInputError(`한 번에 ${SELECTION_MAX.toLocaleString('ko-KR')}자까지 다시 쓸 수 있습니다. 더 짧게 고르세요.`);
 const context=v.context===undefined?'':v.context;
 if(typeof context!=='string'||context.length>CONTEXT_MAX)throw new RewriteInputError(`앞뒤 글은 ${CONTEXT_MAX.toLocaleString('ko-KR')}자까지 보낼 수 있습니다.`);
 return {id:v.id,campaignId:v.campaignId.trim(),mode:v.mode,...(v.mode==='tone'?{tone:v.tone as RewriteTone}:{}),channel,selection:v.selection,context};
}

const GOALS:Record<RewriteMode,string>={rewrite:'뜻과 사실은 그대로 두고 더 읽기 좋게 다시 쓴다.',shorten:'뜻과 사실은 그대로 두고 더 짧게 줄인다(원문보다 짧아야 한다).',tone:''};
const TONES:Record<RewriteTone,string>={friendly:'친근하고 부드러운 말투로 바꾼다(존댓말 유지).',firm:'군더더기 없이 단정한 말투로 바꾼다(존댓말 유지).'};
// HERMES 제출(지시문·입력). 고른 글과 앞뒤 글(참고용)만 보낸다. 사실·숫자·가격·표시 줄을 새로 만들거나 지우지 않게 한다.
export function rewriteSubmission(input:Pick<RewriteInput,'mode'|'tone'|'channel'|'selection'|'context'>):{instructions:string;input:string}{
 const goal=input.mode==='tone'&&input.tone?TONES[input.tone]:GOALS[input.mode];
 const instructions=['너는 COLLECTIVE의 한국어 카피 편집자다. 게시 캡션에서 사용자가 고른 한 조각만 고친다.',goal,
  '고른 조각에 없는 사실·숫자·가격·기간·혜택·효과를 더하지 않는다. 있는 사실·숫자·해시태그·게시 코드·AI 생성물 표시 문장은 그대로 둔다.',
  '앞뒤 글은 흐름을 맞추는 참고용이며 고치지 않는다. 결과는 고친 조각 글만 출력한다. 설명·따옴표·머리말·마크다운을 붙이지 않는다.'].join('\n');
 return {instructions,input:JSON.stringify({channel:input.channel,task:input.mode,...(input.tone?{tone:input.tone}:{}),selection:input.selection,context:input.context})};
}
// 확인 카드의 비용 추정(추정, 실제 사용량은 종료 뒤 기록). 지시문·입력 추정에 출력 여유를 더한다.
export function estimateRewriteTokens(input:Pick<RewriteInput,'mode'|'tone'|'channel'|'selection'|'context'>){
 const s=rewriteSubmission(input);
 return estimateInputTokens(s.instructions+s.input)+REWRITE_OUTPUT_ALLOWANCE;
}
// HERMES 출력 정리: 코드 울타리·감싼 따옴표·'수정본:' 같은 머리말을 걷는다. 비었거나 너무 길면 null(저장하지 않는다).
export function parseRewriteOutput(text:unknown):string|null{
 if(typeof text!=='string')return null;
 const fenced=/^```[a-z]*\n([\s\S]*?)\n```$/i.exec(text.trim());
 const body=(fenced?fenced[1]:text).trim().replace(/^(?:수정본|다시 쓴 글|결과)\s*[:：]\s*/,'').replace(/^["“']([\s\S]*)["”']$/,'$1').trim();
 return body&&body.length<=OUTPUT_MAX?body:null;
}
// 편집기 글에서 고른 범위(start~end)를 바꿔 끼운 새 글. 범위가 어긋나면 null(편집기 글이 그 사이 바뀌었다).
export function spliceSelection(text:string,range:{start:number;end:number;selection:string},replacement:string):string|null{
 if(range.start<0||range.end>text.length||range.start>=range.end||text.slice(range.start,range.end)!==range.selection)return null;
 return text.slice(0,range.start)+replacement+text.slice(range.end);
}
export const isActiveRewrite=(r:{status:string})=>(REWRITE_ACTIVE as readonly string[]).includes(r.status);
// 화면에 돌려줄 모양(접수 번호 없음).
export function publicRewrite(r:RewriteRequest):Omit<RewriteRequest,'providerId'>{const copy:Partial<RewriteRequest>={...r};delete copy.providerId;return copy as Omit<RewriteRequest,'providerId'>}
