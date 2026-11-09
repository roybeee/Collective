// 소재 예측 점수 서버(G2, docs/CREATIVE-SCORE.ko.md). 작업물 한 판(id:버전)마다 creative_score 레코드를 쓴다(parent=캠페인, 캠페인과 함께 삭제).
// 멱등: 본문·채널·사실·말투·규칙·규제 사전·보정표를 묶은 입력 해시(inputHash)가 같으면 다시 쓰지 않는다. 규칙 집합이 바뀌면 해시가 달라져 새로 쓴다.
// 자동 실행은 기능 스위치 creative_score(기본 꺼짐)가 켜졌을 때만 온라인 채점 경로(lib/online-grading.ts gradeSavedArtifacts)가 scoreSavedArtifacts를 부른다.
// 비차단: 어떤 예외도 던지지 않고 로그 'creative_score_error' 1줄만 남긴다. 모델·외부 호출은 없다.
// 사후 보정(creative_calibration, parent=브랜드, 캠페인과 무관): 호출자가 넘긴 게시 뒤 관측(노출·클릭)을 저장된 점수와 합쳐 브랜드×채널 표를 만든다. 자동 수집 연결은 이 판에 없다.
import {database,readRecord,listRecords,recordStatement,stamp,ApiError,str} from './server';
import {isEnabled} from './feature-flags';
import {scoreCreative,primaryChannel,CREATIVE_SCORE_VERSION,type CreativeScore,type ScoreRule} from './creative-score';
import {buildCalibration,CALIBRATION_VERSION,type CalibrationObservation,type CalibrationTable} from './creative-calibration';
import {checkCompliance,type ComplianceReport} from './graders/compliance';
import {COMPLIANCE_LEXICON} from './graders/compliance-lexicon';
import {scopedBrandFacts,type BrandFact} from './brand-facts';
import {ruleApplies,type LearningRule} from './learning';
import type {BrandVoice} from './brand-voice';
import type {Artifact,Campaign} from './agency';
import type {Publication} from './execution';

export type CreativeScoreRecord=CreativeScore&{id:string;artifactId:string;artifactVersion:number;campaignId:string;brandId:string;channel:string;inputHash:string;rulesVersion:string;ruleIds:string[];computedAt:string};
export const creativeScoreId=(artifactId:string,version:number)=>`${artifactId}:${version}`;
export const calibrationId=(brandId:string,channel:string)=>`${brandId}:${channel}`;
const MAX_RECENT=10,MAX_OBSERVATIONS=2000;

