'use client';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import '@/lib/i18n/lazy';
// X6 채널 모양 미리보기(표시 전용). 앱 테마와 상관없이 실제 채널처럼 밝은 기기 틀(app/globals.css '/* X6 X8 preview diff */' 토큰)로 그린다. 다크 모드에서도 뒤집지 않는다.
// 표시 줄(AI 생성물·가상인물)은 '더 보기' 접기와 상관없이 늘 보인다. 글자 수·바이트는 lib/text-bytes.ts가 센다(Instagram 2,200자, Threads 500자, 문자 SMS 90바이트·LMS 2,000바이트).
import {useState,type ReactNode} from 'react';
import Image from 'next/image';
import {Button} from '@/components/ui/button';
import {Segmented} from './segmented';
import {captionParts,foldCaption,messageMarks,previewCounter,splitDisclosure,type PreviewChannel} from '@/lib/text-bytes';

// 채널 이름은 그릴 때 사전에서 읽는다(Instagram·Threads는 고유 이름이라 그대로).
const channelKeys={blog:'preview.channel.blog',sms:'preview.channel.sms'} as const;
export const channelName=(channel:PreviewChannel)=>channel==='instagram'?'Instagram':channel==='threads'?'Threads':t(channelKeys[channel]);
export type ChannelPreviewProps={channel:PreviewChannel;account:string;body:string;imageUrl?:string;disclosure?:string|readonly string[]|null;title?:string};

// 문자 광고 표시 머리말(메시지 본문의 일부라 번역하지 않는다, lib/text-bytes.ts messageMarks).
const AD_PREFIX='(광고)';
const initial=(name:string)=>Array.from(name.trim())[0]?.toUpperCase()??'?';
function Tagged({text}:{text:string}){
 return <>{captionParts(text).map((p,i)=>p.tag?<span key={i} className="cp-tag">{p.text}</span>:<span key={i}>{p.text}</span>)}</>;
}
function Counter({channel,text}:{channel:PreviewChannel;text:string}){
 const c=previewCounter(channel,text);
 if(!c)return null;
 const bytes=c.unit==='바이트';// lib/text-bytes.ts 단위 값(화면 문구는 사전)
 return <p className="cp-counter" data-over={c.over||undefined}>{bytes?t('preview.bytes'):t('preview.chars')} {c.label}{c.over?t('preview.over'):''}</p>;
}
function Disclosure({lines}:{lines:readonly string[]}){
 return lines.length?<div className="cp-disclosure" role="note" aria-label={t('preview.labelLines')}>{lines.map(l=><p key={l}>{l}</p>)}</div>:null;
}
function Head({account,sub}:{account:string;sub?:string}){
 return <div className="cp-head"><span className="cp-avatar" aria-hidden="true">{initial(account)}</span><span className="cp-account"><b>{account}</b>{sub&&<small>{sub}</small>}</span></div>;
}
function Frame({channel,children}:{channel:PreviewChannel;children:ReactNode}){
 return <figure aria-label={t('preview.figure',{channel:channelName(channel)})} className={`channel-preview cp-${channel}`}>{children}</figure>;
}
const Picture=({src}:{src?:string})=>src?<Image unoptimized width={1080} height={1080} src={src} alt={t('preview.imageAlt')} className="cp-square"/>:<div className="cp-square cp-noimage">{t('preview.noImage')}</div>;

function InstagramPreview({account,body,imageUrl,lines,full}:{account:string;body:string;imageUrl?:string;lines:readonly string[];full:string}){
 const [open,setOpen]=useState(false),fold=foldCaption(body);
 return <Frame channel="instagram"><Head account={account}/><Picture src={imageUrl}/>
  <p className="cp-caption"><b>{account}</b> <Tagged text={open||!fold.folded?body:fold.shown}/>{fold.folded&&!open&&<>… <Button type="button" variant="link" size="fit" className="cp-more" onClick={()=>setOpen(true)}>{t('preview.more')}</Button></>}</p>
  <Disclosure lines={lines}/><Counter channel="instagram" text={full}/></Frame>;
}
function ThreadsPreview({account,body,imageUrl,lines,full}:{account:string;body:string;imageUrl?:string;lines:readonly string[];full:string}){
 return <Frame channel="threads"><Head account={account}/><p className="cp-caption"><Tagged text={body}/></p>{imageUrl&&<Picture src={imageUrl}/>}<Disclosure lines={lines}/><Counter channel="threads" text={full}/></Frame>;
}
function BlogPreview({account,body,title,lines}:{account:string;body:string;title?:string;lines:readonly string[]}){
 const paragraphs=body.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
 const heading=title?.trim()||paragraphs[0]?.split('\n')[0]||t('preview.untitled'),first=title?.trim()?paragraphs[0]:paragraphs[0]?.split('\n').slice(1).join('\n')||paragraphs[1];
 return <Frame channel="blog"><p className="cp-blog-brand">{channelName('blog')}</p><p className="cp-blog-title">{heading}</p><Head account={account}/>{first&&<p className="cp-caption">{first}</p>}<Disclosure lines={lines}/></Frame>;
}
function MessagePreview({account,body,lines,full}:{account:string;body:string;lines:readonly string[];full:string}){
 const marks=messageMarks(body),rows=body.split('\n');
 return <Frame channel="sms"><p className="cp-sms-from">{account}</p><div className="cp-bubble">{rows.map((row,i)=>{
  if(i===rows.findIndex(r=>r.trim())&&marks.adPrefix){const rest=row.trim().slice(AD_PREFIX.length);return <p key={i}><mark className="cp-ad">{row.trim().slice(0,AD_PREFIX.length)}</mark>{rest}</p>}
  if(marks.optOut&&row.trim()===marks.optOut)return <p key={i} className="cp-optout">{row}</p>;
  return <p key={i}>{row||' '}</p>;
 })}</div><Disclosure lines={lines}/><Counter channel="sms" text={full}/></Frame>;
}
// 채널 하나의 미리보기. body는 게시될 글 전체(표시 줄 포함 가능), disclosure는 늘 보일 표시 줄이다.
export function ChannelPreview({channel,account,body,imageUrl,disclosure,title}:ChannelPreviewProps){useT();
 const name=account.trim()||t('preview.account'),split=splitDisclosure(body,disclosure),props={account:name,body:split.body,lines:split.disclosure,full:body};
 if(channel==='threads')return <ThreadsPreview {...props} imageUrl={imageUrl}/>;
 if(channel==='blog')return <BlogPreview {...props} title={title}/>;
 if(channel==='sms')return <MessagePreview {...props}/>;
 return <InstagramPreview {...props} imageUrl={imageUrl}/>;
}
// '미리보기 / 원문' 전환. 기본은 미리보기다. 원문은 저장된 글 그대로다.
export function CaptionViews({label,preview,raw}:{label:string;preview:ReactNode;raw:ReactNode}){useT();
 const [view,setView]=useState<'preview'|'raw'>('preview');
 return <div className="caption-views"><Segmented label={label} value={view} onChange={setView} options={[{value:'preview',label:t('preview.preview')},{value:'raw',label:t('preview.raw')}]}/>{view==='preview'?preview:raw}</div>;
}
