// 키보드 초점 지킴이(UX-PLAN-3 ⑨, 평가 10회차 ⑧·⑨). 누른 버튼이 저장 중 잠기거나(버튼·fieldset disabled) 결과 반영으로 목록에서 빠지면
// 브라우저는 초점을 body로 떨군다. 그러면 키보드·화면 낭독기 사용자는 자리를 잃고 문서 처음부터 다시 Tab해야 한다.
// 초점을 잃은 요소를 기억했다가 (1) 다시 누를 수 있게 풀리면 그 요소로, (2) 빠졌거나 계속 잠겨 있으면 같은 영역(section·region·dialog)의
// 바뀐 결과 문구(role=status·alert)로 초점을 옮긴다. 그 사이 화면이 초점을 다른 곳(다음 단계 칸·새 화면 제목 등)으로 옮겼으면 아무것도 하지 않는다.
// 사용자가 빈 곳을 눌러 초점을 뺀 경우(요소는 그대로 누를 수 있음)는 손대지 않는다. 검사: e2e/ux-keyboard-tasks.spec.ts(데스크톱·모바일).
type Pending={el:HTMLElement;region:HTMLElement|null;before:Map<Element,string>;until:number};
const regionOf=(el:HTMLElement)=>el.closest<HTMLElement>('[role=dialog],[role=alertdialog],section,[role=region]');
const statuses=(region:HTMLElement|null)=>region?[...region.querySelectorAll<HTMLElement>('[role=status],[role=alert]')]:[];
const usable=(el:HTMLElement)=>el.isConnected&&!el.matches(':disabled')&&!el.closest('[inert],[aria-hidden=true]')&&el.getClientRects().length>0;
const lostFocus=()=>{const a=document.activeElement;return !a||a===document.body||a===document.documentElement};
export function keepFocus(){
 let last:HTMLElement|null=null,lastRegion:HTMLElement|null=null,snapshot=new Map<Element,string>(),restoring=false,pending:Pending|null=null,frame=0,quiet=0;
 const clear=()=>{pending=null;cancelAnimationFrame(frame);clearTimeout(quiet)};
 // 영역과 그 안의 결과 문구는 사용자가 초점을 옮겨 올 때 기억한다(빠진 요소는 문서에서 떨어져 조상을 찾을 수 없고, 결과 문구는 요소가 빠지기 전에 먼저 바뀔 수 있다).
 const start=(el:HTMLElement)=>{pending={el,region:lastRegion,before:snapshot,until:Date.now()+15000}};
 // 잠금이 풀린 요소로 돌려줄 때는 기억(영역·결과 문구)을 새로 잡지 않는다. 그 뒤 요소가 목록에서 빠지면 같은 기억으로 결과 문구를 찾는다.
 const restore=(el:HTMLElement)=>{restoring=true;try{el.focus()}finally{restoring=false}};
 // 결과 문구로 옮기는 것은 화면이 잠잠해진 뒤(0.4초 변화 없음)에 한다. 저장 중 문구('…하고 있습니다')를 거쳐 잠금이 풀리는 경우 원래 버튼이 먼저다.
 const settle=()=>{const p=pending;if(!p)return;if(!lostFocus()&&document.activeElement!==p.el){clear();return}
  if(usable(p.el)){clear();restore(p.el);return}
  if(!p.region?.isConnected){clear();return}
  const changed=statuses(p.region).filter(s=>s.getClientRects().length>0&&(s.textContent??'').trim()&&p.before.get(s)!==s.textContent);
  const target=changed[changed.length-1];if(!target)return;
  clear();if(!target.hasAttribute('tabindex'))target.tabIndex=-1;target.focus();
 };
 const check=()=>{const p=pending;if(!p)return;if(Date.now()>p.until){clear();return}
  if(!lostFocus()&&document.activeElement!==p.el){clear();return}
  if(usable(p.el)&&document.activeElement!==p.el){clear();restore(p.el);return}
  clearTimeout(quiet);quiet=window.setTimeout(settle,400);
 };
 const onMutate=()=>{
  if(!pending&&last&&(document.activeElement===last||lostFocus())&&(!last.isConnected||last.matches(':disabled')))start(last);
  if(pending){cancelAnimationFrame(frame);frame=requestAnimationFrame(check)}
 };
 const onFocusIn=(e:FocusEvent)=>{if(!restoring){last=e.target instanceof HTMLElement?e.target:null;lastRegion=last&&regionOf(last);snapshot=new Map(statuses(lastRegion).map(s=>[s,s.textContent??'']))}if(pending&&e.target!==pending.el)clear()};
 // 빈 곳을 누르거나 창을 떠나 초점이 빠졌고 요소는 그대로 누를 수 있으면 기억을 지운다. 요소를 지울 때도 지우기 직전에 focusout이 오므로 지운 뒤(다음 마이크로태스크)에 판단한다.
 const onFocusOut=(e:FocusEvent)=>{const el=e.target;if(e.relatedTarget||!(el instanceof HTMLElement)||el!==last)return;queueMicrotask(()=>{if(el===last&&el.isConnected&&!el.matches(':disabled'))last=null})};
 const observer=new MutationObserver(onMutate);
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
 document.addEventListener('focusin',onFocusIn);document.addEventListener('focusout',onFocusOut);
 return ()=>{observer.disconnect();clear();document.removeEventListener('focusin',onFocusIn);document.removeEventListener('focusout',onFocusOut)};
}
