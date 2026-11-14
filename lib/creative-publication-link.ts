// 작업물 판 ↔ 발행 ↔ 게시 뒤 관측 연결(G2 자동 보정, docs/CREATIVE-SCORE.ko.md 4절). 순수 함수만 둔다(시계는 인자로 받는다).
// 연결 1행(artifact_publication_link, id 발행 id, parent 캠페인): 어떤 작업물 판의 카피로 만든 발행인지, 게시 채널, 외부 게시물 ID(알 때),
// 게시 시각(게시 확인 때), 그 외부 ID로 수집한 마지막 관측(분모·분자)을 담는다. 보정표는 연결 관측과 같은 판의 점수를 합쳐 만든다(lib/creative-calibration.ts).
import type {Publication} from './execution';
import type {CalibrationObservation} from './creative-calibration';

export type LinkChannel='buffer'|'instagram_direct'|'threads'|'meta';
// 관측: impressions = 분모(Instagram 미디어 인사이트는 도달 reach, Meta 광고는 노출), clicks = 분자(Instagram은 공유 shares, Meta는 클릭).
// definition에 실제 정의를 적고, 보정표의 관측 비율은 이 두 값의 비율이다. 원천 값이 누적이면 마지막 수집 값으로 덮는다.
export type LinkMetrics={impressions:number;clicks:number;source:'measurement'|'meta_insights';definition:string;observedAt:string};
export type ArtifactPublicationLink={id:string;artifactId:string;artifactVersion:number;publicationId:string;campaignId:string;brandId:string;channel:LinkChannel;externalId:string|null;publishedAt:string|null;metrics:LinkMetrics|null;createdAt:string;updatedAt:string};
export type LinkScore={artifactId:string;artifactVersion:number;brandId:string;channel:string;score:number;band:string;components:readonly {key:string;points:number;max:number}[]};

const DIRECT=/^(instagram_direct|threads):\d+$/;
export const META_LINK_PREFIX='meta:';
export const linkChannelOf=(p:Pick<Publication,'channelId'>):LinkChannel=>{const m=DIRECT.exec(p.channelId??'');return m?m[1] as LinkChannel:'buffer'};
// 외부 게시물 ID: 직접 게시는 게시 확인된 공급자 ID(Instagram 미디어 ID·Threads 게시물 ID), Buffer 발행은 관리자가 적은 Instagram 게시물 ID(link_media)다.
// Buffer 게시 번호(providerId)는 Buffer 내부 번호라 관측 대상이 아니다.
export function externalIdOf(p:Pick<Publication,'channelId'|'providerId'|'status'|'media'>):string|null{
 const channel=linkChannelOf(p);
 if(channel!=='buffer')return p.status==='published'&&p.providerId?p.providerId:null;
 return p.media?.mediaId??null;
}
export const publishedAtOf=(p:Pick<Publication,'status'|'scheduledAt'|'attemptedAt'>):string|null=>p.status==='published'?(p.attemptedAt&&p.attemptedAt>p.scheduledAt?p.attemptedAt:p.scheduledAt)||null:null;

