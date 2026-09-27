'use client';
// 모집 자료 상세의 '인터뷰 영상 완성본'(트랙 R R15b-3): 승인된 인터뷰 영상 대본 판에 촬영한 완성본 파일의 SHA-256·크기·촬영일·라벨을 남긴다.
// 파일은 서버로 올리지 않는다. 브라우저가 파일을 읽어 해시만 계산하고, 대표·관리자가 기록한다. 판정은 서버가 한다(lib/franchise-media.ts).
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Section,kst,type Json} from './franchise-common';

export type MediaView={sha256:string;bytes:number;label:string;filmedOn:string;recordedAt:string};
export const MEDIA_NOTE='영상 파일은 올리지 않습니다. 이 기기에서 파일의 SHA-256 해시만 계산해 기록합니다. 게시한 영상과 같은 파일인지 나중에 해시로 대조합니다.';
const MB=1024*1024;
export const sizeText=(bytes:number)=>bytes>=MB?`${(bytes/MB).toFixed(1)}MB`:`${bytes}바이트`;
export async function fileSha256(file:Blob):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

export function MediaBox({media,canRecord,busy,today,onRecord}:{media:readonly MediaView[];canRecord:boolean;busy:boolean;today:string;onRecord:(payload:Json)=>Promise<boolean>}){
 const [file,setFile]=useState<File|null>(null),[label,setLabel]=useState(''),[on,setOn]=useState(today),[hashing,setHashing]=useState(false),[note,setNote]=useState('');
 async function submit(){
  if(!file||!label.trim())return;
  setHashing(true);setNote('');
  let sha256='';
  try{sha256=await fileSha256(file)}catch{setNote('파일을 읽지 못했습니다. 다른 파일로 다시 시도하세요.');setHashing(false);return}
  setHashing(false);
  if(await onRecord({sha256,bytes:file.size,label:label.trim(),filmedOn:on})){setFile(null);setLabel('')}
 }
 return <Section title="인터뷰 영상 완성본" note={MEDIA_NOTE}>
  {media.length?<ul className="franchise-list" aria-label="완성본 해시 기록">{media.map(m=><li key={m.sha256}>{`${m.label} · 촬영 ${m.filmedOn} · ${sizeText(m.bytes)}`} <small className="subtle-note">{`SHA-256 ${m.sha256.slice(0,16)}… · 기록 ${kst(m.recordedAt)}`}</small></li>)}</ul>:<p className="subtle-note">기록한 완성본이 없습니다.</p>}
  {canRecord&&<form className="form-stack" aria-label="완성본 해시 기록" onSubmit={e=>{e.preventDefault();void submit()}}>
   <label className="field"><span>완성본 파일(올리지 않음)</span><input type="file" accept="video/*" aria-label="완성본 파일" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
   <label className="field"><span>라벨</span><Input maxLength={60} placeholder="예: 대표 인터뷰 15초 최종본" value={label} onChange={e=>setLabel(e.target.value)}/><small>파일 이름·채널 이름만 적습니다. 출연자 이름·연락처는 적지 않습니다.</small></label>
   <label className="field"><span>촬영일 (KST)</span><Input type="date" max={today} value={on} onChange={e=>setOn(e.target.value)}/></label>
   <div className="form-actions"><Button type="submit" disabled={busy||hashing||!file||!label.trim()}>{hashing?'해시 계산 중':'해시 기록'}</Button></div>
   {note&&<p role="alert">{note}</p>}
  </form>}
 </Section>;
}
