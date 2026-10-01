import {fieldForError} from '@/lib/field-error';
// 서버가 저장을 거절하면(토스트 오류·role=alert) 방금 누른 버튼이 있던 폼·대화상자·구역에서 메시지가 가리키는 입력 칸을 찾아
// aria-invalid를 달고 칸 아래에 사유를 보이고(라벨 data-field-error, CSS가 그림) 초점을 옮긴다(UX-PLAN-3 Q3). 폼마다 고치지 않는다.
// 보이는 사유는 CSS 생성 문구라 접근 가능한 이름에 섞이지 않게(content alt "") 하고, 화면 읽기 프로그램에는 aria-description으로 알린다. 칸을 다시 고치면 표시를 지운다. 이미 칸 오류를 직접 그리는 폼(aria-invalid가 있는 곳)과 8초가 지난 오류는 건드리지 않는다.
const WINDOW_MS=8000;
type Control=HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement;
const labelOf=(c:Control)=>(c.labels?.[0]?.textContent||c.getAttribute('aria-label')||'').trim();
function mark(control:Control,message:string){
 const holder=control.closest('label')??control.parentElement;
 control.setAttribute('aria-invalid','true');control.setAttribute('aria-description',message);holder?.setAttribute('data-field-error',message);
 const clear=()=>{control.removeAttribute('aria-invalid');control.removeAttribute('aria-description');holder?.removeAttribute('data-field-error')};
 control.addEventListener('input',clear,{once:true});control.addEventListener('change',clear,{once:true});
 control.focus({preventScroll:false});
}
// 홈 첫 로딩에 싣지 않는다(UX-PLAN-3 Q7): 워크스페이스가 첫 누름·키 입력 때 이 모듈을 내려받아 설치하고, 그 첫 입력도 함께 넘긴다(lib/ui/field-errors.ts).
export function installFieldErrorBridge(first?:Event):()=>void{
  let last:{scope:Element;at:number}|null=null;
  const remember=(e:Event)=>{if(!(e.target instanceof Element))return;if(e.type==='submit'){last={scope:e.target,at:Date.now()};return}const t=e.target.closest('button,[type=submit]');if(!t)return;const scope=t.closest('form')??t.closest('[role=dialog]')??t.closest('section');if(scope)last={scope,at:Date.now()}};
  const apply=(message:string)=>{
   if(!last||Date.now()-last.at>WINDOW_MS||!last.scope.isConnected||last.scope.querySelector('[aria-invalid=true]'))return;
   const controls=([...last.scope.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')] as Control[]).filter(c=>!c.disabled&&c.checkVisibility?.()!==false);
   const key=fieldForError(message,controls.map((c,i)=>({key:String(i),label:labelOf(c)})));
   if(key!==null)mark(controls[Number(key)],message);
  };
  const observer=new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes){if(!(n instanceof Element))continue;
   const toast=n.matches('[data-sonner-toast][data-type=error]')?n:n.querySelector('[data-sonner-toast][data-type=error]');
   const alert=n.matches('[role=alert]')?n:n.querySelector('[role=alert]');
   const text=(toast?.querySelector('[data-title]')??toast??alert)?.textContent?.trim();if(text)apply(text)}});
  if(first)remember(first);
  document.addEventListener('click',remember,true);document.addEventListener('submit',remember,true);
  observer.observe(document.body,{childList:true,subtree:true});
  return()=>{observer.disconnect();document.removeEventListener('click',remember,true);document.removeEventListener('submit',remember,true)};
 }
