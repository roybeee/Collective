// X7 신뢰 UI 읽기(GET /api/artifact-sources). 작업물 한 판의 인용 출처 지도·AI 출처 정보·규제 점검 보기를 저장된 기록에서만 만든다. 쓰기·모델 호출은 없다.
// 소유자 범위: 모든 읽기는 owner 조건이 붙은 기록 읽기다(다른 소유자의 작업물은 404).
// 인용 지도: 실행 기록의 idLabels(역할 실행=role_output_contract, 회의=회의 스냅샷 meetingLabels)를 거꾸로 읽어 라벨→원래 기록을 찾는다.
//  역할 작업물 id는 실행 id의 해시('ai-'+sha256 앞 32자, lib/role-execution.ts roleArtifactId)라 같은 캠페인·담당 실행 중 해시가 같은 실행을 찾는다.
//  확정 사실은 작업물의 factRefs(실행 입력에 쓴 확정 사실, 거절 제외)에서, 없으면 현재 캠페인 범위의 확정 사실에서 항목 이름을 읽는다.
// 규제 점검 보기: 온라인 채점(lib/online-grading.ts)과 같은 본문·사실 원장으로 checkCompliance를 다시 계산한다(결정론, 저장하지 않음). 저장된 채점 시각이 있으면 함께 싣는다.
import {database,readRecord,listRecords,stamp,ApiError} from './server';
import {roles,type Artifact,type Campaign} from './agency';
import type {BrandFact} from './brand-facts';
import type {ArchiveSource} from './archive';
import type {IdLabels} from './artifact-text';
import type {LearningRule} from './learning';
import {meetingLabels,type Meeting} from './meetings';
import {roleArtifactId} from './role-execution';
import {evidenceContext} from './ai-context';
import {checkCompliance,COMPLIANCE_LEXICON,COMPLIANCE_NOTICE} from './graders/compliance';
import {computeComplianceFixes,COMPLIANCE_FIX_NOTICE} from './graders/compliance-fixes';
import {isEnabled} from './feature-flags';
import {bodyOf} from './graders/text';
import type {FactLedger} from './graders/types';
import {MAX_GRADED_LINES} from './online-grading';
import {originLabel} from './review-decisions';
import {factLabel} from './fact-catalog';
import {isAiGenerated,AI_DISCLOSURE_LINE,VIRTUAL_PERSON_LINE} from './ai-disclosure';
import type {ArtifactSources,ArtifactScoreSummary,CitationSource,ComplianceView,OriginInfo} from './artifact-sources';
import {COMPLIANCE_CATEGORY_LABELS} from './artifact-sources';

type StoredArtifact=Artifact&{meetingId?:string};
type RunRecord={jobId:string|null;model:string|null;finishedAt:string|null;labels:IdLabels;learningRules:number|null;via:OriginInfo['via']};
async function optional<T>(task:Promise<T>):Promise<T|null>{
 try{return await task}catch(error){if(error instanceof ApiError&&error.status===404)return null;throw error}
}
const httpUrl=(value:unknown)=>typeof value==='string'&&/^https?:\/\//i.test(value)?value:null;
const text=(value:unknown)=>typeof value==='string'&&value?value:null;

// 역할 실행: 같은 캠페인·담당의 실행 중 작업물 id 해시가 같은 실행(최근 100건).
async function roleRun(owner:string,a:StoredArtifact):Promise<RunRecord|null>{
 const {results}=await database().prepare('SELECT id,model,updated_at FROM jobs WHERE owner=? AND campaign_id=? AND role=? ORDER BY created_at DESC LIMIT 100').bind(owner,a.campaignId,a.role).all<{id:string;model:string;updated_at:string}>();
 const ids=await Promise.all(results.map(async j=>({job:j,artifactId:await roleArtifactId(j.id)})));
 const job=ids.find(x=>x.artifactId===a.id)?.job;
 if(!job)return null;
 const [contract,snapshot]=await Promise.all([optional(readRecord<{idLabels?:IdLabels}>(owner,'role_output_contract',job.id)),optional(readRecord<{rules?:LearningRule[];operatorPreferences?:LearningRule[]}>(owner,'learning_snapshot',job.id))]);
 const learningRules=snapshot?(snapshot.rules?.length??0)+(snapshot.operatorPreferences?.length??0):null;
 return {jobId:job.id,model:text(job.model),finishedAt:text(job.updated_at),labels:contract?.idLabels??{},learningRules,via:'role'};
}
async function meetingRun(owner:string,meetingId:string):Promise<RunRecord|null>{
 const m=await optional(readRecord<Meeting>(owner,'team_meeting',meetingId));
 if(!m)return null;
 return {jobId:null,model:text(m.model),finishedAt:text(m.updatedAt),labels:meetingLabels(m),learningRules:Array.isArray(m.snapshot?.learning)?m.snapshot.learning.length:null,via:'meeting'};
}
async function runOf(owner:string,a:StoredArtifact):Promise<RunRecord|null>{
 if(a.meetingId)return meetingRun(owner,a.meetingId);
 return a.id.startsWith('ai-')?roleRun(owner,a):null;
}
// 공급자가 보고한 모델(사용량 원장)이 있으면 실행 설정 모델보다 먼저 쓴다.
async function reportedModel(owner:string,artifactId:string){
 const row=await database().prepare("SELECT json_extract(data,'$.model') AS model FROM records WHERE owner=? AND kind='provider_usage' AND json_extract(data,'$.artifactId')=? AND json_extract(data,'$.model') IS NOT NULL ORDER BY updated_at DESC LIMIT 1").bind(owner,artifactId).first<{model:string|null}>();
 return text(row?.model);
}

