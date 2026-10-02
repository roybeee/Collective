'use client';
import {NativeSelect} from '@/components/ui/native-select';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {useState} from 'react';
import type {Publication} from '@/lib/execution';

// loop-2: 발행–바이럴 실험 안(arm) 연결과 Instagram 게시물 ID 입력. 준비 폼의 선택지와 발행 카드의 연결·입력 칸이다.
// 준비 때 연결은 발행 준비 권한을 따르고, 준비 뒤 연결·해제와 게시물 ID 입력은 관리자만 한다(서버 403과 같은 규칙).
export type ExperimentOption={id:string;title:string};
type Arm='control'|'treatment';
const armLabels:Record<Arm,string>={control:'A · 대조안',treatment:'B · 실험안'};
const CLOSED=['cancelled','failed'];

// 선택 값 '<실험 id>:<안>'을 요청 본문으로 바꾼다. 비우면 연결하지 않는다.
export function experimentChoice(value:string):{experimentId:string;arm:Arm}|null{
 const at=value.lastIndexOf(':'),arm=value.slice(at+1);
 return at>0&&(arm==='control'||arm==='treatment')?{experimentId:value.slice(0,at),arm}:null;
}
// 같은 안에 살아 있는 다른 발행이 있으면 고를 수 없다(서버 409와 같은 판정).
const takenBy=(publications:readonly Publication[],id:string,arm:Arm,self?:string)=>publications.find(p=>p.id!==self&&p.experimentId===id&&p.arm===arm&&!CLOSED.includes(p.status));
function ArmOptions({options,publications,self}:{options:readonly ExperimentOption[];publications:readonly Publication[];self?:string}){
 return <>{options.flatMap(e=>(['control','treatment'] as const).map(arm=>{const taken=takenBy(publications,e.id,arm,self);return <option key={e.id+':'+arm} value={e.id+':'+arm} disabled={!!taken}>{e.title} · {armLabels[arm]}{taken?' · 다른 발행이 연결됨':''}</option>}))}</>;
}

export function ExperimentLinkSelect({options,publications}:{options:readonly ExperimentOption[];publications:readonly Publication[]}){
 if(!options.length)return null;
 return <label>콘텐츠 실험 연결 (선택)<NativeSelect className="block border rounded p-2 w-full" name="experimentLink" defaultValue=""><option value="">연결하지 않음</option><ArmOptions options={options} publications={publications}/></NativeSelect><span className="block text-sm">이 게시물이 진행 중 실험의 어느 안인지 고릅니다. 게시가 확인된 뒤 Instagram 게시물 ID를 적으면 그 안의 성과를 가져올 수 있습니다.</span></label>;
}

type Act=(name:'link_experiment'|'link_media',data:Record<string,unknown>,message:string)=>void;
export function PublicationExperiment({p,options,canManage,busy,onAct}:{p:Publication;options:readonly ExperimentOption[];canManage:boolean;busy:boolean;onAct:Act}){
 const[choice,setChoice]=useState(''),[mediaId,setMediaId]=useState(''),[permalink,setPermalink]=useState('');
 const linked=p.experimentId&&p.arm?`${options.find(e=>e.id===p.experimentId)?.title??'실험 '+p.experimentId.slice(0,8)} · ${armLabels[p.arm]}`:'';
 const open=!CLOSED.includes(p.status);
 if(!linked&&!p.media&&(!canManage||!open||!options.length))return null;
 return <div className="grid gap-2 border rounded p-3" aria-label="콘텐츠 실험 연결">
  <p className="text-sm">{linked?`콘텐츠 실험: ${linked}`:'콘텐츠 실험에 연결되지 않은 발행입니다.'}{p.media?` · Instagram 게시물 ${p.media.mediaId}`:''}{p.media?.permalink&&<> · <a className="underline" href={p.media.permalink} target="_blank" rel="noreferrer">게시물 열기</a></>}</p>
  {canManage&&open&&<div className="flex flex-wrap gap-2 items-end">
   {options.length>0&&<label className="text-sm">연결할 실험 안<NativeSelect className="block border rounded p-2" value={choice} disabled={busy} onChange={e=>setChoice(e.target.value)}><option value="">선택하세요</option><ArmOptions options={options} publications={[p]} self={p.id}/></NativeSelect></label>}
   {options.length>0&&<Button type="button" variant="outline" size="fit" disabled={busy||!experimentChoice(choice)} disabledReason={(!experimentChoice(choice))?'실험을 먼저 고르세요.':undefined} onClick={()=>onAct('link_experiment',{id:p.id,version:p.version,experiment:experimentChoice(choice)},'발행을 실험 안에 연결했습니다.')}>실험 연결</Button>}
   {linked&&<Button type="button" variant="outline" size="fit" disabled={busy} onClick={()=>onAct('link_experiment',{id:p.id,version:p.version,experiment:null},'실험 연결을 해제했습니다.')}>연결 해제</Button>}
  </div>}
  {canManage&&p.status==='published'&&<div className="grid gap-2">
   <p className="text-sm">Buffer는 Instagram 게시물 ID를 알려 주지 않습니다. 게시물 인사이트나 Graph API에서 확인한 숫자 ID를 한 번 적으세요. 실험에 연결된 발행이면 자동 수집 대상으로 넘깁니다(스위치 publication_auto_link가 켜져 있을 때).</p>
   <label className="text-sm">Instagram 게시물 ID (숫자)<Input className="block border rounded p-2 w-full" inputMode="numeric" value={mediaId} disabled={busy} onChange={e=>setMediaId(e.target.value)} placeholder={p.media?.mediaId??'17900000000000000'}/></label>
   <label className="text-sm">게시물 주소 (선택)<Input className="block border rounded p-2 w-full" type="url" value={permalink} disabled={busy} onChange={e=>setPermalink(e.target.value)} placeholder="https://www.instagram.com/p/…"/></label>
   <div><Button type="button" variant="outline" size="fit" disabled={busy||!mediaId.trim()} disabledReason={(!mediaId.trim())?'필수 칸을 먼저 채우세요.':undefined} onClick={()=>onAct('link_media',{id:p.id,version:p.version,mediaId:mediaId.trim(),...(permalink.trim()?{permalink:permalink.trim()}:{})},'Instagram 게시물 ID를 저장했습니다.')}>게시물 ID 저장</Button></div>
  </div>}
 </div>;
}
