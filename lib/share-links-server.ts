// 공유 링크 서버(G4, docs/SHARE-LINKS.ko.md). 만들기·목록·취소(대표·관리자, 세션)와 토큰으로 여는 공개 조회·외부 검토자 결정(로그인 없음).
// 스위치 share_links(기본 꺼짐)는 이 파일에서만 읽는다. 꺼지면 만들기 409, 공개 조회·결정은 모두 404다(존재 여부를 드러내지 않는다).
// 저장: records kind 'share_link', 행 id는 `share_link:<토큰 SHA-256>`(소유자 없이 PK로 찾는다). 토큰 원문은 저장하지도 기록(console)하지도 않는다.
// 공개 경로는 토큰 모양 검사 → IP·토큰 빈도 제한(auth_rate_limits, 15분 창) → 해시 비교(PK 조회, 길이가 같은 상수 시간 비교) → 스위치 → 만료·취소 → 대상 판 확인 순서다. 모든 실패는 같은 404다.
import {ApiError,database,readRecord,stamp,uid,eventStatement,type Actor} from './server';
import {hashToken,randomToken} from './auth-session';
import {isEnabled} from './feature-flags';
import {frozenReportVersion} from './customer-report-server';
import {artifactDecisionStatement,type ReviewedArtifact} from './review-decisions-server';
import type {Artifact} from './agency';
import {REVIEWER_LINKS_MAX,SHARE_DEFAULT_DAYS,SHARE_MESSAGES as M,activeCount,entryOf,expiryOf,externalActorId,externalEventMessage,isShareToken,linkState,parseCreateLink,parseDecision,parseRevokeLink,publicArtifactView,publicReportView,
 type Parsed,type PublicView,type ShareDecisionKind,type ShareLink,type ShareLinkEntry,type ShareScope} from './share-links';

// 레코드 kind는 글자 그대로 쓴다(tests/record-kinds.test.mjs 스캐너가 kind='share_link'·bind 리터럴을 읽는다).
const rowId=(hash:string)=>`share_link:${hash}`;
const RATE_WINDOW=900000,TOKEN_LIMIT=60,IP_LIMIT=240;
type Row={owner:string;data:string};

