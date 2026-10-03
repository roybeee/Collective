'use client';
// 상품 리서치 화면(docs/PRODUCT-RESEARCH-PLAN.ko.md 6절). 주소 ?view=research&tab=radar|candidates|committee|report|sources, 후보 상세는 #candidate-<id>.
// 서버: GET /api/product-research → ResearchViewResponse, POST {action, requestId, ...} → 새 ResearchViewResponse 또는 {error}(lib/product-research/api.ts).
// 기능 스위치 product_research가 꺼져 있으면 이유와 소유자 할 일(설정 기능표, 켜기)을 보인다. 워크스페이스는 이 화면을 열 때만 내려받는다(홈 첫 로딩 예산).
import {useCallback,useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {RefreshCw,Telescope} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';
import {SafetyScope} from '@/components/app/safety-scope';
import {MetaLine} from '@/components/app/meta-line';
import {askConfirm} from '@/components/app/confirm-dialog';
import {clientId} from '@/lib/client';
import {dateTime} from '@/lib/format';
import {pushNav,researchTabs,type ResearchTab} from '@/lib/nav-state';
import {notifySaved} from '@/lib/ui/notify';
import {useAccount} from './account-context';
import {Empty} from './status-badge';
import type {Act,ActResult,RowIssue,View} from './product-research-shared';
import {RadarTab} from './product-research-radar';
import {CandidatesTab} from './product-research-candidates';
import {CandidateDetail} from './product-research-detail';
import {CommitteeTab} from './product-research-committee';
import {ReportTab} from './product-research-report';
import {SourcesTab} from './product-research-sources';
import s from './product-research.module.css';

const tabLabels:Record<ResearchTab,string>={radar:'트렌드 레이더',candidates:'후보 목록',committee:'선정 위원회',report:'주간 MD 리포트',sources:'출처와 가져오기'};
const isView=(d:unknown):d is View=>!!d&&typeof d==='object'&&typeof (d as View).enabled==='boolean'&&Array.isArray((d as View).products);
function readIssues(d:Record<string,unknown>):RowIssue[]{
 const list=Array.isArray(d.issues)?d.issues:Array.isArray(d.errors)?d.errors:[];
 return list.flatMap(x=>{if(!x||typeof x!=='object')return [];const o=x as Record<string,unknown>;const message=typeof o.message==='string'?o.message:typeof o.error==='string'?o.error:'';if(!message)return [];const row=typeof o.row==='number'?o.row:typeof o.line==='number'?o.line:null;return [{row,field:typeof o.field==='string'?o.field:undefined,message}]});
}
type Loaded={view:View}|{off:true}|{error:string};
async function readView():Promise<Loaded>{
 try{
  const r=await fetch('/api/product-research',{credentials:'same-origin'});
  const d=await r.json().catch(()=>({})) as Record<string,unknown>;
  if(isView(d))return {view:d};
  if(d.enabled===false)return {off:true};
  return {error:typeof d.error==='string'?d.error:r.ok?'화면 응답 형식이 맞지 않습니다.':'상품 리서치 화면을 불러오지 못했습니다.'};
 }catch(e){return {error:(e as Error).message||'상품 리서치 화면을 불러오지 못했습니다.'}}
}
const candidateHash=/^#candidate-([A-Za-z0-9_-]{1,100})$/;
const readCandidate=()=>typeof window==='undefined'?null:location.hash.match(candidateHash)?.[1]??null;

export function ProductResearchPanel({initialTab,onTabChange}:{initialTab?:ResearchTab;onTabChange?:(tab:ResearchTab)=>void}){
 const account=useAccount();
 const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[off,setOff]=useState(false);
 const [tab,showTab]=useState<ResearchTab>(()=>readCandidate()?'candidates':initialTab??'radar'),[detail,setDetail]=useState<string|null>(readCandidate);
 // 주소에서 바뀐 탭(뒤로 가기·바로 가기)을 따른다.
 const [linked,setLinked]=useState(initialTab);
 if(linked!==initialTab){setLinked(initialTab);if(initialTab)showTab(initialTab)}
 const seq=useRef(0);
 const apply=useCallback((r:Loaded)=>{if('view' in r){setView(r.view);setError('');setOff(false)}else if('off' in r){setView(null);setError('');setOff(true)}else setError(r.error)},[]);
 const load=useCallback(async():Promise<boolean>=>{const n=++seq.current,r=await readView();if(n!==seq.current)return false;apply(r);return !('error' in r)},[apply]);
 useEffect(()=>{const n=++seq.current;void readView().then(r=>{if(n===seq.current)apply(r)})},[apply]);
 // 후보 상세는 같은 화면 안의 페이지다. 주소 끝(#candidate-<id>)에 남겨 새로고침·뒤로 가기·링크 공유 때 같은 후보가 열린다.
 useEffect(()=>{const sync=()=>setDetail(readCandidate());window.addEventListener('popstate',sync);window.addEventListener('hashchange',sync);return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('hashchange',sync)}},[]);
 function pickTab(next:string){const t=researchTabs.find(x=>x===next);if(!t)return;showTab(t);onTabChange?.(t);if(detail)closeDetail(true)}
 function openDetail(id:string){
  if(tab!=='candidates'){showTab('candidates');onTabChange?.('candidates')}
  setDetail(id);
  // 워크스페이스가 탭을 주소에 쓴 다음에 후보 표시를 붙인다(같은 틱이면 워크스페이스의 주소 쓰기가 덮는다).
  setTimeout(()=>{if(readCandidate()!==id)history.pushState(null,'',location.pathname+location.search+'#candidate-'+id)},0);
 }
 function closeDetail(replace=false){setDetail(null);if(readCandidate())history[replace?'replaceState':'pushState'](null,'',location.pathname+location.search)}
 const act:Act=async(request,message,description)=>{
  setBusy(true);
  try{
   // AI 선정 메모는 서버가 약 20초까지 기다린 뒤 아직이면 pending을 준다. 같은 요청 번호로 다시 보내 결과를 받는다(최대 6번, 약 2분).
   const requestId=clientId();let r:Response,d:Record<string,unknown>,tries=0;
   for(;;){
    r=await fetch('/api/product-research',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,requestId})});
    d=await r.json().catch(()=>({})) as Record<string,unknown>;
    if(!(r.ok&&d.pending===true)||++tries>=6)break;
    if(tries===1)toast.message('AI가 선정 메모를 쓰고 있습니다. 잠시 기다려 주세요.');
   }
   if(r.ok&&d.pending===true){toast.message('선정 메모가 아직 끝나지 않았습니다. 잠시 뒤 다시 눌러 확인하세요.');if(isView(d))setView(d);return {ok:false,error:'선정 메모 대기 중',issues:[]}}
   if(!r.ok||typeof d.error==='string'){
    const error=typeof d.error==='string'?d.error:'요청을 처리하지 못했습니다.',issues=readIssues(d);
    if(!issues.length)toast.error(error);
    // 다른 곳에서 먼저 바뀌었으면(판 충돌) 최신 화면을 다시 읽는다.
    if(r.status===409)void load();
    return {ok:false,error,issues} satisfies ActResult;
   }
   if(isView(d))setView(d);else await load();
   notifySaved(message,{description});
   return {ok:true};
  }catch(e){const error=(e as Error).message||'요청을 처리하지 못했습니다.';toast.error(error);return {ok:false,error,issues:[]}}
  finally{setBusy(false)}
 };
 if(error&&!view)return <div className="load-error" role="alert"><span>{error}</span><Button variant="outline" onClick={()=>void load()}><RefreshCw/>다시 시도</Button></div>;
 if(off||(view&&!view.enabled))return <ResearchOff isOwner={!!account?.isOwner} onEnabled={()=>{setOff(false);void load()}}/>;
 if(!view)return <ScreenSkeleton label="상품 리서치 자료를 불러오고 있습니다." rows={5}/>;
 const product=detail?view.products.find(p=>p.id===detail)??null:null;
 return <div className={s.panel}>
  <SafetyScope extra="발주와 가격 승인은 기존 소싱 절차에서 사람이 합니다.">이 화면은 발주·결제를 하지 않고, 조사·평가·선정 기록만 남깁니다.</SafetyScope>
  <div className={s.statusRow}>
   <p className={s.muted}><MetaLine items={[`후보 ${view.products.length}개`,`자동 수집 ${view.collectEnabled?'켜짐':'꺼짐'}`,`마지막 수집 ${dateTime(view.collect.lastRunAt,'없음')}`,view.canEdit?null:'보기 전용']}/></p>
   <Button variant="ghost" size="sm" disabled={busy} onClick={()=>void load().then(ok=>{if(ok)notifySaved('최신 자료를 불러왔습니다.')})}><RefreshCw/>새로고침</Button>
  </div>
  {error&&<div className="load-error" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load()}>다시 시도</Button></div>}
  <Tabs value={tab} onValueChange={pickTab}>
   <TabsList className="h-auto max-w-full flex-wrap">{researchTabs.map(t=><TabsTrigger key={t} value={t}>{tabLabels[t]}</TabsTrigger>)}</TabsList>
   <TabsContent value="radar"><RadarTab view={view} act={act} busy={busy} onOpen={openDetail}/></TabsContent>
   <TabsContent value="candidates">{detail?(product?<CandidateDetail key={product.id} view={view} product={product} act={act} busy={busy} onBack={()=>closeDetail()}/>:<div className="load-error" role="alert"><span>이 후보를 찾지 못했습니다. 다시 계산하면서 합쳐졌거나 지워졌을 수 있습니다.</span><Button variant="outline" size="sm" onClick={()=>closeDetail()}>후보 목록으로</Button></div>):<CandidatesTab view={view} act={act} busy={busy} onOpen={openDetail} onSources={()=>pickTab('sources')}/>}</TabsContent>
   <TabsContent value="committee"><CommitteeTab view={view} act={act} busy={busy} onOpen={openDetail}/></TabsContent>
   <TabsContent value="report"><ReportTab view={view} act={act} busy={busy} onOpen={openDetail}/></TabsContent>
   <TabsContent value="sources"><SourcesTab view={view} act={act} busy={busy} onCandidates={()=>pickTab('candidates')}/></TabsContent>
  </Tabs>
 </div>;
}

