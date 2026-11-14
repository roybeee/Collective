'use client';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import '@/lib/i18n/lazy';
// 연결 및 설정 '채널 연결' 탭(X-F). 채널마다 카드 하나: Buffer, Instagram 직접 게시, Threads, 카카오 비즈메시지(딜러), 토스플레이스 POS, 네이버 검색광고.
// 상태는 기존 API만 읽는다: GET /api/feature-flags(스위치), GET /api/channels?brandId=(직접 게시 연결·성과 수집 키), GET /api/execution?campaignId=(Buffer),
// GET /api/kakao?brandId=, GET /api/pos/tossplace. 카드는 연결·확인·해제를 기존 POST로만 한다. 게시·발송·광고 쓰기는 이 탭에서 일어나지 않는다.
import {useCallback,useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {SafetyScope} from '@/components/app/safety-scope';
import {bufferCheckCampaigns} from '@/lib/feature-status';
import {pushNav} from '@/lib/nav-state';
import type {Brand,Campaign} from '@/lib/agency';
import {ChannelCard,FormField,request} from './settings-channel-card';
import {flagOn} from './settings-channel-state';
import {PublisherCard,type PublisherStatus} from './settings-publishers';
import {KakaoCard} from './settings-kakao';
import {PosCard} from './settings-pos';

type CredentialStatus={channel:string;label:string;connected:boolean;account?:string;expiresAt?:string|null};
type ChannelsResponse={channels?:CredentialStatus[];byBrand?:(CredentialStatus&{brandId:string;storeId?:string})[];publishers?:PublisherStatus[]};
type BufferPublisher={connected?:boolean;channelId?:string;account?:string};
export type Snapshot={flags:unknown;channels:ChannelsResponse|null;buffer:BufferPublisher|null};

// 브랜드 하나의 상태를 한 번에 읽는다. 읽지 못한 항목은 null로 두어 카드가 '확인하지 못함'으로 보인다.
async function snapshotOf(brandId:string,checkCampaign:string|undefined):Promise<Snapshot>{
 const [flags,channels,buffer]=await Promise.all([
  request<{flags?:unknown}>('/api/feature-flags').then(d=>d.flags??null,()=>null),
  brandId?request<ChannelsResponse>('/api/channels?brandId='+encodeURIComponent(brandId)).catch(()=>null):Promise.resolve(null),
  checkCampaign?request<{publisher?:BufferPublisher}>('/api/execution?campaignId='+encodeURIComponent(checkCampaign)).then(d=>d.publisher??null,()=>null):Promise.resolve(null),
 ]);
 return {flags,channels,buffer};
}

function BufferCard({buffer,campaignId,checked}:{buffer:BufferPublisher|null;campaignId?:string;checked:boolean}){
 // 직접 게시(스위치 켜짐+연결)가 고른 공급자면 발행 상태의 채널 id가 instagram_direct:·threads:로 시작한다. 그때 Buffer는 쓰지 않는다.
 const direct=/^(instagram_direct|threads):/.test(buffer?.channelId??'');
 const connected=!checked?null:!campaignId?false:buffer?buffer.connected===true&&!direct:null;
 return <ChannelCard channel="buffer" title={t('sch.buffer.title')} lead={t('sch.buffer.lead')} connected={connected} account={direct?undefined:buffer?.account}>
  <p className="subtle-note">{direct?t('sch.buffer.directNow'):''}{t('sch.buffer.where')}</p>
  <div className="form-actions"><Button variant="outline" size="sm" disabled={!campaignId} disabledReason={t('sch.buffer.noCampaign')} onClick={()=>campaignId&&pushNav({view:'campaigns',campaign:campaignId,ctab:'execution'})}>{t('sch.buffer.connectInTab')}</Button></div>
 </ChannelCard>;
}

function NaverCard({snapshot,brandId,checked}:{snapshot:Snapshot;brandId:string;checked:boolean}){
 const base=snapshot.channels?.channels?.find(c=>c.channel==='naver_ads'),own=snapshot.channels?.byBrand?.find(c=>c.channel==='naver_ads'&&c.brandId===brandId&&!c.storeId);
 const connected=!checked?null:snapshot.channels?!!(own?.connected||base?.connected):null,write=flagOn(snapshot.flags,'naver_ads_write');
 const openKeys=()=>document.getElementById('settings-channels')?.scrollIntoView({behavior:'smooth',block:'start'});
 return <ChannelCard channel="naver_ads" title={t('sch.naver.title')} lead={t('sch.naver.lead')} connected={connected} account={own?.account||base?.account} switchOn={write} switchNote={write?t('sch.naver.applyOn'):t('sch.naver.applyOff')}>
  <p className="subtle-note">{t('sch.naver.where')}</p>
  <div className="form-actions"><Button variant="outline" size="sm" onClick={openKeys}>{t('sch.naver.goKeys')}</Button></div>
 </ChannelCard>;
}

export function SettingsChannels({brands,campaigns,reload}:{brands:Brand[];campaigns:Campaign[];reload:()=>Promise<void>}){useT();
 const [pick,setPick]=useState(''),brandId=brands.some(b=>b.id===pick)?pick:brands[0]?.id||'';
 const checks=bufferCheckCampaigns(brands,campaigns),checkCampaign=checks[brandId];
 const [loaded,setLoaded]=useState<{key:string;snapshot:Snapshot}|null>(null),[round,setRound]=useState(0),key=brandId+'#'+round;
 useEffect(()=>{let live=true;void snapshotOf(brandId,checkCampaign).then(snapshot=>{if(live)setLoaded({key,snapshot})});return()=>{live=false}},[brandId,checkCampaign,key]);
 const refresh=useCallback(()=>{setRound(n=>n+1);void reload().catch(()=>{})},[reload]);
 const snapshot=loaded?.snapshot??{flags:null,channels:null,buffer:null},checked=loaded?.key===key,loading=!checked,brandName=brands.find(b=>b.id===brandId)?.name||t('sch.brand');
 const publisher=(channel:'instagram_direct'|'threads')=>snapshot.channels?.publishers?.find(p=>p.channel===channel)??null;
 return <section className="settings-card channel-hub" aria-labelledby="settings-channel-hub-title">
  <header className="channel-card-head"><h2 id="settings-channel-hub-title">{t('sch.title')}</h2><Button variant="outline" size="sm" disabled={loading} onClick={refresh}><RefreshCw/>{t('sch.recheck')}</Button></header>
  <p>{t('sch.lead')}</p>
  <SafetyScope>{t('sch.safety')}</SafetyScope>
  <FormField label={t('sch.brand')}><NativeSelect aria-label={t('sch.brandAria')} value={brandId} onChange={e=>setPick(e.target.value)}>{brands.map(b=><NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}</NativeSelect></FormField>
  <div className="channel-grid" aria-busy={!checked}>
   <BufferCard buffer={snapshot.buffer} campaignId={checkCampaign} checked={checked}/>
   <PublisherCard channel="instagram_direct" brandId={brandId} brandName={brandName} status={publisher('instagram_direct')} checked={checked&&!!snapshot.channels} switchOn={flagOn(snapshot.flags,'instagram_direct_publish')} onChanged={refresh}/>
   <PublisherCard channel="threads" brandId={brandId} brandName={brandName} status={publisher('threads')} checked={checked&&!!snapshot.channels} switchOn={flagOn(snapshot.flags,'threads_publish')} onChanged={refresh}/>
   <KakaoCard key={'kakao-'+brandId} brandId={brandId} brandName={brandName} switchOn={flagOn(snapshot.flags,'kakao_bizmessage')} round={round}/>
   <PosCard brandId={brandId} brandName={brandName} switchOn={flagOn(snapshot.flags,'pos_tossplace')} round={round}/>
   <NaverCard snapshot={snapshot} brandId={brandId} checked={checked}/>
  </div>
 </section>;
}
