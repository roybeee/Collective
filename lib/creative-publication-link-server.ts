// 작업물 판 ↔ 발행 ↔ 관측 연결 서버(G2 자동 보정, docs/CREATIVE-SCORE.ko.md 4절). 스위치 creative_score(기본 꺼짐)가 켜졌을 때만 쓴다.
// - 기록: 발행 준비·직접 게시·게시물 ID 입력 뒤 라우트가 recordPublicationLink를 부른다(작업물 카피로 만든 발행만). 예외를 던지지 않는다.
// - 관측 붙이기: 측정 수집(lib/measurement-collection.ts)과 Meta 성과 저장(app/api/meta-ads/insights)이 외부 ID로 관측을 남기면 같은 외부 ID의 연결에 붙인다.
// - 보정: 워커 하루 정리 단계(lib/research-worker.ts)가 runCreativeCalibrationMaintenance를 부르고, 7일에 한 번 연결을 다시 맞춘 뒤(백필)
//   브랜드×채널 보정표(creative_calibration)를 연결 관측으로 다시 계산한다. 표 내용이 같으면 쓰지 않는다(멱등). 모델·외부 호출은 없다.
import {ApiError,database,listRecords,readRecord,recordStatement,stamp,str} from './server';
import {isEnabled} from './feature-flags';
import {buildCalibration,type CalibrationTable} from './creative-calibration';
import {linkFromPublication,linkedObservations,metaLink,metricsFromArm,metricsFromMetaRows,sameLink,sameMetrics,withMetrics,type ArtifactPublicationLink,type LinkChannel,type LinkMetrics,type LinkScore} from './creative-publication-link';
import type {Publication} from './execution';
import type {Artifact,Campaign} from './agency';
import type {MeasurementDraft} from './measurement-collection';
import type {MetaInsightReport} from './meta-insights';

export const CALIBRATION_RUN_EVERY_MS=7*86400000;
const MAX_SCAN=5000;
type StoredTable=CalibrationTable&{source?:'linked'|'manual'};
type RunState={id:'current';lastRunAt:string;groups:number;written:number;links:number};

async function switchedOn(owner:string){try{return await isEnabled(owner,'creative_score')}catch{console.error('creative_link_flag_unreadable');return false}}
const optional=async<T>(task:Promise<T>)=>{try{return await task}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}};
const readLink=(owner:string,id:string)=>optional(readRecord<ArtifactPublicationLink>(owner,'artifact_publication_link',id));
const writeLink=(owner:string,l:ArtifactPublicationLink)=>recordStatement(owner,'artifact_publication_link',l.id,l,l.campaignId);

// 발행 1건의 연결을 맞춘다. 바뀐 것이 없으면 쓰지 않는다. 반환: 'linked'(새로·바꿔 씀) | 'same' | 'skipped'(카피 없음).
async function syncPublication(owner:string,p:Publication,brandId:string,now:string){
 const previous=await readLink(owner,p.id),next=linkFromPublication(p,brandId,now,previous);
 if(!next)return 'skipped' as const;
 if(sameLink(previous,next))return 'same' as const;
 await writeLink(owner,next).run();
 return 'linked' as const;
}
// 라우트 훅: 스위치가 꺼져 있으면 스위치 1행만 읽는다. 어떤 예외도 던지지 않는다(발행 응답을 막지 않는다).
export async function recordPublicationLink(owner:string,value:unknown){
 try{
  // 라우트 응답 모양 그대로 받는다: 발행 자체 또는 {publication}(link_media·link_experiment).
  const p=(value&&typeof value==='object'&&'publication' in value?(value as {publication:unknown}).publication:value) as Publication|null;
  if(!p||typeof p!=='object'||typeof p.id!=='string'||!p.copy?.artifactId||!await switchedOn(owner))return 'skipped';
  const campaign=await readRecord<Campaign>(owner,'campaign',p.campaignId);
  return await syncPublication(owner,p,campaign.brandId,stamp());
 }catch{console.error('creative_link_error');return 'error'}
}

