// X7 '다시 점검'(POST /api/usage action regrade_artifact). 작업물 현재 판 하나를 온라인 채점과 같은 결정론 채점기(lib/graders 13종)와 규제 점검으로 다시 채점해
// grading 기록(id=<작업물>:<판>, parent=캠페인)을 덮어쓴다. 모델·외부 호출은 없다. 권한(대표·관리자)과 요청 검사는 라우트가 한다.
// 사실 원장은 현재 캠페인 범위의 확정·거절 사실이다(회의 작업물도 현재 원장으로 다시 본다). 입력 토큰(input_budget)은 이전 채점 기록의 값을 이어 쓴다.
// 작업물 본문·상태·complianceHold(A2 하향)는 바꾸지 않는다. 줄 수가 채점 한도를 넘으면 status not_run 기록만 남긴다(온라인 채점과 같다).
import {readRecord,recordStatement,stamp,ApiError} from './server';
import type {Artifact,Campaign} from './agency';
import {gradeArtifact,MAX_GRADED_LINES,type Grading,type GradingContext} from './online-grading';
import {GRADERS_VERSION} from './graders/index';
import {complianceViewOf,factLedgerOf,withComplianceFixes} from './artifact-sources-server';

type StoredArtifact=Artifact&{meetingId?:string};
type RegradeActor={id:string;role:string};
async function previousGrading(owner:string,id:string){
 try{return await readRecord<Grading>(owner,'grading',id)}catch(error){if(error instanceof ApiError&&error.status===404)return null;throw error}
}
export async function regradeArtifact(owner:string,artifactId:string,by:RegradeActor){
 const a=await readRecord<StoredArtifact>(owner,'artifact',artifactId),c=await readRecord<Campaign>(owner,'campaign',a.campaignId);
 const id=`${a.id}:${a.version}`,previous=await previousGrading(owner,id),ledger=await factLedgerOf(owner,c),gradedAt=stamp();
 const inputTokens=typeof previous?.context?.inputTokens==='number'?previous.context.inputTokens:null;
 const context:GradingContext={facts:ledger?'current':'none',confirmedFacts:ledger?.confirmed.length??0,prohibitedFacts:ledger?.prohibited.length??0,industry:null,localStore:!!c.storeId,inputTokens};
 const lines=a.content.split('\n').length;
 const base={id,artifactId:a.id,artifactVersion:a.version,campaignId:c.id,campaignVersion:a.campaignVersion??null,role:a.role,source:previous?.source??(a.meetingId?'meeting' as const:'role' as const),jobId:previous?.jobId??null,meetingId:previous?.meetingId??a.meetingId??null,gradersVersion:GRADERS_VERSION,context,gradedAt,regradedBy:{id:by.id,role:by.role}};
 const grading:Grading&{regradedBy:RegradeActor}=lines>MAX_GRADED_LINES
  ?{...base,status:'not_run',graders:[],summary:null,compliance:null,durationMs:null,reason:'too_many_lines',lines}
  :{...base,status:'graded',...gradeArtifact(a,{facts:ledger,industry:null,localStore:context.localStore},inputTokens)};
 await recordStatement(owner,'grading',id,grading,c.id).run();
 const summary={id,artifactId:a.id,artifactVersion:a.version,role:a.role,source:grading.source,status:grading.status,reason:grading.reason,lines:grading.lines,summary:grading.summary,
  compliance:grading.compliance?{block:grading.compliance.block,warn:grading.compliance.warn,info:grading.compliance.info}:null,durationMs:grading.durationMs,gradedAt,failed:grading.graders.filter(g=>g.status==='fail'||g.status==='grader_error').map(g=>g.id)};
 return {grading:summary,compliance:await withComplianceFixes(owner,c,a,complianceViewOf(a,ledger,gradedAt,gradedAt),ledger)};
}
