import type {Artifact} from './agency';
import {learningMetrics,type LearningMetric} from './learning';

// 카피 팩 v2(A3-1): 콘텐츠 역할의 구조화 출력(채널당 3~5안 카피·숏폼 장면 배열·제안 실험). 순수 모듈이며 상대 import만 쓴다.
// 역할 출력 계약(lib/role-output.ts)이 이 모듈로 팩을 소프트 검증하고 렌더본을 계약 섹션 앞에 넣는다. 규칙과 근거는 docs/COPY-PACK.ko.md.
// 형식 문제는 작업물을 막지 않는다(soft). 문제 목록(copyPackIssues)을 작업물에 남기고 채점기 copy_pack_variants(lib/graders/copy-pack.ts)가 fail로 센다.
export const COPY_PACK_VERSION='copy-pack-v2' as const;
// 역할 요청의 출력 프로필(RoleRequest.outputProfile). 스위치 a3_copy_pack이 켜진 소유자의 콘텐츠 역할만 이 값을 받는다.
export const COPY_PACK_PROFILE='copy-pack-v2' as const;
export type CopyVariant={id:string;angle:string;hook:string;body:string;cta:string;needsCheck?:string[]};
export type CopyChannel={channel:string;purpose:string;destination:string;variants:CopyVariant[]};
export type ShortformScene={start:number;end:number;visual:string;line:string;caption:string;sound:string;transition:string};
export type Shortform={channel:string;durationSec:number;scenes:ShortformScene[]};
export type CopyExperiment={title:string;channel:string;hypothesis:string;variable:string;control:string;treatment:string;fixed:string;metric:string};
export type CopyPack={version:typeof COPY_PACK_VERSION;channels:CopyChannel[];shortform:Shortform|null;experiments:CopyExperiment[]};
// level error는 계약 위반(채점 fail), warn은 참고(브리프 채널 누락).
export type CopyPackIssue={level:'error'|'warn';code:string;message:string};
// 작업물에 붙는 팩 필드. copyPackArtifactVersion은 팩을 만든 작업물 판(1)이다. 사람이 고친 판(2 이상)과 다르면 팩은 옛 판의 것이다.
export type CopyPackArtifact=Artifact&{copyPack?:CopyPack;copyPackArtifactVersion?:number;copyPackIssues?:CopyPackIssue[]};

export const COPY_PACK_LIMITS={channels:[1,4],variants:[3,5],scenes:[3,10],experiments:[1,3],durationSec:[6,60],hook:120,body:1200,cta:60} as const;
// 실험 지표는 바이럴 학습 3지표만 쓴다(lib/learning.ts learningMetrics).
export const COPY_PACK_METRICS=Object.keys(learningMetrics) as LearningMetric[];
// 저장 상한: 검사 뒤 목록·문자열을 이 길이로 자른다(규칙 위반은 자르기 전에 센다).
const KEEP={list:12,text:2000,needsCheck:10};

const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const text=(v:unknown)=>typeof v==='string'?v.trim().slice(0,KEEP.text):'';
// 한 줄 필드(제목·id·채널)는 줄바꿈을 공백으로 바꾼다. 렌더본의 제목 줄이 깨지지 않게 한다.
const line=(v:unknown)=>text(v).replace(/\s*\n\s*/g,' ');
const list=(v:unknown)=>Array.isArray(v)?v:[];
const seconds=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:Number.NaN;
const error=(code:string,message:string):CopyPackIssue=>({level:'error',code,message});
const compact=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
// 같은 안 판정 키: 훅+본문을 NFKC·소문자로 바꾸고 공백·문장부호·기호를 뺀다. 공백·문장부호만 다른 안은 1안이다.
export const variantKey=(v:Pick<CopyVariant,'hook'|'body'>)=>(v.hook+'\n'+v.body).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');

function variantOf(v:unknown):CopyVariant{
 const x=obj(v)||{},needs=list(x.needsCheck).map(text).filter(Boolean).slice(0,KEEP.needsCheck);
 return {id:line(x.id),angle:line(x.angle),hook:text(x.hook),body:text(x.body),cta:text(x.cta),...(needs.length?{needsCheck:needs}:{})};
}
function channelOf(c:unknown):CopyChannel{
 const x=obj(c)||{};
 return {channel:line(x.channel),purpose:line(x.purpose),destination:line(x.destination),variants:list(x.variants).map(variantOf)};
}
function shortformOf(s:unknown):Shortform|null{
 const x=obj(s);
 if(!x)return null;
 return {channel:line(x.channel),durationSec:seconds(x.durationSec),scenes:list(x.scenes).map(v=>{const y=obj(v)||{};return {start:seconds(y.start),end:seconds(y.end),visual:text(y.visual),line:text(y.line),caption:text(y.caption),sound:line(y.sound),transition:line(y.transition)}})};
}
function experimentOf(e:unknown):CopyExperiment{
 const x=obj(e)||{};
 return {title:line(x.title),channel:line(x.channel),hypothesis:text(x.hypothesis),variable:line(x.variable),control:line(x.control),treatment:line(x.treatment),fixed:text(x.fixed),metric:line(x.metric)};
}
const inRange=(n:number,[min,max]:readonly [number,number])=>n>=min&&n<=max;

