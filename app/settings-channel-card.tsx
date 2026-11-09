'use client';
// 채널 연결 카드의 공용 부품(X-F): 카드 틀(상태 배지·계정·토큰 만료 경고·기능 스위치 줄), 입력 칸, 요청 도우미.
// 비밀값 칸은 쓰기 전용이다. 서버 응답의 값으로 채우지 않고, 저장이 끝나면 비운다.
import {useId,type ReactNode} from 'react';
import {ArrowRight,TriangleAlert} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {MetaLine} from '@/components/app/meta-line';
import {pushNav} from '@/lib/nav-state';
import {connectionLabels,connectionState,daysLeft,switchLabel,type ConnectionState} from './settings-channel-state';

// 응답 오류는 서버 문구를 그대로 보인다. 409 '쓰기 스위치 꺼짐' 같은 사유도 이 경로로 온다.
export class RequestError extends Error{constructor(message:string,readonly status:number){super(message)}}
export async function request<T>(url:string,body?:Record<string,unknown>):Promise<T>{
 const response=await fetch(url,body?{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'}:{cache:'no-store',signal:AbortSignal.timeout(15_000)});
 const raw=await response.json().catch(()=>null) as {error?:unknown}|null;
 if(!response.ok)throw new RequestError(raw&&typeof raw.error==='string'?raw.error:'요청을 처리하지 못했습니다.',response.status);
 return raw as T;
}
export const errorText=(e:unknown)=>e instanceof Error?e.message:'요청을 처리하지 못했습니다.';

export function FormField({label,help,children}:{label:string;help?:string;children:ReactNode}){return <label className="field"><span>{label}</span>{children}{help&&<small>{help}</small>}</label>}

const tone:Record<ConnectionState,'default'|'secondary'|'destructive'|'outline'>={connected:'default',expiring:'destructive',expired:'destructive',none:'outline',unknown:'secondary'};
export type ChannelCardProps={channel:string;title:string;lead:string;connected:boolean|null;account?:string;expiresAt?:string|null;switchOn?:boolean|null;switchNote?:string;children?:ReactNode};
// 기능표 행으로 이동한다(같은 설정 화면의 기능표 탭).
const openFeatures=()=>pushNav({view:'settings',section:'features'});
export function ChannelCard({channel,title,lead,connected,account,expiresAt,switchOn,switchNote,children}:ChannelCardProps){
 const id=useId(),state=connectionState(connected,expiresAt),days=daysLeft(expiresAt);
 return <section className="settings-card channel-card" aria-labelledby={id} data-channel={channel} data-state={state}>
  <header className="channel-card-head"><h3 id={id}>{title}</h3><Badge variant={tone[state]}>{connectionLabels[state]}</Badge></header>
  <p className="subtle-note">{lead}</p>
  {(account||expiresAt)&&state!=='none'&&<p><MetaLine items={[account&&'계정 '+account,expiresAt&&'토큰 만료일 '+new Date(expiresAt).toLocaleDateString('ko-KR')]}/></p>}
  {(state==='expiring'||state==='expired')&&<p className="channel-card-warn" role="note"><TriangleAlert/>{state==='expired'?'토큰이 만료됐습니다. 새 토큰으로 다시 연결하세요.':`토큰 만료까지 ${days}일 남았습니다. 새 장수명 토큰으로 다시 연결하세요.`}</p>}
  {switchOn!==undefined&&<p className="channel-card-switch"><MetaLine items={[switchLabel(switchOn),switchNote]}/> <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={openFeatures}>기능표에서 보기<ArrowRight/></Button></p>}
  {children}
 </section>;
}
