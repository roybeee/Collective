'use client';
// 가맹 모집 화면 '모집 자료' 탭(트랙 R R15a-2b): 목록, 상세 시트(보기·편집·승인 단계), 현재 사실로 새 판 저장, 내보내기(복사·내려받기), 게시 위치, 폐기.
// 판정·권한은 서버(/api/franchise)가 한다. 화면은 보기 응답(게이트·체크리스트·사유 문구·라벨)으로 버튼을 숨기거나 입력을 잠그고 사전 검사로 헛요청만 줄인다. 판정 모듈(lib/franchise-assets*)은 import하지 않는다.
// 내보낸 원문은 응답 body만 파일·클립보드에 쓰고 화면 상태에 남기지 않는다(복사 대체 상자만 예외). 모든 쓰기는 요청 번호 규칙(sendAttempt)을 따른다.
// 대표 지시(2026-09-26 '표시하지마'): 생성물 표시 문구·선택·배지를 두지 않는다. 출처 작업물은 제목과 판만 보인다. 대기기간·수익 질의응답 문장은 서버 템플릿이 권장으로 채우고, 화면은 그 문장 때문에 저장·승인·내보내기를 막지 않는다(서버 경고만 보인다).
import {useCallback,useEffect,useRef,useState} from 'react';
import {Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {toKstDate,kstDateOf} from '@/lib/franchise-rules';
// R15b-2: 카드 묶음 PNG는 브라우저에서 그린다(판정은 서버, 렌더러는 자리 계산·그리기만).
import {downloadCardBundle,CARD_SIZES,CARD_SIZE_KEYS,type CardSize} from '@/lib/franchise-card-render';
import type {WorkspaceData} from '@/lib/client';
import {useAccount} from './account-context';
import {franchiseGet,problemOf,messageOf,ProblemBox,Disclaimer,Section,WarningLines,FranchiseLoadError,kst,roleLabel,saveText,copyText,stringWarnings,sendAttempt,followUpOf,reasonCodes,errorIs,
 EvidenceExport,type Json,type Problem,type PostBody,type PostResult,type Attempt} from './franchise-common';

type Artifact=WorkspaceData['artifacts'][number];
type Status='draft'|'approved'|'retired';
type Review={needed:boolean;reasons:string[];at:string|null};
type Ref={id:string;version:number};
type Actor={id:string;role:string};
export type AssetSummary={assetId:string;type:string;typeLabel:string;campaignId:string;campaignTitle:string|null;campaignMissing:boolean;
 latest:{version:number;status:Status;bodyHash:string;review:Review;approval:{by:string;role:string;at:string}|null;exportCount:number;lastExportAt:string|null;placements:{label:string;confirmedAt:string}[];updatedAt:string};
 versions:{version:number;status:Status;exportCount:number}[]};
export type FactOption={id:string;version:number;key:string;label:string;line:string;hasSource:boolean};
export type AssetsView={assets:AssetSummary[];campaigns:{id:string;title:string}[];types:{type:string;label:string}[];templates:{startup_page:string;event_deck:string;card_bundle?:string};templateFactRefs:Ref[];costFactsMissing:boolean;
 facts:FactOption[];branch:string|null;h7Notice:string|null;enabled:boolean;role:string;rules:{checklistVersion:string};disclaimer:string};
export type AssetRecord={id:string;campaignId:string;type:string;version:number;body:string;bodyHash:string;factRefs:Ref[];status:Status;
 approval:{by:string;role:string;at:string;bodyHash:string;checklist:{version:string;checked:string[]}}|null;placements:{label:string;confirmedAt:string}[];
 exports:{at:string;by:string;role:string}[];review:Review;source:{artifactId:string;version:number;origin:string|null}|null;savedBy:Actor;exportCount:number;retiredAt?:string;retiredBy?:Actor;updatedAt:string};
export type AssetDetailView={asset:AssetRecord;latestVersion:number;versions:{version:number;status:Status}[];drift:{factId:string;refVersion:number;currentVersion:number|null;changed:boolean}[];
 resaveSuggested:boolean;gate:{status:number;reasons:{code:string;message:string}[];message:string|null;warnings:string[]};checklist:{version:string;items:{id:string;text:string;ruleIds:string[];warnings:string[]}[];h7Notice:string|null};
 campaign:{id:string;title:string}|null;branch:string|null;h7Notice:string|null;enabled:boolean;disclaimer:string;
 // 결정 34: 강조할 대기기간·계약·가맹금·정보공개서 문장(원문 오프셋). 결정 34 전 서버 응답에는 없을 수 있다.
 waitReview?:{version:string;candidates:WaitCandidate[]}};
export type WaitCandidate={line:number;start:number;end:number};

// ── 표시값(판정 규칙이 아니다. 한도는 서버가 다시 본다) ──
export const ASSET_STATUS_LABELS:Readonly<Record<Status,string>>={draft:'초안',approved:'승인됨',retired:'폐기'};
export const REVIEW_REASON_LABELS:Readonly<Record<string,string>>={fact_changed:'근거 사실 변경',version_changed:'정보공개서 버전 변경'};
export const BODY_MAX=20000,FACT_REFS_MAX=20,LABEL_MAX=100,PLACEMENTS_MAX=20;
// R15b-2 카드 묶음 원문 안내(판정은 서버가 한다).
export const CARD_HELP="카드 묶음: '■ 1장'부터 차례로 3~5장, 카드마다 220자·10줄 이하(QR 카드 90자·4줄). 수치는 근거로 고른 사실의 값 그대로만 씁니다(날짜·시각·대표 전화번호 제외). QR 줄은 'QR https://창업 페이지 주소?utm_content=모집 코드' 한 줄이고 모집 코드는 '유입·비용' 탭에서 발급합니다.";
export const CARD_EXPORT_NOTE='PNG는 승인한 원문을 브라우저에서 카드마다 그린 파일입니다. 내려받은 묶음은 사람이 직접 올립니다. 인쇄·게시 전에 QR을 한 번 찍어 보세요.';
export const EXPORT_NOTE='복사·내려받기마다 내보내기 기록이 1건씩 남습니다. 내보낸 원문은 승인한 원문과 같은 바이트입니다.';
export const RETIRE_CONFIRM='이 판을 폐기합니다. 폐기한 판은 내보내거나 행사에 새로 연결할 수 없고 되돌릴 수 없습니다. 승인·내보내기·게시 기록은 증빙으로 남습니다.';
export const DRAFT_REPLACE_NOTE='초안을 다시 저장하면 바로 앞 초안 판은 새 판으로 바뀝니다(승인·내보내기 기록이 있는 판은 남습니다).';
export const ASSETS_OFF_NOTE='기능 스위치가 꺼져 있어 모집 자료를 저장·승인·내보내거나 게시 위치를 기록할 수 없습니다. 폐기는 할 수 있습니다.';
export const COPY_FALLBACK='클립보드에 복사하지 못했습니다. 아래 원문을 전체 선택해 직접 복사하세요(내보내기 기록은 이미 남았습니다).';
const NO_CAMPAIGN='가맹 모집 목적 캠페인이 없어 새 자료를 만들 수 없습니다. 캠페인 브리프에서 목적을 ‘가맹 모집’으로 지정하세요(대표·관리자).';
const COST_MISSING='현재 등록 버전 정보공개서에 근거한 총 창업비용 사실이 없어 창업 페이지·설명회 덱 템플릿의 창업비용 표가 비어 있습니다. 이대로는 승인되지 않습니다. 브랜드 아카이브의 확인 사실에서 등록하세요.';
const CAMPAIGN_GONE='캠페인이 삭제돼 승인·내보내기를 할 수 없습니다. 게시 위치 기록과 폐기는 할 수 있습니다.';
export const CAMPAIGN_GONE_EDIT='캠페인이 삭제돼 새 판을 저장할 수 없습니다.';
const REVIEW_BLOCK='재검토가 필요합니다. 현재 사실로 새 판을 저장한 뒤 다시 승인하세요.';
const GATE_BLOCK='게이트 사유를 고친 새 판을 저장해야 합니다.';
const OUTDATED_BLOCK='체크리스트가 바뀌었습니다. 새 판으로 저장해 다시 승인해야 내보낼 수 있습니다.';
const SOURCE_STALE='워크스페이스 작업물 목록이 오래됐을 수 있습니다. 페이지를 새로고침한 뒤 다시 고르세요.';
const FACT_CODES=['fact_changed','fact_stale','fact_revenue','fact_source_missing'];
const reviewText=(reasons:readonly string[])=>reasons.map(r=>REVIEW_REASON_LABELS[r]??r).join(' · ');

// ── 순수 도우미(서버 계약, 단위 검사 대상) ──
export const latestOf=(v:AssetDetailView)=>v.asset.version===v.latestVersion;
export const checklistOutdated=(v:AssetDetailView)=>v.asset.status==='approved'&&!!v.asset.approval&&v.asset.approval.checklist.version!==v.checklist.version;
export type AssetGates={showApprove:boolean;canApprove:boolean;showExport:boolean;canExport:boolean;canPlace:boolean;canRetire:boolean;canEdit:boolean;canResave:boolean;blockers:string[]};
// 승인·내보내기는 대표·관리자·최신 판·스위치 켜짐·분기 A·캠페인 있음·재검토 없음·게이트 200일 때만. 서버 경고(권장 문장 포함)는 막지 않는다. 게시 위치는 어느 판이든, 폐기는 스위치가 꺼져도 된다.
// 편집·현재 사실로 새 판은 스위치 켜짐·최신 판·폐기 아님·캠페인 있음(8절). 캠페인이 삭제되면 서버가 저장을 campaign_other_brand로 거절하므로 버튼 대신 안내를 둔다.
export function assetGates(v:AssetDetailView,admin:boolean):AssetGates{
 const L=latestOf(v),e=v.enabled,s=v.asset.status,outdated=checklistOutdated(v);
 const ok=v.branch==='A'&&v.campaign!==null&&!v.asset.review.needed&&v.gate.status===200;
 const showApprove=admin&&L&&s==='draft',canApprove=showApprove&&e&&ok,showExport=admin&&L&&s==='approved',canExport=showExport&&e&&ok&&!outdated;
 const blockers:string[]=[];
 if((showApprove&&!canApprove)||(showExport&&!canExport)){
  if(!e)blockers.push(ASSETS_OFF_NOTE);
  if(v.branch!=='A'&&v.h7Notice)blockers.push(v.h7Notice);
  if(v.campaign===null)blockers.push(CAMPAIGN_GONE);
  if(v.asset.review.needed)blockers.push(REVIEW_BLOCK);
  if(v.gate.status!==200)blockers.push(GATE_BLOCK);
  if(showExport&&outdated)blockers.push(OUTDATED_BLOCK);
 }
 return {showApprove,canApprove,showExport,canExport,canPlace:admin&&e&&s==='approved'&&v.asset.exports.length>0&&v.asset.placements.length<PLACEMENTS_MAX,
  canRetire:admin&&s!=='retired',canEdit:e&&L&&s!=='retired'&&v.campaign!==null,canResave:e&&L&&s!=='retired'&&v.campaign!==null&&(v.resaveSuggested||outdated),blockers};
}
// 현재 사실로 새 판: 참조를 현재 사실 판으로 올리고 없어진 사실은 뺀다. 기준 판은 최신 판, 출처는 보내지 않는다(이어받음).
export function resaveInput(v:AssetDetailView):{payload:Json;dropped:string[]}|null{
 if(!assetGates(v,false).canResave)return null;
 const factRefs=v.drift.flatMap(d=>d.currentVersion===null?[]:[{id:d.factId,version:d.currentVersion}]);
 return {payload:{assetId:v.asset.id,baseVersion:v.latestVersion,type:v.asset.type,body:v.asset.body,factRefs},dropped:v.drift.filter(d=>d.currentVersion===null).map(d=>d.factId)};
}
// 대기기간 우회 문장 확인(결정 34): 확인했을 때만 싣는다. candidates는 화면이 강조한 문장 수이고, 서버가 원문에서 센 수와 다르면 409 wait_review_outdated다.
export function waitReviewInput(v:AssetDetailView,confirmed:boolean):Json{
 return confirmed&&v.waitReview?{waitReview:{version:v.waitReview.version,confirmed:true,candidates:v.waitReview.candidates.length}}:{};
}
// 원문을 강조 조각으로 나눈다(겹치거나 범위를 벗어난 후보는 버린다). 원문을 바꾸지 않는다: 조각을 이으면 원문이다.
export function highlightSegments(body:string,candidates:readonly WaitCandidate[]):{text:string;mark:boolean}[]{
 const out:{text:string;mark:boolean}[]=[];let at=0;
 for(const c of [...candidates].sort((a,b)=>a.start-b.start)){
  if(!(Number.isInteger(c.start)&&Number.isInteger(c.end))||c.start<at||c.end<=c.start||c.end>body.length)continue;
  if(c.start>at)out.push({text:body.slice(at,c.start),mark:false});
  out.push({text:body.slice(c.start,c.end),mark:true});at=c.end;
 }
 if(at<body.length)out.push({text:body.slice(at),mark:false});
 return out;
}
export function approveInput(v:AssetDetailView,checked:ReadonlySet<string>,target?:{version:number;bodyHash:string},waitConfirmed=false):Json{
 return {assetId:v.asset.id,version:target?.version??v.asset.version,bodyHash:target?.bodyHash??v.asset.bodyHash,checklist:{version:v.checklist.version,checked:v.checklist.items.map(i=>i.id).filter(id=>checked.has(id))},...waitReviewInput(v,waitConfirmed)};
}
// 승인 버튼: 체크리스트 모든 항목을 확인해야 한다(항목이 없으면 누를 수 없다). 경고는 조건이 아니다.
export const approveReady=(v:AssetDetailView,checked:ReadonlySet<string>)=>v.checklist.items.length>0&&v.checklist.items.every(i=>checked.has(i.id));
export function placementRange(v:AssetDetailView,nowIso:string):{min:string;max:string}|null{const first=v.asset.exports[0];return first?{min:kstDateOf(first.at),max:toKstDate(nowIso)}:null}
export function seedOptions(artifacts:readonly Artifact[],campaignId:string){
 return artifacts.filter(a=>a.campaignId===campaignId&&a.status==='approved').sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))
  .map(a=>({id:a.id,version:a.version,title:a.title,length:a.content.length,changed:!!(a.factsChanged||a.brandChanged)}));
}
export type EditorForm={type:string;campaignId:string;body:string;picked:ReadonlySet<string>;source:{artifactId:string;version:number;title:string}|null;base:number|null};
// 초안 저장 요청: 새 자료는 캠페인·유형, 편집은 자료 id·기준 판(편집을 시작한 최신 판 또는 충돌 뒤 고른 최신 판)·저장된 유형. 근거는 선택 id를 목록의 현재 판으로 바꾼 값(목록에 없는 id는 빠진다).
export function saveInput(list:Pick<AssetsView,'facts'>,detail:AssetDetailView|null,f:EditorForm):Json{
 const factRefs=list.facts.filter(x=>f.picked.has(x.id)).map(x=>({id:x.id,version:x.version})),source=f.source?{source:{artifactId:f.source.artifactId,version:f.source.version}}:{};
 return detail?{assetId:detail.asset.id,baseVersion:f.base??detail.latestVersion,type:detail.asset.type,body:f.body,factRefs,...source}:{campaignId:f.campaignId,type:f.type,body:f.body,factRefs,...source};
}
export function insertAt(body:string,text:string,pos:number|null|undefined):string|null{
 const at=pos===null||pos===undefined||pos>body.length?body.length:Math.max(0,pos),next=body.slice(0,at)+text+body.slice(at);
 return next.length>BODY_MAX?null:next;
}
// 내보내기 응답을 파일·클립보드로: 응답의 body만 쓴다(화면이 가진 원문은 쓰지 않는다). 복사가 막히면 대체 상자에 같은 body를 넘긴다.
export async function deliverExport(b:PostBody,how:'copy'|'download'):Promise<{message:string;fallback:string|null}|null>{
 if(!(typeof b.body==='string'&&typeof b.filename==='string'))return null;
 let fallback:string|null=null;
 if(how==='download')saveText(b.filename,b.body);
 else if(!await copyText(b.body))fallback=b.body;
 const head=fallback!==null?'':how==='copy'?'복사했습니다. ':'내려받았습니다. ';
 return {message:b.replayed===true?'같은 요청을 다시 받았습니다(내보내기 기록은 늘지 않았습니다).':head+'내보내기 기록 1건을 남겼습니다.',fallback};
}
const resultOf=(r:PostResult)=>(r.body.result??{}) as Json;
const Blockers=({items}:{items:readonly string[]})=><>{items.map(b=><p key={b} className="subtle-note">{b}</p>)}</>;

