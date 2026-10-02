// 권한이 없어 폼을 열 수 없을 때 폼 자리에 남기는 한 줄(UX-PLAN-3 11차원: 권한 없는 동작은 숨기지 않고 이유를 보인다).
export function LockedNote({action,reason}:{action:string;reason:string}){return <p className="subtle-note admin-only-note" role="note">{action}: {reason}</p>}
