'use client';
// 출처와 가져오기: 출처 목록(허용 방식·연결·마지막 수집·오늘 쿼터), 자동 수집 즉시 실행, 출처 자격증명(소유자), 운영자 파일 가져오기(전부 반영 또는 전부 거절), 가져오기 기록.
// 무신사·올리브영·쿠팡 랭킹은 robots.txt·약관 때문에 자동으로 모으지 않고 운영자 가져오기만 받는다(lib/product-research/sources.ts가 정본).
// 평가 1회차: 출처별 30일 성공률·마지막 정상 수집·격리 수(freshness), 경보(alerts), 즉시 수집 하루 횟수(collectNow), 랭킹 '이번 주 가져옴'(rankingStatus), 격리 관측 해제(clear_quarantine).
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {DataTable,type DataColumn} from '@/components/app/data-table';
import {EmptyLine} from '@/components/app/empty-line';
import {LockedNote} from '@/components/app/locked-note';
import {MetaLine} from '@/components/app/meta-line';
import {askConfirm} from '@/components/app/confirm-dialog';
import {count,dateTime,percent} from '@/lib/format';
import {calibrationErrorText,calibrationNote,calibrationText,clearReasonWhy,LIMITS,observedWhy,oldestImportDay,scopeWhy} from '@/lib/product-research/ui-detail';
import {CREDENTIAL_KEYS,CREDENTIAL_SOURCES,type CredentialKey} from '@/lib/product-research/api';
import {IMPORTABLE_SOURCES,SOURCES} from '@/lib/product-research/sources';
import type {SourceId} from '@/lib/product-research/types';
import type {QuarantineEntry} from '@/lib/product-research/api';
import {RecomputeButton} from './product-research-candidates';
import {credentialDisconnectImpact,credentialForms,editReason,koreaToday,methodLabels,metricLabels,snapshotStatusLabels,sourceLabel,type Act,type RowIssue,type View} from './product-research-shared';
import {ResearchRetention} from './product-research-retention';
import {CollectionControl} from './product-research-collection-control';
import s from './product-research.module.css';

const MAX_BYTES=2*1024*1024;
type SourceRow=View['sources'][number];
type ImportRow=View['imports'][number];
const ownerReason='소유자만 할 수 있습니다.';

