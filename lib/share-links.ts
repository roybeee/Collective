// 공유 링크(G4, docs/SHARE-LINKS.ko.md) 순수 규칙: 화면·서버 공용. 저장·조회·토큰 해시는 lib/share-links-server.ts, 공개 HTML은 lib/share-links-html.ts.
// 링크 하나는 동결 고객 보고서의 한 판(customer_report) 또는 작업물의 한 판(artifact)만 가리킨다. 토큰 원문은 만든 직후 한 번만 보이고 저장하지 않는다(SHA-256 해시가 레코드 id).
// 공개 보기(publicReportView·publicArtifactView)는 외부에 보일 값만 새 객체로 조립한다. 내부 id·주소·전화·메모·이메일은 어디에도 넣지 않는다.
import {roles} from './agency';
import {scrubInternalIds} from './artifact-text';
import type {CustomerReport} from './customer-report';
import {REPORT_METRICS} from './customer-report';

export const SHARE_DEFAULT_DAYS=14,SHARE_MAX_DAYS=90,SHARE_LABEL_MAX=60,SHARE_NOTE_MAX=2000,REVIEWER_LINKS_MAX=10;
export const SHARE_DAY_CHOICES=[7,14,30,90] as const;
export const SHARE_PATH='/share/';
export type ShareScope={kind:'customer_report';id:string;version:number;brandId:string;campaignId:null}|{kind:'artifact';id:string;version:number;brandId:null;campaignId:string};
export type ShareScopeKind=ShareScope['kind'];
export type ShareDecisionKind='approved'|'revision';
export type ShareDecision={at:string;noteLength:number};
export type ShareLink={id:string;scope:ShareScope;label:string;createdBy:{id:string;role:'owner'|'admin'};createdAt:string;expiresAt:string;revokedAt:string|null;viewCount:number;lastViewedAt:string|null;
 decisions:Partial<Record<ShareDecisionKind,ShareDecision>>};
export type ShareLinkState='active'|'expired'|'revoked';
export const SHARE_STATE_LABELS:Record<ShareLinkState,string>={active:'사용 중',expired:'만료',revoked:'취소함'};
export const SHARE_MESSAGES={
 off:'공유 링크 기능이 꺼져 있습니다. 소유자가 기능 스위치 share_links를 켜야 합니다.',
 adminOnly:'공유 링크는 대표·관리자만 만들고 취소할 수 있습니다.',
 scope:'공유할 대상(kind·id)을 정하세요.',
 label:`받는 사람 이름(라벨)은 1~${SHARE_LABEL_MAX}자로 적으세요.`,
 days:`유효 기간은 1~${SHARE_MAX_DAYS}일입니다.`,
 cap:`같은 작업물 판에는 검토자 링크를 ${REVIEWER_LINKS_MAX}개까지 만들 수 있습니다. 쓰지 않는 링크를 취소하세요.`,
 outdated:'이전 판 작업물에는 링크를 만들 수 없습니다.',
 notFound:'링크가 없거나 만료·취소됐습니다.',
 decision:'승인 또는 수정 요청 중 하나를 고르세요.',
 note:`수정 요청에는 메시지를 적어야 합니다(${SHARE_NOTE_MAX}자 이하).`,
 origin:'허용되지 않은 요청입니다.',
 rate:'요청이 많습니다. 잠시 후 다시 시도하세요.',
} as const;