const unresolved=(label:string,kind:CitationSource['kind'],brandId:string):CitationSource=>({kind,label,title:label,observedAt:null,validUntil:null,url:null,brandId,value:null,found:false});
async function sourceFor(owner:string,label:string,id:string,c:Campaign):Promise<CitationSource>{
 if(/^브랜드 자료 #/.test(label)){
  const s=await optional(readRecord<ArchiveSource>(owner,'brand_source',id));
  return s?{kind:'archive',label,title:s.title||label,observedAt:text(s.observedAt)??text(s.createdAt),validUntil:null,url:httpUrl(s.url),brandId:s.brandId,value:null,found:true}:unresolved(label,'archive',c.brandId);
 }
 if(/^채널 관찰 #/.test(label))return {...unresolved(label,'observation',c.brandId),found:true};
 if(label==='브랜드 진단')return {...unresolved(label,'diagnosis',c.brandId),found:true};
 if(/^브리프 v\d+$/.test(label))return {...unresolved(label,'brief',c.brandId),title:`${c.title} ${label}`,brandId:null,found:true};
 const prior=await optional(readRecord<Artifact>(owner,'artifact',id));
 return {...unresolved(label,'artifact',c.brandId),title:prior?.title?`${prior.title} (${label})`:label,brandId:null,found:!!prior};
}
async function labelSources(owner:string,labels:IdLabels,c:Campaign){
 const entries=await Promise.all(Object.entries(labels).filter(([,label])=>typeof label==='string').map(async([id,label])=>[label,await sourceFor(owner,label,id,c)] as const));
 return Object.fromEntries(entries);
}
type FactLike={key:string;value:string;source?:string;verifiedAt?:string;validUntil?:string;brandId?:string};
async function factSources(owner:string,a:Artifact,c:Campaign,ledger:FactLedger|null){
 const refs=(a.factRefs||[]).filter(r=>r.status!=='rejected');
 const used=refs.length?(await Promise.all(refs.map(r=>optional(readRecord<BrandFact>(owner,'brand_fact',r.id))))).filter((f):f is BrandFact=>!!f&&f.status==='confirmed')
  :((ledger?.confirmed||[]) as FactLike[]).filter(f=>typeof f.key==='string');
 // 저장 key는 카탈로그 key('address')이고 본문은 표시 이름('주소')을 쓸 수 있어 둘 다 같은 출처로 싣는다(lib/fact-catalog.ts factLabel).
 const entries=used.flatMap(f=>{const label=factLabel(f.key),source={kind:'fact',label:`확정 사실 ${label}`,title:label,observedAt:text(f.verifiedAt),validUntil:text(f.validUntil),url:null,brandId:f.brandId??c.brandId,value:text(f.value),found:true} satisfies CitationSource;
  return [...new Set([f.key,label])].map(name=>[`fact:${name}`,source] as const)});
 return Object.fromEntries(entries);
}
const sourcesOf=(ids:readonly string[])=>ids.flatMap(id=>{const s=COMPLIANCE_LEXICON.sources[id];return s?[{title:s.title,url:s.url}]:[]});
// 규칙 분류별 통과·주의·차단. 통과는 그 분류에서 걸린 규칙이 없는 규칙 수다(가맹 모집 범위 규칙은 소비자 점검에서 쓰지 않아 뺀다). info(인용 문장)는 세지 않는다.
export function complianceViewOf(a:Pick<Artifact,'id'|'role'|'content'>,ledger:FactLedger|null,gradedAt:string|null,checkedAt=stamp()):ComplianceView{
 const lines=a.content.split('\n').length;
 const base={lines,checkedAt,gradedAt,notice:COMPLIANCE_NOTICE};
 if(lines>MAX_GRADED_LINES)return {...base,status:'not_run',categories:[],issues:[]};
 const report=checkCompliance(bodyOf({id:a.id,kind:'role',role:a.role,text:a.content}),{facts:ledger});
 const issues=report.issues.flatMap(i=>i.severity==='info'?[]:[{category:i.category,ruleId:i.ruleId,severity:i.severity as 'block'|'warn',title:i.title,excerpt:i.excerpt,sources:sourcesOf(i.sources)}]);
 const rules=COMPLIANCE_LEXICON.rules.filter(r=>r.scope!=='recruitment'),hit=new Set(issues.map(i=>i.ruleId));
 const categories=[...new Set(rules.map(r=>r.category))].map(category=>({category,label:COMPLIANCE_CATEGORY_LABELS[category]??category,pass:rules.filter(r=>r.category===category&&!hit.has(r.id)).length,warn:issues.filter(i=>i.category===category&&i.severity==='warn').length,block:issues.filter(i=>i.category===category&&i.severity==='block').length}));
 return {...base,status:'checked',categories,issues};
}
// 규정 수정 제안(스위치 compliance_fixes). 꺼져 있거나 점검하지 않은 판(not_run)이면 보기를 그대로 둔다(키도 없다). 전송자 명칭은 캠페인 브랜드 이름이다.
export async function withComplianceFixes(owner:string,c:Campaign,a:Pick<Artifact,'version'|'content'>,view:ComplianceView,ledger:FactLedger|null):Promise<ComplianceView>{
 if(view.status!=='checked'||!await isEnabled(owner,'compliance_fixes'))return view;
 const brand=await optional(readRecord<{name?:string}>(owner,'brand',c.brandId));
 const items=computeComplianceFixes(a.content,{facts:ledger,senderName:typeof brand?.name==='string'?brand.name:null}).map(f=>({id:f.id,ruleId:f.ruleId,kind:f.kind,before:f.before,after:f.after,rationale:f.rationale,needsCheck:f.needsCheck,preview:f.preview,sources:sourcesOf(f.sources)}));
 return {...view,fixes:{version:a.version,notice:COMPLIANCE_FIX_NOTICE,items,scope:{brandId:c.brandId,storeId:c.storeId??null,campaignId:c.id}}};
}
export async function factLedgerOf(owner:string,c:Campaign):Promise<FactLedger|null>{
 try{const facts=(await evidenceContext(database(),owner,c)).facts;return {confirmed:facts.confirmed as FactLedger['confirmed'],prohibited:facts.prohibited as FactLedger['prohibited']}}
 catch{return null}
}
function originInfo(a:StoredArtifact,run:RunRecord|null,model:string|null):OriginInfo{
 const ai=isAiGenerated(a),via:OriginInfo['via']=run?.via??(a.origin==='manual'?'manual':'unknown');
 return {origin:a.origin,originLabel:originLabel(a.origin),role:a.role,roleName:roles.find(r=>r.id===a.role)?.name||a.role,via,model,
  generatedAt:a.origin==='ai'?a.createdAt:ai?run?.finishedAt??null:null,editedAt:a.origin==='ai_edited'||a.origin==='manual'?a.createdAt:null,
  briefVersion:typeof a.campaignVersion==='number'?a.campaignVersion:null,learningRules:run?.learningRules??null,
  disclosure:{applies:ai,line:ai?AI_DISCLOSURE_LINE:null,virtualPersonLine:a.virtualPerson===true?VIRTUAL_PERSON_LINE:null}};
}
export async function artifactSources(owner:string,artifactId:string):Promise<ArtifactSources>{
 const a=await readRecord<StoredArtifact>(owner,'artifact',artifactId),c=await readRecord<Campaign>(owner,'campaign',a.campaignId);
 const [run,ledger,grading,usageModel]=await Promise.all([runOf(owner,a),factLedgerOf(owner,c),optional(readRecord<{gradedAt?:string}>(owner,'grading',`${a.id}:${a.version}`)),isAiGenerated(a)?reportedModel(owner,a.id):Promise.resolve(null)]);
 const [labelled,facts]=await Promise.all([labelSources(owner,run?.labels??{},c),factSources(owner,a,c,ledger)]);
 return {artifactId:a.id,version:a.version,brandId:c.brandId,refs:{...labelled,...facts},factKeys:Object.keys(facts).map(k=>k.slice('fact:'.length)),
  origin:originInfo(a,run,usageModel??run?.model??null),compliance:await withComplianceFixes(owner,c,a,complianceViewOf(a,ledger,text(grading?.gradedAt)),ledger)};
}
// 작업물 목록 카드의 소재 예측 점수 배지(G2). 캠페인의 저장된 점수 중 현재 판만 쓴다. 없는 캠페인·다른 소유자는 404다.
export async function campaignScoreSummaries(owner:string,campaignId:string):Promise<ArtifactScoreSummary[]>{
 await readRecord<Campaign>(owner,'campaign',campaignId);
 const [scores,artifacts]=await Promise.all([listRecords<ArtifactScoreSummary>(owner,'creative_score',campaignId),listRecords<Artifact>(owner,'artifact',campaignId)]);
 return scores.filter(s=>artifacts.some(a=>a.id===s.artifactId&&a.version===s.artifactVersion)).map(({artifactId,artifactVersion,score,band})=>({artifactId,artifactVersion,score,band}));
}
