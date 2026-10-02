'use client';
import {CheckInput} from '@/components/app/check';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {api} from '@/lib/client';
import type {viewMetaImageUpload} from '@/lib/meta-image-upload-server';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';
type View=Awaited<ReturnType<typeof viewMetaImageUpload>>;
export function MetaImageUploadPanel({campaignId}:{campaignId:string}){
 const [data,setData]=useState<View|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
 const load=useCallback(async()=>{const response=await fetch('/api/meta-ads/assets?campaignId='+encodeURIComponent(campaignId)),value=await response.json() as View&{error?:string};if(!response.ok)throw new Error(value.error||'업로드 기록을 불러오지 못했습니다.');return value},[campaignId]);
 useEffect(()=>{let live=true;void Promise.resolve().then(load).then(v=>{if(live){setData(v);setConfirmed(false)}}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setBusy(false)});return()=>{live=false}},[load]);
 async function act(action:'prepare'|'upload',operationId?:string,expectedVersion?:number){if(!data)return;setBusy(true);setError('');try{await api(action,{campaignId,campaignVersion:data.campaignVersion,evidenceFingerprint:data.evidenceFingerprint,...(action==='upload'?{operationId,expectedVersion,confirmed}:{})},'/api/meta-ads/assets');setData(await load());setConfirmed(false)}catch(e){setError((e as Error).message);setData(await load().catch(()=>null))}finally{setBusy(false)}}
 const locked=busy||!data?.enabled||!data.canEdit||!!data.issues.length;
 return <section aria-label="Meta 원본 이미지 업로드" className="form-stack"><h3>검수 원본 이미지 업로드</h3><Note className="">검수한 PNG 원본을 연결된 Meta 광고 계정의 이미지 라이브러리에 올리기만 합니다.</Note>{error&&<p role="alert">{error}</p>}{!data?<ScreenSkeleton label="업로드 기록을 불러오는 중입니다." rows={2}/>:<>
 {!data.enabled&&<p>소유자가 이미지 업로드 기능을 켜야 준비할 수 있습니다.</p>}{data.issues.length>0&&<ul>{data.issues.map(i=><li key={i}>{i}</li>)}</ul>}
 <p>광고 계정: {data.accountId??'미연결'} · 원본 소재: {data.creative?.id??'검수 필요'}</p>{data.creative&&<p className="wrap-anywhere">원본 SHA256: {data.creative.pngHash}</p>}
 <Button disabled={locked} onClick={()=>void act('prepare')}>원본 업로드 준비</Button>
 <label><CheckInput disabled={locked} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>검수한 원본 이미지와 전송 계정을 확인했으며 Meta에 PNG를 업로드하는 데 동의합니다.</label>
 {data.operations.map(o=><article key={o.id}><p>업로드 상태: {o.state}{o.stale?' · 근거 변경':''}</p>{o.state==='prepared'&&<Button disabled={locked||o.stale||!confirmed} disabledReason={o.stale?'다른 곳에서 먼저 바뀌었습니다. 최신 기록을 불러온 뒤 다시 하세요.':!confirmed?'확인 칸을 먼저 체크하세요.':undefined} onClick={()=>void act('upload',o.id,o.version)}>Meta 이미지 업로드</Button>}{['sending','unknown'].includes(o.state)&&<p>결과가 확정되지 않았습니다. 중복 업로드하지 말고 외부 계정에서 대조하세요.</p>}{o.receipt?.metaImageHash&&<><p className="wrap-anywhere">Meta 이미지 hash: {o.receipt.metaImageHash}</p><p>검수 원본 바이트를 전송한 영수증입니다. Meta가 변형한 표시 파일은 원본과 다를 수 있습니다. 광고 구성에서 이 영수증을 선택할 수 있습니다.</p></>}</article>)}
 </>}</section>;
}