// ── 입력 검증(경계) ──
// 테스트 런타임(scripts/eval/runtime.mjs)이 npm 패키지를 올리지 못해 lib은 외부 검증 라이브러리를 쓰지 않는다. 모르는 필드는 거부한다(strict).
export type ValidationIssue={path:string;message:string};
export type Parsed<T>={success:true;data:T}|{success:false;issue:ValidationIssue};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=(path:string,message:string):Parsed<never>=>({success:false,issue:{path,message}});
const text=(v:unknown,max:number,min=1)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max?v.trim():null;
const strictKeys=(v:Record<string,unknown>,allowed:readonly string[])=>Object.keys(v).find(k=>!allowed.includes(k));
export type CreateLinkInput={action:'create';scope:{kind:ShareScopeKind;id:string};label:string;days?:number};
export function parseCreateLink(raw:unknown):Parsed<CreateLinkInput>{
 if(!record(raw)||raw.action!=='create')return fail('action','지원하지 않는 공유 링크 작업입니다.');
 const extra=strictKeys(raw,['action','scope','label','days']);if(extra)return fail(extra,'알 수 없는 입력입니다.');
 const scope=raw.scope;
 if(!record(scope)||strictKeys(scope,['kind','id'])||(scope.kind!=='customer_report'&&scope.kind!=='artifact'))return fail('scope',SHARE_MESSAGES.scope);
 const id=text(scope.id,200);if(!id)return fail('scope',SHARE_MESSAGES.scope);
 const label=text(raw.label,SHARE_LABEL_MAX);if(!label)return fail('label',SHARE_MESSAGES.label);
 if(raw.days!==undefined&&(typeof raw.days!=='number'||!Number.isInteger(raw.days)||raw.days<1||raw.days>SHARE_MAX_DAYS))return fail('days',SHARE_MESSAGES.days);
 return {success:true,data:{action:'create',scope:{kind:scope.kind,id},label,...(raw.days===undefined?{}:{days:raw.days})}};
}
export type RevokeLinkInput={action:'revoke';id:string};
export function parseRevokeLink(raw:unknown):Parsed<RevokeLinkInput>{
 if(!record(raw)||raw.action!=='revoke')return fail('action','지원하지 않는 공유 링크 작업입니다.');
 const extra=strictKeys(raw,['action','id']);if(extra)return fail(extra,'알 수 없는 입력입니다.');
 const id=text(raw.id,100);if(!id)return fail('id','공유 링크 id를 확인하세요.');
 return {success:true,data:{action:'revoke',id}};
}
export type DecisionInput={decision:ShareDecisionKind;note?:string};
export function parseDecision(raw:unknown):Parsed<DecisionInput>{
 if(!record(raw))return fail('decision',SHARE_MESSAGES.decision);
 const extra=strictKeys(raw,['decision','note']);if(extra)return fail(extra,'알 수 없는 입력입니다.');
 if(raw.decision!=='approved'&&raw.decision!=='revision')return fail('decision',SHARE_MESSAGES.decision);
 if(raw.note!==undefined&&(typeof raw.note!=='string'||raw.note.length>SHARE_NOTE_MAX))return fail('note',SHARE_MESSAGES.note);
 return {success:true,data:{decision:raw.decision,...(raw.note===undefined?{}:{note:raw.note})}};
}
export const TOKEN_PATTERN=/^[a-f0-9]{64}$/;
export const isShareToken=(value:unknown):value is string=>typeof value==='string'&&TOKEN_PATTERN.test(value);

// ── 상태 ──
export function linkState(link:Pick<ShareLink,'expiresAt'|'revokedAt'>,now:number):ShareLinkState{
 if(link.revokedAt)return 'revoked';
 return Date.parse(link.expiresAt)<=now?'expired':'active';
}
export const expiryOf=(createdAt:number,days:number)=>new Date(createdAt+days*86400000).toISOString();
// 같은 대상·같은 판의 살아 있는(취소·만료 아닌) 링크 수.
export const activeCount=(links:readonly ShareLink[],scope:Pick<ShareScope,'kind'|'id'|'version'>,now:number)=>links.filter(l=>l.scope.kind===scope.kind&&l.scope.id===scope.id&&l.scope.version===scope.version&&linkState(l,now)==='active').length;
// 화면·API에 돌려주는 모양. 해시 id는 남지만 토큰 원문은 어디에도 없다.
export type ShareLinkEntry=Omit<ShareLink,'decisions'>&{state:ShareLinkState;decisions:ShareLink['decisions']};
export const entryOf=(link:ShareLink,now:number):ShareLinkEntry=>({...link,state:linkState(link,now)});

// ── 공개 보기: 보고서 ──
// 집계 숫자·라벨·안내만 옮긴다. scope.id·brandId·주소·전화·가림 기록의 필드 경로·할 일 라벨은 뺀다(할 일은 건수만).
export type PublicReportView={kind:'customer_report';title:string;scopeType:'store'|'brand';name:string;week:string;from:string;to:string;previousWeek:string;version:number;
 ledger:{id:string;label:string;unit:string;current:number|null;previous:number|null}[];
 completeness:{week:string;weekStart:string;weekEnd:string;status:string;statusLabel:string;ledgerNet:number|null;posNet:number|null;diffRate:number|null}[];
 northStar:{measured:boolean;passedWeeks:number;totalWeeks:number;orders:number;contribution:number|null};
 channels:{label:string;orders:number|null;netRevenue:number|null;adSpend:number|null;contributionAfterSpend:number|null}[];
 publications:{total:number;byStatus:{label:string;count:number}[]};todos:{dataRequests:number;placeMismatches:number};
 spendWarnings:string[];notices:string[]};