export function SourcesTab({view,act,busy,onCandidates,onRefresh}:{view:View;act:Act;busy:boolean;onCandidates:()=>void;onRefresh:()=>Promise<boolean>}){
 const autoConnected=view.sources.some(x=>x.id!=='naver_shop_search'&&x.method==='api'&&x.connected&&SOURCES.some(s=>s.id===x.id&&s.autoFetch));
 const usage=view.collectNow??null,exhausted=!!usage&&usage.usedToday>=usage.maxPerDay;
 const collectWhy=!view.canConnect?`즉시 수집은 ${ownerReason}`:!view.collectEnabled?'자동 수집 스위치가 꺼져 있습니다. 소유자가 아래 버튼으로 켭니다.':!autoConnected?'연결된 공식 API 출처가 없습니다. 아래에서 먼저 연결하세요.':exhausted?`오늘 즉시 수집을 ${usage.maxPerDay}번 다 썼습니다. 내일(한국 시각) 다시 할 수 있고, 하루 1회 자동 수집은 그대로 돕니다.`:'';
 const fresh=(id:SourceId)=>view.freshness?.find(x=>x.sourceId===id)??null;
 const ranking=(id:SourceId)=>view.rankingStatus?.find(x=>x.sourceId===id)??null;
 const columns:DataColumn<SourceRow>[]=[
  {label:'출처',cell:x=>x.label,sort:x=>x.label,csv:x=>x.label},
  {label:'방식',cell:x=><span className={s.method} data-method={x.method}>{methodLabels[x.method]}</span>,sort:x=>methodLabels[x.method],csv:x=>methodLabels[x.method]},
  {label:'연결',cell:x=>connection(x),sort:x=>connection(x),csv:x=>connection(x)},
  {label:'마지막 수집',cell:x=>dateTime(x.lastFetchedAt,'없음'),sort:x=>x.lastFetchedAt??'',csv:x=>x.lastFetchedAt??''},
  {label:'상태',cell:x=>x.lastStatus?snapshotStatusLabels[x.lastStatus]:'기록 없음',csv:x=>x.lastStatus?snapshotStatusLabels[x.lastStatus]:''},
  {label:'오늘 쿼터',cell:x=>quota(x),csv:x=>quota(x)},
  {label:'30일 성공률',cell:x=>successText(fresh(x.id)),sort:x=>fresh(x.id)?.successRate30d??-1,csv:x=>fresh(x.id)?.successRate30d??'',align:'right'},
  {label:'마지막 정상 수집',cell:x=>dateTime(fresh(x.id)?.lastOkAt,'없음'),sort:x=>fresh(x.id)?.lastOkAt??'',csv:x=>fresh(x.id)?.lastOkAt??''},
  {label:'격리 관측',cell:x=>count(fresh(x.id)?.quarantined??null,'개'),sort:x=>fresh(x.id)?.quarantined??-1,csv:x=>fresh(x.id)?.quarantined??'',align:'right'},
  {label:'이번 주 가져오기',cell:x=>{const r=ranking(x.id);return r?<span className={'status '+(r.thisWeek?'status-approved':s.warn)}>{r.thisWeek?'이번 주 가져옴':r.lastImportedAt?`지난 가져오기 ${dateTime(r.lastImportedAt)}`:'가져온 적 없음'}</span>:<span className={s.muted}>해당 없음</span>},sort:x=>ranking(x.id)?.lastImportedAt??'',csv:x=>{const r=ranking(x.id);return r?(r.thisWeek?'이번 주 가져옴':r.lastImportedAt??'없음'):''}},
 ];
 const manualRanks=(view.rankingStatus??[]).filter(r=>SOURCES.find(x=>x.id===r.sourceId)?.method==='manual');
 return <section className={s.section} aria-labelledby="pr-sources-title">
  <h2 id="pr-sources-title" className={s.title}>출처와 가져오기</h2>
  <p className={s.legal} role="note"><b>수집 원칙</b> 공식 API와 계약 데이터만 자동으로 모읍니다. 무신사·올리브영·쿠팡 랭킹은 robots.txt와 약관이 자동 접근을 막아, 운영자가 자기 계정으로 본 화면을 파일로 가져오기만 받습니다. 데이터베이스 투자를 보호한 민사 판례가 있어 막힌 곳은 긁지 않습니다.</p>
  <Alerts view={view}/>
  {manualRanks.length>0&&<p className={s.badges} aria-label="랭킹 가져오기 이번 주 상태">{manualRanks.map(r=><span key={r.sourceId} className={'status '+(r.thisWeek?'status-approved':s.warn)}>{sourceLabel(view,r.sourceId)} {r.thisWeek?'이번 주 가져옴':'이번 주 가져오기 전'}</span>)}</p>}
  <ResearchRetention canInspect={view.canConnect}/>
  <DataTable rows={view.sources} columns={columns} rowKey={x=>x.id} caption="상품 리서치 출처" csvName="product-research-sources"/>
  <p className={s.muted}>네이버 쇼핑 검색 API는 서비스가 종료되어 수집 대상에서 제외됩니다. 이전 수집 기록은 남아 있습니다.</p>
  <p className={s.muted}>30일 성공률은 지난 30일 예약 호출 중 정상으로 끝난 비율입니다. 호출이 없으면 미확인입니다.</p>
  {/* 평가 2회차 M3: 데이터랩 상대값을 검색광고 실측 합으로 맞춘 보정의 검증 오차. 오차 큰 묶음 3개를 함께 보인다. */}
  <p className={s.muted} data-testid="pr-calibration">검색량 보정: {calibrationText(view.calibration)}{view.calibration?.rows.some(r=>r.error!==null)?` 오차 큰 묶음 ${view.calibration.rows.filter(r=>r.error!==null).slice(0,3).map(r=>`${r.label} ${(r.error!*100).toFixed(1)}%`).join(', ')}.`:''}</p>
  {/* 평가 3회차 M3: 묶음마다 오차율과 보정하지 않은 까닭("< 10" 범위·잴 수 없는 키워드)을 표로 보인다. */}
  {view.calibration&&view.calibration.rows.length>0&&<DataTable rows={view.calibration.rows} columns={calibrationColumns} rowKey={r=>r.groupId} caption="키워드 묶음별 검색량 보정" csvName="product-research-calibration" filterText={r=>[r.label,r.reason??''].join(' ')}/>}
  <section className={s.block} aria-labelledby="pr-collect-title"><h3 id="pr-collect-title" className={s.subtitle}>자동 수집</h3>
   <p className={s.muted}><MetaLine items={[`스위치 ${view.collectEnabled?'켜짐':'꺼짐'}`,`마지막 실행 ${dateTime(view.collect.lastRunAt,'없음')}`,`다음 실행 ${dateTime(view.collect.nextRunAt,'예정 없음')}`,usage?`오늘 즉시 수집 ${usage.usedToday}/${usage.maxPerDay}`:null]}/></p>
   <CollectionControl enabled={view.collectEnabled} canConnect={view.canConnect} connected={autoConnected} busy={busy} onRefresh={onRefresh}/>
   {view.collect.lastErrors.length>0&&<ul className={s.issues} aria-label="최근 수집 실패">{view.collect.lastErrors.map((e,i)=><li key={i}><MetaLine items={[sourceLabel(view,e.sourceId),dateTime(e.at)]}/> {e.message}</li>)}</ul>}
   <Button type="button" variant="outline" disabled={busy||!!collectWhy} disabledReason={collectWhy} onClick={()=>void act({action:'collect_now'},'자동 수집을 한 번 실행했습니다.','출처별 하루 쿼터 안에서만 호출했습니다.')}>지금 수집</Button>
  </section>
  <section className={s.block} aria-labelledby="pr-cred-title"><h3 id="pr-cred-title" className={s.subtitle}>출처 연결</h3>
   <p className={s.muted}>NAVER API HUB 키를 우선 사용합니다. 해제하면 연결된 기존 개발자센터 키를 씁니다.</p>
   <div className={s.credGrid}>{CREDENTIAL_KEYS.map(k=><CredentialCard key={k} view={view} credential={k} act={act} busy={busy}/>)}</div>
  </section>
  <QuarantineList view={view} act={act} busy={busy}/>
  <ImportForm view={view} act={act} busy={busy}/>
  <div className={s.toolbar}><RecomputeButton view={view} act={act} busy={busy}/><Button type="button" variant="ghost" onClick={onCandidates}>후보 목록 보기</Button></div>
  <h3 className={s.subtitle}>가져오기 기록</h3>
  {view.imports.length?<DataTable rows={view.imports} columns={importColumns(view)} rowKey={x=>x.snapshotId} caption="운영자 가져오기 기록" csvName="product-research-imports" filterText={x=>[x.fileName,sourceLabel(view,x.sourceId),x.importedBy??''].join(' ')}/>
   :<EmptyLine next="위 '파일 가져오기'로 첫 랭킹 파일을 올리세요.">가져온 파일이 아직 없습니다.</EmptyLine>}
 </section>;
}
type CalibrationRow=NonNullable<View['calibration']>['rows'][number];
const calibrationColumns:DataColumn<CalibrationRow>[]=[
 {label:'키워드 묶음',cell:r=>r.label,sort:r=>r.label,csv:r=>r.label},
 {label:'검증 오차율',cell:r=>calibrationErrorText(r),sort:r=>r.error??-1,csv:r=>r.error??'',align:'right'},
 {label:'"< 10" 범위로 넣은 키워드',cell:r=>count(r.bounded??null,'개'),sort:r=>r.bounded??-1,csv:r=>r.bounded??'',align:'right'},
 {label:'검색수를 잴 수 없는 키워드',cell:r=>count(r.missing??null,'개'),sort:r=>r.missing??-1,csv:r=>r.missing??'',align:'right'},
 {label:'비고',cell:r=>calibrationNote(r)||'없음',csv:r=>calibrationNote(r)},
];
const connection=(x:SourceRow)=>x.id==='naver_shop_search'?'서비스 종료':x.method==='manual'?'가져오기 전용':x.method==='internal'?'앱 안 자료':x.connected?'연결됨':'연결 필요';
const successText=(f:{successRate30d:number|null;calls30d:number}|null)=>f?.successRate30d==null?'미확인':`${percent(f.successRate30d)} (${count(f.calls30d,'회')})`;
const quota=(x:SourceRow)=>x.dailyQuota===null?(x.quotaUsedToday===null?'제한 미확인':`${count(x.quotaUsedToday)} 사용`):`${count(x.quotaUsedToday??0)}/${count(x.dailyQuota)}`;
const importColumns=(view:View):DataColumn<ImportRow>[]=>[
 {label:'파일',cell:x=>x.fileName,sort:x=>x.fileName,csv:x=>x.fileName},
 {label:'출처',cell:x=>sourceLabel(view,x.sourceId),sort:x=>sourceLabel(view,x.sourceId),csv:x=>sourceLabel(view,x.sourceId)},
 {label:'행 수',cell:x=>count(x.rows,'행'),sort:x=>x.rows,csv:x=>x.rows,align:'right'},
 {label:'가져온 시각',cell:x=>dateTime(x.importedAt),sort:x=>x.importedAt,csv:x=>x.importedAt},
 {label:'가져온 사람',cell:x=>x.importedBy??'미확인',csv:x=>x.importedBy??''},
];

