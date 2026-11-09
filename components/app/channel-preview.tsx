'use client';
// X6 채널 모양 미리보기(표시 전용). 앱 테마와 상관없이 실제 채널처럼 밝은 기기 틀(app/globals.css '/* X6 X8 preview diff */' 토큰)로 그린다. 다크 모드에서도 뒤집지 않는다.
// 표시 줄(AI 생성물·가상인물)은 '더 보기' 접기와 상관없이 늘 보인다. 글자 수·바이트는 lib/text-bytes.ts가 센다(Instagram 2,200자, Threads 500자, 문자 SMS 90바이트·LMS 2,000바이트).
import {useState,type ReactNode} from 'react';
import Image from 'next/image';
import {Button} from '@/components/ui/button';
import {Segmented} from './segmented';
import {captionParts,foldCaption,messageMarks,previewCounter,splitDisclosure,type PreviewChannel} from '@/lib/text-bytes';

export const CHANNEL_NAMES:Record<PreviewChannel,string>={instagram:'Instagram',threads:'Threads',blog:'네이버 블로그',sms:'문자 알림톡'};
export type ChannelPreviewProps={channel:PreviewChannel;account:string;body:string;imageUrl?:string;disclosure?:string|readonly string[]|null;title?:string};

const initial=(name:string)=>Array.from(name.trim())[0]?.toUpperCase()??'?';
function Tagged({text}:{text:string}){
 return <>{captionParts(text).map((p,i)=>p.tag?<span key={i} className="cp-tag">{p.text}</span>:<span key={i}>{p.text}</span>)}</>;
}
function Counter({channel,text}:{channel:PreviewChannel;text:string}){
 const c=previewCounter(channel,text);
 if(!c)return null;
 return <p className="cp-counter" data-over={c.over||undefined}>{c.unit==='바이트'?'바이트 수':'글자 수'} {c.label}{c.over?' (한도 초과)':''}</p>;
}
function Disclosure({lines}:{lines:readonly string[]}){
 return lines.length?<div className="cp-disclosure" role="note" aria-label="표시 줄">{lines.map(l=><p key={l}>{l}</p>)}</div>:null;
}
function Head({account,sub}:{account:string;sub?:string}){
 return <div className="cp-head"><span className="cp-avatar" aria-hidden="true">{initial(account)}</span><span className="cp-account"><b>{account}</b>{sub&&<small>{sub}</small>}</span></div>;
}
function Frame({channel,children}:{channel:PreviewChannel;children:ReactNode}){
 return <figure aria-label={`${CHANNEL_NAMES[channel]} 미리보기`} className={`channel-preview cp-${channel}`}>{children}</figure>;
}
const Picture=({src}:{src?:string})=>src?<Image unoptimized width={1080} height={1080} src={src} alt="게시 이미지 미리보기" className="cp-square"/>:<div className="cp-square cp-noimage">이미지 없음</div>;

function InstagramPreview({account,body,imageUrl,lines,full}:{account:string;body:string;imageUrl?:string;lines:readonly string[];full:string}){
 const [open,setOpen]=useState(false),fold=foldCaption(body);
 return <Frame channel="instagram"><Head account={account}/><Picture src={imageUrl}/>
  <p className="cp-caption"><b>{account}</b> <Tagged text={open||!fold.folded?body:fold.shown}/>{fold.folded&&!open&&<>… <Button type="button" variant="link" size="fit" className="cp-more" onClick={()=>setOpen(true)}>더 보기</Button></>}</p>
  <Disclosure lines={lines}/><Counter channel="instagram" text={full}/></Frame>;
}
function ThreadsPreview({account,body,imageUrl,lines,full}:{account:string;body:string;imageUrl?:string;lines:readonly string[];full:string}){
 return <Frame channel="threads"><Head account={account}/><p className="cp-caption"><Tagged text={body}/></p>{imageUrl&&<Picture src={imageUrl}/>}<Disclosure lines={lines}/><Counter channel="threads" text={full}/></Frame>;
}
function BlogPreview({account,body,title,lines}:{account:string;body:string;title?:string;lines:readonly string[]}){
 const paragraphs=body.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
 const heading=title?.trim()||paragraphs[0]?.split('\n')[0]||'제목 없음',first=title?.trim()?paragraphs[0]:paragraphs[0]?.split('\n').slice(1).join('\n')||paragraphs[1];
 return <Frame channel="blog"><p className="cp-blog-brand">{CHANNEL_NAMES.blog}</p><p className="cp-blog-title">{heading}</p><Head account={account}/>{first&&<p className="cp-caption">{first}</p>}<Disclosure lines={lines}/></Frame>;
}
function MessagePreview({account,body,lines,full}:{account:string;body:string;lines:readonly string[];full:string}){
 const marks=messageMarks(body),rows=body.split('\n');
 return <Frame channel="sms"><p className="cp-sms-from">{account}</p><div className="cp-bubble">{rows.map((row,i)=>{
  if(i===rows.findIndex(r=>r.trim())&&marks.adPrefix){const rest=row.trim().slice('(광고)'.length);return <p key={i}><mark className="cp-ad">(광고)</mark>{rest}</p>}
  if(marks.optOut&&row.trim()===marks.optOut)return <p key={i} className="cp-optout">{row}</p>;
  return <p key={i}>{row||' '}</p>;
 })}</div><Disclosure lines={lines}/><Counter channel="sms" text={full}/></Frame>;
}
// 채널 하나의 미리보기. body는 게시될 글 전체(표시 줄 포함 가능), disclosure는 늘 보일 표시 줄이다.
export function ChannelPreview({channel,account,body,imageUrl,disclosure,title}:ChannelPreviewProps){
 const name=account.trim()||'연결 계정',split=splitDisclosure(body,disclosure),props={account:name,body:split.body,lines:split.disclosure,full:body};
 if(channel==='threads')return <ThreadsPreview {...props} imageUrl={imageUrl}/>;
 if(channel==='blog')return <BlogPreview {...props} title={title}/>;
 if(channel==='sms')return <MessagePreview {...props}/>;
 return <InstagramPreview {...props} imageUrl={imageUrl}/>;
}
// '미리보기 / 원문' 전환. 기본은 미리보기다. 원문은 저장된 글 그대로다.
export function CaptionViews({label,preview,raw}:{label:string;preview:ReactNode;raw:ReactNode}){
 const [view,setView]=useState<'preview'|'raw'>('preview');
 return <div className="caption-views"><Segmented label={label} value={view} onChange={setView} options={[{value:'preview',label:'미리보기'},{value:'raw',label:'원문'}]}/>{view==='preview'?preview:raw}</div>;
}
