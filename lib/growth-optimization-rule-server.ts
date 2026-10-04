import {roleArtifactId} from './role-execution';
import type {Campaign,Artifact} from './agency';
import type {CandidateInput} from './growth-optimization';
import type {LearningRule,LearningSnapshot} from './learning';
import {operatorRule} from './learning';
import {preferencePairRules,preferencePairCases,type PreferencePair} from './playbook-curator';
import {evalRead,type EvalCase,type EvalRun} from './eval-server';
import {reserveOf} from './eval-kinds';
import {pairReport} from './eval-stats';
import {storefrontDigest} from './storefront-orders';
import {optionalRecord,inCampaign} from './growth-ledger-server';
import type {GrowthExperimentRecord} from './growth-experiment-server';
import type {GrowthPublicationLink} from './growth-publication-server';
import {ApiError,database} from './server';
export type RuleEvaluation={kind:'operator_preferences';rule:LearningRule;ruleDigest:string;pair:PreferencePair;caseIds:string[];caseDigest:string;campaignDigest:string;intent?:{label:string;at:string;by:string;tokenBudget:number}};
type Candidate={id:string;input:CandidateInput;ruleEvaluation?:RuleEvaluation|null};
const params=(key?:string,value?:string)=>{const p=new URL('https://collective.invalid').searchParams;if(key)p.set(key,value!);return p;};
const scope=(c:Campaign)=>({id:c.id,brandId:c.brandId,storeId:c.storeId??null,channels:c.channels,version:c.version});
export function requireEnforcedEvaluationCost():never{throw new ApiError(409,'원화 지출 상한을 강제하는 공급자 계약이 연결되어야 유료 평가를 시작할 수 있습니다. 무료 동결·정확성 검증을 먼저 진행하세요.');}
async function cases(owner:string,ids:string[],rule:LearningRule,budget:number){
 const values=await Promise.all(ids.map(id=>evalRead(owner,params('case',id)) as Promise<EvalCase>));
 if(preferencePairCases(values,[rule]).skippedCases||!values.some(x=>x.set==='sealed'))throw new ApiError(409,'같은 규칙 범위의 역할 케이스와 봉인 케이스가 필요합니다.');
 if(values.reduce((n,x)=>n+2*reserveOf(x),0)>budget)throw new ApiError(409,'규칙 쌍 평가 예약량이 후보 토큰 예산을 넘습니다.');
 return storefrontDigest(values);
}
export async function freezeRuleEvaluation(owner:string,c:Campaign,r:Candidate,value:unknown):Promise<RuleEvaluation>{
 const b=value&&typeof value==='object'?value as {caseIds?:unknown}:{};
 if(!Array.isArray(b.caseIds)||!b.caseIds.length||b.caseIds.length>100||b.caseIds.some(x=>typeof x!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(x))||new Set(b.caseIds).size!==b.caseIds.length)throw new ApiError(400,'중복 없는 평가 케이스 1~100개를 지정하세요.');
 const rule=await optionalRecord<LearningRule>(owner,'learning_rule',r.input.targetRef);
 if(r.input.candidateKind!=='operating_rule'||!rule||!operatorRule(rule)||rule.brandId!==c.brandId||(rule.storeId&&rule.storeId!==c.storeId)||rule.status==='retired'||!Number.isFinite(Date.parse(rule.expiresAt))||Date.parse(rule.expiresAt)<=Date.now()||rule.guidance!==r.input.proposal)throw new ApiError(409,'현재 브랜드·점포의 유효한 운영자 선호 규칙과 개선 제안 본문이 정확히 같아야 합니다.');
 const frozen=preferencePairRules([rule]),blockHash='sha256:'+await storefrontDigest(frozen.block),caseIds=(b.caseIds as string[]).slice().sort();
 return {kind:'operator_preferences',rule,ruleDigest:await storefrontDigest(rule),pair:{kind:'operator_preferences',unit:'operator_preferences',brandId:frozen.brandId,activeVersionId:'off',candidateVersionId:frozen.candidateVersionId,rules:frozen.rules,blockHash,block:frozen.block},caseIds,caseDigest:await cases(owner,caseIds,rule,r.input.tokenBudget),campaignDigest:await storefrontDigest(scope(c))};
}
export async function assertRuleEvaluation(owner:string,c:Campaign,r:Candidate){
 const e=r.ruleEvaluation;if(!e)throw new ApiError(409,'운영 규칙 동결 스냅샷이 필요합니다.');
 const current=await freezeRuleEvaluation(owner,c,r,{caseIds:e.caseIds});
 if(await storefrontDigest(current)!==await storefrontDigest({...e,intent:undefined}))throw new ApiError(409,'동결한 규칙·본문·범위·케이스가 바뀌었습니다. 새 후보를 만드세요.');
 return e;
}
export async function validateRuleEvaluation(owner:string,c:Campaign,r:Candidate){
 const e=await assertRuleEvaluation(owner,c,r);return {kind:'rule_snapshot' as const,valid:true as const,digest:await storefrontDigest(e),tokens:0 as const,paidEvaluation:'blocked_cost_contract' as const};
}
/** Q's exact operator-preference pair; never substitute an unrelated prompt pair. */
export async function ruleRunMatches(e:RuleEvaluation,run:EvalRun){
 const p=run.pair;if(!e.intent||!p||!('kind' in p)||p.kind!=='operator_preferences')return false;
 const {skippedCases,...pair}=p;
 return skippedCases===0&&run.variant==='pair'&&run.label===e.intent.label&&run.createdBy.id===e.intent.by&&Date.parse(run.createdAt)>=Date.parse(e.intent.at)&&run.tokenBudget===e.intent.tokenBudget&&Number.isSafeInteger(run.usedTokens)&&run.usedTokens>=0&&run.usedTokens<=e.intent.tokenBudget&&await storefrontDigest(pair)===await storefrontDigest(e.pair)&&JSON.stringify([...run.caseIds].sort())===JSON.stringify(e.caseIds)&&run.results.length===e.caseIds.length*2&&e.caseIds.every(id=>['active','candidate'].every(variant=>run.results.filter(x=>x.caseId===id&&x.variant===variant).length===1));
}
export async function collectRuleEvaluation(owner:string,c:Campaign,r:Candidate,requested:unknown){
 const e=await assertRuleEvaluation(owner,c,r);if(!e.intent)throw new ApiError(409,'이 후보가 시작한 유료 평가 의도가 없습니다. 무료 검증은 Q 평가 통과가 아닙니다.');
 const listing=await evalRead(owner,params()) as {runs:EvalRun[]},matches=listing.runs.filter(x=>x.label===e.intent!.label);
 if(matches.length!==1)throw new ApiError(409,'평가 수락 상태를 대사해야 합니다. 새 실행을 만들지 마세요.');
 const run=await evalRead(owner,params('run',matches[0].id)) as EvalRun;
 if(requested&&requested!==run.id||!await ruleRunMatches(e,run)||run.deleted||run.status!=='completed')throw new ApiError(409,'정확한 운영 규칙 Q 쌍 평가 완료 기록이 아닙니다.');
 return {run,report:pairReport(run)};
}
export async function ruleSalesIntervention(owner:string,c:Campaign,r:Candidate,e:GrowthExperimentRecord){
 const frozen=await assertRuleEvaluation(owner,c,r);
 if(!e.registration||e.registration.digest!==await storefrontDigest({id:e.id,input:e.input})||await storefrontDigest(e.registration.refs)!==await storefrontDigest(e.input.interventionRefs))throw new ApiError(409,'실험 사전등록의 정확한 개입 근거가 필요합니다.');
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='learning_snapshot' AND parent_id=? LIMIT 1001").bind(owner,c.id).all<{data:string}>();
 if(rows.results.length>1000)throw new ApiError(409,'규칙 주입 근거 조회 한도를 넘었습니다.');
 const snapshots=rows.results.map(x=>JSON.parse(x.data) as LearningSnapshot);
 for(const ref of e.registration.refs){
  if(ref.kind!=='publication_link')continue;
  const link=await optionalRecord<GrowthPublicationLink>(owner,'growth_publication_link',ref.id),copy=link?.snapshot.publication.copy;
  if(!link||!inCampaign(link,c)||link.version!==ref.version||link.status!=='published'||!copy||copy.artifactVersion!==1)continue;
  const artifact=await optionalRecord<Artifact>(owner,'artifact',copy.artifactId);
  if(!artifact||artifact.campaignId!==c.id||artifact.version!==1||artifact.origin!=='ai'||artifact.status==='outdated')continue;
  for(const snapshot of snapshots){
   if(snapshot.campaignId!==c.id||snapshot.artifactId!==artifact.id||snapshot.role!==artifact.role||await roleArtifactId(snapshot.id)!==artifact.id)continue;
   const injected=snapshot.operatorPreferences?.find(x=>x.id===frozen.rule.id);
   if(injected?.status==='active'&&await storefrontDigest(injected)===frozen.ruleDigest)return {kind:'publication_link' as const,id:link.id,version:link.version,artifactId:artifact.id,artifactVersion:1,ruleId:injected.id,ruleVersion:injected.version,ruleDigest:frozen.ruleDigest,snapshotId:snapshot.id};
  }
 }
 throw new ApiError(409,'정확한 규칙 전체 스냅샷이 주입된 최초 AI 작업물과 사전등록 게시 판이 필요합니다.');
}