// ── 탭 본체 ──
export type CardBrand={name:string;color?:string};
export function FranchiseAssets({brandId,brand,admin,artifacts,onStatus,initial}:{brandId:string;brand?:CardBrand;admin:boolean;artifacts:readonly Artifact[];onStatus:()=>void;initial?:AssetsView}){
 const me=useAccount()?.id??null;
 const [list,setList]=useState<AssetsView|null>(initial??null),[error,setError]=useState(''),[open,setOpen]=useState<{assetId:string|null}|null>(null);
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const d=await franchiseGet<AssetsView>({view:'assets',brandId},signal);if(!signal?.aborted){setList(d);setError('')}}
  catch(e){if(!signal?.aborted)setError(messageOf(e))}
 },[brandId]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load]);
 return <div className="franchise-panel">
  <div className="franchise-bar"><h3>모집 자료</h3>{list&&list.enabled&&list.campaigns.length>0&&<Button onClick={()=>setOpen({assetId:null})}><Plus/>새 모집 자료</Button>}</div>
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load()}>다시 불러오기</Button></div>}
  {!list?!error&&<p role="status">모집 자료를 불러오고 있습니다.</p>:<>
   {list.h7Notice&&<p className="notice" role="note">{list.h7Notice}</p>}
   {!list.enabled&&<p className="notice" role="note">{ASSETS_OFF_NOTE}</p>}
   {list.enabled&&!list.campaigns.length&&<p className="subtle-note">{NO_CAMPAIGN}</p>}
   {list.costFactsMissing&&<p className="subtle-note">{COST_MISSING}</p>}
   {list.assets.length?<ul className="franchise-list" aria-label="모집 자료 목록">{list.assets.map(a=>{const l=a.latest;return <li key={a.assetId}>
    <div className="franchise-bar"><b>{a.typeLabel}</b><span>{`v${l.version}`}</span><span className="status">{ASSET_STATUS_LABELS[l.status]}</span>{l.review.needed&&<span className="franchise-flag">{`재검토 필요 · ${reviewText(l.review.reasons)}`}</span>}</div>
    <p className="subtle-note">{`${a.campaignMissing?'캠페인 삭제됨':a.campaignTitle??'-'} · 수정 ${kst(l.updatedAt)} · 판 ${a.versions.length}개`}</p>
    {l.approval&&<p className="subtle-note">{`승인 ${l.approval.by===me?'나':roleLabel(l.approval.role)} · ${kst(l.approval.at)}`}</p>}
    {l.exportCount>0&&<p className="subtle-note">{`내보내기 ${l.exportCount}회 · 마지막 ${kst(l.lastExportAt)}`}</p>}
    {l.placements.length>0&&<p className="subtle-note">{`게시 위치 ${l.placements.length}곳: ${l.placements.map(p=>`${p.label} (${p.confirmedAt})`).join(' · ')}`}</p>}
    <Button variant="outline" size="sm" aria-label={`${a.typeLabel} v${l.version} 열기`} onClick={()=>setOpen({assetId:a.assetId})}>열기</Button>
   </li>})}</ul>:<p className="subtle-note">아직 모집 자료가 없습니다.</p>}
   <Disclaimer/>
  </>}
  {open&&list&&<AssetSheet key={open.assetId??'new'} brandId={brandId} brand={brand} assetId={open.assetId} list={list} admin={admin} artifacts={artifacts} onClose={()=>setOpen(null)} onChanged={()=>void load()} onStatus={onStatus}/>}
 </div>;
}

