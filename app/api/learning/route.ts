import {actor,identity,secureMutation,body,json,failure,acquireLock,releaseLock,listRecords,database} from '@/lib/server';
import {learningAction,withStats,renewBlocked,reviewDecisionChoices,playbookRechecks as rechecksOf} from '@/lib/learning-server';
import {expiringRules,operatorRule,type ViralExperiment,type LearningRule} from '@/lib/learning';
import {curate} from '@/lib/playbook-curator';
import type {SourceCampaignDeleted} from '@/lib/record-kinds';
// reviewDecisions(인용 선택용 판정 요약)·playbookSuggestions(Curator 제안)·playbookRechecks(중지한 운영자 선호 규칙의 재확인 표시)는 운영자 선호 영역(B3-1)이 쓴다.
export async function GET(req:Request){try{const owner=await identity(req);
 // 워크스페이스 첫 화면의 만료 임박 알림(loop-11)은 규칙만 읽어 만료 임박 목록만 돌려준다.
 if(new URL(req.url).searchParams.get('only')==='expiring')return json({expiringRules:expiringRules(await listRecords<LearningRule&{sourceCampaignDeleted?:SourceCampaignDeleted}>(owner,'learning_rule'))});
 const [cases,analyses,experiments,rules,snapshots,observations,jobOutputs,jobs,guidances,experimentSummaries,reviewDecisions,playbookRechecks]=await Promise.all([listRecords(owner,'viral_case'),listRecords(owner,'viral_analysis'),listRecords<ViralExperiment>(owner,'viral_experiment'),listRecords<LearningRule&{sourceCampaignDeleted?:SourceCampaignDeleted}>(owner,'learning_rule'),listRecords(owner,'learning_snapshot'),listRecords(owner,'case_observation'),listRecords(owner,'learning_job_output'),database().prepare("SELECT id,campaign_id AS campaignId,role,status,error,created_at AS createdAt FROM jobs WHERE owner=? AND role IN ('viral_analysis','viral_discovery','viral_guidance') ORDER BY created_at DESC LIMIT 80").bind(owner).all(),listRecords(owner,'learning_guidance'),listRecords(owner,'viral_experiment_summary'),reviewDecisionChoices(owner),rechecksOf(owner)]);// 서버가 지금 연장을 거절할 활성 규칙에 renewBlocked를 붙인다(응답 필드, 저장하지 않음). 화면 연장 버튼이 같은 판정을 따른다(R2).
 const blocked=new Set(await Promise.all(rules.filter(r=>r.status==='active'&&!r.sourceCampaignDeleted&&!operatorRule(r)).map(async r=>await renewBlocked(owner,r,experiments)?r.id:'')));
 const shown=rules.map(r=>blocked.has(r.id)?{...r,renewBlocked:true}:r);
 return json({cases,analyses,experiments:experiments.map(withStats),rules:shown,expiringRules:expiringRules(shown),snapshots,observations,jobOutputs,guidances,jobs:jobs.results,experimentSummaries,reviewDecisions,playbookSuggestions:curate(rules),playbookRechecks})}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',token='';try{const who=await actor(req);owner=who.owner;secureMutation(req);const b=await body(req);token=await acquireLock(owner);return json(await learningAction(owner,b,{id:who.id,email:who.email,role:who.role}))}catch(e){return failure(e)}finally{if(token)await releaseLock(owner,token)}}
