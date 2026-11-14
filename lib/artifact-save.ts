// 작업물 새 버전 저장 묶음(app/api/action save_artifact와 규정 수정 제안 적용 apply_compliance_fixes가 같이 쓴다).
// 새 판(검토 대기), 캠페인 검토 대기, 사건 기록, 같은·뒤 담당 작업물 outdated, 이전 판 이력(kind 'history')을 한 묶음으로 만든다. 쓰기는 호출자가 batch로 한다.
// B1 D: AI 작업물을 사람이 고치면 origin ai_edited와 AI 원본 id·버전, 원본 대비 편집 통계를 남긴다(correctedOrigin). 직접 작성은 manual 그대로다.
import {eventStatement,listRecords,recordStatement,stamp,uid,type EventActor} from './server';
import {roles,type Artifact,type Campaign} from './agency';
import {correctedOrigin} from './review-decisions-server';

export type SavedArtifact=Artifact&{campaignVersion:number};
type Fields={role:string;title:string;content:string};
// event: 사건 문구(없으면 '담당 작업물 수정 · v2'). extra: 새 판에 함께 남길 필드(출처 판정 뒤, 작성 시각 앞에 넣는다).
export async function artifactVersionWrites(owner:string,c:Campaign,old:SavedArtifact|null,{role,title,content}:Fields,by:EventActor,opts:{event?:(version:number)=>string;extra?:Record<string,unknown>}={}){
 const a={...(old?.growthLessonReferences?{growthLessonReferences:old.growthLessonReferences,growthLessonDigest:old.growthLessonDigest,growthLessonAcknowledgedState:old.growthLessonAcknowledgedState}:{}),id:old?.id||uid(),campaignId:c.id,campaignVersion:c.version,role,title,content,version:(old?.version||0)+1,status:'review',...await correctedOrigin(owner,old,content),...opts.extra,createdAt:stamp()};
 const writes=[recordStatement(owner,'artifact',a.id,a,c.id),recordStatement(owner,'campaign',c.id,{...c,status:'review',updatedAt:stamp()}),eventStatement(owner,c.id,opts.event?opts.event(a.version):`${roles.find(r=>r.id===role)?.name} 작업물 ${old?'수정':'등록'} · v${a.version}`,by)];
 for(const downstream of await listRecords<Artifact>(owner,'artifact',c.id)){if(downstream.id!==a.id&&downstream.status!=='outdated'&&roles.findIndex(r=>r.id===downstream.role)>=roles.findIndex(r=>r.id===role))writes.push(recordStatement(owner,'artifact',downstream.id,{...downstream,status:'outdated'},c.id))}
 if(old){const h={...old,id:uid(),originalId:old.id};writes.push(recordStatement(owner,'history',h.id,h,c.id))}
 return {artifact:a,writes};
}
