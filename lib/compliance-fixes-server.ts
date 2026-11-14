// 규정 수정 제안 적용(POST /api/action apply_compliance_fixes, 스위치 compliance_fixes). 라우트가 잠금·출처 검사를 하고 이 함수를 부른다.
// 화면이 보낸 글은 받지 않는다. 저장된 본문으로 제안을 다시 계산해(lib/graders/compliance-fixes.ts) 고른 id만 적용하고, save_artifact와 같은 묶음(lib/artifact-save.ts)으로
// 새 버전을 저장한 뒤(AI 작성이면 ai_edited, 사건 '규정 수정 제안 n건 적용 · vN') 결정론 채점기로 바로 다시 점검한다(lib/artifact-regrade.ts). 모델·외부 호출은 없다.
// 권한: 편집 권한(requireAccess edit_campaign)이 있는 대표·관리자와 범위 역할(브랜드 매니저·점포 매니저). 범위 없는 직원(member)은 403이다(다시 점검과 같은 등급).
import {ApiError,assertNoActiveJobs,database,readRecord,type Actor} from './server';
import {requireAccess,artifactResource} from './server-access';
import {isScoped} from './access';
import {isEnabled} from './feature-flags';
import type {Campaign} from './agency';
import {artifactVersionWrites,type SavedArtifact} from './artifact-save';
import {factLedgerOf} from './artifact-sources-server';
import {regradeArtifact} from './artifact-regrade';
import {applyComplianceFixes,computeComplianceFixes,ComplianceFixConflictError} from './graders/compliance-fixes';
import {MAX_GRADED_LINES} from './online-grading';

export const FIXES_OFF='규정 수정 제안 기능이 꺼져 있습니다. 소유자가 설정의 기능 스위치에서 켭니다.';
const MAX_SELECTED=50,MAX_CONTENT=40000;
function fixIdsOf(value:unknown):string[]{
 if(!Array.isArray(value)||!value.length||value.length>MAX_SELECTED||value.some(v=>typeof v!=='string'||!v||v.length>200))throw new ApiError(400,'적용할 수정 제안을 1~50건 고르세요.');
 const ids=value as string[];
 if(new Set(ids).size!==ids.length)throw new ApiError(400,'같은 수정 제안을 두 번 고를 수 없습니다.');
 return ids;
}
export async function applyComplianceFixesAction(req:Request,who:Actor,b:Record<string,unknown>){
 const owner=who.owner;
 if(!await isEnabled(owner,'compliance_fixes'))throw new ApiError(409,FIXES_OFF);
 const id=typeof b.artifactId==='string'&&b.artifactId.trim()&&b.artifactId.length<=100?b.artifactId.trim():'';
 if(!id)throw new ApiError(400,'작업물 입력을 확인해 주세요.');
 const {principal}=await requireAccess(req,'edit_campaign',()=>artifactResource(owner,id));
 if(!isScoped(principal)&&who.role==='member')throw new ApiError(403,'관리자만 변경할 수 있습니다.');
 const ids=fixIdsOf(b.fixIds);
 if(typeof b.version!=='number'||!Number.isInteger(b.version))throw new ApiError(400,'작업물 버전을 확인해 주세요.');
 const old=await readRecord<SavedArtifact>(owner,'artifact',id),c=await readRecord<Campaign>(owner,'campaign',old.campaignId);
 await assertNoActiveJobs(owner,c.id);
 if(b.version!==old.version)throw new ApiError(409,'작업물이 변경됐습니다. 새로고침 후 다시 고르세요.');
 if(old.status==='outdated')throw new ApiError(409,'이전 브리프의 작업물입니다. 새 작업물을 등록하세요.');
 if(old.content.split('\n').length>MAX_GRADED_LINES)throw new ApiError(409,'본문이 자동 점검 한도를 넘어 수정 제안이 없습니다.');
 const brand=await readRecord<{name?:string}>(owner,'brand',c.brandId).catch(()=>null);
 const all=computeComplianceFixes(old.content,{facts:await factLedgerOf(owner,c),senderName:typeof brand?.name==='string'?brand.name:null});
 const chosen=ids.map(fid=>all.find(f=>f.id===fid));
 if(chosen.some(f=>!f))throw new ApiError(409,'수정 제안이 바뀌었습니다. 다시 점검한 뒤 고르세요.');
 let content:string;
 try{content=applyComplianceFixes(old.content,chosen as NonNullable<typeof chosen[number]>[])}
 catch(error){if(error instanceof ComplianceFixConflictError)throw new ApiError(400,error.message);throw error}
 if(!content.trim()||content.length>MAX_CONTENT)throw new ApiError(400,'수정 뒤 본문 길이가 저장 한도를 벗어납니다. 직접 고쳐 주세요.');
 const ruleIds=[...new Set(chosen.map(f=>f!.ruleId))],n=chosen.length;
 const {artifact,writes}=await artifactVersionWrites(owner,c,old,{role:old.role,title:old.title,content},{id:who.id,email:who.email},{
  event:version=>`규정 수정 제안 ${n}건 적용 · v${version}`,extra:{complianceFixes:{fromVersion:old.version,count:n,ruleIds}}});
 await database().batch(writes);
 const regraded=await regradeArtifact(owner,artifact.id,{id:who.id,role:isScoped(principal)?principal.role:who.role});
 return {id:artifact.id,version:artifact.version,origin:artifact.origin,applied:n,ruleIds,grading:regraded.grading,compliance:regraded.compliance};
}