export async function shareLinksOn(owner:string){
 return isEnabled(owner,'share_links').catch(()=>{console.error('share_links_flag_unreadable');return false});
}
const notFound=()=>new ApiError(404,M.notFound);
const parse=<T>(result:Parsed<T>,fallback:string):T=>{
 if(result.success)return result.data;
 const {path,message}=result.issue;
 throw new ApiError(400,['label','days','scope'].includes(path)?message:fallback);
};
// 같은 길이의 16진 문자열을 상수 시간으로 비교한다(PK 조회 뒤 저장 id와 다시 맞춰 본다).
export function sameHash(a:string,b:string){
 if(a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}

// ── 대상 확인 ──
async function scopeOf(owner:string,input:{kind:'customer_report'|'artifact';id:string}):Promise<ShareScope&{title:string}>{
 if(input.kind==='customer_report'){
  const frozen=await frozenReportVersion(owner,input.id);
  return {kind:'customer_report',id:frozen.id,version:frozen.version,brandId:frozen.brandId,campaignId:null,title:frozen.report.scope.name};
 }
 const a=await readRecord<Artifact>(owner,'artifact',input.id);
 if(a.status==='outdated')throw new ApiError(409,M.outdated);
 return {kind:'artifact',id:a.id,version:a.version,brandId:null,campaignId:a.campaignId,title:a.title};
}

// ── 소유자 쪽(세션 인증, 호출자가 잠금·빈도 제한을 잡는다) ──
async function ownerLinks(owner:string):Promise<ShareLink[]>{
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='share_link' ORDER BY updated_at DESC`).bind(owner).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as ShareLink);
}
export async function listShareLinks(owner:string,p:URLSearchParams):Promise<{enabled:boolean;links:ShareLinkEntry[]}>{
 const kind=p.get('kind'),id=p.get('id')||'',now=Date.now();
 if(kind!=='customer_report'&&kind!=='artifact')throw new ApiError(400,M.scope);
 const links=(await ownerLinks(owner)).filter(l=>l.scope.kind===kind&&(!id||l.scope.id===id)).map(l=>entryOf(l,now));
 return {enabled:await shareLinksOn(owner),links};
}
async function createLink(owner:string,raw:Record<string,unknown>,who:Actor){
 const input=parse(parseCreateLink(raw),M.scope),scope=await scopeOf(owner,input.scope),now=Date.now();
 if(scope.kind==='artifact'&&activeCount(await ownerLinks(owner),scope,now)>=REVIEWER_LINKS_MAX)throw new ApiError(409,M.cap);
 const token=randomToken(),hash=await hashToken(token),pure:ShareScope=scope.kind==='customer_report'?{kind:'customer_report',id:scope.id,version:scope.version,brandId:scope.brandId,campaignId:null}:{kind:'artifact',id:scope.id,version:scope.version,brandId:null,campaignId:scope.campaignId};
 const link:ShareLink={id:uid(),scope:pure,label:input.label,createdBy:{id:who.id,role:who.role==='owner'?'owner':'admin'},createdAt:new Date(now).toISOString(),expiresAt:expiryOf(now,input.days??SHARE_DEFAULT_DAYS),revokedAt:null,viewCount:0,lastViewedAt:null,decisions:{}};
 await database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(rowId(hash),owner,'share_link','',JSON.stringify(link),link.createdAt).run();
 return {...entryOf(link,now),token};
}
async function revokeLink(owner:string,raw:Record<string,unknown>){
 const input=parse(parseRevokeLink(raw),'공유 링크 id를 확인하세요.');
 const row=await database().prepare(`SELECT id,data FROM records WHERE owner=? AND kind='share_link' AND json_extract(data,'$.id')=?`).bind(owner,input.id).first<{id:string;data:string}>();
 if(!row)throw new ApiError(404,'그 공유 링크가 없습니다.');
 const link=JSON.parse(row.data) as ShareLink,now=Date.now();
 if(link.revokedAt)return entryOf(link,now);
 const revoked:ShareLink={...link,revokedAt:new Date(now).toISOString()};
 await database().prepare('UPDATE records SET data=?,updated_at=? WHERE id=? AND owner=?').bind(JSON.stringify(revoked),revoked.revokedAt,row.id,owner).run();
 return entryOf(revoked,now);
}
// 판정 순서: 모르는 작업 400 → 권한 403 → 스위치 꺼짐 409(취소는 꺼져도 된다) → 대상 404/409 → 입력 400 → 상한 409.
export async function shareLinkAction(owner:string,input:Record<string,unknown>,who:Actor){
 const action=input.action;
 if(action!=='create'&&action!=='revoke')throw new ApiError(400,'지원하지 않는 공유 링크 작업입니다.');
 if(who.role==='member')throw new ApiError(403,M.adminOnly);
 if(action==='revoke')return revokeLink(owner,input);
 if(!await shareLinksOn(owner))throw new ApiError(409,M.off);
 return createLink(owner,input,who);
}

// ── 공개 쪽(로그인 없음) ──
async function bump(name:string,limit:number){
 const key=await hashToken('share:'+name),now=Date.now(),db=database();
 await db.prepare('INSERT INTO auth_rate_limits(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<=? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END').bind(key,now,now-RATE_WINDOW,now-RATE_WINDOW).run();
 const row=await db.prepare('SELECT count FROM auth_rate_limits WHERE key=?').bind(key).first<{count:number}>();
 if(!row||row.count>limit)throw new ApiError(429,M.rate);
}
const clientIp=(req:Request)=>req.headers.get('cf-connecting-ip')||'unknown-edge-address';
type Resolved={owner:string;rowId:string;link:ShareLink};
async function resolve(token:unknown,req:Request):Promise<Resolved>{
 if(!isShareToken(token))throw notFound();
 await bump('ip:'+clientIp(req),IP_LIMIT);
 const hash=await hashToken(token),row=await database().prepare(`SELECT id,owner,data FROM records WHERE id=? AND kind='share_link'`).bind(rowId(hash)).first<Row&{id:string}>();
 if(!row||!sameHash(row.id,rowId(hash)))throw notFound();
 await bump('token:'+hash,TOKEN_LIMIT);
 const link=JSON.parse(row.data) as ShareLink;
 if(!await shareLinksOn(row.owner)||linkState(link,Date.now())!=='active')throw notFound();
 return {owner:row.owner,rowId:row.id,link};
}
async function targetView(owner:string,link:ShareLink):Promise<PublicView>{
 const base={label:link.label,expiresAt:link.expiresAt};
 if(link.scope.kind==='customer_report'){
  const frozen=await frozenReportVersion(owner,link.scope.id,link.scope.version).catch(()=>null);
  if(!frozen)throw notFound();
  return {...publicReportView(frozen.report,frozen.version),...base};
 }
 const a=await readRecord<Artifact>(owner,'artifact',link.scope.id).catch(()=>null);
 if(!a||a.version!==link.scope.version||a.status==='outdated')throw notFound();
 return {...publicArtifactView(a,link.decisions),...base};
}
// GET: 보기 1회를 세고(viewCount·lastViewedAt) 공개 보기를 돌려준다. 어떤 실패도 404다.
export async function openShareLink(token:unknown,req:Request):Promise<PublicView>{
 const r=await resolve(token,req),view=await targetView(r.owner,r.link),seen={...r.link,viewCount:r.link.viewCount+1,lastViewedAt:stamp()};
 await database().prepare('UPDATE records SET data=? WHERE id=? AND owner=?').bind(JSON.stringify(seen),r.rowId,r.owner).run().catch(()=>console.error('share_view_count_failed'));
 return view;
}
// POST(작업물 검토자 링크만): 결정 1회를 review_decision(행위자 external:<라벨>)과 캠페인 이벤트로 남기고 링크에 적는다. 같은 (링크, 결정)은 다시 쓰지 않고 그 결과를 돌려준다.
// 작업물 상태·캠페인 상태는 바꾸지 않는다(외부 검토자는 그 판에 의견을 남길 수 있을 뿐, 최종 승인은 대표·관리자가 한다).
export type DecisionResult={decision:ShareDecisionKind;at:string;repeated:boolean};
export async function externalDecision(token:unknown,raw:unknown,req:Request):Promise<DecisionResult>{
 const r=await resolve(token,req);
 if(r.link.scope.kind!=='artifact')throw notFound();
 const parsed=parseDecision(raw);
 if(!parsed.success)throw new ApiError(400,parsed.issue.path==='note'?M.note:M.decision);
 const {decision}=parsed.data,note=(parsed.data.note||'').trim();
 if(decision==='revision'&&!note)throw new ApiError(400,M.note);
 const a=await readRecord<Artifact>(r.owner,'artifact',r.link.scope.id).catch(()=>null);
 if(!a||a.version!==r.link.scope.version||a.status==='outdated')throw notFound();
 const done=r.link.decisions[decision];
 if(done)return {decision,at:done.at,repeated:true};
 const at=stamp(),link:ShareLink={...r.link,decisions:{...r.link.decisions,[decision]:{at,noteLength:note.length}}};
 const statement=await artifactDecisionStatement(r.owner,a as ReviewedArtifact,{decision,reasonCodes:[],note,actor:{id:externalActorId(r.link.label),role:'external'}});
 await database().batch([statement,eventStatement(r.owner,a.campaignId,externalEventMessage(r.link.label,a.title,a.version,decision,note)),
  database().prepare('UPDATE records SET data=?,updated_at=? WHERE id=? AND owner=?').bind(JSON.stringify(link),at,r.rowId,r.owner)]);
 return {decision,at,repeated:false};
}
// 공개 POST는 같은 출처만 받는다. Origin이 있으면 요청 주소의 출처와 같아야 한다. 공개 화면은 Referrer-Policy no-referrer라 브라우저가 폼 POST에 Origin: null을 보내므로
// null은 없는 것으로 보고 Sec-Fetch-Site로 판정한다(same-origin·none만). Origin null인데 Sec-Fetch-Site도 없으면 거부한다.
export function requireSameOrigin(req:Request){
 const origin=req.headers.get('origin'),site=req.headers.get('sec-fetch-site');
 if(origin!==null&&origin!=='null'){if(origin!==new URL(req.url).origin)throw new ApiError(403,M.origin);return}
 if(site?site!=='same-origin'&&site!=='none':origin==='null')throw new ApiError(403,M.origin);
}