function variantIssues(c:CopyChannel):CopyPackIssue[]{
 const name=c.channel||'이름 없는 채널',ids=c.variants.map(v=>v.id),distinct=new Set(c.variants.map(variantKey).filter(Boolean)).size,[min,max]=COPY_PACK_LIMITS.variants;
 return [
  ...(c.channel?[]:[error('channel_name','채널 이름이 비어 있습니다.')]),
  ...(distinct<min?[error('variants_too_few',`${name}: 서로 다른 안이 ${distinct}개입니다(${min}개 이상, 공백·문장부호만 다른 안은 1안).`)]:[]),
  ...(c.variants.length>max?[error('variants_too_many',`${name}: 안이 ${c.variants.length}개입니다(${max}개 이하).`)]:[]),
  ...(ids.some((id,i)=>!id||ids.indexOf(id)!==i)?[error('variant_id_duplicate',`${name}: 안 id가 비었거나 겹칩니다(${ids.join(',')}).`)]:[]),
  ...c.variants.flatMap(v=>{
   const at=`${name} 안 ${v.id||'?'}`;
   return [
    ...(!v.hook||v.hook.length>COPY_PACK_LIMITS.hook?[error('hook_length',`${at}: 훅은 1~${COPY_PACK_LIMITS.hook}자입니다(${v.hook.length}자).`)]:[]),
    ...(!v.body||v.body.length>COPY_PACK_LIMITS.body?[error('body_length',`${at}: 본문은 1~${COPY_PACK_LIMITS.body.toLocaleString('en-US')}자입니다(${v.body.length}자).`)]:[]),
    ...(!v.cta||v.cta.length>COPY_PACK_LIMITS.cta?[error('cta_length',`${at}: CTA는 1~${COPY_PACK_LIMITS.cta}자입니다(${v.cta.length}자).`)]:[]),
    ...(/\n/.test(v.cta)?[error('cta_single',`${at}: CTA는 하나만 씁니다.`)]:[]),
   ];
  }),
 ];
}
// 장면은 0초에 시작해 빈틈·겹침 없이 이어지고 마지막 끝이 durationSec와 같아야 한다.
function shortformIssues(s:Shortform|null):CopyPackIssue[]{
 if(!s)return [error('shortform_missing','숏폼 장면(shortform)이 없습니다.')];
 const {scenes,durationSec}=s,[min,max]=COPY_PACK_LIMITS.scenes;
 const broken=scenes.flatMap((x,i)=>{
  const expected=i===0?0:scenes[i-1].end;
  return !(x.start<x.end)||x.start!==expected?[`${i+1}번 장면 ${x.start}–${x.end}초(시작 ${expected}초여야 함)`]:[];
 });
 const last=scenes[scenes.length-1]?.end;
 return [
  ...(Number.isInteger(durationSec)&&inRange(durationSec,COPY_PACK_LIMITS.durationSec)?[]:[error('shortform_duration',`숏폼 길이는 ${COPY_PACK_LIMITS.durationSec[0]}~${COPY_PACK_LIMITS.durationSec[1]}초 정수입니다(${durationSec}).`)]),
  ...(inRange(scenes.length,[min,max])?[]:[error('scene_count',`장면은 ${min}~${max}개입니다(${scenes.length}개).`)]),
  ...(broken.length||scenes.length&&last!==durationSec?[error('scene_timeline',`장면 타임라인이 0초부터 빈틈 없이 ${durationSec}초로 닫히지 않습니다${broken.length?`: ${broken.join(', ')}`:`(마지막 끝 ${last}초)`}.`)]:[]),
 ];
}
function experimentIssues(experiments:CopyExperiment[],channels:CopyChannel[]):CopyPackIssue[]{
 const [min,max]=COPY_PACK_LIMITS.experiments;
 return [
  ...(inRange(experiments.length,[min,max])?[]:[error('experiment_count',`실험은 ${min}~${max}개입니다(${experiments.length}개).`)]),
  ...experiments.flatMap((e,i)=>{
   const at=`실험 ${i+1}`,channel=channels.find(c=>c.channel&&c.channel===e.channel),ids=channel?.variants.map(v=>v.id)||[];
   return [
    ...(e.title&&e.hypothesis&&e.variable?[]:[error('experiment_fields',`${at}: 제목·가설·바꿀 요소(variable)가 필요합니다.`)]),
    ...(channel?[]:[error('experiment_channel',`${at}: 채널(${e.channel||'없음'})이 팩 채널에 없습니다.`)]),
    ...(channel&&(!ids.includes(e.control)||!ids.includes(e.treatment)||e.control===e.treatment)?[error('experiment_arm',`${at}: 대조·실험안은 ${e.channel}의 서로 다른 안 id여야 합니다(${e.control}/${e.treatment}).`)]:[]),
    ...((COPY_PACK_METRICS as string[]).includes(e.metric)?[]:[error('experiment_metric',`${at}: 지표는 ${COPY_PACK_METRICS.join('·')} 중 하나입니다(${e.metric||'없음'}).`)]),
   ];
  }),
 ];
}
// 모델 원문 JSON의 copyPack 값을 읽는다. 알려진 필드만 새 객체로 옮기고(입력 불변) 규칙 위반을 issues로 돌려준다.
// 객체가 아니거나 버전이 다르면 pack은 null이다. 규칙 위반이 있어도 읽을 수 있으면 pack을 돌려준다(soft).
export function parseCopyPack(value:unknown):{pack:CopyPack|null;issues:CopyPackIssue[]}{
 const x=obj(value);
 if(!x)return {pack:null,issues:[error('copy_pack_missing','카피 팩(copyPack) 객체가 없습니다.')]};
 if(x.version!==COPY_PACK_VERSION)return {pack:null,issues:[error('copy_pack_version',`카피 팩 버전은 ${COPY_PACK_VERSION}이어야 합니다.`)]};
 const channels=list(x.channels).map(channelOf),shortform=shortformOf(x.shortform),experiments=list(x.experiments).map(experimentOf);
 const issues=[
  ...(Array.isArray(x.channels)&&inRange(channels.length,COPY_PACK_LIMITS.channels)?[]:[error('channel_count',`채널은 ${COPY_PACK_LIMITS.channels[0]}~${COPY_PACK_LIMITS.channels[1]}개입니다(${channels.length}개).`)]),
  ...channels.flatMap(variantIssues),
  ...shortformIssues(shortform),
  ...experimentIssues(experiments,channels),
 ];
 const keep=<T,>(items:T[])=>items.slice(0,KEEP.list);
 return {pack:{version:COPY_PACK_VERSION,channels:keep(channels).map(c=>({...c,variants:keep(c.variants)})),shortform:shortform&&{...shortform,scenes:keep(shortform.scenes)},experiments:keep(experiments)},issues};
}
// 브리프 채널(쉼표·빗금·줄바꿈으로 나눈 이름)이 팩 채널 이름에 없으면 경고만 남긴다. 매장 안내처럼 카피 팩 밖 채널도 있기 때문이다.
export function briefChannelIssues(pack:CopyPack|null|undefined,channels:string):CopyPackIssue[]{
 if(!pack)return [];
 const names=pack.channels.map(c=>compact(c.channel)).filter(Boolean);
 const brief=[...new Set(String(channels||'').split(/[,，/\n·]+/).map(s=>s.trim()).filter(Boolean))];
 return brief.filter(b=>!names.some(n=>n.includes(compact(b))||compact(b).includes(n))).map(b=>({level:'warn' as const,code:'brief_channel_missing',message:`브리프 채널 ${b.slice(0,40)}의 카피 안이 없습니다.`}));
}