// 외부 ID로 관측을 붙인다. 같은 관측이면 쓰지 않는다. 반환: 바꾼 연결 수.
async function attach(owner:string,channels:readonly LinkChannel[],externalId:string,metrics:LinkMetrics){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='artifact_publication_link' AND json_extract(data,'$.externalId')=?").bind(owner,externalId).all<{data:string}>();
 const targets=rows.results.map(r=>JSON.parse(r.data) as ArtifactPublicationLink).filter(l=>channels.includes(l.channel)&&!sameMetrics(l.metrics,metrics));
 if(targets.length)await database().batch(targets.map(l=>writeLink(owner,withMetrics(l,metrics,stamp()))));
 return targets.length;
}
const connectorChannels:Record<string,readonly LinkChannel[]>={instagram:['buffer','instagram_direct'],threads:['threads']};
// 측정 수집 훅(collectForExperiment 저장 뒤): 스위치 꺼짐이면 아무것도 하지 않는다. 예외를 던지지 않는다.
export async function attachMeasurement(owner:string,input:{connector:string;target:string;arm:{denominator:number|null;numerator:number|null}|null|undefined;definition:string;fetchedAt:string}){
 try{
  const channels=connectorChannels[input.connector],metrics=metricsFromArm(input.arm,input.definition,input.fetchedAt);
  if(!channels||!metrics||!input.target||!await switchedOn(owner))return 0;
  return await attach(owner,channels,input.target,metrics);
 }catch{console.error('creative_link_error');return 0}
}
// Meta 성과 저장 훅: 보고서의 광고 ID마다 Meta 연결에 기간 합계를 붙인다. 예외를 던지지 않는다.
export async function attachMetaInsights(owner:string,report:Pick<MetaInsightReport,'rows'|'collectedAt'>){
 try{
  if(!report.rows.length||!await switchedOn(owner))return 0;
  let changed=0;
  for(const adId of [...new Set(report.rows.map(r=>r.adId))].sort()){const m=metricsFromMetaRows(report.rows,adId,report.collectedAt);if(m)changed+=await attach(owner,['meta'],adId,m)}
  return changed;
 }catch{console.error('creative_link_error');return 0}
}

// 대표·관리자: Meta 광고 ID를 작업물 판에 잇는다(Meta 소재에는 작업물 판 기록이 없다). 같은 광고 ID를 다시 이으면 덮어쓴다.
export async function linkMetaAd(owner:string,input:Record<string,unknown>){
 if(!await switchedOn(owner))throw new ApiError(409,'소재 예측 점수 스위치가 꺼져 있습니다. 소유자가 켠 뒤 연결하세요.');
 const artifactId=str(input.artifactId,'작업물',200,true),adId=str(input.adId,'Meta 광고 ID',30,true),publishedAt=str(input.publishedAt,'게시 시각',40,true);
 if(!/^\d{1,30}$/.test(adId))throw new ApiError(400,'Meta 광고 ID는 숫자입니다.');
 if(!Number.isFinite(Date.parse(publishedAt)))throw new ApiError(400,'게시 시각은 ISO 시각이어야 합니다.');
 const row=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='artifact'").bind(`${owner}:artifact:${artifactId}`,owner).first<{data:string}>();
 if(!row)throw new ApiError(404,'작업물을 찾을 수 없습니다.');
 const artifact=JSON.parse(row.data) as Artifact,version=input.artifactVersion===undefined?artifact.version:input.artifactVersion;
 if(!Number.isSafeInteger(version)||(version as number)<1||(version as number)>artifact.version)throw new ApiError(400,'작업물 판을 확인해 주세요.');
 const campaign=await readRecord<Campaign>(owner,'campaign',artifact.campaignId),previous=await readLink(owner,'meta:'+adId);
 const next=metaLink({artifactId,artifactVersion:version as number,campaignId:campaign.id,brandId:campaign.brandId,adId,publishedAt:new Date(publishedAt).toISOString()},stamp(),previous);
 if(!sameLink(previous,next))await writeLink(owner,next).run();
 const insights=await optional(readRecord<MetaInsightReport>(owner,'meta_ads_insights',campaign.id));
 if(insights)await attachMetaInsights(owner,insights);
 return {link:await readLink(owner,next.id),written:!sameLink(previous,next)};
}