// ── 상세 시트: 보기·편집·승인 단계(대화상자 안의 대화상자 대신 시트 안 모드) ──
type Mode='view'|'edit'|'approve';
export type SaveOutcome='ok'|'source_invalid'|'failed';
export function AssetSheet({brandId,brand,assetId,list,admin,artifacts,onClose,onChanged,onStatus,initial,initialMode}:{brandId:string;brand?:CardBrand;assetId:string|null;list:AssetsView;admin:boolean;artifacts:readonly Artifact[];
 onClose:()=>void;onChanged:()=>void;onStatus:()=>void;initial?:AssetDetailView;initialMode?:Mode}){
 const me=useAccount()?.id??null,who=(id:string,role:string)=>id===me?'나':roleLabel(role);
 const [id,setId]=useState(assetId),[version,setVersion]=useState<number|null>(null),[view,setView]=useState<AssetDetailView|null>(initial??null);
 const [mode,setMode]=useState<Mode>(initialMode??(assetId===null?'edit':'view')),[now,setNow]=useState(()=>new Date().toISOString());
 const [loadError,setLoadError]=useState<{message:string;status:number}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[warnings,setWarnings]=useState<string[]>([]),[problem,setProblem]=useState<Problem|null>(null);
 const [attempts,setAttempts]=useState<Record<string,Attempt>>({}),[conflict,setConflict]=useState(false),[fallback,setFallback]=useState<string|null>(null),[editorKey,setEditorKey]=useState(0),[approveKey,setApproveKey]=useState(0);
 const load=useCallback(async(signal?:AbortSignal)=>{
  if(!id)return;
  try{const d=await franchiseGet<AssetDetailView>({view:'asset',brandId,assetId:id,...(version!==null?{version:String(version)}:{})},signal);if(!signal?.aborted){setView(d);setLoadError(null);setNow(new Date().toISOString())}}
  catch(e){if(!signal?.aborted)setLoadError({message:messageOf(e),status:e instanceof FranchiseLoadError?e.status:0})}
 },[brandId,id,version]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load]);
 // 쓰기 공통: 작업마다 요청 번호 기록을 따로 둔다. 실패는 문제 상자와 후속 동작(9절), 성공은 문구·경고와 다시 읽기.
 async function run(action:string,payload:Json):Promise<PostResult>{
  setBusy(true);setProblem(null);setMessage('');setWarnings([]);
  try{const {r,next}=await sendAttempt(action,{brandId,...payload},attempts[action]??null);setAttempts(a=>({...a,[action]:next}));return r}
  finally{setBusy(false)}
 }
 function fail(r:PostResult,extra=''){
  const p=problemOf(r);setProblem({...p,error:extra?`${p.error} ${extra}`:p.error,warnings:undefined});
  const next=followUpOf(r);
  if(next==='reload'){void load();onChanged()}
  else if(next==='close'){onChanged();onClose()}
  else if(next==='status'){onStatus();void load();onChanged()}
 }
 function done(r:PostResult,text:string){setMessage((r.body.replayed===true?'이미 처리된 요청입니다. ':'')+text);setWarnings(stringWarnings(r));void load();onChanged()}
 async function save(payload:Json):Promise<SaveOutcome>{
  const r=await run('asset_save',payload),res=resultOf(r);
  if(r.status===200){
   setConflict(false);setVersion(null);
   if(typeof res.assetId==='string'&&res.assetId!==id)setId(res.assetId);
   done(r,res.unchanged===true?'바뀐 내용이 없어 새 판을 만들지 않았습니다.':`v${String(res.version)} 초안을 저장했습니다.`);setMode('view');return 'ok';
  }
  if(errorIs(r,'SOURCE_INVALID')){fail(r,SOURCE_STALE);return 'source_invalid'}
  fail(r);
  if(errorIs(r,'ASSET_STALE')){setConflict(true);setVersion(null)}
  else if(r.status===409&&reasonCodes(r).some(c=>FACT_CODES.includes(c)))setMessage('사실 목록을 새로 불러왔습니다. 근거 사실을 확인한 뒤 다시 저장하세요.');
  return 'failed';
 }
 async function resave(){
  const x=view&&resaveInput(view);if(!x)return;
  if(x.dropped.length&&!window.confirm(`근거에서 뺄 사실 ${x.dropped.length}개(삭제됐거나 이 브랜드 사실이 아님). 원문에 그 값이 남아 있으면 승인 때 막힙니다. 계속할까요?`))return;
  const r=await run('asset_save',x.payload),res=resultOf(r);
  if(r.status===200){setVersion(null);done(r,res.unchanged===true?'바뀐 내용이 없어 새 판을 만들지 않았습니다.':`v${String(res.version)} 초안을 저장했습니다. 다시 승인해야 내보낼 수 있습니다.`);return}
  fail(r);
  if(r.status===409&&reasonCodes(r).some(c=>FACT_CODES.includes(c))){setEditorKey(k=>k+1);setMode('edit')}
 }
 async function approve(checked:ReadonlySet<string>,waitConfirmed:boolean){
  if(!view)return;
  const r=await run('asset_approve',approveInput(view,checked,undefined,waitConfirmed)),res=resultOf(r);
  if(r.status===200){setMode('view');done(r,`v${String(res.version)}을 승인했습니다.`);return}
  fail(r);
  const codes=reasonCodes(r);if(codes.includes('hash_mismatch')||codes.includes('checklist_outdated')||codes.includes('wait_review_outdated')){setApproveKey(k=>k+1);void load()}
 }
 async function exportAs(how:'copy'|'download',waitConfirmed:boolean,size?:CardSize){
  if(!view)return;setFallback(null);
  const r=await run('asset_export',{assetId:view.asset.id,version:view.asset.version,mode:how,...waitReviewInput(view,waitConfirmed)});
  if(r.status!==200){fail(r);if(reasonCodes(r).includes('wait_review_outdated'))void load();return}
  if(size){await deliverCards(r,size);void load();onChanged();return}
  const out=await deliverExport(r.body,how);
  if(!out)setProblem({error:'내보낸 원문을 받지 못했습니다. 새로고침한 뒤 다시 시도하세요.'});
  else{setFallback(out.fallback);setMessage(out.message);setWarnings(stringWarnings(r))}
  void load();onChanged();
 }
 // 카드 묶음 PNG: 응답 body(승인 원문)만 그린다. 그리기가 실패하면 파일을 하나도 내려받지 않고 문제 상자에 알린다(내보내기 기록은 이미 남았다).
 async function deliverCards(r:PostResult,size:CardSize){
  const b=r.body;
  if(!view||typeof b.body!=='string'){setProblem({error:'내보낸 원문을 받지 못했습니다. 새로고침한 뒤 다시 시도하세요.'});return}
  try{
   const n=await downloadCardBundle(b.body,{assetId:view.asset.id,version:view.asset.version,size,brand:brand??{name:''}});
   setMessage(b.replayed===true?'같은 요청을 다시 받았습니다(내보내기 기록은 늘지 않았습니다).':`PNG ${n}장(${CARD_SIZES[size].label})을 내려받았습니다. 내보내기 기록 1건을 남겼습니다.`);
   setWarnings(stringWarnings(r));
  }catch(e){setProblem({error:`PNG를 만들지 못했습니다: ${(e as Error).message} (내보내기 기록은 남았습니다.)`})}
 }
 async function place(label:string,on:string):Promise<boolean>{
  if(!view)return false;
  const r=await run('asset_place',{assetId:view.asset.id,version:view.asset.version,label:label.trim(),confirmedAt:on});
  if(r.status===200){done(r,`게시 위치를 기록했습니다(모두 ${String(resultOf(r).placements)}곳).`);return true}
  fail(r);return false;
 }
 async function retire(){
  if(!view||!window.confirm(RETIRE_CONFIRM))return;
  const r=await run('asset_retire',{assetId:view.asset.id,version:view.asset.version}),res=resultOf(r);
  if(r.status===200){done(r,res.unchanged===true?'이미 폐기된 판입니다.':`v${String(res.version)}을 폐기했습니다.`);return}
  fail(r);
 }
 const g=view?assetGates(view,admin):null,typeName=(t:string)=>list.types.find(x=>x.type===t)?.label??t;
 const title=view?`${typeName(view.asset.type)} · v${view.asset.version}`:id===null?'새 모집 자료':'모집 자료';
 const description=view?`${ASSET_STATUS_LABELS[view.asset.status]} · ${view.campaign?.title??'캠페인 삭제됨'} · 저장 ${kst(view.asset.updatedAt)} · ${who(view.asset.savedBy.id,view.asset.savedBy.role)}`
  :id===null?'가맹 모집 캠페인의 모집 자료 초안을 만듭니다. 승인·내보내기는 대표·관리자가 합니다.':'자료를 불러오고 있습니다.';
 return <Sheet open onOpenChange={o=>{if(!o&&!busy)onClose()}}><SheetContent className="franchise-sheet">
  <SheetHeader><SheetTitle>{mode==='edit'&&id===null?'새 모집 자료':title}</SheetTitle><SheetDescription>{description}</SheetDescription></SheetHeader>
  <div className="franchise-detail">
   {loadError&&<div role="alert" className="load-error"><span>{loadError.message}</span>{loadError.status===404&&version!==null?<Button variant="outline" size="sm" onClick={()=>setVersion(null)}>최신 판 열기</Button>:<Button variant="outline" size="sm" onClick={()=>void load()}>다시 불러오기</Button>}</div>}
   {mode==='edit'&&(id===null||view)?<AssetEditor key={editorKey} list={list} artifacts={artifacts} detail={id===null?null:view} busy={busy} enabled={view?view.enabled:list.enabled} conflict={conflict} onSave={save}
     onCancel={()=>{setConflict(false);if(id===null)onClose();else setMode('view')}} onRestart={()=>{setConflict(false);setEditorKey(k=>k+1)}}/>
    :view&&g?(mode==='approve'&&g.showApprove?<ApprovalStep key={`${view.asset.id}:${view.asset.version}:${view.asset.bodyHash}:${approveKey}`} view={view} busy={busy} blockers={g.blockers} onApprove={(c,w)=>void approve(c,w)} onCancel={()=>setMode('view')}/>
     :<AssetBody brandId={brandId} view={view} g={g} admin={admin} artifacts={artifacts} busy={busy} now={now} fallback={fallback} who={who} on={{version:n=>{setVersion(n===view.latestVersion?null:n);setMode('view')},edit:()=>{setConflict(false);setEditorKey(k=>k+1);setMode('edit')},
      approve:()=>setMode('approve'),resave:()=>void resave(),exportAs:(how,w,size)=>void exportAs(how,w,size),place,retire:()=>void retire(),closeFallback:()=>setFallback(null)}}/>):null}
   {(message||problem||warnings.length>0)&&<div className="franchise-status">{message&&<p role="status">{message}</p>}<WarningLines items={warnings}/><ProblemBox problem={problem}/></div>}
  </div>
 </SheetContent></Sheet>;
}

