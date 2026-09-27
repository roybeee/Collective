// B5 맥락 정책 리플레이 서버 조회(GET /api/context-replay, 설계 docs/CONTEXT-REPLAY.ko.md). 모델 호출 없는 분석 전용이다: 쓰기·잠금·HERMES·OpenAI 호출이 없고 운영 제출 경로는 그대로다.
// 소유자(owner) 범위의 최근 hermes_submission(기본 50건, 최대 200건, 최신순, input 문자 합 MAX_TOTAL_CHARS 이내)을 읽기 전용으로 읽고, 저장한 입력(body.input)을 순수 비교(lib/context-replay.ts replay·comparisonMarkdown,
// 후보 정책은 lib/context-policies.ts)에 넘긴다. 원문 보호: 본문(instructions·input)은 이 모듈 안에서만 쓰고 응답에는 통계만 싣는다. 제출 id·지시문도 응답에 싣지 않는다.
// 대상: 캠페인을 부모로 둔 제출(역할 실행 lib/role-execution.ts·회의 단계 lib/meeting-execution.ts). 브리프·조사·학습 제출은 부모가 캠페인이 아니어서 읽지 않는다.
// 종류 판별(lib/token-budget.ts submissionKind와 같은 근거): jobs 행(id=제출 id)이 있으면 역할(jobs.role). 제출 id가 '<회의 id>:<단계>[:<역할>][:retry:<n>]'(lib/meeting-repair.ts meetingSubmissionId)이고
// 그 회의(team_meeting)가 이 소유자의 것이면 회의 단계. 그 밖은 'unknown'(비교에서 빼고 수만 센다). 로컬 스크립트(scripts/eval/context-replay.mjs)가 같은 조회·비교표를 쓴다.
import {ApiError,database,stamp} from './server';
import {comparisonMarkdown,replay,type ReplaySummary} from './context-replay';
import type {ReplaySubmission} from './context-policies';

