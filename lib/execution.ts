import {campaignBudget,statuses,type Campaign} from './agency';
import {claimGuard} from './campaign-policy';

export type FactRef={id:string;version:number};
// materialHash: 소재 입력(브랜드 이름·색 + 사실 {id,version} + 캡션) 지문. 이 필드 이전 소재는 브리프 버전으로 판정한다. current: 서버가 계산한 현재 유효 여부(화면용).
export type ExecutionCreative={id:string;campaignId:string;campaignVersion:number;brandId:string;storeId?:string;version:number;factRefs:FactRef[];caption:string;pngHash:string;objectKey:string;materialHash?:string;current?:boolean;createdAt:string};
export type ExecutionLimits={id:string;version:number;maxPublications:number;maxPlannedCostKRW:number;paused:boolean};
export type PublicationStatus='draft'|'approved'|'submitting'|'uncertain'|'accepted'|'published'|'failed'|'cancelled'|'blocked';
// mediaMode auto: 승인 때 앱 공개 주소(/media/<sha256>.png)를 채운다. external(이전 기록 포함): 고급 옵션의 Cloudinary·R2 주소.
// copy: 승인된 콘텐츠 작업물에서 고른 카피. approvedLimits: 승인 당시 한도(낮아질 때만 무효). needsReview: 사용한 사실이 바뀌어 확인이 필요함.
export type PublicationCopy={artifactId:string;artifactVersion:number;index:number;text:string};
export type NeedsReview={reason:string;at:string};
export type Publication={id:string;campaignId:string;creativeId:string;creativeVersion:number;campaignVersion:number;pngHash:string;factRefs:FactRef[];caption:string;mediaUrl:string;mediaMode?:'auto'|'external';copy?:PublicationCopy;scheduledAt:string;plannedCostKRW:number;version:number;status:PublicationStatus;channelId?:string;credentialVersion?:number;limitsVersion?:number;approvedLimits?:{maxPublications:number;maxPlannedCostKRW:number};approvedBy?:string;approvedAt?:string;providerId?:string;providerStatus?:string;error?:string;attemptedAt?:string;attemptRestored?:boolean;needsReview?:NeedsReview|null;invalidatedReason?:string;reconfirmedBy?:string;reconfirmedAt?:string;resolvedBy?:string;resolvedAt?:string;createdAt:string;updatedAt?:string};
export type PublisherStatus={connected:boolean;channelId?:string;account?:string;version?:number};
export type CaptionCandidate={artifactId:string;artifactVersion:number;index:number;text:string;issues:string[]};
export type ExecutionState={creatives:ExecutionCreative[];publications:Publication[];limits:ExecutionLimits|null;publisher:PublisherStatus;copies:CaptionCandidate[];copyCaptions:boolean};
export const publicationLabels:Record<PublicationStatus,string>={draft:'승인 전',approved:'실행 승인',submitting:'접수 확인 중',uncertain:'접수 여부 미확인',accepted:'예약 접수',blocked:'공급자 확인 필요',published:'게시 확인',failed:'발행 실패',cancelled:'취소'};
// 관리자가 Buffer 미접수를 확인하고 차감을 되돌린 시도(attemptRestored)는 한도에서 뺀다.
export function executionTotals(publications:Publication[]){const attempted=publications.filter(p=>!!p.attemptedAt&&!p.attemptRestored);return {attempts:attempted.length,plannedCostKRW:attempted.reduce((n,p)=>n+p.plannedCostKRW,0)}}

// 사실이 바뀌면 재검토 표시를 남기는 상태: 승인 건과 Buffer에 예약이 있을 수 있는 건(접수 중·미확인·접수·공급자 확인 필요).
export const reviewStatuses:PublicationStatus[]=['approved','submitting','uncertain','accepted','blocked'];
// 접수 중(submitting)은 Buffer 호출(최대 15초)이 끝나지 않았을 수 있다. 이 시간이 지나야 관리자가 접수 여부를 확정한다(exec-loop-9).
export const SUBMIT_SETTLE_MS=120000;
export function uncertainResolvable(p:Pick<Publication,'status'|'attemptedAt'>,now=Date.now()){return p.status==='uncertain'||p.status==='submitting'&&!(now-Date.parse(p.attemptedAt||'')<SUBMIT_SETTLE_MS)}

export function providerPublicationStatus(status:string):PublicationStatus{return status==='sent'?'published':status==='error'?'failed':['scheduled','sending'].includes(status)?'accepted':'blocked'}