const POS_LABELS:Record<string,string>={pass:'통과',fail:'불일치',missing_pos:'POS 합계 없음'};
const LEDGER=REPORT_METRICS.filter(m=>m.section==='ledger');
export function publicReportView(r:CustomerReport,version:number):PublicReportView{
 const name=String(r.scope.name);
 return {kind:'customer_report',title:`주간 고객 보고서 ${name} ${r.period.week}`,scopeType:r.scope.type,name,week:r.period.week,from:r.period.from,to:r.period.to,previousWeek:r.period.previousWeek,version,
  ledger:LEDGER.map(m=>{const k=m.id as keyof CustomerReport['ledger']['current'];return {id:m.id,label:m.label,unit:m.unit,current:r.ledger.current[k]??null,previous:r.ledger.previous[k]??null}}),
  completeness:r.completeness.map(c=>({week:c.week,weekStart:c.weekStart,weekEnd:c.weekEnd,status:c.status,statusLabel:POS_LABELS[c.status]||c.status,ledgerNet:c.ledgerNet,posNet:c.posNet,diffRate:c.diffRate})),
  northStar:{measured:r.northStar.measured,passedWeeks:r.northStar.passedWeeks,totalWeeks:r.northStar.weeks.length,orders:r.northStar.northStarOrders,contribution:r.northStar.northStarContribution},
  channels:r.channels.map(c=>({label:String(c.label),orders:c.orders,netRevenue:c.netRevenue,adSpend:c.adSpend,contributionAfterSpend:c.contributionAfterSpend})),
  publications:{total:r.publications.total,byStatus:r.publications.byStatus.map(p=>({label:p.label,count:p.count}))},
  todos:{dataRequests:r.todos.dataRequests.length,placeMismatches:r.todos.placeMismatches.length},
  spendWarnings:r.spendWarnings.map(w=>w.message),notices:[...r.notices]};
}

// ── 공개 보기: 작업물 ──
export type PublicArtifactView={kind:'artifact';title:string;roleLabel:string;version:number;origin:string;originLabel:string;aiNotice:string;content:string;decisions:ShareLink['decisions']};
export const ORIGIN_LABELS:Record<string,string>={manual:'직접 작성',ai:'AI 작성',ai_edited:'AI 작성 후 사람 수정'};
export const AI_NOTICE='AI 표시: AI가 작성한 초안은 COLLECTIVE 팀이 검토합니다. 이 화면의 승인·수정 요청은 담당자에게 전달되는 의견이며 최종 승인은 담당자가 합니다.';
export function publicArtifactView(a:{title:string;role:string;version:number;origin?:string;content:string},decisions:ShareLink['decisions']):PublicArtifactView{
 const origin=a.origin||'manual';
 return {kind:'artifact',title:scrubInternalIds(String(a.title)),roleLabel:roles.find(r=>r.id===a.role)?.name||'작업물',version:a.version,origin,originLabel:ORIGIN_LABELS[origin]||origin,aiNotice:AI_NOTICE,content:scrubInternalIds(String(a.content)),decisions:{...decisions}};
}
export type PublicView=(PublicReportView|PublicArtifactView)&{label:string;expiresAt:string};

// ── 외부 검토자 결정 ──
// 캠페인 이벤트 문구(lib/history-labels.ts eventLine이 문장으로 바꾼다): '외부 검토자 ○○ · 제목 v2 승인[ · 메시지]'.
export const externalActorId=(label:string)=>`external:${label}`;
export const externalEventMessage=(label:string,title:string,version:number,decision:ShareDecisionKind,note:string)=>`외부 검토자 ${label} · ${title} v${version} ${decision==='approved'?'승인':'수정 요청'}${note?' · '+note:''}`;
export const DECISION_LABELS:Record<ShareDecisionKind,string>={approved:'승인',revision:'수정 요청'};