const optional=async<T>(task:Promise<T>)=>{try{return await task}catch(error){if(error instanceof ApiError&&error.status===404)return null;throw error}};
async function sha256(text:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
 return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function artifactById(owner:string,artifactId:string){
 const row=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='artifact'").bind(`${owner}:artifact:${artifactId}`,owner).first<{data:string}>();
 if(!row)throw new ApiError(404,'작업물을 찾을 수 없습니다.');
 return JSON.parse(row.data) as Artifact;
}
// 최근 게시물: 같은 브랜드 캠페인의 발행 캡션(최신 10건). 발행이 없으면 같은 캠페인의 승인 작업물(자기 자신 제외) 본문이다.
async function recentTexts(owner:string,campaign:Campaign,artifact:Artifact){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='execution_publication' ORDER BY updated_at DESC LIMIT 60").bind(owner).all<{data:string}>();
 const brandCampaigns=new Set((await listRecords<Campaign>(owner,'campaign')).filter(c=>c.brandId===campaign.brandId).map(c=>c.id));
 const captions=rows.results.map(r=>JSON.parse(r.data) as Publication).filter(p=>brandCampaigns.has(p.campaignId)&&typeof p.caption==='string'&&p.caption.trim()).slice(0,MAX_RECENT).map(p=>({id:`발행 ${p.id}`,text:p.caption}));
 if(captions.length)return captions;
 return (await listRecords<Artifact>(owner,'artifact',campaign.id)).filter(a=>a.id!==artifact.id&&a.status==='approved'&&a.role===artifact.role).slice(0,MAX_RECENT).map(a=>({id:`작업물 ${a.id} v${a.version}`,text:a.content}));
}
const scoreRule=(r:LearningRule):ScoreRule=>({id:r.id,guidance:r.guidance,direction:r.direction});
type Gathered={channel:string;facts:ReturnType<typeof scopedBrandFacts>;voice:BrandVoice['confirmedVoice'];rules:LearningRule[];report:ComplianceReport;recent:{id:string;text:string}[];calibration:CalibrationTable|null};
async function gather(owner:string,campaign:Campaign,artifact:Artifact):Promise<Gathered>{
 const channel=primaryChannel(campaign.channels),now=Date.now();
 const [allFacts,voiceRow,allRules,calibration,recent]=await Promise.all([
  listRecords<BrandFact>(owner,'brand_fact',campaign.brandId),optional(readRecord<BrandVoice>(owner,'brand_voice',campaign.brandId)),listRecords<LearningRule>(owner,'learning_rule'),
  optional(readRecord<CalibrationTable>(owner,'creative_calibration',calibrationId(campaign.brandId,channel))),recentTexts(owner,campaign,artifact),
 ]);
 const facts=scopedBrandFacts(allFacts,campaign.brandId,campaign.storeId,now);
 // 범위: 같은 브랜드·채널 별칭·지점(storeId)·역할(role이 있는 규칙만) — lib/learning.ts ruleApplies와 같은 판정. id 순으로 고정해 해시가 순서에 흔들리지 않게 한다.
 const rules=allRules.filter(r=>ruleApplies(r,campaign.brandId,campaign.channels,now,campaign.storeId,artifact.role)).sort((a,b)=>a.id.localeCompare(b.id));
 const report=checkCompliance(artifact.content,{facts:{confirmed:facts.confirmed,prohibited:facts.prohibited}});
 return {channel,facts,voice:voiceRow?.confirmedVoice??null,rules,report,recent,calibration};
}
const rulesVersionOf=(g:Gathered)=>[CREATIVE_SCORE_VERSION,`lexicon:${COMPLIANCE_LEXICON.version}`,...g.rules.map(r=>`${r.id}@${r.version}`),g.calibration?`cal:${g.calibration.version}@${g.calibration.computedAt}`:'cal:none'].join('|');
function compute(artifact:Artifact,g:Gathered):CreativeScore{
 return scoreCreative({text:artifact.content,channel:g.channel,origin:artifact.origin,facts:{confirmed:g.facts.confirmed.map(f=>({key:f.key,value:f.value})),prohibited:g.facts.prohibited.map(f=>({key:f.key,value:f.value}))},
  voice:g.voice?{preferTerms:g.voice.preferTerms,avoidTerms:g.voice.avoidTerms}:null,rules:g.rules.map(scoreRule),compliance:{issues:g.report.issues.map(i=>({ruleId:i.ruleId,severity:i.severity,title:i.title}))},recent:g.recent,calibration:g.calibration});
}
// 한 작업물 판의 점수를 계산해 저장한다. 같은 입력 해시의 기록이 있으면 그대로 돌려준다(쓰기 0회). 반환값의 written은 실제로 썼는지다.
export async function scoreArtifactVersion(owner:string,artifact:Artifact):Promise<{record:CreativeScoreRecord;written:boolean}>{
 const campaign=await readRecord<Campaign>(owner,'campaign',artifact.campaignId),g=await gather(owner,campaign,artifact),rulesVersion=rulesVersionOf(g);
 const inputHash=await sha256(JSON.stringify({text:artifact.content,origin:artifact.origin,channel:g.channel,rulesVersion,facts:g.facts.confirmed.map(f=>[f.key,f.value]),prohibited:g.facts.prohibited.map(f=>[f.key,f.value]),voice:g.voice&&[g.voice.preferTerms,g.voice.avoidTerms],recent:g.recent.map(r=>r.text)}));
 const id=creativeScoreId(artifact.id,artifact.version),existing=await optional(readRecord<CreativeScoreRecord>(owner,'creative_score',id));
 if(existing&&existing.inputHash===inputHash)return {record:existing,written:false};
 const record:CreativeScoreRecord={...compute(artifact,g),id,artifactId:artifact.id,artifactVersion:artifact.version,campaignId:campaign.id,brandId:campaign.brandId,channel:g.channel,inputHash,rulesVersion,ruleIds:g.rules.map(r=>r.id),computedAt:stamp()};
 await recordStatement(owner,'creative_score',id,record,campaign.id).run();
 return {record,written:true};
}
async function switchedOn(owner:string){
 try{return await isEnabled(owner,'creative_score')}catch{console.error('creative_score_flag_unreadable');return false}
}
// 온라인 채점 경로가 저장 뒤 잠금 밖에서 부른다. 스위치가 꺼져 있으면 저장된 작업물을 읽지 않고 0을 돌려준다. 예외를 던지지 않는다.
export async function scoreSavedArtifacts(owner:string,targets:readonly Pick<Artifact,'id'|'version'>[]){
 try{
  if(!targets.length||!await switchedOn(owner))return 0;
  let scored=0;
  for(const t of targets){
   try{const a=await artifactById(owner,t.id);if(a.version===t.version){await scoreArtifactVersion(owner,a);scored++}}
   catch{console.error('creative_score_error')}
  }
  return scored;
 }catch{console.error('creative_score_error');return 0}
}
// GET /api/creative-score?artifactId=: 현재 판의 점수(없으면 null)와 스위치 상태. 다른 소유자의 작업물은 404다.
export async function artifactCreativeScore(owner:string,artifactId:string){
 const artifact=await artifactById(owner,artifactId);
 const record=await optional(readRecord<CreativeScoreRecord>(owner,'creative_score',creativeScoreId(artifact.id,artifact.version)));
 return {enabled:await switchedOn(owner),artifactId:artifact.id,artifactVersion:artifact.version,score:record};
}
// POST recompute: 스위치가 꺼져 있으면 409. 같은 입력이면 기록을 다시 쓰지 않는다.
export async function recomputeCreativeScore(owner:string,artifactId:string){
 if(!await switchedOn(owner))throw new ApiError(409,'소재 예측 점수 스위치가 꺼져 있습니다. 소유자가 켠 뒤 다시 계산하세요.');
 return scoreArtifactVersion(owner,await artifactById(owner,artifactId));
}
function observationInput(v:unknown,i:number){
 if(!v||typeof v!=='object'||Array.isArray(v))throw new ApiError(400,`${i+1}번째 관측 형식을 확인해 주세요.`);
 const o=v as Record<string,unknown>,artifactId=str(o.artifactId,`${i+1}번째 관측의 작업물`,200,true),publishedAt=str(o.publishedAt,`${i+1}번째 관측의 게시 시각`,40,true);
 if(!Number.isFinite(Date.parse(publishedAt)))throw new ApiError(400,`${i+1}번째 관측의 게시 시각은 ISO 시각이어야 합니다.`);
 const count=(x:unknown,label:string)=>{if(!Number.isInteger(x)||(x as number)<0||(x as number)>1e12)throw new ApiError(400,`${i+1}번째 관측의 ${label}은 0 이상의 정수여야 합니다.`);return x as number};
 const impressions=count(o.impressions,'노출'),clicks=count(o.clicks,'클릭');
 if(clicks>impressions)throw new ApiError(400,`${i+1}번째 관측의 클릭이 노출보다 많습니다.`);
 return {artifactId,publishedAt,impressions,clicks};
}
// POST calibrate: 관측(작업물 id·게시 시각·노출·클릭)을 저장된 점수(그 작업물의 가장 최근 판)와 합쳐 브랜드×채널 보정표를 쓴다. 점수가 없는 작업물의 관측은 뺀다(missing).
export async function calibrateCreativeScores(owner:string,input:Record<string,unknown>){
 const brandId=str(input.brandId,'브랜드',100,true),channel=str(input.channel,'채널',100,true);
 if(!Array.isArray(input.observations)||!input.observations.length||input.observations.length>MAX_OBSERVATIONS)throw new ApiError(400,`관측은 1~${MAX_OBSERVATIONS}건 배열로 보내세요.`);
 await readRecord(owner,'brand',brandId);
 const parsed=input.observations.map(observationInput);
 const scores=(await listRecords<CreativeScoreRecord>(owner,'creative_score')).filter(s=>s.brandId===brandId&&s.channel===channel).sort((a,b)=>b.artifactVersion-a.artifactVersion);
 const observations:CalibrationObservation[]=[],missing:string[]=[];
 for(const o of parsed){
  const s=scores.find(x=>x.artifactId===o.artifactId);
  if(!s){missing.push(o.artifactId);continue}
  observations.push({artifactId:o.artifactId,score:s.score,band:s.band,components:s.components.map(c=>({key:c.key,points:c.points,max:c.max})),publishedAt:o.publishedAt,impressions:o.impressions,clicks:o.clicks});
 }
 const table=buildCalibration({brandId,channel,observations,now:stamp()});
 await recordStatement(owner,'creative_calibration',calibrationId(brandId,channel),table,brandId).run();
 return {table,missing:[...new Set(missing)],version:CALIBRATION_VERSION};
}
export async function brandCalibration(owner:string,brandId:string,channel:string){
 await readRecord(owner,'brand',brandId);
 return optional(readRecord<CalibrationTable>(owner,'creative_calibration',calibrationId(brandId,channel)));
}