export const composeCaption=(copy:string|undefined,factCaption:string)=>copy?copy+'\n\n'+factCaption:factCaption;
// 승인된 콘텐츠 작업물의 '게시 카피' 절(제목이 없는 본문이면 전체)을 빈 줄·하위 제목 단위로 나눈 캡션 후보. 목록 기호·강조 표시는 뺀다.
const heading=(line:string)=>line.match(/^(#{1,6})[ \t]/)?.[1].length??0;
export function copyBlocks(content:string):string[]{
 const lines=content.split('\n'),start=lines.findIndex(l=>heading(l)&&/게시\s?카피/.test(l)),level=start<0?0:heading(lines[start]),end=lines.findIndex((l,i)=>i>start&&heading(l)>0&&heading(l)<=level);
 const body=start>=0?lines.slice(start+1,end<0?undefined:end):lines.some(heading)?[]:lines;
 return body.map(l=>heading(l)?'':l).join('\n').split(/\n\s*\n/).map(b=>b.split('\n').map(l=>l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/,'').replace(/\*\*|__/g,'').trim()).filter(Boolean).join('\n')).filter(b=>b.length>=5&&b.length<=1500&&!b.startsWith('|')).slice(0,12);
}
const compact=(s:string)=>s.replace(/\s+/g,'').toLowerCase();
const factValue=(f:unknown)=>{const v=(f as {value?:unknown}|null)?.value;return typeof v==='string'?v.trim():''};
// 게시 캡션 검사(PR 2 claimGuard + 후보 대조): 거절 사실 값, 확정 사실에 근거 없는 광고 표현, 미확인 후보 사실 값, 남은 확인 표시.
// 실제 게시 문구라 [확인 필요]를 붙여도 통과시키지 않는다.
export function captionIssues(text:string,facts:{confirmed:unknown[];prohibited:unknown[];candidate:unknown[]}):string[]{
 const guard=claimGuard(facts),body=compact(text),supported=compact(facts.confirmed.map(factValue).join(' '));
 const candidates=[...new Set(facts.candidate.map(factValue).filter(v=>v.length>=2&&v.length<=40&&!supported.includes(compact(v))))];
 return [...guard.prohibited.filter(t=>body.includes(compact(t))).map(t=>'거절된 사실 표현: '+t),...guard.unverified.filter(t=>body.includes(compact(t))).map(t=>'근거 없는 광고 표현: '+t),...candidates.filter(t=>body.includes(compact(t))).map(t=>'미확인 후보 사실: '+t),...(/확인\s?필요|자료\s?필요|\[가설/.test(text)?['확인 표시가 남은 문구']:[])];
}
export const koreaDay=(iso:string)=>new Date(iso).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
// 발행 승인 조건(data-truth-4 b): 기획 승인, 시작일·종료일 확정, 예약일(한국 날짜)이 기간 안.
export function campaignGateIssues(c:Pick<Campaign,'status'|'startDate'|'endDate'>,scheduledAt:string):string[]{
 const issues:string[]=[];
 if(c.status!=='approved')issues.push(`기획 미승인 · 캠페인 기획이 승인돼야 발행을 승인할 수 있습니다(현재: ${statuses[c.status]||c.status||'미정'}).`);
 if(!c.startDate||!c.endDate)issues.push('기간 밖 · 캠페인 시작일·종료일을 확정하세요.');
 else{const day=koreaDay(scheduledAt);if(day<c.startDate||day>c.endDate)issues.push(`기간 밖 · 예약일 ${day}이 캠페인 기간 ${c.startDate}~${c.endDate} 밖입니다.`)}
 return issues;
}
// 예산 조건(data-truth-4 a): 예산이 미확정이면 비용이 있는 발행을, 확정 예산보다 큰 비용 상한은 예산 초과로 막는다.
export function budgetIssues(c:{budget?:number|null;budgetConfirmedAt?:string},plannedCostKRW:number,limits:{maxPlannedCostKRW?:number}|null):string[]{
 const budget=campaignBudget(c),cap=limits?.maxPlannedCostKRW??0;
 if(budget===null)return plannedCostKRW>0?['예산 미확정 · 캠페인 예산을 확정해야 비용이 있는 발행을 승인할 수 있습니다.']:[];
 return cap>budget?[`예산 초과 · 비용 상한 ${cap.toLocaleString('ko-KR')}원이 확정 예산 ${budget.toLocaleString('ko-KR')}원을 넘습니다. 한도를 낮추세요.`]:[];
}
// 승인 뒤 바뀌어 재확인이 필요한 항목. 한도는 낮아졌을 때만 무효화한다(approvedLimits가 없는 이전 승인은 한도 버전으로 판정).
// 낮아진 한도는 발행 횟수 한도와 예정 비용 상한을 구분해 부른다(exec-loop-10).
export function approvalDrift(p:Publication,credential:{channelId?:string;version?:number}|null,limits:ExecutionLimits|null):string[]{
 const approvedLimits=p.approvedLimits,drift:string[]=[];
 if(!credential||credential.channelId!==p.channelId||credential.version!==p.credentialVersion)drift.push('발행 계정');
 if(!limits||!approvedLimits){if(!limits||limits.version!==p.limitsVersion)drift.push('발행 횟수 한도')}
 else{if(limits.maxPublications<approvedLimits.maxPublications)drift.push('발행 횟수 한도(낮아짐)');if(limits.maxPlannedCostKRW<approvedLimits.maxPlannedCostKRW)drift.push('예정 비용 상한(낮아짐)')}
 if(p.needsReview)drift.push('사용한 사실');
 return drift;
}
// 승인 버튼 옆에 보이는 차단 사유. 서버도 같은 조건을 409로 막는다.
export function approvalBlockers({campaign,publication,state,factCount,rightsConfirmed}:{campaign:Pick<Campaign,'status'|'startDate'|'endDate'>&{budget?:number|null;budgetConfirmedAt?:string};publication:Pick<Publication,'scheduledAt'|'creativeId'|'needsReview'>&{plannedCostKRW?:number};state:Pick<ExecutionState,'creatives'|'limits'|'publisher'>;factCount:number;rightsConfirmed:boolean}):string[]{
 const creative=state.creatives.find(c=>c.id===publication.creativeId);
 return [...(!state.limits?['한도 미설정 · 기본 한도(발행 1회·0원)를 저장하세요.']:[]),...(!state.publisher.connected?['채널 미연결 · Buffer Instagram 채널을 연결하세요.']:[]),...(!factCount?['사실 없음 · 근거와 유효 기한이 있는 사실을 확정하세요.']:[]),...campaignGateIssues(campaign,publication.scheduledAt),...budgetIssues(campaign,publication.plannedCostKRW||0,state.limits),...(creative?.current===false||publication.needsReview?['사실 변경 · 소재 입력이나 사용한 사실이 바뀌었습니다. 이 초안을 취소하고 새 PNG로 새 초안을 만드세요.']:[]),...(!rightsConfirmed?['권리 확인 필요 · PNG·문구 사용 권리 확인란을 체크하세요.']:[])];
}
// 제작·발행 탭 상단 체크리스트. 완료되지 않은 첫 단계가 현재 단계다.
export function publishSteps(state:Pick<ExecutionState,'creatives'|'publications'|'limits'|'publisher'>,factCount:number){
 const live=state.publications.filter(p=>p.status!=='cancelled');
 return [{label:'사실 확정',done:factCount>0},{label:'PNG',done:state.creatives.some(c=>c.current!==false)},{label:'채널',done:state.publisher.connected},{label:'한도',done:!!state.limits},{label:'초안',done:live.length>0},{label:'승인',done:live.some(p=>!['draft','failed'].includes(p.status))},{label:'접수',done:live.some(p=>p.status==='accepted'||p.status==='published')}];
}
// 승인 직후 앱 공개 주소를 로그인 정보 없이 읽을 수 있는지 확인한다(exec-loop-2). Buffer도 같은 조건으로 이미지를 가져간다.
// 로그인 리디렉션·오류·PNG가 아닌 응답은 접근 불가다. 화면과 다른 origin 주소는 브라우저에서 확인할 수 없어 건너뛴다(true).
export async function anonymousReachable(url:string,origin:string,fetcher:typeof fetch=(...args)=>fetch(...args)){
 try{if(new URL(url).origin!==new URL(origin).origin)return true;const r=await fetcher(url,{method:'HEAD',credentials:'omit',cache:'no-store',redirect:'manual'});return r.ok&&!!r.headers.get('content-type')?.startsWith('image/png')}catch{return false}
}
// 예약 1시간 전부터 2일 뒤까지의 접수 건은 화면 진입 시 상태를 자동으로 다시 조회한다(수동 조회 버튼은 그대로 둔다).
export function autoRefreshDue(p:Pick<Publication,'status'|'providerId'|'scheduledAt'>,now=Date.now()){const t=Date.parse(p.scheduledAt);return p.status==='accepted'&&!!p.providerId&&t-3600000<=now&&now<=t+172800000}