// MAX_TOTAL_CHARS: 한 요청이 옮기는 input 문자 합의 상한(최신순 누적). 품질 단계 회의 입력은 1건에 10만~24만 자라 200건 전부를 올리면 Workers isolate 메모리(128MB)를 넘을 수 있다.
export const DEFAULT_LIMIT=50,MAX_LIMIT=200,MAX_TOTAL_CHARS=8000000;
const FILTERS=['role','meeting','all'] as const;
export type ReplayFilter=typeof FILTERS[number];
export type ReplayQuery={limit:number;kind:ReplayFilter};
export type StoredSubmission={kind:'role'|'meeting'|'unknown';role:string|null;stage:string|null;input:string};
export function replayQuery(params:URLSearchParams):ReplayQuery{
 const limit=params.get('limit')||String(DEFAULT_LIMIT),kind=params.get('kind')||'all';
 if(!/^\d{1,3}$/.test(limit)||Number(limit)<1||Number(limit)>MAX_LIMIT)throw new ApiError(400,`조회 건수(limit)는 1~${MAX_LIMIT} 사이 정수로 입력하세요.`);
 if(!(FILTERS as readonly string[]).includes(kind))throw new ApiError(400,'종류(kind)는 role·meeting·all 중 하나로 입력하세요.');
 return {limit:Number(limit),kind:kind as ReplayFilter};
}
// 회의 제출 id. 회의 번호에는 ':'가 없다(lib/meeting-execution.ts 회의 번호 검증). 합의(synthesis)·품질(quality) 단계는 id에 역할이 없어 입력의 role로 정한다(lib/context-policies.ts submissionRole).
const MEETING_ID=/^[A-Za-z0-9_-]{1,100}:(discussion|synthesis|revision|quality)(?::([a-z_]{1,40}))?(?::retry:\d{1,4})?$/;
export function classifySubmission(id:string,jobRole:string|null,meeting:boolean):Omit<StoredSubmission,'input'>{
 if(jobRole)return {kind:'role',role:jobRole,stage:null};
 const m=meeting?MEETING_ID.exec(id):null;
 return m?{kind:'meeting',role:m[2]??null,stage:m[1]}:{kind:'unknown',role:null,stage:null};
}
// len: input 문자 수(읽을 수 없으면 null). input: 문자 예산 안이면 input 문자열, 예산을 넘었거나 읽을 수 없으면 null.
type Row={sid:string;at:string;input:string|null;len:number|null;jobRole:string|null;meeting:number};
// 종류 필터는 판별과 같은 근거(jobs 행·회의 레코드)로 SQL에서 건다. 바인드 값은 필터와 무관하게 5개로 고정이다(D1 한도 100).
const KIND_SQL:Record<ReplayFilter,string>={all:'',role:' AND j.role IS NOT NULL',meeting:' AND j.role IS NULL AND m.id IS NOT NULL'};
// 저장 본문 {instructions,input,session_id,conversation_history}(records.data의 body 문자열)에서 input 문자열만 SQL로 꺼낸다. 지시문은 옮기지 않는다.
// data·body가 JSON이 아니거나 body·input이 문자열이 아니면 NULL(읽을 수 없음)이다. json_valid·json_type으로 먼저 걸러 손상된 본문 하나가 쿼리 전체를 실패시키지 않는다.
const INPUT_SQL=`CASE WHEN json_valid(b.data) AND json_type(b.data,'$.body')='text' AND json_valid(json_extract(b.data,'$.body')) AND json_type(json_extract(b.data,'$.body'),'$.input')='text' THEN json_extract(json_extract(b.data,'$.body'),'$.input') END`;
// 안쪽 쿼리는 id·판별 열만 정렬해 최근 limit건을 고르고(오래된 제출의 본문은 읽지 않는다), 그 행의 input만 꺼낸다.
// 바깥 쿼리는 최신순으로 input 길이를 누적(cum)해 문자 예산 이하인 행에만 input을 싣는다. 예산을 넘는 행은 len만 온다(overBudget).
const RECENT_SQL=(kind:ReplayFilter)=>`SELECT sid,at,jobRole,meeting,len,CASE WHEN cum<=? THEN input END AS input FROM (SELECT sid,at,rn,jobRole,meeting,input,len,SUM(len) OVER (ORDER BY at DESC,rn DESC ROWS UNBOUNDED PRECEDING) AS cum`
 +` FROM (SELECT sid,at,rn,jobRole,meeting,input,length(input) AS len FROM (SELECT t.sid,t.at,t.rn,t.jobRole,t.meeting,${INPUT_SQL} AS input FROM (SELECT s.id AS rid,s.rn,s.at,s.sid,j.role AS jobRole,m.id IS NOT NULL AS meeting`
 +` FROM (SELECT id,owner,rowid AS rn,updated_at AS at,substr(id,?) AS sid FROM records s WHERE s.owner=? AND s.kind='hermes_submission' AND s.parent_id<>''`
 +` AND EXISTS(SELECT 1 FROM records c WHERE c.id=s.owner||':campaign:'||s.parent_id AND c.owner=s.owner AND c.kind='campaign')) s`
 +` LEFT JOIN jobs j ON j.id=s.sid AND j.owner=s.owner LEFT JOIN records m ON m.id=?||substr(s.sid,1,instr(s.sid,':')-1) AND m.owner=s.owner AND m.kind='team_meeting'`
 +` WHERE 1${KIND_SQL[kind]} ORDER BY s.at DESC,s.rn DESC LIMIT ?) t JOIN records b ON b.id=t.rid))) ORDER BY at DESC,rn DESC`;
