'use client';
import '@/lib/i18n/lazy-trust';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {EmptyLine} from './empty-line';
import {MetaLine} from './meta-line';
import {StatList} from './stat-list';
import type {CreativeScore,ScoreBand} from '@/lib/creative-score';
import {kstText} from '@/lib/format';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';

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
// 글자는 사전(trust.score.*), 시각은 화면 언어(lib/format.ts kstText). 등급은 저장값('낮음'·'보통'·'높음')이라 사전 이름으로 바꿔 보인다. 구성 요소 이름·근거 문장은 채점기 출력 그대로다.
// trust.score.label의 한국어는 lib/creative-score.ts CREATIVE_SCORE_LABEL과 같다(tests/i18n-coverage.test.mjs).
const kst=(iso:string)=>kstText(iso,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const bandKeys={'낮음':'trust.score.band.low','보통':'trust.score.band.normal','높음':'trust.score.band.high'} as const;
const bandText=(band:ScoreBand|string)=>band in bandKeys?t(bandKeys[band as ScoreBand]):band;

// 목록용 요약 배지: '추정 72점 · 높음'처럼 글자로만 뜻을 전한다. 점수가 없으면 '점수 없음'.
export function ScoreBadge({score,band,className}:{score:number|null|undefined;band?:ScoreBand|null;className?:string}){
 const t=useT(),text=typeof score==='number'?t('trust.score.badge',{score})+(band?` · ${bandText(band)}`:''):t('trust.score.none');
 return <span className={className??'meta-line'} aria-label={t('trust.score.badgeLabel',{text})} title={t('trust.score.label')}>{text}</span>;
}
export function CreativeScoreCard({artifactId,artifactVersion,canManage}:{artifactId:string;artifactVersion:number;canManage:boolean}){
 useT();const [data,setData]=useState<Response_|null>(null),[round,setRound]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void fetch(API+'?'+new URLSearchParams({artifactId}),{signal:controller.signal,cache:'no-store',credentials:'same-origin'}).then(r=>readJson<Response_>(r,t('trust.score.loadFailed')))
   .then(d=>{if(!controller.signal.aborted){setData(d);setError('')}}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)});
  return()=>controller.abort();
 },[artifactId,artifactVersion,round]);
 async function recompute(){
  setBusy(true);
  try{await fetch(API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'recompute',artifactId})}).then(r=>readJson(r,t('trust.score.recomputeFailed')));setError('')}
  catch(e){setError((e as Error).message)}finally{setBusy(false);setRound(n=>n+1)}
 }
 if(!data)return error?<p className="form-error" role="alert">{error}</p>:<p className="loading-line" role="status">{t('trust.score.loading')}</p>;
 const s=data.score,reason=!canManage?t('trust.score.denied'):!data.enabled?t('trust.score.switchOff'):'';
 return <section className="form-stack" aria-label={t('trust.score.cardLabel',{id:artifactId,version:artifactVersion})}>
  <h5>{t('trust.score.title')}</h5>
  <p className="subtle-note">{t('trust.score.lead',{label:t('trust.score.label')})}</p>
  {!s&&<EmptyLine className="subtle-note" next={data.enabled?t('trust.score.emptyNext'):t('trust.score.emptyOff')}>{t('trust.score.empty')}</EmptyLine>}
  {s&&<>
   <StatList label={t('trust.score.summary')} items={[[t('trust.score.score'),`${s.score} / 100`],[t('trust.score.band'),bandText(s.band)],[t('trust.score.channel'),s.channel],[t('trust.score.sample'),s.sample.n?`n=${s.sample.n}`+(s.sample.window?t('trust.score.window',{window:s.sample.window}):''):t('trust.score.noCalibration')],[t('trust.score.computedAt'),kst(s.computedAt)]]}/>
   {!!s.flags.length&&<ul className="artifact-list" aria-label={t('trust.score.flags')}>{s.flags.map(f=><li key={f}>{t('trust.score.flag',{flag:f})}</li>)}</ul>}
   <ul className="artifact-list" aria-label={t('trust.score.components')}>{s.components.map(c=><li key={c.key}>
    <MetaLine items={[<b key="l">{c.label}</b>,t('trust.score.points',{points:c.points,max:c.max})]}/>
    <ul>{c.evidence.map(e=><li key={e}>{e}</li>)}</ul>
   </li>)}</ul>
  </>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="form-actions"><Button type="button" size="sm" variant="outline" disabled={busy||!canManage||!data.enabled} disabledReason={reason} onClick={()=>void recompute()}>{t('trust.score.recompute')}</Button></div>
 </section>;
}
