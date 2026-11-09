'use client';
// 채널 연결 탭의 토스플레이스 POS 카드(X-F, docs/POS-INTEGRATION.ko.md). GET /api/pos/tossplace(대표·관리자), POST create·update·enable·disable·reset_cursor·pull_now(소유자).
// 읽기 전용 수집이다. 키는 쓰기 전용 칸이고 응답에 나오지 않는다. 연결을 지우는 API는 없어서 '해제'는 수집 끄기다.
import {useEffect,useState} from 'react';
import {Link2,LoaderCircle,Play,Power,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {MetaLine} from '@/components/app/meta-line';
import {EmptyLine} from '@/components/app/empty-line';
import {askConfirm} from '@/components/app/confirm-dialog';
import {dateTime} from '@/lib/format';
import {notifySaved} from '@/lib/ui/notify';
import {toast} from 'sonner';
import {useAccount} from './account-context';
import {ChannelCard,FormField,RequestError,errorText,request} from './settings-channel-card';
import {posIssue} from './settings-channel-state';

type PosResult={fetched:number;created:number;updated:number;duplicates:number;older:number};
type PosRow={id:string;storeId:string;brandId:string;merchantId:string;enabled:boolean;webhookEnabled:boolean;version:number;intervalMinutes:number;since:string;lastSuccessAt:string|null;lastError:string|null;nextAttemptAt:string|null;lastResult:PosResult|null};
type PosView={connections:PosRow[];enabled:boolean;canEdit:boolean};
type StoreRef={id:string;name:string;brandId:string;status?:string};
type Load={state:'loading'}|{state:'ready';view:PosView}|{state:'denied'|'error';message:string};
const blank={storeId:'',merchantId:'',accessKey:'',secretKey:'',webhookSecret:'',intervalMinutes:'60',since:''};
const OWNER_REASON='소유자만 POS 연결을 바꿀 수 있습니다.';

function PosForm({stores,busy,onSubmit}:{stores:StoreRef[];busy:boolean;onSubmit:(input:Record<string,unknown>)=>Promise<boolean>}){
 const [form,setForm]=useState({...blank,storeId:stores[0]?.id??''}),[issue,setIssue]=useState('');
 const set=(k:keyof typeof blank,v:string)=>{setForm(f=>({...f,[k]:v}));setIssue('')};
 const storeId=stores.some(s=>s.id===form.storeId)?form.storeId:stores[0]?.id??'';
 return <form className="form-stack" noValidate aria-label="토스플레이스 POS 연결" onSubmit={e=>{e.preventDefault();const input={...form,storeId},problem=posIssue(input,true);if(problem){setIssue(problem);return}
  void onSubmit({storeId,merchantId:input.merchantId.trim(),accessKey:input.accessKey,secretKey:input.secretKey,...(input.webhookSecret?{webhookSecret:input.webhookSecret}:{}),intervalMinutes:Number(input.intervalMinutes),...(input.since?{since:input.since}:{})}).then(ok=>{if(ok)setForm({...blank,storeId})})}}>
  <FormField label="지점" help={stores.length?undefined:'운영 중인 지점이 없습니다. 점포 마케팅에서 지점을 먼저 만드세요.'}><NativeSelect aria-label="POS 지점" value={storeId} disabled={!stores.length} onChange={e=>set('storeId',e.target.value)}>{stores.map(s=><NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>)}</NativeSelect></FormField>
  <FormField label="매장 ID(merchantId)" help="개발자센터의 숫자 매장 ID입니다. POS 로그인 번호와 다릅니다."><Input inputMode="numeric" value={form.merchantId} onChange={e=>set('merchantId',e.target.value)}/></FormField>
  <div className="form-two"><FormField label="API Access Key"><Input type="password" autoComplete="off" value={form.accessKey} onChange={e=>set('accessKey',e.target.value)}/></FormField><FormField label="API Secret Key"><Input type="password" autoComplete="off" value={form.secretKey} onChange={e=>set('secretKey',e.target.value)}/></FormField></div>
  <FormField label="웹훅 서명 키 (선택)"><Input type="password" autoComplete="off" value={form.webhookSecret} onChange={e=>set('webhookSecret',e.target.value)}/></FormField>
  <div className="form-two"><FormField label="조회 간격(분)" help="15~1440분"><Input type="number" min={15} max={1440} step={1} value={form.intervalMinutes} onChange={e=>set('intervalMinutes',e.target.value)}/></FormField><FormField label="조회 시작일 (선택)" help="비우면 30일 전부터"><Input type="date" value={form.since} onChange={e=>set('since',e.target.value)}/></FormField></div>
  {issue&&<p className="form-error" role="alert">{issue}</p>}
  <div className="form-actions"><Button type="submit" size="sm" disabled={busy||!stores.length} disabledReason={!stores.length?'운영 중인 지점이 없습니다.':undefined}>{busy?<LoaderCircle className="spin"/>:<Link2/>}연결 저장(꺼진 상태)</Button></div>
 </form>;
}

export function PosCard({brandId,brandName,switchOn,round}:{brandId:string;brandName:string;switchOn:boolean|null;round:number}){
 const account=useAccount(),owner=!!account?.isOwner;
 const [load,setLoad]=useState<Load>({state:'loading'}),[stores,setStores]=useState<StoreRef[]>([]),[again,setAgain]=useState(0),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;
  request<PosView>('/api/pos/tossplace').then(view=>{if(live)setLoad({state:'ready',view})},e=>{if(live)setLoad({state:e instanceof RequestError&&e.status===403?'denied':'error',message:errorText(e)})});
  request<{stores?:StoreRef[]}>('/api/stores').then(d=>{if(live&&Array.isArray(d.stores))setStores(d.stores)},()=>{});
  return()=>{live=false}},[round,again]);
 const view=load.state==='ready'?load.view:null,rows=(view?.connections??[]).filter(c=>c.brandId===brandId),active=rows.find(c=>c.enabled);
 const storeName=(id:string)=>stores.find(s=>s.id===id)?.name??'지점';
 const brandStores=stores.filter(s=>s.brandId===brandId&&s.status!=='archived');
 async function send(body:Record<string,unknown>,saved:`${string}습니다.`){setBusy(true);try{await request('/api/pos/tossplace',body);notifySaved(saved);setAgain(n=>n+1);return true}catch(e){toast.error(errorText(e));return false}finally{setBusy(false)}}
 async function toggle(row:PosRow){
  if(row.enabled&&!(await askConfirm({title:'POS 자동 수집을 끌까요?',fields:{what:'토스플레이스 주문·결제 읽기',where:`${storeName(row.storeId)} (매장 ID ${row.merchantId})`,cost:'비용 변화 없음',reversible:'같은 카드에서 다시 켜면 이어서 읽습니다'},impact:'끄면 이 지점의 주문 장부에 새 POS 주문이 들어오지 않습니다. 이미 들어온 주문은 남습니다.',undo:'다시 켜면 됩니다.',confirmLabel:'수집 끄기',danger:true})))return;
  await send({action:row.enabled?'disable':'enable',id:row.id,expectedVersion:row.version},row.enabled?'POS 수집을 껐습니다.':'POS 수집을 켰습니다.');
 }
 const editReason=!owner?OWNER_REASON:undefined;
 return <ChannelCard channel="pos_tossplace" title="토스플레이스 POS" lead="지점 POS 주문을 읽기 전용으로 장부에 넣습니다." connected={load.state==='ready'?!!active:null} account={active?metaAccount(storeName(active.storeId),active.merchantId):undefined} switchOn={switchOn} switchNote={switchOn?'켜진 연결을 워커가 읽음':'꺼져 있으면 수집 안 함'}>
  {load.state==='denied'&&<p className="subtle-note" role="note">{load.message}</p>}
  {load.state==='error'&&<p className="form-error" role="alert">{load.message} <Button variant="link" size="sm" className="h-auto p-0" onClick={()=>setAgain(n=>n+1)}><RefreshCw/>다시 시도</Button></p>}
  {load.state==='ready'&&(rows.length?<ul className="channel-rows" aria-label={`${brandName} POS 연결`}>{rows.map(r=><li key={r.id} data-enabled={r.enabled}>
   <MetaLine items={[storeName(r.storeId),'매장 ID '+r.merchantId,r.enabled?'수집 켜짐':'수집 꺼짐',r.lastSuccessAt&&'마지막 성공 '+dateTime(r.lastSuccessAt),r.lastError&&'최근 실패 '+r.lastError,r.lastResult&&`새 주문 ${r.lastResult.created}건`]}/>
   <div className="form-actions">
    <Button variant="outline" size="sm" disabled={busy||!owner} disabledReason={editReason} onClick={()=>void toggle(r)}><Power/>{r.enabled?'수집 끄기(해제)':'수집 켜기'}</Button>
    <Button variant="outline" size="sm" disabled={busy||!owner||!r.enabled} disabledReason={editReason??(!r.enabled?'수집을 먼저 켜세요.':undefined)} onClick={()=>void send({action:'pull_now',id:r.id},'한 페이지를 읽어 확인했습니다.')}><Play/>지금 확인</Button>
   </div></li>)}</ul>:<EmptyLine next={owner?'연결 버튼으로 저장하세요.':'소유자가 연결합니다.'}>연결된 POS가 없습니다.</EmptyLine>)}
  <div className="form-actions"><Button variant="outline" size="sm" aria-expanded={open} disabled={!owner} disabledReason={OWNER_REASON} onClick={()=>setOpen(v=>!v)}><Link2/>연결</Button></div>
  {open&&<PosForm key={brandId} stores={brandStores} busy={busy} onSubmit={input=>send({action:'create',input},'POS 연결을 저장했습니다.').then(ok=>{if(ok)setOpen(false);return ok})}/>}
 </ChannelCard>;
}
const metaAccount=(store:string,merchant:string)=>`${store}, 매장 ID ${merchant}`;
