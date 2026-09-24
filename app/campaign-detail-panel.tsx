'use client';
import {useCallback,useEffect,useState,type ComponentProps} from 'react';
import {Button} from '@/components/ui/button';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import type {CampaignDetail} from '@/lib/campaign-detail';
import {CampaignPanel} from './panels';
import {AiTeamSlot,EvidenceSummary} from './evidence-summary';
import {DirectivesPanel} from './directives-panel';
import {OnlineGradingSlot} from './online-grading';
import {CampaignAttributionSlot} from './campaign-attribution-slot';

type Props=ComponentProps<typeof CampaignPanel>;
export function CampaignDetailPanel(props:Props){
 if(!props.campaign)return null;
 return <LoadedCampaign key={props.campaign.id} {...props}/>;
}

function LoadedCampaign(props:Props){
 const c=props.campaign!,id=c.id;
 const parentReload=props.reload;
 const [detail,setDetail]=useState<CampaignDetail|null>(null),[error,setError]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  const response=await fetch('/api/campaigns/'+encodeURIComponent(id),{signal});
  const result=await response.json() as CampaignDetail & {error?:string};
  if(!response.ok)throw new Error(result.error||'캠페인 상세를 불러오지 못했습니다.');
  if(!signal?.aborted){setDetail(result);setError('');}
 },[id]);
 // 상세는 캠페인이 바뀌거나 캠페인 레코드(버전·수정 시각·상태·지점 연결)가 바뀔 때 자동으로 읽는다. 부모 data 객체에 기대면 폴링 tick마다
 // 상세를 두 번 부르고(reload()가 이미 load()를 부른다), id만 보면 상세 밖에서 고친 브리프(브리프 수정·지점 연결)의 옛 버전이 남는다.
 useEffect(()=>{
  const controller=new AbortController();
  void fetch('/api/campaigns/'+encodeURIComponent(id),{signal:controller.signal})
   .then(async response=>{const result=await response.json() as CampaignDetail & {error?:string};if(!response.ok)throw new Error(result.error||'조회 실패');return result})
   .then(result=>{if(!controller.signal.aborted){setDetail(result);setError('')}})
   .catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'조회 실패')});
  return()=>controller.abort();
 },[id,c.version,c.updatedAt,c.status,c.storeId]);
 const reload=useCallback(async()=>{await Promise.all([parentReload(),load()]);},[parentReload,load]);
 if(!detail)return <Sheet open onOpenChange={open=>{if(!open)props.onClose()}}><SheetContent className="campaign-sheet"><SheetHeader><SheetTitle>{props.campaign!.title}</SheetTitle><SheetDescription>캠페인 상세와 버전 기록을 불러옵니다.</SheetDescription></SheetHeader>{error?<div role="alert"><p>{error}</p><Button onClick={()=>void load().catch(e=>setError(e.message))}>다시 시도</Button></div>:<p>불러오는 중…</p>}</SheetContent></Sheet>;
 const data={...props.data,artifacts:detail.artifacts,metrics:detail.metrics,events:detail.events,runs:detail.runs};
 return <><CampaignPanel {...props} campaign={detail.campaign} data={data} history={detail.history} detailError={error} reload={reload}/><AiTeamSlot><EvidenceSummary campaignId={detail.campaign.id} artifacts={detail.artifacts}/><DirectivesPanel campaignId={detail.campaign.id}/></AiTeamSlot><OnlineGradingSlot campaignId={detail.campaign.id} artifacts={detail.artifacts}/><CampaignAttributionSlot campaignId={detail.campaign.id} onSaved={reload}/></>;
}
