// 작업물 목록 카드 요약 읽기(벤치마크 P5·P10, GET /api/artifact-sources?cards=<캠페인>). 쓰기·모델·외부 호출은 없다.
// publication: 그 판의 카피를 쓴 발행 기록(lib/execution.ts)에서 예약·발행 표시를 읽는다(lib/artifact-lifecycle.ts).
// compliance: 상세 대화상자와 같은 결정론 규제 점검(complianceViewOf)의 차단·주의 수. 이전 판(outdated)은 목록에 나오지 않으므로 뺀다. 없는 캠페인·다른 소유자는 404다.
import {listRecords,readRecord} from './server';
import type {Artifact,Campaign} from './agency';
import type {Publication} from './execution';
import {complianceViewOf,factLedgerOf} from './artifact-sources-server';
import {publicationMark,type PublicationMark} from './artifact-lifecycle';

export type ArtifactCardSummary={artifactId:string;artifactVersion:number;publication:PublicationMark;compliance:{status:'checked'|'not_run';block:number;warn:number}};
export async function campaignArtifactCards(owner:string,campaignId:string):Promise<ArtifactCardSummary[]>{
 const c=await readRecord<Campaign>(owner,'campaign',campaignId);
 const [artifacts,publications,ledger]=await Promise.all([listRecords<Artifact>(owner,'artifact',campaignId),listRecords<Publication>(owner,'execution_publication',campaignId),factLedgerOf(owner,c)]);
 return artifacts.filter(a=>a.status!=='outdated').map(a=>{
  const view=complianceViewOf(a,ledger,null);
  return {artifactId:a.id,artifactVersion:a.version,publication:publicationMark(a,publications),compliance:{status:view.status,block:view.issues.filter(i=>i.severity==='block').length,warn:view.issues.filter(i=>i.severity==='warn').length}};
 });
}
