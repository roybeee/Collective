import type {Campaign} from './agency';
import type {CopyExperiment,CopyPack,CopyPackArtifact,CopyVariant} from './copy-pack';
import {artifactUsable} from './role-output';
import {learningChannels,learningMetrics,type LearningMetric,type ViralExperiment} from './learning';
import {channelAliases} from './channels';

// A3-3a 작업물 제안 실험: 승인된 콘텐츠 작업물의 카피 팩 제안 실험(copyPack.experiments[index])을 바이럴 실험 초안으로 옮기는 순수 판정.
// 서버(lib/learning-server.ts create_experiment_from_artifact)와 화면(app/learning-panel.tsx)이 같은 판정·문구를 쓴다. 규칙과 근거는 docs/COPY-PACK.ko.md A3-3 절.
// 같은 작업물·판·제안 번호는 같은 실험 id다(멱등). 판이 바뀌면 새 id가 되지만 사람이 고친 판에는 팩이 없어 만들 수 없다.
export const artifactExperimentId=(artifactId:string,artifactVersion:number,index:number)=>`artifact:${artifactId}:${artifactVersion}:${index}`;
type Arms={control:CopyVariant;treatment:CopyVariant};
function packArms(pack:CopyPack,e:CopyExperiment):Arms|null{
 const variants=pack.channels.find(c=>c.channel&&c.channel===e.channel)?.variants??[],control=variants.find(v=>v.id===e.control),treatment=variants.find(v=>v.id===e.treatment);
 return control&&treatment&&control!==treatment?{control,treatment}:null;
}
// 실험을 만들 수 없는 이유(없으면 null). 모두 409 사유다: 콘텐츠 역할·승인·현재 브리프(artifactUsable)·팩 있음·팩 판 = 작업물 판·error 문제 없음·제안 번호 범위.
export function artifactExperimentProblem(a:CopyPackArtifact,campaignVersion:number,index:number):string|null{
 if(a.role!=='content')return '콘텐츠 역할 작업물의 카피 팩만 실험으로 옮길 수 있습니다.';
 if(a.status!=='approved')return '승인된 작업물만 실험으로 옮길 수 있습니다. 작업물을 검토해 승인한 뒤 만드세요.';
 if(!artifactUsable(a,campaignVersion))return '현재 브리프 버전의 작업물이 아닙니다. 새 브리프로 만든 작업물을 승인한 뒤 실험을 만드세요.';
 const pack=a.copyPack;
 if(!pack)return '이 작업물에는 카피 팩이 없습니다.';
 if(a.copyPackArtifactVersion!==a.version)return `카피 팩은 작업물 v${a.copyPackArtifactVersion??'?'}의 것이고 지금 작업물은 v${a.version}입니다. 사람이 고치거나 개선한 판의 팩이 아니라 실험으로 옮길 수 없습니다.`;
 if(a.copyPackIssues?.some(i=>i.level==='error'))return '카피 팩에 형식 오류가 있어 실험으로 옮길 수 없습니다.';
 const e=pack.experiments[index];
 if(!e)return `제안 실험 ${index+1}번이 없습니다(이 팩의 제안 실험 ${pack.experiments.length}개).`;
 if(!Object.hasOwn(learningMetrics,e.metric))return '제안 실험의 지표가 바이럴 3지표가 아닙니다.';
 return packArms(pack,e)?null:'제안 실험의 대조·실험안을 팩에서 찾을 수 없습니다.';
}
// 안 id 대신 그 채널의 실제 문안(훅·본문·CTA, 확인 필요 항목)을 싣는다. 실험 카드만 보고도 두 안이 무엇인지 알 수 있게 한다.
function armText(v:CopyVariant){
 return [`안 ${v.id}${v.angle?` · ${v.angle}`:''}`,`훅: ${v.hook}`,`본문: ${v.body}`,`CTA: ${v.cta}`,...(v.needsCheck?.length?[`확인 필요: ${v.needsCheck.join(', ')}`]:[])].join('\n').slice(0,6000);
}
// 팩 채널 이름(예: 'Instagram 피드')을 학습 채널로 읽는다. 읽지 못하면 앱이 발행·수집하는 Instagram이다(검증 채널 기본값과 같은 결).
export function packVerifyChannel(packChannel:string){
 const text=packChannel.toLowerCase();
 return learningChannels.find(name=>channelAliases(name).some(x=>text.includes(x)))??'Instagram';
}
export type ArtifactExperimentDraft={title:string;hypothesis:string;variable:string;control:string;treatment:string;metric:LearningMetric;fixed:string;packChannel:string;verifyChannel:string};
// 판정(artifactExperimentProblem)을 통과한 작업물에서만 부른다.
export function artifactExperimentDraft(a:CopyPackArtifact,index:number):ArtifactExperimentDraft{
 const pack=a.copyPack as CopyPack,e=pack.experiments[index],arms=packArms(pack,e) as Arms;
 return {title:e.title,hypothesis:e.hypothesis,variable:e.variable,control:armText(arms.control),treatment:armText(arms.treatment),metric:e.metric as LearningMetric,fixed:e.fixed,packChannel:e.channel,verifyChannel:packVerifyChannel(e.channel)};
}
// 동일 조건 기본값: 제안 실험의 고정 요소(fixed), 없으면 한 요소만 바꾸는 표준 문장. 요청에 조건을 적으면 그것을 쓴다.
export const artifactConditions=(d:Pick<ArtifactExperimentDraft,'fixed'>)=>d.fixed?`고정: ${d.fixed}`.slice(0,6000):'동일 채널·타깃·관찰 길이·예산을 유지하고, 제안 실험이 바꾸는 요소 하나만 변경합니다.';
// 실험 카드의 출처 줄. 사례 기반 실험(source 없음)은 빈 문자열이다.
export function experimentOrigin(e:Pick<ViralExperiment,'source'>){
 const s=e.source;
 return s?.kind==='artifact'?`작업물 제안 실험 · 작업물 v${s.artifactVersion} · 제안 ${s.index+1}`:'';
}
// 학습 화면의 '작업물 제안 실험' 목록: 브랜드 캠페인의 콘텐츠 작업물 중 카피 팩이 있는 것의 제안 실험마다 한 줄. problem이 있으면 만들기 버튼을 끄고 사유를 보인다.
export type ArtifactExperimentOption={artifactId:string;artifactVersion:number;artifactTitle:string;campaignId:string;index:number;title:string;packChannel:string;verifyChannel:string;metric:string;experimentId:string;problem:string|null;draft:ArtifactExperimentDraft|null};
export function artifactExperimentOptions(artifacts:readonly CopyPackArtifact[],campaigns:readonly Pick<Campaign,'id'|'brandId'|'version'>[],brandId:string):ArtifactExperimentOption[]{
 return artifacts.flatMap(a=>{
  const c=campaigns.find(x=>x.id===a.campaignId);
  if(!c||c.brandId!==brandId||a.role!=='content'||!a.copyPack)return [];
  return a.copyPack.experiments.map((e,index)=>{
   const problem=artifactExperimentProblem(a,c.version,index);
   return {artifactId:a.id,artifactVersion:a.version,artifactTitle:a.title,campaignId:c.id,index,title:e.title,packChannel:e.channel,verifyChannel:packVerifyChannel(e.channel),metric:e.metric,experimentId:artifactExperimentId(a.id,a.version,index),problem,draft:problem?null:artifactExperimentDraft(a,index)};
  });
 });
}
