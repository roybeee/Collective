'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {EmptyLine} from './empty-line';
import {MetaLine} from './meta-line';
import {StatList} from './stat-list';
import {CREATIVE_SCORE_LABEL,type CreativeScore,type ScoreBand} from '@/lib/creative-score';

// 소재 예측 점수 카드(G2, docs/CREATIVE-SCORE.ko.md). 서버(/api/creative-score)가 계산·저장한 값을 그대로 보인다. 색만으로 뜻을 전하지 않는다(등급 글자·점수·근거를 함께 적는다).
// 붙이는 자리(레인 소유자 메모): 캠페인 상세 '작업물' 탭의 작업물 카드 아래 — app/panels.tsx에서 <CreativeScoreCard artifactId={a.id} artifactVersion={a.version} canManage={isAdmin}/>.
// 목록·표에서는 <ScoreBadge score={s.score} band={s.band}/>를 쓴다. 이 파일은 app/panels.tsx를 고치지 않는다(마운트는 레인 소유자가 한다).
const API='/api/creative-score';
type Response_={enabled:boolean;artifactId:string;artifactVersion:number;score:(CreativeScore&{computedAt:string;channel:string})|null};
async function readJson<T>(response:Response,fallback:string):Promise<T>{
 const data=await response.json().catch(()=>({})) as T&{error?:string};
 if(!response.ok)throw new Error(data.error||fallback);
 return data;
}
const kst=(iso:string)=>new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});

// 목록용 요약 배지: '추정 72점 · 높음'처럼 글자로만 뜻을 전한다. 점수가 없으면 '점수 없음'.
export function ScoreBadge({score,band,className}:{score:number|null|undefined;band?:ScoreBand|null;className?:string}){
 const text=typeof score==='number'?`추정 ${score}점${band?` · ${band}`:''}`:'점수 없음';
 return <span className={className??'meta-line'} aria-label={`소재 예측 점수 ${text}`} title={CREATIVE_SCORE_LABEL}>{text}</span>;
}
export function CreativeScoreCard({artifactId,artifactVersion,canManage}:{artifactId:string;artifactVersion:number;canManage:boolean}){
 const [data,setData]=useState<Response_|null>(null),[round,setRound]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void fetch(API+'?'+new URLSearchParams({artifactId}),{signal:controller.signal,cache:'no-store',credentials:'same-origin'}).then(r=>readJson<Response_>(r,'소재 예측 점수를 불러오지 못했습니다.'))
   .then(d=>{if(!controller.signal.aborted){setData(d);setError('')}}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)});
  return()=>controller.abort();
 },[artifactId,artifactVersion,round]);
 async function recompute(){
  setBusy(true);
  try{await fetch(API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'recompute',artifactId})}).then(r=>readJson(r,'다시 계산하지 못했습니다.'));setError('')}
  catch(e){setError((e as Error).message)}finally{setBusy(false);setRound(n=>n+1)}
 }
 if(!data)return error?<p className="form-error" role="alert">{error}</p>:<p className="loading-line" role="status">소재 예측 점수를 불러오고 있습니다.</p>;
 const s=data.score,reason=!canManage?'대표·관리자만 다시 계산할 수 있습니다.':!data.enabled?'기능 스위치가 꺼져 있습니다. 소유자가 켭니다.':'';
 return <section className="form-stack" aria-label={`소재 예측 점수 작업물 ${artifactId} v${artifactVersion}`}>
  <h5>소재 예측 점수</h5>
  <p className="subtle-note">{CREATIVE_SCORE_LABEL}. 규칙으로 계산한 추정이며 승인·품질 판정이 아닙니다.</p>
  {!s&&<EmptyLine className="subtle-note" next={data.enabled?'다시 계산을 누르면 현재 판의 점수를 만듭니다.':'소유자가 소재 예측 점수 스위치를 켜면 저장 때 자동으로 계산합니다.'}>이 판의 점수가 아직 없습니다.</EmptyLine>}
  {s&&<>
   <StatList label="점수 요약" items={[['점수',`${s.score} / 100`],['등급',s.band],['채널',s.channel],['표본',s.sample.n?`n=${s.sample.n}${s.sample.window?`, 기간 ${s.sample.window}`:''}`:'보정표 없음(규칙 점수만)'],['계산 시각',kst(s.computedAt)]]}/>
   {!!s.flags.length&&<ul className="artifact-list" aria-label="주의 표시">{s.flags.map(f=><li key={f}>주의: {f}</li>)}</ul>}
   <ul className="artifact-list" aria-label="구성 요소별 근거">{s.components.map(c=><li key={c.key}>
    <MetaLine items={[<b key="l">{c.label}</b>,`${c.points} / ${c.max}점`]}/>
    <ul>{c.evidence.map(e=><li key={e}>{e}</li>)}</ul>
   </li>)}</ul>
  </>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="form-actions"><Button type="button" size="sm" variant="outline" disabled={busy||!canManage||!data.enabled} disabledReason={reason} onClick={()=>void recompute()}>점수 다시 계산</Button></div>
 </section>;
}
