'use client';
import {CheckInput} from '@/components/app/check';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {api} from '@/lib/client';
import type {MetaCreateInput,viewMetaCreate} from '@/lib/meta-ad-create-server';
import {metaCreateStepNames,type MetaCreateStep} from '@/lib/meta-ad-create';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';
type View=Awaited<ReturnType<typeof viewMetaCreate>>;
const blank:MetaCreateInput={operationId:'',imageUploadReceiptId:'',pageId:'',pixelId:'',graphDailyBudget:'',budgetUnitEvidence:'',ageMin:18,ageMax:65,callToActionType:'LEARN_MORE'};
const labels={adset:'광고세트',creative:'소재',ad:'광고'};
export function MetaAdCreatePanel({campaignId}:{campaignId:string}){
 const [data,setData]=useState<View|null>(null),[input,setInput]=useState(blank),[busy,setBusy]=useState(true),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false),[dirty,setDirty]=useState(false);
 const load=useCallback(async()=>{const r=await fetch('/api/meta-ads/create?campaignId='+encodeURIComponent(campaignId)),v=await r.json() as View&{error?:string};if(!r.ok)throw new Error(v.error||'생성 작업을 불러오지 못했습니다.');return v},[campaignId]);
 useEffect(()=>{let live=true;void Promise.resolve().then(load).then(v=>{if(live){setData(v);setInput(v.saved?.input??{...blank,operationId:v.parents[0]?.id??'',imageUploadReceiptId:v.images[0]?.id??''})}}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setBusy(false)});return()=>{live=false}},[load]);
 async function act(action:'prepare'|'create'|'reconcile',step?:MetaCreateStep){if(!data)return;setBusy(true);setError('');try{await api(action,{campaignId,campaignVersion:data.campaignVersion,expectedVersion:data.version,evidenceFingerprint:data.evidenceFingerprint,...(action==='prepare'?{input}:{step,confirmed})},'/api/meta-ads/create');const v=await load();setData(v);setInput(v.saved?.input??input);setDirty(false);setConfirmed(false)}catch(e){setError((e as Error).message);setData(await load().catch(()=>null))}finally{setBusy(false)}}
 function change<K extends keyof MetaCreateInput>(key:K,value:MetaCreateInput[K]){setInput({...input,[key]:value});setDirty(true);setConfirmed(false)}
 const locked=busy||!data?.enabled||!data.canEdit||!!data.issues.length,started=!!data?.saved&&metaCreateStepNames.some(k=>data.saved!.steps[k].state!=='prepared');
 return <section aria-label="Meta 비활성 광고 생성" className="form-stack"><h3>비활성 광고 단계별 생성</h3><Note className="">검수한 원본으로 광고세트·소재·광고를 하나씩 만듭니다. 광고세트와 광고는 PAUSED로 생성하며 활성화 기능은 없습니다.</Note>{error&&<p role="alert">{error}</p>}{!data?<ScreenSkeleton label="생성 작업을 불러오는 중입니다." rows={2}/>:<>
 {!data.enabled&&<p>소유자가 하위 광고 생성 기능을 켜야 준비할 수 있습니다.</p>}{data.issues.length>0&&<ul>{data.issues.map(i=><li key={i}>{i}</li>)}</ul>}
 <label className="field"><span>부모 비활성 캠페인</span><NativeSelect disabled={locked||started} value={input.operationId} onChange={e=>change('operationId',e.target.value)}><NativeSelectOption value="">선택</NativeSelectOption>{data.parents.map(p=><NativeSelectOption key={p.id} value={p.id}>{p.externalId}</NativeSelectOption>)}</NativeSelect></label>
 <label className="field"><span>원본 업로드 영수증</span><NativeSelect disabled={locked||started} value={input.imageUploadReceiptId??''} onChange={e=>change('imageUploadReceiptId',e.target.value)}><NativeSelectOption value="">선택</NativeSelectOption>{data.images.map(p=><NativeSelectOption key={p.id} value={p.id}>{p.metaImageHash}</NativeSelectOption>)}</NativeSelect></label>
 <div className="form-two">{([['pageId','Facebook 페이지 ID'],['pixelId','픽셀 ID'],['graphDailyBudget','Graph 일 예산 원문 정수'],['budgetUnitEvidence','원화·Graph 예산 단위 대조 근거']] as const).map(([k,label])=><label className="field" key={k}><span>{label}</span><Input disabled={locked||started} value={input[k]} onChange={e=>change(k,e.target.value)}/></label>)}</div>
 <div className="form-two">{(['ageMin','ageMax'] as const).map(k=><label className="field" key={k}><span>{k==='ageMin'?'최소 연령':'최대 연령'}</span><Input type="number" min={18} max={65} disabled={locked||started} value={input[k]} onChange={e=>change(k,Number(e.target.value))}/></label>)}</div>
 <label className="field"><span>버튼 유형</span><NativeSelect disabled={locked||started} value={input.callToActionType} onChange={e=>change('callToActionType',e.target.value as MetaCreateInput['callToActionType'])}><NativeSelectOption value="LEARN_MORE">더 알아보기</NativeSelectOption><NativeSelectOption value="SHOP_NOW">구매하기</NativeSelectOption></NativeSelect></label>
 <p>대한민국 성인·웹사이트 구매·단일 이미지 구성만 지원합니다. Graph 금액을 원화로 자동 환산하지 않습니다.</p><Button disabled={locked||started} onClick={()=>void act('prepare')}>하위 광고 생성 준비</Button>
 {data.saved&&<><label><CheckInput disabled={busy||!data.canEdit||dirty} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>고정된 검수·원본·계정·예산 단위를 확인했으며 선택한 객체 생성 또는 외부 조회에 동의합니다.</label>{data.stale&&<p>근거 또는 연결이 변경되어 작업이 잠겼습니다.</p>}{metaCreateStepNames.map((step,i)=>{const state=data.saved!.steps[step],before=metaCreateStepNames.slice(0,i).every(k=>data.saved!.steps[k].state==='verified');return <article key={step}><p>{labels[step]} · {state.state}{state.externalId?' · ID '+state.externalId:''}</p>{state.state==='prepared'&&<Button disabled={locked||dirty||data.stale||!confirmed||!before} onClick={()=>void act('create',step)}>{labels[step]} 비활성 생성</Button>}{['sending','unknown'].includes(state.state)&&<><p>결과 미확정 단계는 재전송하거나 건너뛰지 않습니다.</p>{state.externalId&&<Button disabled={busy||!data.canEdit||!confirmed} onClick={()=>void act('reconcile',step)}>{labels[step]} 알려진 ID 조회</Button>}</>}</article>})}<p>표시된 ID는 광고 구성 검증에서 다시 대조할 수 있습니다. 과거 조회만으로 현재 비활성 상태나 광고비를 보증하지 않습니다.</p></>}
 </>}</section>;
}
