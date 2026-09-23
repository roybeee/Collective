import type {Artifact} from '@/lib/agency';

// 작업물 변경 표시: 작성 뒤 브랜드 정보·확정 사실이 바뀐 작업물과, 저장 전 검사에서 [확인 필요] 없이 금지·미확인 표현이 발견된 작업물.
export function artifactFlags(a:Pick<Artifact,'brandChanged'|'factsChanged'|'unverifiedClaims'>){
 return [
  a.brandChanged?{label:'브랜드 변경',title:'작성 뒤 브랜드 정보가 바뀌었습니다. 승인 전 새 기준과 맞는지 확인하세요.'}:null,
  a.factsChanged?{label:'사실 변경',title:'작성 뒤 확정·거절 사실이 바뀌었습니다. 승인 전 새 사실과 맞는지 확인하세요.'}:null,
  a.unverifiedClaims?.length?{label:'확인 전 표현',title:`[확인 필요] 없이 쓰인 표현: ${a.unverifiedClaims.join(', ')}`}:null,
 ].filter((x):x is {label:string;title:string}=>!!x);
}
// 승인 전에 변경 확인이 필요한 작업물. 서버도 같은 조건에서 acknowledgeChanges를 요구한다.
export const needsChangeAcknowledgement=(a:Pick<Artifact,'brandChanged'|'factsChanged'>)=>!!a.brandChanged||!!a.factsChanged;

export function ArtifactFlags({artifact}:{artifact:Artifact}){
 const flags=artifactFlags(artifact);
 return flags.length?<>{flags.map(f=><span key={f.label} className="status status-revision" title={f.title}>{f.label}</span>)}</>:null;
}