type BodyActions={version:(n:number)=>void;edit:()=>void;approve:()=>void;resave:()=>void;exportAs:(how:'copy'|'download',waitConfirmed:boolean,size?:CardSize)=>void;place:(label:string,on:string)=>Promise<boolean>;retire:()=>void;closeFallback:()=>void};
function AssetBody({brandId,view,g,admin,artifacts,busy,now,fallback,who,on}:{brandId:string;view:AssetDetailView;g:AssetGates;admin:boolean;artifacts:readonly Artifact[];busy:boolean;now:string;fallback:string|null;who:(id:string,role:string)=>string;on:BodyActions}){
 const a=view.asset,source=a.source,range=placementRange(view,now),changed=view.drift.filter(d=>d.changed),gone=view.enabled&&latestOf(view)&&a.status!=='retired'&&view.campaign===null;
 return <>
  <section className="franchise-box" aria-label="판과 상태">
   <div className="franchise-bar">{view.versions.map(x=><Button key={x.version} size="sm" variant={x.version===a.version?'default':'outline'} aria-current={x.version===a.version?'true':undefined} onClick={()=>on.version(x.version)}>{`v${x.version} (${ASSET_STATUS_LABELS[x.status]})`}</Button>)}</div>
   {!latestOf(view)&&<p className="subtle-note">최신 판 아님. 옛 판은 증빙·행사 연결·게시 위치 기록용입니다.</p>}
   {a.review.needed&&<p className="franchise-flag">{`재검토 필요 · ${reviewText(a.review.reasons)}`}</p>}
   {source&&<p className="subtle-note">{`출처 작업물 ${artifacts.find(x=>x.id===source.artifactId)?.title??source.artifactId} v${source.version}`}</p>}
   {a.status==='retired'&&<p className="subtle-note">{`폐기 ${kst(a.retiredAt)} · ${a.retiredBy?who(a.retiredBy.id,a.retiredBy.role):'-'}`}</p>}
  </section>
  <section className="franchise-box" aria-label="원문 보기">
   <HighlightedBody view={view} label="원문"/>
   <p className="subtle-note">{`${a.body.length.toLocaleString('ko-KR')}자 · 원문 해시 ${a.bodyHash.slice(0,12)}…`}</p>
  </section>
  <Section title="승인·내보내기 게이트">
   {view.gate.status===200?<p>현재 사실 기준으로 막는 사유가 없습니다.</p>:<>{view.gate.message&&<p>{view.gate.message}</p>}{view.gate.reasons.length>0&&<ul>{view.gate.reasons.map(r=><li key={r.code}>{r.message}</li>)}</ul>}</>}
   <WarningLines items={view.gate.warnings}/><Disclaimer/>
  </Section>
  {(view.resaveSuggested||checklistOutdated(view))&&<Section title="재검토" note="근거 사실·정보공개서 버전이나 체크리스트가 바뀌었습니다. 현재 사실로 새 판을 저장한 뒤 다시 승인하세요.">
   {changed.length>0&&<ul>{changed.map(d=><li key={d.factId}>{`${d.factId}: v${d.refVersion} → ${d.currentVersion===null?'사실 없음(근거에서 뺍니다)':`v${d.currentVersion}`}`}</li>)}</ul>}
   {g.canResave&&<div><Button disabled={busy} onClick={on.resave}>현재 사실로 새 판 저장</Button></div>}
  </Section>}
  <Section title={admin?'승인 체크리스트':'승인 전 확인 항목(대표·관리자가 확인)'}>
   <ol className="form-stack">{view.checklist.items.map(i=><li key={i.id}>{i.text}<WarningLines items={i.warnings}/></li>)}</ol>
   <small>{`체크리스트 ${view.checklist.version}`}</small>
   {view.checklist.h7Notice&&<p className="notice" role="note">{view.checklist.h7Notice}</p>}
  </Section>
  <Section title="승인 기록">
   <p>{a.approval?`승인 ${who(a.approval.by,a.approval.role)} · ${kst(a.approval.at)} · 체크리스트 ${a.approval.checklist.version}`:'아직 승인하지 않았습니다.'}</p>
   {g.showApprove&&(g.canApprove?<div><Button disabled={busy} onClick={on.approve}>승인하기</Button></div>:<Blockers items={g.blockers}/>)}
  </Section>
  <Section title="내보내기">
   {g.showExport&&(g.canExport?<ExportControls key={`${a.id}:${a.version}:${a.bodyHash}`} view={view} busy={busy} onExport={on.exportAs}/>:<Blockers items={g.blockers}/>)}
   {fallback!==null&&<div className="form-stack"><p role="alert">{COPY_FALLBACK}</p><Textarea readOnly aria-label="내보낸 원문 (직접 복사)" rows={8} value={fallback} onFocus={e=>e.currentTarget.select()}/><div><Button size="sm" variant="outline" onClick={on.closeFallback}>닫기</Button></div></div>}
   <p className="subtle-note">{`내보내기 ${a.exportCount}회`}</p>
   {a.exports.length>0&&<ul>{a.exports.slice(-5).reverse().map((x,i)=><li key={i}>{`${kst(x.at)} · ${who(x.by,x.role)}`}</li>)}</ul>}
  </Section>
  <Section title="게시 위치">
   {a.placements.length?<ul>{a.placements.map((p,i)=><li key={i}>{`${p.label} (${p.confirmedAt})`}</li>)}</ul>:<p className="subtle-note">기록한 게시 위치가 없습니다.</p>}
   {g.canPlace&&range&&<PlaceForm range={range} busy={busy} onPlace={on.place}/>}
   {admin&&a.status==='approved'&&a.placements.length>=PLACEMENTS_MAX&&<p className="subtle-note">게시 위치는 20곳까지 기록합니다.</p>}
  </Section>
  {admin&&<EvidenceExport brandId={brandId} scope="asset" target={a.id}/>}
  {(g.canEdit||g.canRetire||gone)&&<div className="franchise-bar">{g.canEdit&&<Button disabled={busy} onClick={on.edit}>편집</Button>}{gone&&<p className="subtle-note">{CAMPAIGN_GONE_EDIT}</p>}{g.canRetire&&<Button variant="outline" disabled={busy} onClick={on.retire}>폐기</Button>}</div>}
 </>;
}