// 출처 자격증명: 저장하면 서버가 검증 호출 뒤 암호화해 둔다. 화면은 저장한 값을 다시 받지 않는다(연결 계정 이름만).
function CredentialCard({view,credential,act,busy}:{view:View;credential:CredentialKey;act:Act;busy:boolean}){
 const form=credentialForms[credential],state=view.credentials.find(c=>c.key===credential);
 const [values,setValues]=useState<Record<string,string>>({});
 const missing=form.fields.some(f=>!f.optional&&!values[f.name]?.trim());
 const policy= CREDENTIAL_SOURCES[credential].filter(id=>id!=='naver_shop_search').map(id=>view.sources.find(s=>s.id===id)?.policy).find(p=>p&&!p.allowed);
 const saveWhy=policy?.reason??(!view.canConnect?ownerReason:missing?'필수 칸을 먼저 채우세요.':'');
 async function save(){
  const input=Object.fromEntries(form.fields.map(f=>[f.name,(values[f.name]??'').trim()]).filter(([,v])=>v));
  const r=await act({action:'connect_source',credentialKey:credential,input},`${form.label} 연결을 저장했습니다.`,credential==='naver_developers'&&view.credentials.some(c=>c.key==='naver_api_hub'&&c.connected)?'NAVER API HUB 키가 우선 사용됩니다.':'다음 자동 수집부터 이 키를 씁니다.');
  if(r.ok)setValues({});
 }
 async function disconnect(){
  const ok=await askConfirm({title:`${form.label} 연결을 해제할까요?`,impact:credentialDisconnectImpact(credential,view.credentials),undo:'같은 키를 다시 넣으면 다시 연결됩니다.',confirmLabel:'연결 해제',danger:true});
  if(ok)await act({action:'disconnect_source',credentialKey:credential},`${form.label} 연결을 해제했습니다.`);
 }
 const disconnectWhy=!view.canConnect?ownerReason:'';
 return <section className={s.credCard} aria-label={`${form.label} 연결`}>
  <div className={s.headRow}><b>{form.label}</b><span className={'status '+(state?.connected?'status-approved':'status-outdated')}>{state?.connected?'연결됨':'연결 전'}</span></div>
  <small className={s.muted}>{CREDENTIAL_SOURCES[credential].filter(id=>id!=='naver_shop_search').map(id=>sourceLabel(view,id)).join(', ')}</small>
  {credential==='naver_api_hub'&&<small className={s.muted}>데이터랩 검색어 트렌드와 쇼핑인사이트 권한을 모두 확인한 뒤 연결을 저장합니다.</small>}
  {policy&&<p role="status" className={s.muted}>사용 보류: {policy.reason} 기존 키는 보관되며 연결 상태와 사용 허용 상태는 별개입니다.</p>}
  {state?.connected&&<small className={s.muted}><MetaLine items={[state.account?`계정 ${state.account}`:null,`저장 ${dateTime(state.updatedAt)}`]}/></small>}
  {view.canConnect?<form className={s.credForm} onSubmit={e=>{e.preventDefault();if(!saveWhy)void save()}} autoComplete="off">
   {form.fields.map(f=><label key={f.name} className="field"><span>{f.label}{f.optional?'(선택)':''}</span><Input type={f.secret?'password':'text'} name={`pr-credential-${credential}-${f.name}`} disabled={!!policy} autoComplete={f.secret?'new-password':'off'} autoCapitalize="none" spellCheck={false} value={values[f.name]??''} onChange={e=>setValues(v=>({...v,[f.name]:e.target.value}))}/></label>)}
   <div className={s.toolbar}><Button type="submit" size="sm" disabled={busy||!!saveWhy} disabledReason={saveWhy}>{state?.connected?'키 바꿔 저장':'연결 저장'}</Button>
   {state?.connected&&<Button type="button" variant="ghost" size="sm" className="danger-action" disabled={busy||!!disconnectWhy} disabledReason={disconnectWhy} onClick={()=>void disconnect()}>연결 해제</Button>}</div>
  </form>:<LockedNote action="출처 연결" reason={ownerReason}/>}
 </section>;
}