// submissions = role + meeting + unknown + unreadable + overBudget. overBudget: 문자 예산을 넘어 input을 옮기지 않은 제출(비교에서 뺀다).
// from·to: 읽은 제출 중 가장 오래된·최근 저장 시각(UTC, records.updated_at). 읽은 제출이 없으면 null.
export type ReplayCounts={submissions:number;role:number;meeting:number;unknown:number;unreadable:number;overBudget:number;from:string|null;to:string|null};
export async function readReplaySubmissions(owner:string,query:ReplayQuery,maxChars=MAX_TOTAL_CHARS):Promise<{submissions:StoredSubmission[];counts:ReplayCounts}>{
 const from=`${owner}:hermes_submission:`.length+1;
 const rows=(await database().prepare(RECENT_SQL(query.kind)).bind(maxChars,from,owner,`${owner}:team_meeting:`,query.limit).all<Row>()).results;
 const submissions:StoredSubmission[]=rows.flatMap(row=>typeof row.input==='string'?[{...classifySubmission(row.sid,row.jobRole,!!row.meeting),input:row.input}]:[]);
 const count=(kind:StoredSubmission['kind'])=>submissions.filter(s=>s.kind===kind).length,unreadable=rows.filter(r=>r.len===null).length;
 return {submissions,counts:{submissions:rows.length,role:count('role'),meeting:count('meeting'),unknown:count('unknown'),unreadable,overBudget:rows.length-submissions.length-unreadable,from:rows.at(-1)?.at??null,to:rows[0]?.at??null}};
}
// 판별한 역할·회의 제출만 비교에 넘긴다. 역할·단계를 id·jobs에서 알면 메타로 싣고, 모르면 비교 모듈이 입력의 role·phase로 정한다.
const forReplay=(list:StoredSubmission[]):ReplaySubmission[]=>list.flatMap(s=>s.kind==='unknown'?[]:[{kind:s.kind,input:s.input,...(s.role?{role:s.role}:{}),...(s.stage?{stage:s.stage}:{})}]);
export const replaySubmissions=(list:StoredSubmission[])=>replay(forReplay(list));
export const REPLAY_NOTICE='저장된 HERMES 제출 입력에 후보 맥락 정책을 모델 호출 없이 적용해 센 통계입니다. 원문은 싣지 않고 문자 수·추정 토큰·키 이름·id 개수만 보여 줍니다. 운영 제출에는 어떤 정책도 적용하지 않았고, 서버 평가(eval)는 실행하지 않았습니다(not_run).';
export type ReplayPayload={generatedAt:string;filter:ReplayQuery;read:ReplayCounts;replay:ReplaySummary;notice:string};
// 응답 {generatedAt,filter,read,replay,notice}. 로컬 스크립트(scripts/eval/context-replay.mjs)가 이 JSON으로 같은 비교표(replayMarkdown)를 낸다.
export async function contextReplay(owner:string,params:URLSearchParams,generatedAt=stamp()):Promise<ReplayPayload>{
 const filter=replayQuery(params),read=await readReplaySubmissions(owner,filter);
 return {generatedAt,filter,read:read.counts,replay:replaySubmissions(read.submissions),notice:REPLAY_NOTICE};
}
const KIND_LABEL:Record<ReplayFilter,string>={all:'역할·회의',role:'역할',meeting:'회의'},ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
// 비교표: lib/context-replay.ts comparisonMarkdown 뒤에 조회 범위(조건·읽은 제출 수, 비교에서 뺀 제출 수)를 붙인다. 수치만 싣는다.
export function replayMarkdown(payload:Pick<ReplayPayload,'generatedAt'|'filter'|'read'|'replay'>){
 const {filter,read}=payload;
 return comparisonMarkdown(payload.replay,{generatedAt:payload.generatedAt})+['','## 조회 범위','',
  `- 최근 제출 ${filter.limit}건 이내 · 종류 ${KIND_LABEL[filter.kind]} · 캠페인을 부모로 둔 HERMES 제출만 읽었다(브리프·조사·학습 제출 제외).`,
  ...(read.from&&read.to&&ISO.test(read.from)&&ISO.test(read.to)?[`- 제출 저장 시각(UTC): ${read.from} ~ ${read.to}`]:[]),
  `- 읽은 제출 ${read.submissions}건: 역할 ${read.role} · 회의 ${read.meeting} · 판별하지 못함 ${read.unknown} · 본문을 읽을 수 없음 ${read.unreadable} · 문자 예산 초과 ${read.overBudget}. 판별하지 못한 제출, 읽을 수 없는 본문, 문자 예산(최신순 누적 input ${String(MAX_TOTAL_CHARS).replace(/\B(?=(\d{3})+(?!\d))/g,',')}자)을 넘은 제출은 비교에서 뺐다.`].join('\n')+'\n';
}
// 첨부 파일 이름의 날짜는 한국 시간(KST) 오늘이다.
export const replayFileName=(now=Date.now())=>`collective-context-replay-${new Date(now+9*3600000).toISOString().slice(0,10)}.md`;
export async function contextReplayMarkdown(owner:string,params:URLSearchParams,now=Date.now()){
 return {markdown:replayMarkdown(await contextReplay(owner,params,new Date(now).toISOString())),filename:replayFileName(now)};
}
