// 재실행 영향 설명(개선 계획 PR 5 '재실행 영향 설명', ux-12). 역할을 다시 작성하면 그 역할과 뒤 순서 역할의 이전 버전이 아닌 작업물이
// 이전 버전(outdated)이 되고 이전 판은 기록(history)에 남는다(lib/role-execution.ts 완료 저장과 같은 기준). 화면이 누르기 전에 대상을 보이도록 계산만 한다.
import {roles} from './agency';

export type RerunImpact={role:string;name:string};
export function rerunImpact(artifacts:readonly {role:string;status:string}[],roleId:string):RerunImpact[]{
 const from=roles.findIndex(r=>r.id===roleId);
 if(from<0)return [];
 return roles.slice(from).filter(r=>artifacts.some(a=>a.role===r.id&&a.status!=='outdated')).map(r=>({role:r.id,name:r.name}));
}
export const rerunImpactNote=(impact:readonly RerunImpact[])=>impact.length?`다시 작성하면 ${impact.map(x=>x.name).join('·')} 작업물 ${impact.length}건이 이전 버전으로 바뀝니다(이전 판은 기록에 남습니다).`:'';
