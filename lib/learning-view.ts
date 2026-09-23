// 학습 규칙 카드의 표시 판정(app/learning-panel.tsx). 버튼은 서버(lib/learning-server.ts)가 받아 주는 경우에만 보인다.
import {ruleNeedsReview,type LearningRule} from './learning';
import type {SourceCampaignDeleted} from './record-kinds';
// 결정 7(b): 원 캠페인이 삭제된 바이럴 규칙은 종료 상태로만 남는다. assertSourceCampaign의 409 안내와 같은 문구다.
export const SOURCE_DELETED_NOTICE='원 캠페인이 삭제되어 이 규칙은 재검증·연장·상태 변경을 할 수 없습니다. 캠페인을 선택해 새 실험을 만들어 주세요.';
export type ShownRule=LearningRule&{sourceCampaignDeleted?:SourceCampaignDeleted|null};
export type RuleActions={retest:boolean;renew:boolean;retire:boolean;pause:boolean};
export type RuleState={label:string;sourceDeleted:boolean;deletedAt:string|null;notice:string;actions:RuleActions};
// 삭제 시각이 날짜로 읽히지 않으면 null로 둔다(화면은 '시각 미확인').
const readableAt=(at:unknown)=>typeof at==='string'&&Number.isFinite(Date.parse(at))?at:null;
export function ruleState(r:ShownRule,now=Date.now()):RuleState{
 if(r.sourceCampaignDeleted)return {label:'원 캠페인 삭제됨',sourceDeleted:true,deletedAt:readableAt(r.sourceCampaignDeleted.at),notice:SOURCE_DELETED_NOTICE,actions:{retest:false,renew:false,retire:false,pause:false}};
 const review=ruleNeedsReview(r,now),label=r.status==='retired'?'근거 정정 · 적용 종료':r.status==='paused'?'적용 중지':Date.parse(r.expiresAt)<now?'재검토 필요':'시험 적용 중';
 // 점포 출처 규칙의 후속 실험은 점포 마케팅 화면에서 만든다(서버도 retest_rule을 409로 거절한다).
 return {label,sourceDeleted:false,deletedAt:null,notice:'',actions:{retest:review&&r.origin!=='store',renew:review,retire:review,pause:r.status==='active'}};
}
