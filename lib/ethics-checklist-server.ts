// 사람 확인 체크리스트 서버(스위치 ethics_review_checklist, 순수 규칙은 lib/ethics-checklist.ts). 모델·외부 호출은 없다.
// 보기: 규정 점검 보기에 checklist 키를 붙인다. 꺼져 있으면 보기를 그대로 돌려준다(키도 없다 → 패널이 이전과 같다).
// 기록: POST /api/action mark_ethics_check. 행 id는 매번 새 uuid이고 ON CONFLICT 없는 INSERT라 덮어쓰지 않는다(추가 전용, kind ethics_check_mark, 부모 캠페인).
// 권한: 작업물 승인 권한(requireAccess approve_artifact: 대표·관리자, 배정 범위의 브랜드 매니저·점포 매니저·검토자). 직원(member)은 403이다.
// 표시는 승인을 막지 않는다(승인 경로는 이 기록을 읽지 않는다). 막을지는 대표 결정이다.
import {ApiError,database,listRecords,readRecord,stamp,uid,type Actor} from './server';
import {requireAccess,artifactResource} from './server-access';
import {isScoped} from './access';
import {isEnabled} from './feature-flags';
import {isRecruitmentObjective,type Artifact,type Campaign} from './agency';
import {outputLanguageOf} from './brief-language';
import {COMPLIANCE_LEXICON} from './graders/compliance-lexicon';
import {ETHICS_CHECKLIST_VERSION,ethicsChecklist,ethicsSignals,latestMarks,parseEthicsMark,type EthicsItem,type EthicsMark} from './ethics-checklist';
import type {ComplianceView,EthicsChecklistView} from './artifact-sources';
import type {AiImageDisclosureRecord} from './ai-disclosure-image-server';

export const CHECKLIST_OFF='사람 확인 체크리스트 기능이 꺼져 있습니다. 소유자가 설정의 기능 스위치에서 켭니다.';
type ChecklistArtifact=Pick<Artifact,'id'|'version'|'content'>&{virtualPerson?:boolean};

async function aiImageRegistered(owner:string,c:Campaign,artifactId:string){
 const records=await listRecords<AiImageDisclosureRecord>(owner,'ai_image_disclosure',c.id).catch(()=>[] as AiImageDisclosureRecord[]);
 return records.some(r=>r.artifactId===artifactId&&(r.origin==='ai'||r.origin==='ai_edited'));
}
export async function checklistItems(owner:string,c:Campaign,a:ChecklistArtifact){
 const aiImage=a.virtualPerson===true||await aiImageRegistered(owner,c,a.id);
 return ethicsChecklist(ethicsSignals(a.content,{outputLanguage:outputLanguageOf(c),aiImage,franchise:isRecruitmentObjective(c)}));
}
async function marksOf(owner:string,c:Campaign,a:Pick<Artifact,'id'|'version'>){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='ethics_check_mark' AND parent_id=? ORDER BY rowid").bind(owner,c.id).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as EthicsMark).filter(m=>m.artifactId===a.id&&m.artifactVersion===a.version);
}
const basisView=(item:EthicsItem)=>item.basis.kind==='law'?{kind:'law' as const,law:item.basis.law,article:item.basis.article,url:COMPLIANCE_LEXICON.sources[item.basis.sourceId]?.url??null}:{kind:item.basis.kind};
export function checklistView(c:Campaign,a:Pick<Artifact,'version'>,items:readonly EthicsItem[],marks:readonly EthicsMark[]):EthicsChecklistView{
 const ids=new Set(items.map(i=>i.id));
 return {version:ETHICS_CHECKLIST_VERSION,artifactVersion:a.version,items:items.map(i=>({id:i.id,basis:basisView(i),triggers:[...i.triggers]})),
  marks:latestMarks(marks).filter(m=>ids.has(m.itemId)).map(m=>({itemId:m.itemId,status:m.status,note:m.note,actorRole:m.actor.role,createdAt:m.createdAt})),
  scope:{brandId:c.brandId,storeId:c.storeId??null,campaignId:c.id}};
}
export async function withEthicsChecklist(owner:string,c:Campaign,a:ChecklistArtifact,view:ComplianceView):Promise<ComplianceView>{
 if(!await isEnabled(owner,'ethics_review_checklist'))return view;
 const [items,marks]=await Promise.all([checklistItems(owner,c,a),marksOf(owner,c,a)]);
 return {...view,checklist:checklistView(c,a,items,marks)};
}

// POST /api/action {action:'mark_ethics_check', artifactId, version, itemId, status, note?}. 라우트가 잠금·출처 검사를 하고 이 함수를 부른다.
export async function markEthicsCheckAction(req:Request,who:Actor,b:Record<string,unknown>){
 const owner=who.owner;
 if(!await isEnabled(owner,'ethics_review_checklist'))throw new ApiError(409,CHECKLIST_OFF);
 const id=typeof b.artifactId==='string'&&b.artifactId.trim()&&b.artifactId.length<=100?b.artifactId.trim():'';
 if(!id)throw new ApiError(400,'작업물 입력을 확인해 주세요.');
 const {principal}=await requireAccess(req,'approve_artifact',()=>artifactResource(owner,id));
 if(typeof b.version!=='number'||!Number.isInteger(b.version))throw new ApiError(400,'작업물 버전을 확인해 주세요.');
 const a=await readRecord<ChecklistArtifact&{campaignId:string;status?:string}>(owner,'artifact',id),c=await readRecord<Campaign>(owner,'campaign',a.campaignId);
 if(b.version!==a.version)throw new ApiError(409,'작업물이 변경됐습니다. 새로고침 후 다시 표시하세요.');
 if(a.status==='outdated')throw new ApiError(409,'이전 브리프의 작업물입니다. 새 작업물에서 확인하세요.');
 const items=await checklistItems(owner,c,a),parsed=parseEthicsMark(b,items);
 if('error' in parsed)throw new ApiError(400,parsed.error);
 const mark:EthicsMark={...parsed.mark,id:uid(),artifactId:a.id,artifactVersion:a.version,campaignId:c.id,checklistVersion:ETHICS_CHECKLIST_VERSION,
  actor:{id:who.id,role:isScoped(principal)?principal.role:who.role},createdAt:stamp()};
 await database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:ethics_check_mark:${mark.id}`,owner,'ethics_check_mark',c.id,JSON.stringify(mark),mark.createdAt).run();
 return {checklist:checklistView(c,a,items,await marksOf(owner,c,a))};
}
