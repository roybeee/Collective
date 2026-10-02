// 성공 알림 한 형식(UX-PLAN-3 ⑤): 제목은 '…습니다.'로 끝나는 한 문장, 덧붙임은 description, 되돌릴 수 있으면 '되돌리기' 버튼 하나(10초).
// 레인 A 화면은 toast.success를 직접 부르지 않고 이 함수를 쓴다(tests/ux-budget.test.mjs가 센다). 형식은 타입(Saved)이 컴파일 때 막는다.
// sonner는 첫 알림 때 내려받는다(홈 첫 로딩에 넣지 않는다, app/workspace.tsx LazyToaster). 오류 알림은 기존대로 toast.error를 쓴다.
export type Saved=`${string}습니다.`;
export type NotifyOptions={description?:string;duration?:number;action?:{label:string;onClick:()=>void};undo?:()=>unknown;undone?:Saved};
export function notifySaved(message:Saved,{undo,undone='되돌렸습니다.',...rest}:NotifyOptions={}){
 void import('sonner').then(({toast})=>{toast.success(message,undo?{duration:10000,...rest,action:{label:'되돌리기',onClick:()=>{void Promise.resolve().then(undo).then(()=>notifySaved(undone),e=>toast.error(e instanceof Error?e.message:'되돌리지 못했습니다.'))}}}:rest)});
}
