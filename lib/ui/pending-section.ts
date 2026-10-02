// 홈 안건에서 캠페인 성장·판매 탭의 특정 섹션으로 바로 가기(UX-PLAN P5). 주소 대신 화면 상태로 한 번만 전달한다.
let pending:string|null=null;
export const setPendingSection=(id:string|null)=>{pending=id;};
export const takePendingSection=()=>{const id=pending;pending=null;return id;};
// 안건 행이 가리키는 접기 패널 제목. 그 패널이 처음 그려질 때 한 번 열고 비운다(components/app/lazy-panel.tsx).
let pendingPanel:string|null=null;
export const setPendingPanel=(summary:string|null)=>{pendingPanel=summary;};
// 같은 그리기 안의 두 번 호출(개발 모드 엄격 검사)에도 같은 답을 주도록 비우기는 다음 차례로 미룬다.
export const takePendingPanel=(summary:string)=>{if(pendingPanel!==summary)return false;setTimeout(()=>{if(pendingPanel===summary)pendingPanel=null},0);return true;};
// 안건 행이 가리키는 기록('<종류>:<id>'). 그 기록을 다루는 패널이 처음 불러올 때 한 번 꺼내 처리 칸을 바로 연다.
let pendingRecord:string|null=null;
export const setPendingRecord=(id:string|null)=>{pendingRecord=id;};
export const takePendingRecord=(kind:string)=>{if(!pendingRecord?.startsWith(kind+':'))return null;const id=pendingRecord.slice(kind.length+1);pendingRecord=null;return id;};
