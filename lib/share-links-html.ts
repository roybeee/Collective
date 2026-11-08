// 공개 공유 화면 HTML(G4, app/share/[token]/route.ts). 서버가 문자열로 만든다: 인라인 스크립트 0, 스타일은 /share.css 하나, 모든 글자는 escapeHtml을 거친다.
// 세션 쿠키·내부 id·주소·전화는 입력(PublicView)에 없으므로 화면에도 없다. 검토자 결정은 순수 HTML 폼(POST 같은 경로)이라 JS 없이 동작한다.
import {AI_NOTICE,DECISION_LABELS,SHARE_NOTE_MAX,type PublicArtifactView,type PublicReportView,type PublicView} from './share-links';

export function escapeHtml(value:unknown){
 return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c] as string);
}
const e=escapeHtml;
const kst=(iso:string)=>{const t=Date.parse(iso);if(Number.isNaN(t))return '';const d=new Date(t+9*3600000),p=(n:number)=>String(n).padStart(2,'0');return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} KST`};
const won=(n:number)=>n.toLocaleString('ko-KR')+'원';
function unitText(unit:string,v:number|null){
 if(v===null)return '미확인';
 if(unit==='krw')return won(v);
 if(unit==='ratio')return (v*100).toFixed(1)+'%';
 return v.toLocaleString('ko-KR')+(unit==='count'?'건':unit==='people'?'명':unit==='weeks'?'주':'');
}
const row=(cells:string[])=>`<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`;
const head=(cells:string[])=>`<tr>${cells.map(c=>`<th scope="col">${c}</th>`).join('')}</tr>`;
export const FOOTER_TEXT='COLLECTIVE 보고서 · 읽기 전용';
export type FormResult={message:string;error:boolean}|null;

function page(title:string,body:string,view:Pick<PublicView,'expiresAt'>){
 return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer">
<title>${e(title)}</title><link rel="stylesheet" href="/share.css"></head>
<body><main class="share">${body}</main>
<footer class="share-foot"><p>${e(FOOTER_TEXT)} · 만료일 ${e(kst(view.expiresAt))}</p></footer></body></html>`;
}
function reportBody(v:PublicReportView,label:string){
 const ledger=v.ledger.map(m=>row([e(m.label),e(unitText(m.unit,m.current)),e(unitText(m.unit,m.previous))])).join('');
 const checks=v.completeness.map(c=>row([e(c.week),`${e(c.weekStart)}~${e(c.weekEnd)}`,e(c.statusLabel),e(unitText('krw',c.ledgerNet)),e(unitText('krw',c.posNet)),e(unitText('ratio',c.diffRate))])).join('');
 const channels=v.channels.length?`<section><h2>채널 단위경제</h2><table>${head(['채널','주문','순매출','광고비','광고비 뒤 공헌이익'])}${v.channels.map(c=>row([e(c.label),e(unitText('count',c.orders)),e(unitText('krw',c.netRevenue)),e(unitText('krw',c.adSpend)),e(unitText('krw',c.contributionAfterSpend))])).join('')}</table></section>`:'';
 const warnings=v.spendWarnings.length?`<section><h2>광고비 경고</h2><ul>${v.spendWarnings.map(w=>`<li>${e(w)}</li>`).join('')}</ul></section>`:'';
 const publications=v.publications.byStatus.map(p=>`${e(p.label)} ${p.count}건`).join(', ');
 return `<header><p class="share-eyebrow">주간 고객 보고서 · 읽기 전용</p><h1>${e(v.name)} · ${e(v.week)}</h1><p>기간 ${e(v.from)} ~ ${e(v.to)} (한국 시간, 월~일) · 판 v${v.version} · 받는 분 ${e(label)}</p></header>
<section><h2>장부</h2><table>${head(['지표',e(v.week),'전주 '+e(v.previousWeek)])}${ledger}</table></section>
<section><h2>POS 대조 (최근 ${v.completeness.length}주)</h2><table>${head(['주','기간','상태','장부 순매출','POS 순매출','차이율'])}${checks}</table></section>
<section><h2>north-star</h2><p>대조 통과 ${v.northStar.passedWeeks}/${v.northStar.totalWeeks}주 · 귀속 주문 ${v.northStar.orders}건 · 귀속 공헌이익 ${e(unitText('krw',v.northStar.contribution))}</p></section>
${channels}${warnings}
<section><h2>발행·할 일</h2><p>이번 주 예약 발행 ${v.publications.total}건${publications?': '+publications:''}</p><p>열린 자료 요청 ${v.todos.dataRequests}건 · 플레이스 불일치 ${v.todos.placeMismatches}건</p></section>
<section class="share-notes"><h2>안내</h2><ul>${v.notices.map(n=>`<li>${e(n)}</li>`).join('')}</ul></section>`;
}
function artifactBody(v:PublicArtifactView,label:string,token:string,result:FormResult){
 const done=(['approved','revision'] as const).filter(d=>v.decisions[d]).map(d=>`<li>${e(DECISION_LABELS[d])} · ${e(kst(v.decisions[d]!.at))}</li>`).join('');
 const status=result?`<p class="${result.error?'share-error':'share-ok'}" role="${result.error?'alert':'status'}">${e(result.message)}</p>`:'';
 const form=`<form method="post" action="/share/${e(token)}" class="share-form"><input type="hidden" name="token" value="${e(token)}">
<fieldset><legend>검토 결과</legend>
<label class="share-choice"><input type="radio" name="decision" value="approved" required> 승인</label>
<label class="share-choice"><input type="radio" name="decision" value="revision" required> 수정 요청</label>
<label class="share-field"><span>수정 요청 메시지 (수정 요청에는 필수, ${SHARE_NOTE_MAX}자 이하)</span><textarea name="note" maxlength="${SHARE_NOTE_MAX}" rows="4"></textarea></label>
<button type="submit">보내기</button></fieldset></form>`;
 return `<header><p class="share-eyebrow">검토 요청 · 읽기 전용</p><h1>${e(v.title)}</h1><p>${e(v.roleLabel)} 작업물 · v${v.version} · ${e(v.originLabel)} · 받는 분 ${e(label)}</p><p class="share-ai">${e(AI_NOTICE)}</p></header>
<article class="share-content" aria-label="작업물 본문"><pre>${e(v.content)}</pre></article>
<section><h2>검토</h2>${status}${done?`<ul aria-label="남긴 결정">${done}</ul>`:''}${form}</section>`;
}
export function renderShare(view:PublicView,token:string,result:FormResult=null){
 const body=view.kind==='customer_report'?reportBody(view,view.label):artifactBody(view,view.label,token,result);
 return page(view.title,body,view);
}
export function renderNotFound(){
 return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>링크를 찾을 수 없습니다</title><link rel="stylesheet" href="/share.css"></head>
<body><main class="share"><header><h1>링크를 찾을 수 없습니다</h1><p>링크가 없거나 만료·취소됐습니다. 보내 준 담당자에게 새 링크를 요청하세요.</p></header></main>
<footer class="share-foot"><p>${e(FOOTER_TEXT)}</p></footer></body></html>`;
}
