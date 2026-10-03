'use client';
// 출처와 가져오기: 출처 목록(허용 방식·연결·마지막 수집·오늘 쿼터), 자동 수집 즉시 실행, 출처 자격증명(소유자), 운영자 파일 가져오기(전부 반영 또는 전부 거절), 가져오기 기록.
// 무신사·올리브영·쿠팡 랭킹은 robots.txt·약관 때문에 자동으로 모으지 않고 운영자 가져오기만 받는다(lib/product-research/sources.ts가 정본).
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {DataTable,type DataColumn} from '@/components/app/data-table';
import {EmptyLine} from '@/components/app/empty-line';
import {LockedNote} from '@/components/app/locked-note';
import {MetaLine} from '@/components/app/meta-line';
import {askConfirm} from '@/components/app/confirm-dialog';
import {count,dateTime} from '@/lib/format';
import {CREDENTIAL_KEYS,CREDENTIAL_SOURCES,type CredentialKey} from '@/lib/product-research/api';
import {IMPORTABLE_SOURCES,SOURCES} from '@/lib/product-research/sources';
import type {SourceId} from '@/lib/product-research/types';
import {RecomputeButton} from './product-research-candidates';
import {credentialForms,editReason,koreaToday,methodLabels,snapshotStatusLabels,sourceLabel,type Act,type RowIssue,type View} from './product-research-shared';
import s from './product-research.module.css';

const MAX_BYTES=2*1024*1024;
type SourceRow=View['sources'][number];
type ImportRow=View['imports'][number];
const ownerReason='소유자만 할 수 있습니다.';