// 운영자 가져오기: manual·계약 데이터 출처만, CSV 또는 JSON(2MB·2,000행). 한 행이라도 틀리면 파일 전체를 반영하지 않고 행 번호와 이유를 보인다.
function ImportForm({view,act,busy}:{view:View;act:Act;busy:boolean}){
 // 운영자 가져오기(manual)를 먼저, 계약 데이터 내보내기를 뒤에 둔다.
 const sources=SOURCES.filter(x=>IMPORTABLE_SOURCES.includes(x.id)).sort((a,b)=>Number(a.method!=='manual')-Number(b.method!=='manual'));
 const [sourceId,setSourceId]=useState<SourceId>(sources[0]?.id??'coupang_ranking_manual'),[file,setFile]=useState<File|null>(null),[scope,setScope]=useState(''),[observed,setObserved]=useState(koreaToday);
 const [issues,setIssues]=useState<RowIssue[]>([]),[failure,setFailure]=useState(''),picker=useRef<HTMLInputElement>(null);
 const today=koreaToday();
 const why=!view.canEdit?editReason:!file?'가져올 파일을 먼저 고르세요.':file.size>MAX_BYTES?'파일이 2MB를 넘습니다. 나눠서 가져오세요.':!/\.(csv|json)$/i.test(file.name)?'CSV 또는 JSON 파일만 가져옵니다.':scopeWhy(scope)||observedWhy(observed,today);
 async function submit(){
  if(!file||why)return;
  setIssues([]);setFailure('');
  const text=await file.text();
  const r=await act({action:'import_file',sourceId,fileName:file.name,text,scope:scope.trim(),observedDate:observed},'파일을 가져왔습니다.','점수를 다시 계산하면 후보에 반영됩니다.');
  if(r.ok){setFile(null);if(picker.current)picker.current.value='';return}
  setFailure(r.error);setIssues(r.issues);
 }
 return <section className={s.block} aria-labelledby="pr-import-title"><h3 id="pr-import-title" className={s.subtitle}>파일 가져오기</h3>
  <p className={s.muted}>운영자가 직접 본 랭킹 화면이나 계약 공급사 내보내기 파일을 올립니다.</p>
  <form className={s.formGrid} onSubmit={e=>{e.preventDefault();void submit()}}>
   <label className="field"><span>출처</span><NativeSelect value={sourceId} onChange={e=>setSourceId(e.target.value as SourceId)}>{sources.map(x=><NativeSelectOption key={x.id} value={x.id}>{x.label}({methodLabels[x.method]})</NativeSelectOption>)}</NativeSelect></label>
   <label className="field"><span>파일(CSV 또는 JSON, 2MB까지)</span><Input ref={picker} type="file" accept=".csv,.json,text/csv,application/json" onChange={e=>{setFile(e.target.files?.[0]??null);setIssues([]);setFailure('')}}/></label>
   <label className="field"><span>범위({LIMITS.importScopeMax}자까지)</span><Input value={scope} maxLength={LIMITS.importScopeMax} placeholder="예: 식품 소스·양념 랭킹" onChange={e=>setScope(e.target.value)}/></label>
   <label className="field"><span>관측 날짜(최근 14일)</span><Input type="date" value={observed} min={oldestImportDay(today)} max={today} onChange={e=>setObserved(e.target.value)}/></label>
   <div className={s.wide}><Button type="submit" disabled={busy||!!why} disabledReason={why}>파일 가져오기</Button></div>
  </form>
  {failure&&<div className={s.blockNote} role="alert"><b>파일 전체를 반영하지 않았습니다.</b> {failure}
   {issues.length>0&&<><p>아래 행을 고친 뒤 같은 파일을 다시 가져오세요.</p><ol className={s.issues}>{issues.slice(0,50).map((x,i)=><li key={i}>{rowIssue(x)}</li>)}</ol>{issues.length>50&&<p>나머지 {issues.length-50}건은 앞의 행을 고친 뒤 다시 확인됩니다.</p>}</>}
  </div>}
 </section>;
}