// 게시 위치: 채널·게시물 이름과 게시 확인일(첫 내보내기 날 ~ 오늘, KST). 실패하면 입력을 두고 라벨 칸으로 돌아간다.
function PlaceForm({range,busy,onPlace}:{range:{min:string;max:string};busy:boolean;onPlace:(label:string,on:string)=>Promise<boolean>}){
 const [label,setLabel]=useState(''),[on,setOn]=useState(range.max),ref=useRef<HTMLInputElement>(null);
 return <form autoComplete="off" className="form-stack" onSubmit={e=>{e.preventDefault();void onPlace(label,on).then(ok=>{if(ok)setLabel('');else ref.current?.focus()})}}><fieldset disabled={busy} className="form-stack">
  <label className="field"><span>게시 위치</span><Input autoComplete="off" ref={ref} required maxLength={LABEL_MAX} placeholder="예: 창업 포털 소개 글" value={label} onChange={e=>setLabel(e.target.value)}/><small>채널·게시물 이름만 적습니다. 연락처·개인 이름은 적지 않습니다.</small></label>
  <label className="field"><span>게시 확인일 (KST)</span><Input type="date" required min={range.min} max={range.max} value={on} onChange={e=>setOn(e.target.value)}/></label>
  <div className="form-actions"><Button type="submit" disabled={!label.trim()||!on}>게시 위치 기록</Button></div>
 </fieldset></form>;
}

