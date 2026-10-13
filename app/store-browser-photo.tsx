'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {EmptyLine} from '@/components/app/empty-line';
import {Note} from '@/components/app/note';
import {MetaLine} from '@/components/app/meta-line';
import type {BrowserPhotoRights} from '@/lib/store-browser';

type PhotoSource={id:string;title:string;version:number;fileName?:string};
type RightsInput={rightsId?:string;sourceId:string;sourceVersion:number;permission:'owned'|'licensed';evidence:string;validUntil:string;expectedVersion?:number};
export function StoreBrowserPhoto({sources,rights,busy,connected,onRights,onCreate}:{sources:PhotoSource[];rights:BrowserPhotoRights[];busy:boolean;connected:boolean;onRights:(input:RightsInput)=>Promise<unknown>;onCreate:(rightsId:string)=>Promise<void>}){
 const [sourceId,setSourceId]=useState(''),[permission,setPermission]=useState<'owned'|'licensed'>('owned'),[evidence,setEvidence]=useState(''),[validUntil,setValidUntil]=useState('');
 const source=sources.find(s=>s.id===sourceId),record=rights.find(r=>r.sourceId===sourceId&&r.sourceVersion===source?.version);
 const complete=!!source&&!!evidence.trim()&&!!validUntil;
 return <details><summary>매장 사진 업로드</summary><Note>이 브랜드 아카이브의 확인된 사진 원본을 선택하세요. 업로드할 사진의 사용 권리와 유효기간을 기록한 뒤 변경안을 승인합니다.</Note>
  {!sources.length?<EmptyLine next="브랜드 아카이브에 이 점포의 사진 원본을 업로드하고 확인 완료로 표시하세요.">선택 가능한 사진 원본이 없습니다.</EmptyLine>:<>
   <form className="form-stack" onSubmit={e=>{e.preventDefault();if(source)void onRights({rightsId:record?.id,sourceId:source.id,sourceVersion:source.version,permission,evidence,validUntil:validUntil+'T23:59:59+09:00',expectedVersion:record?.version})}}>
    <label className="store-field"><span>아카이브 사진 원본</span><NativeSelect required value={sourceId} onChange={e=>setSourceId(e.target.value)}><NativeSelectOption value="">사진 선택</NativeSelectOption>{sources.map(s=><NativeSelectOption key={s.id} value={s.id}>{s.title}{s.fileName?` (${s.fileName})`:''}</NativeSelectOption>)}</NativeSelect></label>
    <label className="store-field"><span>사진 사용 권리</span><NativeSelect value={permission} onChange={e=>setPermission(e.target.value as 'owned'|'licensed')}><NativeSelectOption value="owned">직접 소유한 사진</NativeSelectOption><NativeSelectOption value="licensed">사용 허락을 받은 사진</NativeSelectOption></NativeSelect></label>
    <label className="store-field"><span>사용 권리 근거</span><Textarea required rows={3} maxLength={3000} value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="직접 촬영 사실 또는 사용 허락의 범위·계약 근거"/></label>
    <label className="store-field"><span>사용 권리 유효기간</span><Input required type="date" value={validUntil} onChange={e=>setValidUntil(e.target.value)}/></label>
    <Button disabled={busy||!complete} disabledReason={!complete?'사진과 사용 권리 근거·유효기간을 모두 입력하세요.':undefined}>사진 사용 권리 저장</Button>
   </form>
   {record&&<p>{record.status==='revoked'?'선택한 사진의 사용 권리가 회수되었습니다. 사용 권리 근거와 유효기간을 다시 저장하면 복원할 수 있습니다.':'선택한 사진의 사용 권리가 기록되었습니다.'} 유효기간: {record.validUntil}</p>}
   <Button disabled={busy||!connected||!record||record.status==='revoked'} disabledReason={!connected?'이 점포의 네이버 계정을 먼저 연결하세요.':!record?'선택한 사진의 사용 권리를 먼저 저장하세요.':record.status==='revoked'?'회수된 사진의 사용 권리를 다시 저장하세요.':undefined} onClick={()=>{if(record&&record.status!=='revoked')void onCreate(record.id)}}>사진 업로드 변경안 저장</Button>
  </>}
  <p>사진 원본과 변경안의 파일이 같은지 서버가 확인합니다. 실제 네이버 업로드 완료 여부는 관리 화면과 공개 화면의 근거를 각각 확인하세요.</p>
 </details>;
}

export function StoreBrowserPhotoRights({sources,rights,busy,onRevoke}:{sources:PhotoSource[];rights:BrowserPhotoRights[];busy:boolean;onRevoke:(record:BrowserPhotoRights)=>Promise<void>}){
 return <section aria-label="사진 사용 권리 목록"><h3>사진 사용 권리 목록</h3><Note>새 작업이 꺼져 있어도 기존 사진의 사용 권리를 회수할 수 있습니다. 회수 이후에는 새 업로드안을 만들거나 승인된 사진을 실행할 수 없습니다.</Note><ul>{rights.map(record=><li key={record.id}><p><MetaLine items={[sources.find(s=>s.id===record.sourceId)?.title||'사진 원본 조회 불가',<b key="status">{record.status==='revoked'?'회수됨':'등록됨'}</b>,`기한 ${record.validUntil}`]}/></p>{record.status!=='revoked'&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void onRevoke(record)}>사진 사용 권리 회수</Button>}</li>)}</ul></section>;
}
