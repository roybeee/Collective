// 홈 안건에서 캠페인 성장·판매 탭의 특정 섹션으로 바로 가기(UX-PLAN P5). 주소 대신 화면 상태로 한 번만 전달한다.
let pending:string|null=null;
export const setPendingSection=(id:string|null)=>{pending=id;};
export const takePendingSection=()=>{const id=pending;pending=null;return id;};