// ── 승인 단계(대표·관리자): 승인할 원문, 체크리스트(모든 항목 확인), 항목·게이트 경고(막지 않는다) ──
// 대기기간 우회 문장 확인(결정 34): 강조한 문장을 읽고 확인해야 승인·내보내기 버튼이 열린다. 서버도 같은 확인을 요구한다(없으면 409).
const WAIT_CONFIRM_TEXT=(n:number)=>`강조한 대기기간·계약·가맹금·정보공개서 문장 ${n}개를 읽었고, 대기기간을 우회하거나 줄여 말하는 문장이 없습니다.`;
const WAIT_NOTE='강조는 낱말로 고른 후보이고 막지 않습니다. 판정기가 놓치는 우회 표현이 있어 사람이 확인합니다. COLLECTIVE 휴리스틱 · 법률 자문 아님.';
export function HighlightedBody({view,label}:{view:AssetDetailView;label:string}){
 const parts=highlightSegments(view.asset.body,view.waitReview?.candidates??[]);
 return <pre aria-label={label} tabIndex={0} className="whitespace-pre-wrap break-words text-sm">{parts.map((p,i)=>p.mark?<mark key={i} className="franchise-wait-mark">{p.text}</mark>:<span key={i}>{p.text}</span>)}</pre>;
}
export function WaitConfirm({view,checked,onChange,id}:{view:AssetDetailView;checked:boolean;onChange:(on:boolean)=>void;id:string}){
 const n=view.waitReview?.candidates.length??0;
 return <div className="field"><label className="franchise-inline"><input id={id} type="checkbox" checked={checked} aria-describedby={`${id}-note`} onChange={e=>onChange(e.target.checked)}/>{` ${WAIT_CONFIRM_TEXT(n)}`}</label>
  <small id={`${id}-note`}>{WAIT_NOTE}</small></div>;
}
function ExportControls({view,busy,onExport}:{view:AssetDetailView;busy:boolean;onExport:(how:'copy'|'download',waitConfirmed:boolean,size?:CardSize)=>void}){
 const [ok,setOk]=useState(false),off=busy||!ok,cards=view.asset.type==='card_bundle';
 return <div className="form-stack"><WaitConfirm view={view} checked={ok} onChange={setOk} id="export-wait-confirm"/>
  <div className="franchise-bar"><Button disabled={off} onClick={()=>onExport('copy',ok)}>복사</Button><Button variant="outline" disabled={off} onClick={()=>onExport('download',ok)}>내려받기(.txt)</Button>
   {cards&&CARD_SIZE_KEYS.map(size=><Button key={size} variant="outline" disabled={off} onClick={()=>onExport('download',ok,size)}>{`PNG 내려받기(${CARD_SIZES[size].label})`}</Button>)}</div>
  <p className="subtle-note">{EXPORT_NOTE}</p>{cards&&<p className="subtle-note">{CARD_EXPORT_NOTE}</p>}</div>;
}
export function ApprovalStep({view,busy,blockers,onApprove,onCancel,initialChecked,initialWaitConfirmed}:{view:AssetDetailView;busy:boolean;blockers:readonly string[];onApprove:(checked:ReadonlySet<string>,waitConfirmed:boolean)=>void;onCancel:()=>void;initialChecked?:readonly string[];initialWaitConfirmed?:boolean}){
 const [checked,setChecked]=useState<ReadonlySet<string>>(()=>new Set(initialChecked??[])),[waitOk,setWaitOk]=useState(initialWaitConfirmed===true);
 const ready=approveReady(view,checked)&&waitOk&&!blockers.length;
 function toggle(id:string,on:boolean){const next=new Set(checked);if(on)next.add(id);else next.delete(id);setChecked(next)}
 return <section className="franchise-box" aria-labelledby="approve-title">
  <h3 id="approve-title">승인 확인</h3>
  {view.checklist.h7Notice&&<p className="notice" role="note">{view.checklist.h7Notice}</p>}
  <Blockers items={blockers}/>
  <HighlightedBody view={view} label="승인할 원문"/>
  <p className="subtle-note">{`${view.asset.body.length.toLocaleString('ko-KR')}자 · 승인하면 이 원문(해시)이 승인 기록에 묶입니다.`}</p>
  <form autoComplete="off" className="form-stack" onSubmit={e=>{e.preventDefault();if(ready&&!busy)onApprove(checked,waitOk)}}><fieldset disabled={busy} className="form-stack">
   <fieldset className="field"><legend>{`승인 체크리스트 (${view.checklist.items.length}개 모두 확인)`}</legend>
    {view.checklist.items.map(i=><div key={i.id}><label className="franchise-inline"><input type="checkbox" checked={checked.has(i.id)} aria-describedby={i.warnings.length?`chk-${i.id}-w`:undefined} onChange={e=>toggle(i.id,e.target.checked)}/>{` ${i.text}`}</label>
     {i.warnings.length>0&&<ul id={`chk-${i.id}-w`} className="franchise-warnings">{i.warnings.map((w,k)=><li key={k}>{`주의: ${w}`}</li>)}</ul>}</div>)}
    <small>{`체크리스트 ${view.checklist.version}`}</small>
   </fieldset>
   <WaitConfirm view={view} checked={waitOk} onChange={setWaitOk} id="approve-wait-confirm"/>
   <WarningLines items={view.gate.warnings}/>
   <div className="form-actions"><Button type="button" variant="outline" onClick={onCancel}>돌아가기</Button><Button type="submit" disabled={!ready||busy}>승인</Button></div>
  </fieldset></form>
  <Disclaimer/>
 </section>;
}

