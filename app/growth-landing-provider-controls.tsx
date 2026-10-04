'use client';
import {GROWTH_PROVIDER_ORIGINS} from '@/lib/growth-provider';
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import type {GrowthLandingView} from '@/lib/growth-landing-server';
import {CheckInput} from '@/components/app/check';
import {MetaLine} from '@/components/app/meta-line';
import {askConfirm} from '@/components/app/confirm-dialog';
import {metaText} from '@/lib/format';
type Send=(body:Record<string,unknown>,message:string)=>Promise<boolean>;
type Props={view:GrowthLandingView;busy:boolean;stale:boolean;send:Send};
export function LandingProviderConnectionControls({view,busy,stale,send}:Props){
 const connection=view.providerConnection;
 const [input,setInput]=useState({baseUrl:connection?.baseUrl??GROWTH_PROVIDER_ORIGINS[0],tenantId:connection?.tenantId??'',providerStoreId:connection?.providerStoreId??'',secret:''});
 const [installed,setInstalled]=useState(false),[evidenceRef,setEvidenceRef]=useState('');
 const disabled=busy||stale||!view.canManageProvider;
 const why=!view.canManageProvider?'판매처 연결 설정과 변경은 소유자만 할 수 있습니다.':stale?'최신 연결 상태를 다시 불러오세요.':undefined;
 return <details><summary>판매처 상품 설명 연결 {connection?.enabled?'켜짐':connection?'꺼짐':'미연결'}</summary>
  <p>실제 판매처 상품 저장소를 사용하는 bridge가 설치되어야 합니다. 독립 SQLite 예제는 운영 상품을 바꾸지 않습니다. 연결 저장 시 기본 꺼짐이며, 구매 이유 한 구역의 전체 설명만 교체합니다.</p>
  {why&&<p>{why}</p>}
  {connection&&<p><MetaLine items={[`연결 v${connection.version}`,`게시 위임 계정 ${connection.accountId}`,'채널 storefront',`설치 근거 ${connection.installationEvidenceRef||'없음'}`]}/></p>}
  <form onSubmit={async e=>{e.preventDefault();if(await send({action:'provider_configure',expectedVersion:connection?.version??0,input},'연결을 꺼짐 상태로 저장했습니다.'))setInput(x=>({...x,secret:''}));}}>
   <fieldset disabled={disabled}><legend>판매처 서명 연결</legend>
    <label>판매처 주소<NativeSelect value={input.baseUrl} onChange={e=>setInput({...input,baseUrl:e.target.value})}>{GROWTH_PROVIDER_ORIGINS.map(origin=><option key={origin} value={origin}>{origin}</option>)}</NativeSelect></label>
    <label>판매처 tenant ID<Input required maxLength={100} pattern="[A-Za-z0-9_-]+" value={input.tenantId} onChange={e=>setInput({...input,tenantId:e.target.value})}/></label>
    <label>판매처 store ID<Input required maxLength={100} pattern="[A-Za-z0-9_-]+" value={input.providerStoreId} onChange={e=>setInput({...input,providerStoreId:e.target.value})}/></label>
    <label>판매처 서명키 {connection?'(비우면 기존 키 유지)':''}<Input type="password" name="collective-landing-signing-key" autoComplete="new-password" required={!connection} value={input.secret} onChange={e=>setInput({...input,secret:e.target.value})}/></label>
    <Button type="submit" variant="panel" size="fit" disabled={disabled} disabledReason={why}>판매처 연결 저장</Button>
   </fieldset>
  </form>
  {connection&&<fieldset disabled={disabled}><legend>실제 상품 저장소 연결 확인</legend>
   {!connection.enabled&&<><label><CheckInput checked={installed} onChange={e=>setInstalled(e.target.checked)}/> 독립 예제가 아닌 실제 판매처 상품 저장소 어댑터 설치와 변경 권한을 확인했습니다.</label><label>어댑터 설치 확인 증빙 ID<Input maxLength={100} pattern="[A-Za-z0-9_-]+" value={evidenceRef} onChange={e=>setEvidenceRef(e.target.value)}/></label></>}
   <Button type="button" variant="panel" size="fit" disabled={!connection.enabled&&(!installed||!evidenceRef)} disabledReason={!connection.enabled&&(!installed||!evidenceRef)?'실제 상품 저장소 어댑터 설치 확인과 증빙 ID가 필요합니다.':undefined} onClick={()=>void send({action:connection.enabled?'provider_disable':'provider_enable',expectedVersion:connection.version,...(!connection.enabled?{installed,evidenceRef}:{})},connection.enabled?'판매처 변경 연결을 껐습니다.':'판매처 변경 연결을 켰습니다. 개별 수정안은 별도 승인·적용해야 합니다.')}>{connection.enabled?'판매처 변경 연결 끄기':'판매처 변경 연결 켜기'}</Button>
  </fieldset>}
 </details>;
}
export function LandingProviderProposalControls({view,proposal:p,busy,stale,send}:Props&{proposal:GrowthLandingView['proposals'][number]}){
 const [productId,setProductId]=useState(()=>{try{return decodeURIComponent(new URL(p.input.landingUrl).pathname).match(/^\/p\/([A-Za-z0-9_:-]+)$/)?.[1]??''}catch{return ''}}),[authorityId,setAuthorityId]=useState(''),[reason,setReason]=useState('');
 const state=p.provider,attempt=state?.attempt,authority=view.providerAuthorities.find(a=>a.id===authorityId),connection=view.providerConnection;
 const disabled=busy||stale||!view.canManageProvider;
 const confirming=useRef(false);
 const why=stale?'최신 수정안과 연결 상태를 불러오세요.':!view.canManageProvider?'소유자만 판매처 변경을 실행합니다.':undefined;
 const sendAction=(action:string,extra:Record<string,unknown>,message:string)=>send({action,id:p.id,expectedVersion:p.version,...extra},message);
 async function change(rollback:boolean){
  if(disabled||confirming.current)return;confirming.current=true;
  try{if(await askConfirm({title:rollback?'원본 설명으로 복원할까요?':'승인 설명을 실제 적용할까요?',impact:rollback?'다른 편집이 없을 때만 승인 전 상품 설명으로 복원합니다.':'승인한 설명을 실제 판매처 상품에 적용합니다.',undo:rollback?'다시 적용하려면 새 수정안을 승인해야 합니다.':'다른 편집이 없으면 공급자 원본 복원으로 되돌릴 수 있습니다.',confirmLabel:rollback?'원본 복원':'실제 적용'}))await sendAction(rollback?'provider_rollback':'provider_apply',{confirm:true,...(rollback?{reason}:{})},rollback?'판매처 되돌림 요청을 처리했습니다.':'판매처 적용 요청을 처리했습니다.');}finally{confirming.current=false;}
 }
 async function reapprove(){
  if(disabled||!authority||confirming.current)return;confirming.current=true;
  try{if(await askConfirm({title:'원본 복원 권한을 다시 승인할까요?',impact:'같은 판매처 상품의 적용 결과와 현재 위임을 확인해 복원 권한을 저장합니다.',undo:'실제 복원은 별도 버튼으로 실행합니다.',confirmLabel:'복원 재승인'}))await sendAction('provider_approve_recovery',{confirm:true,authorityId:authority.id,authorityVersion:authority.version},'현재 연결과 위임으로 원본 복원을 재승인했습니다.');}finally{confirming.current=false;}
 }
 return <div aria-label={`${p.id} 판매처 실행`}>
  {!view.canManageProvider&&<p>판매처 원본 연결·변경·복원은 소유자만 실행합니다.</p>}
  {state&&<p><MetaLine items={[`상품 ${state.binding.productId}`,`원본 v${state.binding.productVersion}`,`위임 ${state.binding.authorityId} v${state.binding.authorityVersion}`,attempt?attempt.status==='unknown'?'결과불명: 새 전송 금지, 영수증 조회 필요':attempt.status==='verified'?'공급자 영수증·현재 내용 일치 확인':'공급자 거절: 새 수정안으로 검토':'상품 원본 연결됨, 아직 미적용']}/></p>}
  {connection&&p.status==='draft'&&!attempt&&<fieldset disabled={disabled}><legend>승인 전 판매처 상품 원본 연결</legend>
   <p>구매 이유 단일 구역의 현재 문구가 상품 설명 전체와 같아야 합니다. 연결 후 수정안을 승인하세요.</p>
   <label>판매처 상품 ID<Input value={productId} maxLength={100} pattern="[A-Za-z0-9_:-]+" onChange={e=>setProductId(e.target.value)}/></label>
   <label>상품 설명 게시 위임<NativeSelect value={authorityId} onChange={e=>setAuthorityId(e.target.value)}><option value="">위임 선택</option>{view.providerAuthorities.map(a=><option key={a.id} value={a.id}>{metaText([a.id,`v${a.version}`,a.status==='active'?'유효':a.status==='revoked'?'철회':'초안'])}</option>)}</NativeSelect></label>
   {!view.providerAuthorities.length&&<p>판매 위임 화면에서 계정 {connection.accountId}, 채널 storefront, T2 publish 권한과 비용·손실 한도를 먼저 승인하세요.</p>}
   <Button type="button" variant="panel" size="fit" disabled={!authority||!productId} disabledReason={!authority||!productId?'상품 ID와 게시 위임을 선택하세요.':undefined} onClick={()=>void sendAction('provider_bind',{productId,authorityId,authorityVersion:authority?.version},'판매처 원본과 위임 판을 연결했습니다. 변경 내용을 확인한 뒤 승인하세요.')}>{p.id} 판매처 원본 연결</Button>
  </fieldset>}
  {state&&p.status==='approved'&&!attempt&&<Button type="button" variant="panel" size="fit" disabled={disabled||!connection?.enabled||state.binding.connectionVersion!==connection.version||!p.approvalValid||p.sourceStatus!=='current'||!!p.readiness.missing.length} disabledReason={why??(!connection?.enabled?'판매처 변경 연결을 켜세요.':state.binding.connectionVersion!==connection.version?'연결 판이 바뀌어 새 수정안 검토가 필요합니다.':!p.approvalValid||p.sourceStatus!=='current'||!!p.readiness.missing.length?'승인판과 원천 근거를 확인하세요.':undefined)} onClick={()=>void change(false)}>{p.id} 승인 설명 실제 적용</Button>}
  {attempt?.status==='unknown'&&<Button type="button" variant="panel" size="fit" disabled={disabled} disabledReason={why} onClick={()=>void sendAction('provider_reconcile',{},'공급자 영수증과 현재 설명을 조회했습니다.')}>{p.id} 공급자 결과 조회</Button>}
  {state&&p.status==='applied'&&attempt?.status==='verified'&&<fieldset disabled={disabled}><legend>판매처 원본 복원</legend>
   <p>연결을 껐다 켜거나 위임 판이 변경됐다면 현재 위임으로 복원을 재승인하세요. 원래 적용 승인과 상품 원본은 그대로 보존합니다.</p>
   {state.recoveryApproval&&<p><MetaLine items={[`복원 재승인 연결 v${state.recoveryApproval.connectionVersion}`,`위임 ${state.recoveryApproval.authorityId} v${state.recoveryApproval.authorityVersion}`]}/></p>}
   <label>복원 재승인 위임<NativeSelect value={authorityId} onChange={e=>setAuthorityId(e.target.value)}><option value="">위임 선택</option>{view.providerAuthorities.map(a=><option key={a.id} value={a.id}>{metaText([a.id,`v${a.version}`,a.status==='active'?'유효':a.status==='revoked'?'철회':'초안'])}</option>)}</NativeSelect></label>
   <Button type="button" variant="panel" size="fit" disabled={!authority||!connection?.enabled} disabledReason={!authority?'현재 복원 위임을 선택하세요.':!connection?.enabled?'동일 판매처 연결을 켜세요.':undefined} onClick={()=>void reapprove()}>{p.id} 원본 복원 재승인</Button>
   <label>공급자 되돌림 사유<Input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label>
   <Button type="button" variant="panel" size="fit" disabled={!reason||!connection?.enabled||(state.recoveryApproval?.connectionVersion??state.binding.connectionVersion)!==connection.version} disabledReason={!reason?'되돌림 사유를 입력하세요.':!connection?.enabled?'판매처 변경 연결을 켜세요.':(state.recoveryApproval?.connectionVersion??state.binding.connectionVersion)!==connection.version?'변경된 연결판으로 원본 복원을 재승인하세요.':undefined} onClick={()=>void change(true)}>{p.id} 원본 설명 실제 복원</Button>
  </fieldset>}
 </div>;
}