// 백필: 기존 발행(작업물 카피가 있는 것)마다 연결을 맞추고, 이미 저장된 측정 초안·Meta 성과로 관측을 붙인다. 여러 번 돌려도 결과가 같다.
export async function backfillPublicationLinks(owner:string){
 const now=stamp(),brandOf=new Map((await listRecords<Campaign>(owner,'campaign')).map(c=>[c.id,c.brandId] as const));
 const pubs=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='execution_publication' AND json_extract(data,'$.copy.artifactId') IS NOT NULL ORDER BY id LIMIT ${MAX_SCAN}`).bind(owner).all<{data:string}>();
 const counts={scanned:pubs.results.length,linked:0,same:0,metrics:0};
 for(const r of pubs.results){
  const p=JSON.parse(r.data) as Publication,brandId=brandOf.get(p.campaignId);
  if(!brandId)continue;
  const result=await syncPublication(owner,p,brandId,now);
  if(result==='linked')counts.linked++;else if(result==='same')counts.same++;
 }
 for(const d of await listRecords<MeasurementDraft>(owner,'measurement_draft'))for(const arm of ['control','treatment'] as const){
  const entry=d.arms?.[arm],channels=connectorChannels[d.channel],m=entry?.target?metricsFromArm(entry.value,entry.definition,entry.fetchedAt):null;
  if(channels&&m&&entry?.target)counts.metrics+=await attach(owner,channels,entry.target,m);
 }
 for(const report of await listRecords<MetaInsightReport>(owner,'meta_ads_insights'))for(const adId of [...new Set(report.rows.map(r=>r.adId))].sort()){
  const m=metricsFromMetaRows(report.rows,adId,report.collectedAt);if(m)counts.metrics+=await attach(owner,['meta'],adId,m);
 }
 return counts;
}

type ScoreRow={artifactId:string;artifactVersion:number;brandId:string;channel:string;score:number;band:string;components:{key:string;points:number;max:number}[]};
const tableEssence=(t:StoredTable|null)=>t?JSON.stringify({...t,computedAt:''}):'';
// 연결 관측으로 브랜드×채널 표를 다시 계산한다. 내용이 같으면 쓰지 않는다. 사람이 만든 표(source 없음·manual)는 연결 관측이 부족(insufficient)하면 덮지 않는다.
export async function recomputeLinkedCalibrations(owner:string,now=stamp()){
 const [links,scores]=await Promise.all([listRecords<ArtifactPublicationLink>(owner,'artifact_publication_link'),listRecords<ScoreRow>(owner,'creative_score')]);
 const pairs:LinkScore[]=scores.map(s=>({artifactId:s.artifactId,artifactVersion:s.artifactVersion,brandId:s.brandId,channel:s.channel,score:s.score,band:s.band,components:s.components}));
 const {groups,missingScore,missingMetrics}=linkedObservations(links,pairs);
 let written=0;const tables:StoredTable[]=[];
 for(const g of groups){
  const id=`${g.brandId}:${g.channel}`,existing=await optional(readRecord<StoredTable>(owner,'creative_calibration',id));
  const table:StoredTable={...buildCalibration({brandId:g.brandId,channel:g.channel,observations:g.observations,now}),source:'linked'};
  if(existing&&existing.source!=='linked'&&table.status==='insufficient')continue;
  const same=!!existing&&existing.source==='linked'&&tableEssence(existing)===tableEssence({...table,computedAt:existing.computedAt});
  if(same){tables.push(existing);continue}
  await recordStatement(owner,'creative_calibration',id,table,g.brandId).run();written++;tables.push(table);
 }
 return {groups:groups.length,written,links:links.length,missingScore,missingMetrics,tables};
}

// 워커 하루 정리 단계: 스위치 꺼짐이면 스위치 1행만 읽는다. 마지막 실행 뒤 7일이 안 됐으면 실행 상태 1행만 읽는다. 예외를 던지지 않는다.
export async function runCreativeCalibrationMaintenance(owner:string,nowMs=Date.now()){
 try{
  if(!await switchedOn(owner))return {status:'idle' as const,reason:'switch_off'};
  const run=await optional(readRecord<RunState>(owner,'creative_calibration_run','current'));
  if(run&&nowMs-Date.parse(run.lastRunAt)<CALIBRATION_RUN_EVERY_MS)return {status:'idle' as const,reason:'not_due'};
  const backfill=await backfillPublicationLinks(owner),now=new Date(nowMs).toISOString(),result=await recomputeLinkedCalibrations(owner,now);
  const state:RunState={id:'current',lastRunAt:now,groups:result.groups,written:result.written,links:result.links};
  await recordStatement(owner,'creative_calibration_run','current',state).run();
  return {status:'processed' as const,backfill,groups:result.groups,written:result.written};
 }catch{console.error('creative_calibration_run_error');return {status:'idle' as const,reason:'error'}}
}
// 대표·관리자가 바로 다시 맞출 때(POST calibrate_linked): 7일 간격을 기다리지 않는다. 스위치 꺼짐 409.
export async function calibrateFromLinks(owner:string){
 if(!await switchedOn(owner))throw new ApiError(409,'소재 예측 점수 스위치가 꺼져 있습니다. 소유자가 켠 뒤 다시 계산하세요.');
 const backfill=await backfillPublicationLinks(owner),result=await recomputeLinkedCalibrations(owner);
 return {backfill,groups:result.groups,written:result.written,missingScore:result.missingScore,missingMetrics:result.missingMetrics,tables:result.tables};
}