// ── 편집기(edit 모드): 상태는 편집 모드에 들어갈 때 한 번만 초기화하고, 보기를 다시 읽어도 입력을 지우지 않는다 ──
export function AssetEditor({list,artifacts,detail,busy,enabled,conflict,onSave,onCancel,onRestart}:{list:AssetsView;artifacts:readonly Artifact[];detail:AssetDetailView|null;busy:boolean;enabled:boolean;conflict:boolean;
 onSave:(payload:Json)=>Promise<SaveOutcome>;onCancel:()=>void;onRestart:()=>void}){
 const templateOf=(t:string)=>t==='startup_page'||t==='event_deck'?list.templates[t]:t==='card_bundle'?list.templates.card_bundle??'':'',first=list.types[0]?.type??'';
 // 창업비용 표가 있는 템플릿만 비용 사실을 근거로 미리 고른다(카드 묶음 템플릿은 사실 칸을 비워 둔다).
 const costTemplate=(t:string)=>t==='startup_page'||t==='event_deck';
 const [type,setType]=useState(()=>detail?detail.asset.type:first),[campaignId,setCampaignId]=useState(()=>detail?detail.asset.campaignId:'');
 const [body,setBody]=useState(()=>detail?detail.asset.body:templateOf(first));
 const [picked,setPicked]=useState<ReadonlySet<string>>(()=>new Set(detail?detail.asset.factRefs.map(r=>r.id):templateOf(first)?list.templateFactRefs.map(r=>r.id):[]));
 // 템플릿이 더한(사용자가 직접 고르지 않은) 근거 사실. 유형을 바꿔 원문이 새 유형의 템플릿(자유 유형은 빈 원문)으로 바뀌면 함께 뺀다. 손으로 고른 사실은 남긴다.
 const [auto,setAuto]=useState<ReadonlySet<string>>(()=>new Set(!detail&&templateOf(first)?list.templateFactRefs.map(r=>r.id):[]));
 const [source,setSource]=useState<EditorForm['source']>(null),[base,setBase]=useState<number|null>(()=>detail?detail.latestVersion:null);
 const [note,setNote]=useState(''),[seed,setSeed]=useState(''),[withContent,setWithContent]=useState(true),bodyRef=useRef<HTMLTextAreaElement>(null);
 const known=new Set(list.facts.map(f=>f.id)),gone=[...picked].filter(x=>!known.has(x)),live=[...picked].filter(x=>known.has(x)).length;
 // 템플릿 사실을 더한다. 이미 고른 사실은 그대로 두고 새로 더한 것만 템플릿 몫으로 표시한다.
 function withTemplateRefs(from:ReadonlySet<string>,fromAuto:ReadonlySet<string>){const next=new Set(from),mark=new Set(fromAuto);for(const r of list.templateFactRefs)if(!next.has(r.id)){next.add(r.id);mark.add(r.id)}setPicked(next);setAuto(mark)}
 function changeType(next:string){
  if(!body.trim()||body===templateOf(type)){
   const t=templateOf(next),kept=new Set([...picked].filter(x=>!auto.has(x)));setBody(t);setNote('');
   if(t&&costTemplate(next))withTemplateRefs(kept,new Set());else{setPicked(kept);setAuto(new Set())}
  }
  else setNote('템플릿 넣기로 바꿀 수 있습니다.');
  setType(next);
 }
 function applyTemplate(){if(body.trim()&&!window.confirm('현재 원문을 템플릿으로 바꿉니다. 계속할까요?'))return;setBody(templateOf(type));if(costTemplate(type))withTemplateRefs(picked,auto);setNote('')}
 function insert(text:string,over:string){const next=insertAt(body,text,bodyRef.current?.selectionStart);if(next===null){setNote(over);return false}setBody(next);setNote('');return true}
 function toggleFact(x:string,on:boolean){const next=new Set(picked);if(on)next.add(x);else next.delete(x);setPicked(next);if(auto.has(x)){const a=new Set(auto);a.delete(x);setAuto(a)}}
 function importSeed(){const a=artifacts.find(x=>x.id===seed);if(!a)return;setSource({artifactId:a.id,version:a.version,title:a.title});if(withContent)insert(a.content,'길이 초과로 본문은 넣지 않았습니다.')}
 async function submit(nextBase:number|null){setBase(nextBase);if(await onSave(saveInput(list,detail,{type,campaignId,body,picked,source,base:nextBase}))==='source_invalid')setSource(null)}
 const seeds=campaignId?seedOptions(artifacts,campaignId):[],inherited=detail?.asset.source??null,campaignGone=!!detail&&detail.campaign===null;
 const invalid=busy||!enabled||campaignGone||!body.trim()||body.length>BODY_MAX||(!detail&&!campaignId);
 return <form autoComplete="off" className="form-stack" onSubmit={e=>{e.preventDefault();if(!invalid)void submit(base)}}><fieldset disabled={busy} className="form-stack">
  {!enabled&&<p className="notice" role="note">{ASSETS_OFF_NOTE}</p>}
  {campaignGone&&<p className="notice" role="note">{CAMPAIGN_GONE_EDIT}</p>}
  {conflict&&detail&&<div role="alert" className="franchise-problem">
   <p>{`다른 사용자가 v${detail.latestVersion}을 저장했습니다. 최신 판 원문을 확인하세요. 내 원문으로 새 판을 만들면 바로 앞 판이 초안일 때 그 초안은 새 판으로 바뀝니다.`}</p>
   <pre aria-label="최신 판 원문" tabIndex={0} className="whitespace-pre-wrap break-words text-sm">{detail.asset.body}</pre>
   <div className="franchise-bar"><Button type="button" disabled={invalid} onClick={()=>void submit(detail.latestVersion)}>최신 판 위에 저장</Button>
    <Button type="button" variant="outline" onClick={()=>{if(window.confirm('편집 중인 원문을 버리고 최신 판으로 다시 시작합니다. 계속할까요?'))onRestart()}}>최신 판으로 다시 시작</Button></div>
  </div>}
  <div className="form-two">
   <label className="field"><span>자료 유형</span><NativeSelect aria-label="자료 유형" disabled={!!detail} value={type} onChange={e=>changeType(e.target.value)}>{list.types.map(t=><NativeSelectOption key={t.type} value={t.type}>{t.label}</NativeSelectOption>)}</NativeSelect></label>
   {detail?<p className="subtle-note">{`모집 캠페인: ${detail.campaign?.title??'캠페인 삭제됨'}`}</p>
    :<label className="field"><span>모집 캠페인</span><NativeSelect required value={campaignId} onChange={e=>{setCampaignId(e.target.value);setSeed('');setSource(null)}}><NativeSelectOption value="">캠페인 선택</NativeSelectOption>{list.campaigns.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}</NativeSelect></label>}
  </div>
  {(type==='startup_page'||type==='event_deck'||type==='card_bundle')&&<div className="franchise-bar"><Button type="button" size="sm" variant="outline" onClick={applyTemplate}>템플릿 넣기</Button>{list.costFactsMissing&&costTemplate(type)&&<small>{COST_MISSING}</small>}</div>}
  {type==='card_bundle'&&<p className="subtle-note">{CARD_HELP}</p>}
  {note&&<p className="subtle-note" role="status">{note}</p>}
  <label className="field"><span>원문</span><Textarea autoComplete="off" ref={bodyRef} aria-label="원문" aria-describedby="asset-body-count" maxLength={BODY_MAX} rows={14} className="min-h-[40vh]" value={body} onChange={e=>setBody(e.target.value)}/>
   <small id="asset-body-count">{`${body.length.toLocaleString('ko-KR')} / 20,000자`}</small></label>
  {detail&&<p className="subtle-note">{DRAFT_REPLACE_NOTE}</p>}
  <fieldset className="field"><legend>{`근거 사실 (최대 ${FACT_REFS_MAX}개)`}</legend>
   {list.facts.length?list.facts.map(f=>{const on=picked.has(f.id);return <div key={f.id} className="franchise-bar">
    <label className="franchise-inline"><input type="checkbox" checked={on} disabled={!on&&live>=FACT_REFS_MAX} onChange={e=>toggleFact(f.id,e.target.checked)}/>{` ${f.label}`}</label>
    <small>{f.hasSource?f.line:`${f.line} · 정보공개서 근거 없음`}</small>
    <Button type="button" size="sm" variant="outline" aria-label={`${f.label} 원문에 넣기`} onClick={()=>insert(f.line,'20,000자를 넘어 넣지 않았습니다.')}>원문에 넣기</Button>
   </div>}):<p className="subtle-note">쓸 수 있는 확인 사실이 없습니다.</p>}
   {gone.map(x=><p key={x} className="franchise-flag">{`더 이상 쓸 수 없는 사실 ${x}: 저장하면 근거에서 빠집니다`}</p>)}
  </fieldset>
  {campaignId&&<fieldset className="field"><legend>승인된 작업물에서 가져오기 (선택)</legend>
   {inherited&&!source&&<p className="subtle-note">{`출처(이어받음): ${artifacts.find(x=>x.id===inherited.artifactId)?.title??inherited.artifactId} v${inherited.version}`}</p>}
   {seeds.length?<div className="franchise-bar">
    <NativeSelect aria-label="가져올 작업물" value={seed} onChange={e=>setSeed(e.target.value)}><NativeSelectOption value="">작업물 선택</NativeSelectOption>{seeds.map(s=><NativeSelectOption key={s.id} value={s.id}>{`${s.title} · v${s.version}${s.changed?' · 작성 뒤 사실·브랜드 정보 변경':''}`}</NativeSelectOption>)}</NativeSelect>
    <label className="franchise-inline"><input type="checkbox" checked={withContent} onChange={e=>setWithContent(e.target.checked)}/>{' 본문도 원문 커서 위치에 넣기'}</label>
    <Button type="button" size="sm" variant="outline" disabled={!seed} onClick={importSeed}>가져오기</Button>
   </div>:<p className="subtle-note">이 캠페인에 승인된 작업물이 없습니다.</p>}
   {source&&<div className="franchise-bar"><span>{`출처: ${source.title} v${source.version}`}</span><Button type="button" size="sm" variant="ghost" onClick={()=>setSource(null)}>출처 연결 해제</Button></div>}
  </fieldset>}
  <div className="form-actions"><Button type="button" variant="outline" onClick={onCancel}>취소</Button><Button type="submit" disabled={invalid}>초안 저장</Button></div>
 </fieldset></form>;
}
