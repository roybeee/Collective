'use client';
// 결정 인박스 행 안 동작(GLOBAL-PLAN X1). 기존 API만 쓴다: 작업물 승인·수정 요청은 POST /api/action review_artifact, 발행 승인은 GET /api/execution으로 현재 계정·한도 버전을 읽어 POST /api/execution approve.
// 확인은 승인 카드 v2(askDecision/askConfirm: 무엇·어디·언제·비용·되돌림)로 묻고, 일괄 승인은 confirm:false로 묻지 않고 실행한다. 돌려주는 값은 '…습니다.' 성공 문장, 취소면 null. 외부 실행은 없다.
import {askConfirm,askDecision} from './confirm-dialog';
import {dateTime,money} from '@/lib/format';
import type {AgendaItem} from '@/lib/agenda-types';
import type {ExecutionState} from '@/lib/execution';
async function request<T=unknown>(path:string,input?:Record<string,unknown>):Promise<T>{
 const r=await fetch(path,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);
 const d=await r.json().catch(()=>({})) as T&{error?:string};if(!r.ok)throw new Error(d.error||'처리하지 못했습니다.');return d;
}
const whereText=(item:AgendaItem)=>[item.campaignTitle,...(item.where??[])].join(', ');
export async function requestArtifactChanges(item:AgendaItem,message:string):Promise<string>{
 if(item.action?.type!=='review_artifact')throw new Error('수정 요청할 수 있는 작업물이 아닙니다.');
 if(!message.trim())throw new Error('수정 요청 내용을 적어 주세요.');
 await request('/api/action',{action:'review_artifact',id:item.action.recordId,version:item.action.version,decision:'revision',note:message.trim()});
 return '수정을 요청했습니다.';
}
async function approveArtifact(item:AgendaItem,confirm:boolean):Promise<string|null>{
 const a=item.action;if(a?.type!=='review_artifact')return null;
 if(confirm){
  const d=await askDecision({title:`${item.title}: 이 판을 승인할까요?`,fields:{what:item.detail,where:whereText(item),reversible:'승인 기록은 작업물 이력에 남습니다. 내용을 고쳐 새 판을 저장하면 다시 검토합니다.'},impact:'이 판을 승인으로 기록합니다. 광고 집행이나 외부 게시로 이어지지 않습니다.',undo:'승인 기록은 작업물 이력에 남습니다.',confirmLabel:'승인',requestChanges:{label:'변경 요청'}});
  if(!d)return null;if(d.decision==='changes')return requestArtifactChanges(item,d.message);
 }
 await request('/api/action',{action:'review_artifact',id:a.recordId,version:a.version,decision:'approved',note:''});
 return '작업물을 승인했습니다.';
}
async function approvePublication(item:AgendaItem,confirm:boolean):Promise<string|null>{
 const a=item.action;if(a?.type!=='approve_publication')return null;
 if(a.aiCopy||a.codedPng)throw new Error('AI 카피·코드 PNG 발행은 제작·발행 탭에서 표시 확인란을 체크하고 승인하세요.');
 const state=await request<ExecutionState>('/api/execution?campaignId='+encodeURIComponent(item.campaignId)),p=state.publications.find(x=>x.id===a.recordId);
 if(!p||p.status!=='draft')throw new Error('승인 전 발행을 찾을 수 없습니다. 안건을 새로고침하세요.');
 if(confirm){
  const ok=await askConfirm({title:'이 발행을 승인할까요?',fields:{what:item.detail||'발행 소재',where:[item.campaignTitle,...(item.where??[]),`계정 ${state.publisher.account||state.publisher.channelId||'연결 필요'}`].join(', '),when:dateTime(p.scheduledAt),cost:money(p.plannedCostKRW),reversible:'접수 전까지 이 발행을 취소할 수 있습니다. Buffer에 접수한 뒤에는 Buffer에서 취소합니다.'},impact:'승인하면 이 PNG를 앱 공개 주소로 제공하고 접수 단계로 넘어갑니다. 아직 Buffer에 보내지 않습니다.',undo:'접수 전에는 이 발행 취소로 되돌립니다.',confirmLabel:'발행 승인'});
  if(!ok)return null;
 }
 // 승인 본문은 제작·발행 탭과 같은 규칙(lib/execution.ts approvalRequest)이다. 홈 첫 로딩에 넣지 않도록 필요할 때 내려받는다.
 const {approvalRequest,codedPngApproval}=await import('@/lib/execution');
 await request('/api/execution',{action:'approve',campaignId:item.campaignId,id:p.id,version:p.version,...approvalRequest(p,state,false),...codedPngApproval(p,false)});
 return '발행을 승인했습니다.';
}
export function approveAgendaItem(item:AgendaItem,{confirm}:{confirm:boolean}):Promise<string|null>{
 if(item.action?.type==='review_artifact')return approveArtifact(item,confirm);
 if(item.action?.type==='approve_publication')return approvePublication(item,confirm);
 return Promise.reject(new Error('행 안에서 승인할 수 없는 항목입니다. 열어서 처리하세요.'));
}
