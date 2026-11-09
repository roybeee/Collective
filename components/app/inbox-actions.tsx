'use client';
// 결정 인박스 행 안 동작(GLOBAL-PLAN X1). 기존 API만 쓴다: 작업물 승인·수정 요청은 POST /api/action review_artifact, 발행 승인은 GET /api/execution으로 현재 계정·한도 버전을 읽어 POST /api/execution approve.
// 확인은 승인 카드 v2(askDecision/askConfirm: 무엇·어디·언제·비용·되돌림)로 묻고, 일괄 승인은 confirm:false로 묻지 않고 실행한다. 돌려주는 값은 '…습니다.' 성공 문장, 취소면 null. 외부 실행은 없다.
import {askConfirm,askDecision} from './confirm-dialog';
import {dateTime} from '@/lib/format';
import {localMoney as money,t} from '@/lib/i18n';
import type {AgendaItem} from '@/lib/agenda-types';
import type {ExecutionState} from '@/lib/execution';
import '@/lib/i18n/lazy'; // 이 화면의 한국어 원본(lib/i18n/ko-lazy.ts)을 등록한다. 홈 첫 로딩에는 싣지 않는다.
async function request<T=unknown>(path:string,input?:Record<string,unknown>):Promise<T>{
 const r=await fetch(path,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);
 const d=await r.json().catch(()=>({})) as T&{error?:string};if(!r.ok)throw new Error(d.error||t('inbox.failed'));return d;
}
const whereText=(item:AgendaItem)=>[item.campaignTitle,...(item.where??[])].join(', ');
export async function requestArtifactChanges(item:AgendaItem,message:string):Promise<string>{
 if(item.action?.type!=='review_artifact')throw new Error(t('inbox.notArtifact'));
 if(!message.trim())throw new Error(t('inbox.needMessage'));
 await request('/api/action',{action:'review_artifact',id:item.action.recordId,version:item.action.version,decision:'revision',note:message.trim()});
 return t('inbox.changesRequested');
}
async function approveArtifact(item:AgendaItem,confirm:boolean):Promise<string|null>{
 const a=item.action;if(a?.type!=='review_artifact')return null;
 if(confirm){
  const d=await askDecision({title:t('inbox.approveArtifactTitle',{title:item.title}),fields:{what:item.detail,where:whereText(item),reversible:t('inbox.artifactReversible')},impact:t('inbox.artifactImpact'),undo:t('inbox.artifactUndo'),confirmLabel:t('inbox.approve'),requestChanges:{label:t('confirm.requestChanges')}});
  if(!d)return null;if(d.decision==='changes')return requestArtifactChanges(item,d.message);
 }
 await request('/api/action',{action:'review_artifact',id:a.recordId,version:a.version,decision:'approved',note:''});
 return t('inbox.artifactApproved');
}
async function approvePublication(item:AgendaItem,confirm:boolean):Promise<string|null>{
 const a=item.action;if(a?.type!=='approve_publication')return null;
 if(a.aiCopy||a.codedPng)throw new Error(t('inbox.aiCopyBlocked'));
 const state=await request<ExecutionState>('/api/execution?campaignId='+encodeURIComponent(item.campaignId)),p=state.publications.find(x=>x.id===a.recordId);
 if(!p||p.status!=='draft')throw new Error(t('inbox.publicationMissing'));
 if(confirm){
  const ok=await askConfirm({title:t('inbox.approvePublicationTitle'),fields:{what:item.detail||t('inbox.publicationWhat'),where:[item.campaignTitle,...(item.where??[]),t('inbox.account',{account:state.publisher.account||state.publisher.channelId||t('inbox.needConnection')})].join(', '),when:dateTime(p.scheduledAt),cost:money(p.plannedCostKRW),reversible:t('inbox.publicationReversible')},impact:t('inbox.publicationImpact'),undo:t('inbox.publicationUndo'),confirmLabel:t('inbox.approvePublication')});
  if(!ok)return null;
 }
 // 승인 본문은 제작·발행 탭과 같은 규칙(lib/execution.ts approvalRequest)이다. 홈 첫 로딩에 넣지 않도록 필요할 때 내려받는다.
 const {approvalRequest,codedPngApproval}=await import('@/lib/execution');
 await request('/api/execution',{action:'approve',campaignId:item.campaignId,id:p.id,version:p.version,...approvalRequest(p,state,false),...codedPngApproval(p,false)});
 return t('inbox.publicationApproved');
}
export function approveAgendaItem(item:AgendaItem,{confirm}:{confirm:boolean}):Promise<string|null>{
 if(item.action?.type==='review_artifact')return approveArtifact(item,confirm);
 if(item.action?.type==='approve_publication')return approvePublication(item,confirm);
 return Promise.reject(new Error(t('inbox.cannotApprove')));
}
