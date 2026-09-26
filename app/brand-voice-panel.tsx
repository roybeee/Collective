'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import type {BrandVoice,BrandVoiceInput,VoiceBody} from '@/lib/brand-voice';
import {adminRequestNote,useCanManage} from './auth-client';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';

// 브랜드 말투 원장(A3-2, 브랜드 아카이브 '브랜드 말투' 탭). 관리자가 초안을 쓰고 대표·관리자가 확정·철회한다(직원은 보기만, 서버 403).
// 모델에는 확정본만 가고, 기능 스위치 a3_brand_voice가 켜졌을 때 크리에이티브·콘텐츠 역할 입력에만 실린다.
type Limits={items:number;item:number;samples:number;sample:number;block:number};
type VoiceState={voice:BrandVoice|null;active:BrandVoiceInput|null;limits?:Limits;error?:string};
const FIELDS:[keyof VoiceBody,string,string][]=[['tone','어조','따뜻한'],['do','쓸 것','짧은 문장'],['dont','피할 것','과장 감탄사 연속'],['preferTerms','선호 표현','갓 구운'],['avoidTerms','피할 표현 · 카피에 쓰면 채점기가 표시합니다','최고의'],['samples','예시 문장','퇴근길에 갓 구운 떡볶이 한 컵 챙겨 가세요.']];
const STATUS={draft:'초안(모델에 가지 않음)',confirmed:'확정',revoked:'철회'};
type Form=Record<keyof VoiceBody,string>;
const emptyForm:Form={tone:'',do:'',dont:'',preferTerms:'',avoidTerms:'',samples:''};
const formOf=(v:VoiceBody|null):Form=>v?{tone:v.tone.join('\n'),do:v.do.join('\n'),dont:v.dont.join('\n'),preferTerms:v.preferTerms.join('\n'),avoidTerms:v.avoidTerms.join('\n'),samples:v.samples.join('\n')}:emptyForm;
const linesOf=(text:string)=>text.split('\n').map(x=>x.trim()).filter(Boolean);
async function postVoice(payload:Record<string,unknown>){const response=await fetch('/api/brand-voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return {response,data:await response.json() as VoiceState}}

export function BrandVoicePanel({brandId}:{brandId:string}){
 const canManage=useCanManage();
 const [state,setState]=useState<VoiceState>({voice:null,active:null}),[form,setForm]=useState<Form>(emptyForm),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  setLoading(true);setError('');
  try{
   const response=await fetch('/api/brand-voice?'+new URLSearchParams({brandId}),{signal}),data=await response.json() as VoiceState;
   if(!response.ok)throw new Error(data.error||'브랜드 말투를 불러오지 못했습니다.');
   if(!signal?.aborted){setState(data);setForm(formOf(data.voice))}
  }catch(error){if(!signal?.aborted)setError((error as Error).message)}finally{if(!signal?.aborted)setLoading(false)}
 },[brandId]);
 useEffect(()=>{const controller=new AbortController();void Promise.resolve().then(()=>{if(!controller.signal.aborted)return load(controller.signal)});return ()=>controller.abort()},[load]);
 async function act(action:'save_draft'|'confirm'|'revoke',done:string,event?:FormEvent){
  event?.preventDefault();setSaving(true);setError('');setMessage('');
  try{
   const data=action==='save_draft'?Object.fromEntries(FIELDS.map(([k])=>[k,linesOf(form[k])])):undefined;
   const {response,data:saved}=await postVoice({action,brandId,version:state.voice?.version??0,...(data?{data}:{})});
   if(!response.ok)throw new Error((response.status===409?'저장 충돌: ':'')+(saved.error||'저장하지 못했습니다.'));
   setState(prev=>({...prev,voice:saved.voice,active:saved.active}));setForm(formOf(saved.voice));setMessage(done);
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }
 const {voice,active,limits}=state;
 return <section aria-label="브랜드 말투"><div className="section-heading"><div><h3>브랜드 말투</h3><p>카피·문안의 어조와 쓰지 않을 표현을 정합니다. 확정한 말투만 AI 크리에이티브·콘텐츠 담당에게 전달됩니다(기능 스위치가 켜진 경우).</p></div></div>
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" disabled={saving} onClick={()=>void load()}>다시 불러오기</Button></div>}{message&&<p role="status">{message}</p>}
  {loading?<p role="status">브랜드 말투를 불러오고 있습니다.</p>:<>
   <div className="notice"><p>{voice?`현재 판 v${voice.version} · ${STATUS[voice.status]}`:'아직 말투가 없습니다.'}{active?` · 모델에 가는 확정본 v${active.version}`:' · 모델에 가는 확정본 없음'}</p>{voice?.status==='draft'&&active&&<small>초안을 고치는 동안에는 이전 확정본 v{active.version}이 계속 쓰입니다.</small>}</div>
   {canManage?<form className="form-stack" onSubmit={e=>void act('save_draft','초안을 저장했습니다. 확정해야 AI 입력에 쓰입니다.',e)} aria-label="브랜드 말투 편집"><fieldset disabled={saving} className="form-stack">
    <p className="subtle-note">한 줄에 한 항목입니다.{limits?` 목록마다 ${limits.items}개·항목 ${limits.item}자, 예시 ${limits.samples}개·${limits.sample}자, 전체 ${limits.block.toLocaleString('ko-KR')}자까지입니다.`:''} 전화번호·이메일 같은 개인정보는 적지 마세요(AI 입력에서는 가려집니다).</p>
    {FIELDS.map(([key,label,placeholder])=><label key={key} className="field"><span>{label}</span><Textarea rows={key==='samples'?3:2} value={form[key]} placeholder={placeholder} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
    <div className="form-actions"><Button type="submit" variant="outline">{saving?'저장 중…':'초안 저장'}</Button><Button type="button" disabled={voice?.status!=='draft'} onClick={()=>void act('confirm','말투를 확정했습니다.')}>초안 확정</Button><Button type="button" variant="ghost" disabled={!active} onClick={()=>void act('revoke','확정 말투를 철회했습니다. AI 입력에서 빠집니다.')}>확정 철회</Button></div>
   </fieldset></form>:<><ul className="artifact-list">{FIELDS.map(([key,label])=>voice?.[key].length?<li key={key} className="brand-detail-card"><div className="brand-detail-body"><h4>{label}</h4><p style={{whiteSpace:'pre-wrap'}}>{voice[key].join('\n')}</p></div></li>:null)}</ul><p className="subtle-note">말투 작성·확정은 대표·관리자만 할 수 있습니다. {adminRequestNote}</p></>}
  </>}
 </section>;
}