// 렌더: 계약 섹션 앞에 넣는 마크다운. 카피 안은 '#### 카피 안 A' 제목 아래 목록 줄(훅·본문·CTA)이라 캡션 후보(copyBlocks)는 안마다 한 덩어리가 되고,
// 채점기의 카피 구역 라벨(카피)과 거절 사실·광고 표현 검사가 본문 문장을 그대로 본다. 확인 필요 항목은 제목에만 적어 캡션에 섞이지 않게 한다.
const cell=(s:string)=>s.replace(/\|/g,'／').replace(/\s*\n\s*/g,' ').trim()||'-';
const bullets=(s:string)=>s.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>`- ${l}`);
function variantMarkdown(v:CopyVariant){
 const heading=[`#### 카피 안 ${v.id||'?'}`,v.angle,v.needsCheck?.length?`확인 필요: ${v.needsCheck.join(', ')}`:''].filter(Boolean).join(' · ');
 return [heading,'',...bullets(v.hook),...bullets(v.body),...bullets(v.cta)].join('\n');
}
function channelMarkdown(c:CopyChannel){
 const heading=[`### ${c.channel||'채널 미정'}`,c.purpose,c.destination?`목적지 ${c.destination}`:''].filter(Boolean).join(' · ');
 return [heading,...c.variants.map(variantMarkdown)].join('\n\n');
}
function scenesMarkdown(s:Shortform|null){
 if(!s||!s.scenes.length)return '';
 const rows=s.scenes.map(x=>`| ${x.start}–${x.end}초 | ${cell(x.visual)} | ${cell(x.line)} | ${cell(x.caption)} | ${cell(x.sound)} | ${cell(x.transition)} |`);
 return [`### 숏폼 장면표 · ${s.channel||'채널 미정'} · ${s.durationSec}초`,'','| 구간 | 화면 | 대사 | 자막 | 소리 | 전환 |','|---|---|---|---|---|---|',...rows].join('\n');
}
function experimentsMarkdown(experiments:CopyExperiment[]){
 if(!experiments.length)return '';
 const label=(m:string)=>m in learningMetrics?`${learningMetrics[m as LearningMetric].label}(${m})`:m;
 return ['### 제안 실험','',...experiments.map((e,i)=>`- 실험 ${i+1}: ${e.title} (${e.channel}) — 가설: ${cell(e.hypothesis)} · 바꿀 요소: ${e.variable} · 대조: 안 ${e.control} · 실험: 안 ${e.treatment} · 고정: ${cell(e.fixed)} · 지표: ${label(e.metric)}`)].join('\n');
}
// 계약 섹션 id → 그 섹션 앞에 넣을 팩 렌더본. output_3(랜딩)은 팩이 없다.
export function renderCopyPack(pack:CopyPack):Record<string,string>{
 return {output_1:pack.channels.map(channelMarkdown).join('\n\n'),output_2:scenesMarkdown(pack.shortform),output_4:experimentsMarkdown(pack.experiments)};
}