// 행 오류 한 줄. 서버 사유에 이미 'N행'이 있으면 다시 붙이지 않는다(평가 M9: '3행: 3행: …').
function rowIssue(x:RowIssue){
 const where=x.row===null?'파일':`${x.row}행`,field=x.field?`(${x.field})`:'';
 return x.row!==null&&new RegExp(`^${x.row}\\s*행`).test(x.message)?`${x.message}${field?` ${field}`:''}`:`${where}${field}: ${x.message}`;
}

// 경보: 출처별 연속 실패와 격리 대기. since는 처음 실패(또는 격리)한 시각이다.
function Alerts({view}:{view:View}){
 const alerts=view.alerts??[];
 if(!alerts.length)return null;
 return <div className={s.blockNote} role="alert" aria-label="수집 경보"><b>경보 {alerts.length}건</b>
  <ul>{alerts.map((a,i)=><li key={i}><MetaLine items={[sourceLabel(view,a.sourceId),`${dateTime(a.since)}부터`]}/> {a.message}</li>)}</ul>
 </div>;
}

// 격리 관측: 이상치(중앙값에서 크게 벗어난 값)로 점수에서 뺀 관측. 사람이 확인하고 사유를 적어 해제하면 다시 점수에 들어간다.
function QuarantineList({view,act,busy}:{view:View;act:Act;busy:boolean}){
 const rows=view.quarantines??[];
 const [reasons,setReasons]=useState<Record<string,string>>({});
 const columns:DataColumn<QuarantineEntry>[]=[
  {label:'출처',cell:q=>sourceLabel(view,q.sourceId),sort:q=>sourceLabel(view,q.sourceId),csv:q=>sourceLabel(view,q.sourceId)},
  {label:'대상',cell:q=>q.subjectKey.replace(/^kw:/,'키워드 ').replace(/^ls:[a-z_]+:/,'목록 '),sort:q=>q.subjectKey,csv:q=>q.subjectKey},
  {label:'지표',cell:q=>metricLabels[q.metric as keyof typeof metricLabels]??q.metric,csv:q=>q.metric},
  {label:'관측 기간 끝',cell:q=>q.periodTo.slice(0,10),sort:q=>q.periodTo,csv:q=>q.periodTo},
  {label:'값(중앙값)',cell:q=>`${q.value.toLocaleString('ko-KR')} (${q.median.toLocaleString('ko-KR')})`,sort:q=>q.value,csv:q=>q.value,align:'right'},
  {label:'벗어난 정도',cell:q=>q.robustZ.toFixed(1),sort:q=>Math.abs(q.robustZ),csv:q=>q.robustZ,align:'right'},
  {label:'해제',cell:q=>{const reason=reasons[q.id]??'',why=!view.canEdit?editReason:clearReasonWhy(reason);return <span className={s.clearCell}><Input aria-label={`격리 해제 사유 ${q.id}`} value={reason} maxLength={LIMITS.clearReasonMax} disabled={!view.canEdit} placeholder="예: 공급사 행사로 실제 급등했습니다." onChange={e=>setReasons(r=>({...r,[q.id]:e.target.value}))}/><Button type="button" variant="outline" size="sm" disabled={busy||!!why} disabledReason={why} onClick={()=>void act({action:'clear_quarantine',quarantineId:q.id,reason:reason.trim()},'격리를 해제했습니다.','다시 계산한 점수표에 이 관측을 넣었습니다.').then(r=>{if(r.ok)setReasons(x=>{const {[q.id]:_,...rest}=x;void _;return rest})})}>격리 해제</Button></span>}},
 ];
 return <section className={s.block} aria-labelledby="pr-quarantine-title"><h3 id="pr-quarantine-title" className={s.subtitle}>격리 관측 {rows.length}개</h3>
  <p className={s.muted}>이상치로 격리한 관측은 확인 전까지 점수에서 뺍니다. 해제 사유는 {LIMITS.reasonMin}~{LIMITS.clearReasonMax}자로 씁니다.</p>
  {rows.length?<DataTable rows={rows} columns={columns} rowKey={q=>q.id} caption="해제를 기다리는 격리 관측" csvName="product-research-quarantines"/>
   :<EmptyLine next="수집한 값이 평소보다 크게 벗어나면 여기에 모입니다.">해제를 기다리는 격리 관측이 없습니다.</EmptyLine>}
 </section>;
}