// 기능 스위치가 꺼졌을 때: 왜 못 쓰는지와 소유자가 할 일. 켜기는 소유자 전용 같은 API(/api/feature-flags)를 쓰고, 되돌리기로 다시 끈다.
function ResearchOff({isOwner,onEnabled}:{isOwner:boolean;onEnabled:()=>void}){
 const [switching,setSwitching]=useState(false);
 async function set(on:boolean){
  const r=await fetch('/api/feature-flags',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set',flag:'product_research',enabled:on})});
  const d=await r.json().catch(()=>({})) as {error?:unknown};
  if(!r.ok)throw new Error(typeof d.error==='string'?d.error:'상품 리서치 스위치를 바꾸지 못했습니다.');
 }
 async function enable(){
  if(switching)return;
  const ok=await askConfirm({title:'상품 리서치를 켤까요?',impact:'켜면 대표·관리자가 점수표·선정 메모·선정 결정·운영자 랭킹 가져오기를 쓸 수 있습니다. 외부 API 자동 수집은 따로 켭니다.',undo:'설정의 같은 스위치나 되돌리기로 끌 수 있습니다.',confirmLabel:'켜기'});
  if(!ok)return;
  setSwitching(true);
  try{await set(true);notifySaved('상품 리서치를 켰습니다.',{undo:async()=>{await set(false);location.reload()},undone:'상품 리서치를 다시 껐습니다.'});onEnabled()}
  catch(e){toast.error((e as Error).message)}finally{setSwitching(false)}
 }
 function openSettings(){
  pushNav({view:'settings'});
  // 설정 화면은 열 때 내려받는다. 기능표의 상품 리서치 행이 그려지면 그 행으로 옮긴다.
  let tries=0;const find=()=>{const row=document.querySelector<HTMLElement>('[data-feature="product-research"]');if(row){row.scrollIntoView({block:'center'});return}if(++tries<40)setTimeout(find,100)};setTimeout(find,100);
 }
 return <Empty title="상품 리서치가 꺼져 있습니다" text="기능 스위치가 꺼져 있어 후보 점수표, 선정 메모, 결정, 랭킹 가져오기를 쓸 수 없습니다. 워크스페이스 소유자가 켭니다." action={<div className="empty-actions">
  <Button variant="outline" onClick={openSettings}><Telescope/>설정 기능표 보기</Button>
  <Button disabled={switching||!isOwner} disabledReason={!isOwner?'소유자만 켤 수 있습니다. 소유자에게 요청하세요.':undefined} onClick={()=>void enable()}>상품 리서치 켜기</Button>
 </div>}/>;
}
