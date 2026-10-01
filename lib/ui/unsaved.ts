// 미저장 입력 보호(UX-PLAN P3). 편집기가 dirty 여부를 알리면 캠페인 탭 전환·시트 닫기·창 닫기 전에 확인한다.
// 화면 상태만 다루며 서버에는 아무것도 보내지 않는다.
import {t} from '@/lib/ui-copy';
const dirty=new Set<string>();
let listening=false;
function beforeUnload(e:BeforeUnloadEvent){if(dirty.size){e.preventDefault();e.returnValue='';}}
export function markDirty(id:string,value:boolean){
 if(value)dirty.add(id);else dirty.delete(id);
 if(typeof window==='undefined')return;
 if(dirty.size&&!listening){window.addEventListener('beforeunload',beforeUnload);listening=true;}
 else if(!dirty.size&&listening){window.removeEventListener('beforeunload',beforeUnload);listening=false;}
}
export const hasUnsaved=()=>dirty.size>0;
/** 저장하지 않은 입력이 있으면 확인을 받는다. 이동해도 되면 true(그때 dirty 표시를 비운다). */
export function confirmLeave(){if(!dirty.size)return true;const ok=window.confirm(t('unsavedLeave'));if(ok)dirty.clear();return ok;}
