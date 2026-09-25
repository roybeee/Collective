'use client';
import {useState} from 'react';
import {RefreshCw,Save} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';

// J2 AI 심사 보정 라벨(소유자 전용, 품질 콘솔 안). GET /api/eval?labels=queue가 준 블라인드 항목(표시 id·역할 이름·렌더본·적용 기준)에 1~5점 또는 해당없음을 매긴다.
// 화면은 응답에서 허용한 필드만 골라 읽는다. run·케이스·variant·모델 필드가 섞여 와도 그리지 않는다(docs/JUDGE.ko.md '블라인드').
// 심사 점수(J3)는 이 화면에 없다. 라벨을 저장하기 전에는 심사 점수를 보이지 않는다는 규칙을 J3가 지킨다.
type Criterion={id:string;label:string;definition:string;anchors:string[]};
type Item={itemId:string;roleName:string;criteria:string[];output:string|null};
type Queue={rubricVersion:string;criteria:Criterion[];labeled:number;total:number;items:Item[]};
type Use='measure'|'anchor';
const SCORES=['1','2','3','4','5','na'] as const;
const text=(v:unknown)=>typeof v==='string'?v:'';
const list=(v:unknown)=>Array.isArray(v)?v:[];
// 허용 목록: 표시 id·역할 이름·적용 기준 id·렌더본만 남긴다.
function pickQueue(v:unknown):Queue{
 const o=(v&&typeof v==='object'?v:{}) as Record<string,unknown>,counts=(o.counts&&typeof o.counts==='object'?o.counts:{}) as Record<string,unknown>;
 const criteria=list(o.criteria).map(c=>{const x=c as Record<string,unknown>;return {id:text(x.id),label:text(x.label),definition:text(x.definition),anchors:list(x.anchors).map(text)}}).filter(c=>c.id);
 const items=list(o.items).map(i=>{const x=i as Record<string,unknown>;return {itemId:text(x.itemId),roleName:text(x.roleName),criteria:list(x.criteria).map(text).filter(Boolean),output:typeof x.output==='string'?x.output:null}}).filter(i=>/^L[0-9a-f]{10}$/.test(i.itemId));
 return {rubricVersion:text(o.rubricVersion),criteria,labeled:Number(counts.labeled)||0,total:Number(counts.items)||0,items};
}
async function readQueue():Promise<Queue>{
 const response=await fetch('/api/eval?labels=queue&limit=10',{cache:'no-store'}),data=await response.json().catch(()=>({})) as {error?:string};
 if(!response.ok)throw new Error(data.error||'라벨 항목을 불러오지 못했습니다.');
 return pickQueue(data);
}
function CriterionField({c,value,onChange}:{c:Criterion;value:string;onChange:(v:string)=>void}){
 return <fieldset className="judge-criterion"><legend>{c.label}</legend><p className="subtle-note">{c.definition}</p>
  <ol className="judge-anchors">{c.anchors.map((a,i)=><li key={i}><strong>{i+1}</strong> {a}</li>)}</ol>
  <div className="judge-scores" role="radiogroup" aria-label={`${c.label} 점수`}>{SCORES.map(s=><label key={s}><input type="radio" name={`judge-${c.id}`} value={s} checked={value===s} onChange={()=>onChange(s)}/>{s==='na'?'해당없음':s}</label>)}</div>
 </fieldset>;
}
export function JudgeLabelPanel(){
 const [queue,setQueue]=useState<Queue|null>(null),[at,setAt]=useState(0),[scores,setScores]=useState<Record<string,string>>({}),[use,setUse]=useState<Use>('measure'),[note,setNote]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(0);
 const item=queue?.items[at],criteria=item?item.criteria.map(id=>queue!.criteria.find(c=>c.id===id)).filter((c):c is Criterion=>!!c):[];
 const complete=!!item&&criteria.length>0&&criteria.every(c=>scores[c.id]);
 const reset=()=>{setScores({});setNote('');setUse('measure')};
 async function load(){
  setBusy(true);setError('');
  try{setQueue(await readQueue());setAt(0);setSaved(0);reset()}catch(e){setError(e instanceof Error?e.message:'라벨 항목을 불러오지 못했습니다.')}finally{setBusy(false)}
 }
 async function save(){
  if(!item||!complete)return;
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/eval',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save_label',itemId:item.itemId,use,scores:Object.fromEntries(criteria.map(c=>[c.id,scores[c.id]==='na'?'na':Number(scores[c.id])])),...(note.trim()?{note:note.trim()}:{})})});
   const data=await response.json().catch(()=>({})) as {error?:string};
   if(!response.ok)throw new Error(data.error||'라벨을 저장하지 못했습니다.');
   setSaved(n=>n+1);setAt(i=>i+1);reset();
  }catch(e){setError(e instanceof Error?e.message:'라벨을 저장하지 못했습니다.')}finally{setBusy(false)}
 }
 return <div className="judge-labels">
  <p className="subtle-note">평가 산출물의 렌더본에 AI 심사와 같은 루브릭으로 점수를 매깁니다. 어느 실행·버전의 출력인지는 보이지 않고 순서는 무작위입니다. 봉인 세트 출력은 나오지 않습니다. 라벨은 AI 심사 보정(κ)에만 쓰고 작업물 승인에는 쓰지 않습니다.</p>
  <div className="quality-toolbar"><Button type="button" variant="outline" disabled={busy} onClick={()=>void load()}><RefreshCw/>라벨 불러오기</Button>
   {queue&&<span className="quality-dim">루브릭 {queue.rubricVersion} · 라벨 {queue.labeled+saved}/{queue.total}건</span>}</div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {queue&&!item&&<p className="subtle-note" role="status">{queue.items.length?'이 목록의 라벨을 모두 저장했습니다. 다시 불러오면 다음 항목이 나옵니다.':'라벨을 매길 항목이 없습니다. 평가 실행이 끝나면 여기에 나옵니다.'}</p>}
  {item&&<article className="judge-item" aria-label="라벨 항목">
   <h4>항목 {item.itemId} · {item.roleName}</h4>
   {item.output===null?<p className="quality-dim">모델 출력이 없어 라벨을 매길 수 없습니다. 다음 항목으로 넘어가세요.</p>:<pre className="judge-label-output">{item.output}</pre>}
   {criteria.map(c=><CriterionField key={c.id} c={c} value={scores[c.id]||''} onChange={v=>setScores(s=>({...s,[c.id]:v}))}/>)}
   <div className="quality-toolbar">
    <label>용도<NativeSelect aria-label="라벨 용도" value={use} onChange={e=>setUse(e.target.value as Use)}><NativeSelectOption value="measure">측정(κ에 씀)</NativeSelectOption><NativeSelectOption value="anchor">앵커 맞춤(κ 제외)</NativeSelectOption></NativeSelect></label>
    <label className="judge-note">메모(선택)<Textarea aria-label="라벨 메모" value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></label>
   </div>
   <div className="quality-toolbar"><Button type="button" disabled={busy||!complete||item.output===null} onClick={()=>void save()}><Save/>라벨 저장</Button>
    <Button type="button" variant="outline" disabled={busy} onClick={()=>{setAt(i=>i+1);reset()}}>건너뛰기</Button>
    {!complete&&<span className="quality-dim">적용 기준 {criteria.length}개에 모두 점수(또는 해당없음)를 고르면 저장할 수 있습니다.</span>}</div>
  </article>}
 </div>;
}
