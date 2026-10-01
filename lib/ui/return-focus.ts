// 상태로 여는 대화상자(트리거 없이 open 상태로 띄움)는 닫을 때 초점이 문서 처음으로 간다. 연 버튼을 기억해 두었다가 닫힐 때 돌려준다(UX-PLAN-3 Q9).
let opener:HTMLElement|null=null;
export function rememberOpener(){const el=document.activeElement;opener=el instanceof HTMLElement&&el!==document.body?el:null}
export function restoreOpener(e:Event){const el=opener;opener=null;if(el?.isConnected){e.preventDefault();el.focus()}}