// 발행 → 연결. 작업물 카피(copy)가 없는 발행(직접 쓴 캡션)은 null이다. 이전 연결의 관측·생성 시각은 그대로 둔다.
export function linkFromPublication(p:Publication,brandId:string,now:string,previous?:ArtifactPublicationLink|null):ArtifactPublicationLink|null{
 if(!p.copy?.artifactId||!Number.isSafeInteger(p.copy.artifactVersion))return null;
 const base={id:p.id,artifactId:p.copy.artifactId,artifactVersion:p.copy.artifactVersion,publicationId:p.id,campaignId:p.campaignId,brandId,channel:linkChannelOf(p),externalId:externalIdOf(p)??previous?.externalId??null,publishedAt:publishedAtOf(p)??previous?.publishedAt??null};
 const metrics=previous&&previous.externalId===base.externalId?previous.metrics:null;
 return {...base,metrics,createdAt:previous?.createdAt??now,updatedAt:now};
}
// Meta 광고는 작업물 판을 기록하지 않는 소재(실행 소재 PNG·검수 카피)로 만들어져 자동 연결이 없다. 대표·관리자가 광고 ID와 작업물 판을 직접 잇는다.
export function metaLink(input:{artifactId:string;artifactVersion:number;campaignId:string;brandId:string;adId:string;publishedAt:string},now:string,previous?:ArtifactPublicationLink|null):ArtifactPublicationLink{
 const id=META_LINK_PREFIX+input.adId;
 return {id,artifactId:input.artifactId,artifactVersion:input.artifactVersion,publicationId:id,campaignId:input.campaignId,brandId:input.brandId,channel:'meta',externalId:input.adId,publishedAt:input.publishedAt,metrics:previous?.metrics??null,createdAt:previous?.createdAt??now,updatedAt:now};
}
// 쓸지 판정: 갱신 시각만 다르면 같은 연결이다(멱등, 쓰기 0회).
const essence=(l:ArtifactPublicationLink)=>JSON.stringify({...l,createdAt:'',updatedAt:''});
export const sameLink=(a:ArtifactPublicationLink|null|undefined,b:ArtifactPublicationLink)=>!!a&&essence(a)===essence(b);
export const withMetrics=(l:ArtifactPublicationLink,metrics:LinkMetrics,now:string):ArtifactPublicationLink=>({...l,metrics,updatedAt:now});
export const sameMetrics=(a:LinkMetrics|null,b:LinkMetrics)=>!!a&&a.impressions===b.impressions&&a.clicks===b.clicks&&a.source===b.source&&a.definition===b.definition;

// 측정 수집 arm(분모·분자) → 관측. 둘 중 하나라도 없거나 분자가 분모보다 크면 관측으로 쓰지 않는다.
export function metricsFromArm(arm:{denominator:number|null;numerator:number|null}|undefined|null,definition:string,observedAt:string):LinkMetrics|null{
 if(!arm||!Number.isSafeInteger(arm.denominator)||!Number.isSafeInteger(arm.numerator))return null;
 const impressions=arm.denominator as number,clicks=arm.numerator as number;
 if(impressions<0||clicks<0||clicks>impressions)return null;
 return {impressions,clicks,source:'measurement',definition:definition.slice(0,300),observedAt};
}
// Meta 성과 행(날짜×광고) → 광고별 합계 관측(노출·클릭).
export function metricsFromMetaRows(rows:readonly {adId:string;impressions:number;clicks:number}[],adId:string,observedAt:string):LinkMetrics|null{
 const mine=rows.filter(r=>r.adId===adId);
 if(!mine.length)return null;
 const impressions=mine.reduce((n,r)=>n+r.impressions,0),clicks=mine.reduce((n,r)=>n+r.clicks,0);
 if(clicks>impressions)return null;
 return {impressions,clicks,source:'meta_insights',definition:'Meta 광고 노출 대비 클릭(기간 합계, 귀속 기준은 성과 보고서 참고)',observedAt};
}

// 연결 관측 + 같은 작업물 판의 점수 → 브랜드×점수 채널별 관측 묶음. 관측·게시 시각이 없거나 같은 판의 점수가 없으면 뺀다(missing).
export type LinkedGroup={brandId:string;channel:string;observations:CalibrationObservation[]};
export function linkedObservations(links:readonly ArtifactPublicationLink[],scores:readonly LinkScore[]){
 const groups=new Map<string,LinkedGroup>();let missingScore=0,missingMetrics=0;
 const byVersion=new Map(scores.map(s=>[`${s.artifactId}:${s.artifactVersion}`,s] as const));
 for(const l of [...links].sort((a,b)=>a.id.localeCompare(b.id))){
  if(!l.metrics||!l.publishedAt){missingMetrics++;continue}
  const s=byVersion.get(`${l.artifactId}:${l.artifactVersion}`);
  if(!s||s.brandId!==l.brandId){missingScore++;continue}
  const key=`${s.brandId}\u0000${s.channel}`,group=groups.get(key)??{brandId:s.brandId,channel:s.channel,observations:[]};
  groups.set(key,{...group,observations:[...group.observations,{artifactId:`${l.artifactId}@${l.publicationId}`,score:s.score,band:s.band,components:s.components.map(c=>({key:c.key,points:c.points,max:c.max})),publishedAt:l.publishedAt,impressions:l.metrics.impressions,clicks:l.metrics.clicks}]});
 }
 return {groups:[...groups.values()].sort((a,b)=>a.brandId.localeCompare(b.brandId)||a.channel.localeCompare(b.channel)),missingScore,missingMetrics};
}
