// 미저장 입력 보호(UX-PLAN P3). 편집기가 dirty 여부를 알리면 캠페인 탭 전환·시트 닫기·창 닫기 전에 확인한다.
// 화면 상태만 다루며 서버에는 아무것도 보내지 않는다.
import {t} from '@/lib/ui-copy';
import {askConfirm} from '@/components/app/confirm-dialog';
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
/** 저장하지 않은 입력이 있으면 공용 확인 대화상자로 묻고, 이동해도 되면 go를 부른다(그때 dirty 표시를 비운다).
 * 브라우저 기본 확인창은 창 닫기·새로고침(beforeunload)에만 남는다(UX-PLAN-3 5차원, 평가 7회차). */
export function leaveThen(go:()=>void){
 if(!dirty.size){go();return}
 void askConfirm({title:'저장하지 않은 입력이 있습니다',body:t('unsavedLeave'),impact:'이동하면 이 화면에 쓴 입력이 사라집니다.',undo:'되돌릴 수 없습니다. 남기려면 취소하고 먼저 저장하세요.',confirmLabel:'저장하지 않고 이동',danger:true}).then(ok=>{if(ok){dirty.clear();go()}});
}