// 출력 계약 지시(lib/role-instruction.ts)가 v2일 때만 덧붙이는 팩 스키마·규칙 문장. 코드 소유이며 레지스트리 본문이 덮어쓸 수 없다(lib/prompt-units.ts copypack 표지).
export const copyPackSchema='copyPack:{version:"copy-pack-v2",channels:[{channel:"채널 이름",purpose:"용도",destination:"연결 목적지",variants:[{id:"A",angle:"설득 각도",hook:"훅",body:"본문",cta:"CTA 하나",needsCheck:["확인할 항목"]}]}],shortform:{channel:"숏폼 채널",durationSec:15,scenes:[{start:0,end:3,visual:"화면",line:"대사",caption:"자막",sound:"소리",transition:"전환"}]},experiments:[{title:"실험 이름",channel:"channels의 채널 이름",hypothesis:"가설",variable:"바꿀 요소 하나",control:"대조 안 id",treatment:"실험 안 id",fixed:"고정할 요소",metric:"share_rate|completion_rate|click_rate"}]}';
export const copyPackInstruction=` 카피 팩 규칙: channels는 1~4개이고 브리프 채널을 우선합니다. 채널마다 variants를 3~5안 쓰고 안마다 훅과 본문이 서로 달라야 합니다(띄어쓰기·문장부호만 다른 안은 같은 안으로 셉니다). 안 id는 채널 안에서 겹치지 않게 A·B·C 순서로 씁니다. hook은 ${COPY_PACK_LIMITS.hook}자, body는 ${COPY_PACK_LIMITS.body.toLocaleString('en-US')}자, cta는 ${COPY_PACK_LIMITS.cta}자 이하이고 CTA는 하나만 씁니다. 검증되지 않은 가격·효능은 문안에 [확인 필요]로 두고 needsCheck에 항목 이름을 적습니다. shortform.scenes는 3~10개이며 0초에서 시작해 빈틈 없이 이어지고 마지막 end가 durationSec(6~60초)와 같아야 합니다. experiments는 1~3개이고 control·treatment는 같은 channel의 서로 다른 안 id, metric은 share_rate·completion_rate·click_rate 중 하나입니다. 시스템이 팩을 output_1(채널별 카피 안)·output_2(장면표)·output_4(실험) 앞에 붙이므로 sections에는 팩 문안을 반복하지 말고 채널별 용도·선택 이유, 편집 메모, 랜딩 문안, 실험 선택 이유를 짧게 쓰세요.`;