export function SourcesTab({view,act,busy,onCandidates}:{view:View;act:Act;busy:boolean;onCandidates:()=>void}){
 const autoConnected=view.sources.some(x=>x.method==='api'&&x.connected);
 const collectWhy=!view.canConnect?`즉시 수집은 ${ownerReason}`:!view.collectEnabled?'자동 수집 스위치가 꺼져 있습니다. 소유자가 설정에서 켭니다.':!autoConnected?'연결된 공식 API 출처가 없습니다. 아래에서 먼저 연결하세요.':'';
 const columns:DataColumn<SourceRow>[]=[
  {label:'출처',cell:x=>x.label,sort:x=>x.label,csv:x=>x.label},
  {label:'방식',cell:x=><span className={s.method} data-method={x.method}>{methodLabels[x.method]}</span>,sort:x=>methodLabels[x.method],csv:x=>methodLabels[x.method]},
  {label:'연결',cell:x=>connection(x),sort:x=>connection(x),csv:x=>connection(x)},
  {label:'마지막 수집',cell:x=>dateTime(x.lastFetchedAt,'없음'),sort:x=>x.lastFetchedAt??'',csv:x=>x.lastFetchedAt??''},
  {label:'상태',cell:x=>x.lastStatus?snapshotStatusLabels[x.lastStatus]:'기록 없음',csv:x=>x.lastStatus?snapshotStatusLabels[x.lastStatus]:''},
  {label:'오늘 쿼터',cell:x=>quota(x),csv:x=>quota(x)},
 ];
 return <section className={s.section} aria-labelledby="pr-sources-title">
  <h2 id="pr-sources-title" className={s.title}>출처와 가져오기</h2>
  <p className={s.legal} role="note"><b>수집 원칙</b> 공식 API와 계약 데이터만 자동으로 모읍니다. 무신사·올리브영·쿠팡 랭킹은 robots.txt와 약관이 자동 접근을 막아, 운영자가 자기 계정으로 본 화면을 파일로 가져오기만 받습니다. 데이터베이스 투자를 보호한 민사 판례가 있어 막힌 곳은 긁지 않습니다.</p>
  <DataTable rows={view.sources} columns={columns} rowKey={x=>x.id} caption="상품 리서치 출처" csvName="product-research-sources"/>
  <section className={s.block} aria-labelledby="pr-collect-title"><h3 id="pr-collect-title" className={s.subtitle}>자동 수집</h3>
   <p className={s.muted}><MetaLine items={[`스위치 ${view.collectEnabled?'켜짐':'꺼짐'}`,`마지막 실행 ${dateTime(view.collect.lastRunAt,'없음')}`,`다음 실행 ${dateTime(view.collect.nextRunAt,'예정 없음')}`]}/></p>
   {view.collect.lastErrors.length>0&&<ul className={s.issues} aria-label="최근 수집 실패">{view.collect.lastErrors.map((e,i)=><li key={i}><MetaLine items={[sourceLabel(view,e.sourceId),dateTime(e.at)]}/> {e.message}</li>)}</ul>}
   <Button type="button" variant="outline" disabled={busy||!!collectWhy} disabledReason={collectWhy} onClick={()=>void act({action:'collect_now'},'자동 수집을 한 번 실행했습니다.','출처별 하루 쿼터 안에서만 호출했습니다.')}>지금 수집</Button>
  </section>
  <section className={s.block} aria-labelledby="pr-cred-title"><h3 id="pr-cred-title" className={s.subtitle}>출처 연결</h3>
   <div className={s.credGrid}>{CREDENTIAL_KEYS.map(k=><CredentialCard key={k} view={view} credential={k} act={act} busy={busy}/>)}</div>
  </section>
  <ImportForm view={view} act={act} busy={busy}/>
  <div className={s.toolbar}><RecomputeButton view={view} act={act} busy={busy}/><Button type="button" variant="ghost" onClick={onCandidates}>후보 목록 보기</Button></div>
  <h3 className={s.subtitle}>가져오기 기록</h3>
  {view.imports.length?<DataTable rows={view.imports} columns={importColumns(view)} rowKey={x=>x.snapshotId} caption="운영자 가져오기 기록" csvName="product-research-imports" filterText={x=>[x.fileName,sourceLabel(view,x.sourceId),x.importedBy??''].join(' ')}/>
   :<EmptyLine next="위 '파일 가져오기'로 첫 랭킹 파일을 올리세요.">가져온 파일이 아직 없습니다.</EmptyLine>}
 </section>;
}
const connection=(x:SourceRow)=>x.method==='manual'?'가져오기 전용':x.method==='internal'?'앱 안 자료':x.connected?'연결됨':'연결 필요';
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
 const saveWhy=!view.canConnect?ownerReason:missing?'필수 칸을 먼저 채우세요.':'';
 async function save(){
  const input=Object.fromEntries(form.fields.map(f=>[f.name,(values[f.name]??'').trim()]).filter(([,v])=>v));
  const r=await act({action:'connect_source',credentialKey:credential,input},`${form.label} 연결을 저장했습니다.`,'다음 자동 수집부터 이 키를 씁니다.');
  if(r.ok)setValues({});
 }
 async function disconnect(){
  const ok=await askConfirm({title:`${form.label} 연결을 해제할까요?`,impact:'저장한 키를 지우고 이 출처의 자동 수집을 멈춥니다. 이미 모은 스냅샷과 점수는 그대로 남습니다.',undo:'같은 키를 다시 넣으면 다시 연결됩니다.',confirmLabel:'연결 해제',danger:true});
  if(ok)await act({action:'disconnect_source',credentialKey:credential},`${form.label} 연결을 해제했습니다.`);
 }
 const disconnectWhy=!view.canConnect?ownerReason:'';
 return <section className={s.credCard} aria-label={`${form.label} 연결`}>
  <div className={s.headRow}><b>{form.label}</b><span className={'status '+(state?.connected?'status-approved':'status-outdated')}>{state?.connected?'연결됨':'연결 전'}</span></div>
  <small className={s.muted}>{CREDENTIAL_SOURCES[credential].map(id=>sourceLabel(view,id)).join(', ')}</small>
  {state?.connected&&<small className={s.muted}><MetaLine items={[state.account?`계정 ${state.account}`:null,`저장 ${dateTime(state.updatedAt)}`]}/></small>}
  {view.canConnect?<form className={s.credForm} onSubmit={e=>{e.preventDefault();if(!saveWhy)void save()}} autoComplete="off">
   {form.fields.map(f=><label key={f.name} className="field"><span>{f.label}{f.optional?'(선택)':''}</span><Input type={f.secret?'password':'text'} autoComplete="off" spellCheck={false} value={values[f.name]??''} onChange={e=>setValues(v=>({...v,[f.name]:e.target.value}))}/></label>)}
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
 const why=!view.canEdit?editReason:!file?'가져올 파일을 먼저 고르세요.':file.size>MAX_BYTES?'파일이 2MB를 넘습니다. 나눠서 가져오세요.':!/\.(csv|json)$/i.test(file.name)?'CSV 또는 JSON 파일만 가져옵니다.':!scope.trim()?'범위(카테고리 이름 등)를 쓰세요.':!/^\d{4}-\d{2}-\d{2}$/.test(observed)?'관측 날짜를 고르세요.':'';
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
   <label className="field"><span>범위</span><Input value={scope} maxLength={100} placeholder="예: 식품 소스·양념 랭킹" onChange={e=>setScope(e.target.value)}/></label>
   <label className="field"><span>관측 날짜</span><Input type="date" value={observed} max={koreaToday()} onChange={e=>setObserved(e.target.value)}/></label>
   <div className={s.wide}><Button type="submit" disabled={busy||!!why} disabledReason={why}>파일 가져오기</Button></div>
  </form>
  {failure&&<div className={s.blockNote} role="alert"><b>파일 전체를 반영하지 않았습니다.</b> {failure}
   {issues.length>0&&<><p>아래 행을 고친 뒤 같은 파일을 다시 가져오세요.</p><ol className={s.issues}>{issues.slice(0,50).map((x,i)=><li key={i}>{x.row===null?'파일':`${x.row}행`}{x.field?`(${x.field})`:''}: {x.message}</li>)}</ol>{issues.length>50&&<p>나머지 {issues.length-50}건은 앞의 행을 고친 뒤 다시 확인됩니다.</p>}</>}
  </div>}
 </section>;
}
