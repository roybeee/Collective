'use client';
// 제작·발행 탭 발행 카드 안의 캐러셀·릴스 묶음과 직접 게시 결과 미확인 대조(C3 후속). app/execution-panel.tsx가 지연 로딩한다.
// 묶음: 장마다 소재 이미지·순서·미디어 해시 앞 12자를 보이고, 승인 확인 카드(무엇)에 같은 해시 목록을 싣는다(lib/execution-media-set.ts). 서버는 승인 요청의 해시가 다르면 409다.
// 대조: 결과 미확인 직접 게시 발행에 '계정 게시물로 대조'(POST reconcile_direct)를 보인다. 읽기만 하고 다시 보내지 않는다. 여러 후보면 후보를 보인다.
import '@/lib/i18n/lazy';
import Image from 'next/image';
import {Button} from '@/components/ui/button';
import {MetaLine} from '@/components/app/meta-line';
import {useT} from '@/lib/i18n-react';
import {t} from '@/lib/i18n';
import {carouselCount,publicationMediaHashes} from '@/lib/execution-media-set';
import type {Publication} from '@/lib/execution';

type Act=(name:string,data:Record<string,unknown>,message:string)=>void;
const short=(hash:string)=>hash.slice(0,12);
const asset=(creativeId:string)=>'/api/execution/asset?id='+encodeURIComponent(creativeId);
const directChannel=(channelId?:string)=>/^(instagram_direct|threads):\d+$/.test(channelId??'');

// 승인 확인 카드의 '무엇'에 덧붙이는 한 줄. 묶음이 없으면 빈 문자열.
export function mediaSetConfirmLine(p:Pick<Publication,'pngHash'|'codedPng'|'mediaSet'>){
 if(!p.mediaSet)return '';
 const hashes=publicationMediaHashes(p).map(short).join(', ');
 return p.mediaSet.type==='CAROUSEL'?t('mediaSet.confirmCarousel',{n:String(carouselCount(p.mediaSet)),hashes}):t('mediaSet.confirmReels',{hashes});
}

export function PublicationMediaSet({p,busy,canManage,onAct}:{p:Publication;busy:boolean;canManage:boolean;onAct:Act}){
 const tr=useT(),set=p.mediaSet,hashes=publicationMediaHashes(p);
 const reconcilable=canManage&&directChannel(p.channelId)&&(p.status==='uncertain'||p.status==='submitting');
 const note=p.directReconcile;
 return <>
  {set?.type==='CAROUSEL'&&<section aria-label={tr('mediaSet.carouselLabel')} className="space-y-1">
   <p className="text-sm font-semibold">{tr('mediaSet.carouselTitle',{n:String(carouselCount(set))})}</p>
   <ol className="flex flex-wrap gap-2">{[p.creativeId,...set.items.map(i=>i.creativeId)].map((id,i)=><li key={id+i}><figure><Image unoptimized width={1080} height={1080} src={asset(id)} alt={tr('mediaSet.itemAlt',{n:String(i+1)})} className="w-24"/><figcaption className="text-xs">{tr('mediaSet.itemCaption',{n:String(i+1),hash:short(hashes[i]??'')})}</figcaption></figure></li>)}</ol>
  </section>}
  {set?.type==='REELS'&&<section aria-label={tr('mediaSet.reelsLabel')} className="space-y-1 text-sm">
   <p className="font-semibold">{tr('mediaSet.reelsTitle')}</p>
   <p className="break-all text-xs">{set.video.url}</p>
   <p className="text-xs">{tr('mediaSet.reelsMeta',{hash:short(set.video.sha256),mb:(set.video.bytes/1048576).toFixed(1),cover:short(hashes[0]??'')})}</p>
  </section>}
  {set&&p.status==='draft'&&<p className="text-xs">{tr('mediaSet.hashNote')}</p>}
  {p.permalink&&<p className="text-sm"><a className="underline" href={p.permalink} target="_blank" rel="noreferrer">{tr('mediaSet.permalink')}</a></p>}
  {reconcilable&&<div className="grid gap-2">
   <p className="text-sm">{tr('mediaSet.reconcileLead')}</p>
   <div><Button variant="outline" size="fit" disabled={busy} onClick={()=>onAct('reconcile_direct',{id:p.id,version:p.version},t('mediaSet.reconciled'))}>{tr('mediaSet.reconcile')}</Button></div>
   {note?.result==='none_yet'&&<p role="status" className="text-sm">{tr('mediaSet.noneYet',{at:note.checkedAt.slice(0,16).replace('T',' ')})}</p>}
   {note?.result==='multiple'&&<div role="status" className="text-sm"><p>{tr('mediaSet.multiple',{n:String(note.candidates.length)})}</p><ul className="list-disc pl-5">{note.candidates.map(c=><li key={c.id}><MetaLine items={[c.permalink?<a key="link" className="underline" href={c.permalink} target="_blank" rel="noreferrer">{c.id}</a>:c.id,c.timestamp]}/></li>)}</ul></div>}
  </div>}
 </>;
}
