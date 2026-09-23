// 브랜드 아카이브 진행 표시(03 브랜드 진단 · 04 전략 준비)의 상태와 다음 행동. 값은 아카이브 GET 응답(진단 basis·included, 자료 목록)에서 계산한다.
// 화면 표시용 파생 계산만 한다. 저장 데이터와 서버 동작은 바꾸지 않는다.
const time=(iso:string)=>Date.parse(iso)||0;
export type ArchiveAction='deep'|'classify'|'confirm'|'review'|'data'|'campaign';
export type ArchiveStep={done:boolean;text:string;action?:ArchiveAction};
type StageDiagnosis={status:string;createdAt:string;basis?:string;included?:boolean;researchQuality?:{status:string}};
export function archiveStage({diagnosis:d,fresh,sources,active,canManage}:{diagnosis?:StageDiagnosis;fresh:boolean;sources:{status:string;createdAt:string;characters:number}[];active:boolean;canManage:boolean}):{diagnosis:ArchiveStep;strategy:ArchiveStep}{
 const rerun:ArchiveAction=sources.some(s=>s.characters>0&&s.status!=='excluded')?'classify':'deep';
 const recorded={done:true,text:'기록됨'},needsData=d?.researchQuality?.status==='needs_data';
 if(active&&!(d&&fresh))return {diagnosis:{done:false,text:'조사 진행 중'},strategy:{done:false,text:'진단 후 확정'}};
 if(!d)return {diagnosis:{done:false,text:'진단 없음',action:rerun},strategy:{done:false,text:'진단 후 확정'}};
 const added=sources.filter(s=>s.status!=='excluded'&&time(s.createdAt)>time(d.createdAt)).length;
 if(fresh&&d.status==='confirmed')return {diagnosis:recorded,strategy:{done:true,text:'확정됨',action:'campaign'}};
 if(fresh){
  const wait='진단 확정 대기';
  return {diagnosis:recorded,strategy:needsData?{done:false,text:wait+' · 자료 보완 필요',action:'data'}:d.basis==='pending'?{done:false,text:wait+' · 근거 자료 검토 필요',...(canManage?{action:'review' as const}:{})}:canManage?{done:false,text:wait,action:'confirm'}:{done:false,text:wait+' · 관리자 확정 필요'}};
 }
 // 채택 뒤 브랜드 기준만 바뀐 진단은 근거가 그대로여서 다시 진단하지 않고 다시 채택할 수 있다.
 if(!added&&d.status==='confirmed'&&d.basis==='confirmed')return {diagnosis:recorded,strategy:needsData?{done:false,text:'기준 변경 · 자료 보완 필요',action:'data'}:canManage?{done:false,text:'기준 변경 · 다시 채택 필요',action:'confirm'}:{done:false,text:'기준 변경 · 관리자 재채택 대기'}};
 const reason=added?`자료 ${added}개 추가됨`:d.basis==='empty'?'근거 자료 없음':'근거 자료 변경됨';
 return {diagnosis:{done:false,text:reason+' · 재진단 필요',action:rerun},strategy:{done:false,text:'재진단 후 확정'}};
}
