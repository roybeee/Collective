// 상태로 여는 대화상자(트리거 없이 open 상태로 띄움)는 닫을 때 초점이 문서 처음으로 간다. 연 버튼을 기억해 두었다가 닫힐 때 돌려준다(UX-PLAN-3 Q9).
let opener:HTMLElement|null=null;
export function rememberOpener(){const el=document.activeElement;opener=el instanceof HTMLElement&&el!==document.body?el:null}
export function restoreOpener(e:Event){const el=opener;opener=null;if(el?.isConnected){e.preventDefault();el.focus()}}
// 화면을 옮긴 뒤(바로 가기 등) 초점을 새 화면 제목으로 둔다. 제목이 없으면 본문 영역으로.
export function focusMainHeading(){const main=document.getElementById('main-content'),h=main?.querySelector<HTMLElement>('h1[tabindex]');(h??main)?.focus({preventScroll:true})}
