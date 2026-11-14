'use client';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import '@/lib/i18n/lazy-settings';
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
import {notifySaved,type Saved} from '@/lib/ui/notify';
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
const OWNER_REASON=()=>t('spos.ownerOnly');

function PosForm({stores,busy,onSubmit}:{stores:StoreRef[];busy:boolean;onSubmit:(input:Record<string,unknown>)=>Promise<boolean>}){useT();
 const [form,setForm]=useState({...blank,storeId:stores[0]?.id??''}),[issue,setIssue]=useState('');
 const set=(k:keyof typeof blank,v:string)=>{setForm(f=>({...f,[k]:v}));setIssue('')};
 const storeId=stores.some(s=>s.id===form.storeId)?form.storeId:stores[0]?.id??'';
 return <form className="form-stack" noValidate aria-label={t('spos.formTitle')} onSubmit={e=>{e.preventDefault();const input={...form,storeId},problem=posIssue(input,true);if(problem){setIssue(problem);return}
  void onSubmit({storeId,merchantId:input.merchantId.trim(),accessKey:input.accessKey,secretKey:input.secretKey,...(input.webhookSecret?{webhookSecret:input.webhookSecret}:{}),intervalMinutes:Number(input.intervalMinutes),...(input.since?{since:input.since}:{})}).then(ok=>{if(ok)setForm({...blank,storeId})})}}>
  <FormField label={t('spos.store')} help={stores.length?undefined:t('spos.noStores')}><NativeSelect aria-label={t('spos.storeAria')} value={storeId} disabled={!stores.length} onChange={e=>set('storeId',e.target.value)}>{stores.map(s=><NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>)}</NativeSelect></FormField>
  <FormField label={t('spos.merchant')} help={t('spos.merchantHelp')}><Input inputMode="numeric" value={form.merchantId} onChange={e=>set('merchantId',e.target.value)}/></FormField>
  <div className="form-two"><FormField label="API Access Key"><Input type="password" autoComplete="off" value={form.accessKey} onChange={e=>set('accessKey',e.target.value)}/></FormField><FormField label="API Secret Key"><Input type="password" autoComplete="off" value={form.secretKey} onChange={e=>set('secretKey',e.target.value)}/></FormField></div>
  <FormField label={t('spos.webhookKey')}><Input type="password" autoComplete="off" value={form.webhookSecret} onChange={e=>set('webhookSecret',e.target.value)}/></FormField>
  <div className="form-two"><FormField label={t('spos.interval')} help={t('spos.intervalHelp')}><Input type="number" min={15} max={1440} step={1} value={form.intervalMinutes} onChange={e=>set('intervalMinutes',e.target.value)}/></FormField><FormField label={t('spos.since')} help={t('spos.sinceHelp')}><Input type="date" value={form.since} onChange={e=>set('since',e.target.value)}/></FormField></div>
  {issue&&<p className="form-error" role="alert">{issue}</p>}
  <div className="form-actions"><Button type="submit" size="sm" disabled={busy||!stores.length} disabledReason={!stores.length?t('spos.noStoresShort'):undefined}>{busy?<LoaderCircle className="spin"/>:<Link2/>}{t('spos.saveOff')}</Button></div>
 </form>;
}

export function PosCard({brandId,brandName,switchOn,round}:{brandId:string;brandName:string;switchOn:boolean|null;round:number}){useT();
 const account=useAccount(),owner=!!account?.isOwner;
 const [load,setLoad]=useState<Load>({state:'loading'}),[stores,setStores]=useState<StoreRef[]>([]),[again,setAgain]=useState(0),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;
  request<PosView>('/api/pos/tossplace').then(view=>{if(live)setLoad({state:'ready',view})},e=>{if(live)setLoad({state:e instanceof RequestError&&e.status===403?'denied':'error',message:errorText(e)})});
  request<{stores?:StoreRef[]}>('/api/stores').then(d=>{if(live&&Array.isArray(d.stores))setStores(d.stores)},()=>{});
  return()=>{live=false}},[round,again]);
 const view=load.state==='ready'?load.view:null,rows=(view?.connections??[]).filter(c=>c.brandId===brandId),active=rows.find(c=>c.enabled);
 const storeName=(id:string)=>stores.find(s=>s.id===id)?.name??t('spos.store');
 const brandStores=stores.filter(s=>s.brandId===brandId&&s.status!=='archived');
 async function send(body:Record<string,unknown>,saved:string){setBusy(true);try{await request('/api/pos/tossplace',body);notifySaved(saved as Saved);setAgain(n=>n+1);return true}catch(e){toast.error(errorText(e));return false}finally{setBusy(false)}}
 async function toggle(row:PosRow){
  if(row.enabled&&!(await askConfirm({title:t('spos.offTitle'),fields:{what:t('spos.offWhat'),where:t('spos.offWhere',{store:storeName(row.storeId),merchant:row.merchantId}),cost:t('spos.noCost'),reversible:t('spos.offReversible')},impact:t('spos.offImpact'),undo:t('spos.offUndo'),confirmLabel:t('spos.offConfirm'),danger:true})))return;
  await send({action:row.enabled?'disable':'enable',id:row.id,expectedVersion:row.version},row.enabled?t('spos.offDone'):t('spos.onDone'));
 }
 const editReason=!owner?OWNER_REASON():undefined;
 return <ChannelCard channel="pos_tossplace" title={t('spos.title')} lead={t('spos.lead')} connected={load.state==='ready'?!!active:null} account={active?metaAccount(storeName(active.storeId),active.merchantId):undefined} switchOn={switchOn} switchNote={switchOn?t('spos.switchOn'):t('spos.switchOff')}>
  {load.state==='denied'&&<p className="subtle-note" role="note">{load.message}</p>}
  {load.state==='error'&&<p className="form-error" role="alert">{load.message} <Button variant="link" size="sm" className="h-auto p-0" onClick={()=>setAgain(n=>n+1)}><RefreshCw/>{t('spos.retry')}</Button></p>}
  {load.state==='ready'&&(rows.length?<ul className="channel-rows" aria-label={t('spos.connections',{brand:brandName})}>{rows.map(r=><li key={r.id} data-enabled={r.enabled}>
   <MetaLine items={[storeName(r.storeId),t('spos.merchantPrefix')+r.merchantId,r.enabled?t('spos.collectOn'):t('spos.collectOff'),r.lastSuccessAt&&t('spos.lastSuccess')+dateTime(r.lastSuccessAt),r.lastError&&t('spos.lastFailure')+r.lastError,r.lastResult&&t('spos.newOrders',{n:r.lastResult.created})]}/>
   <div className="form-actions">
    <Button variant="outline" size="sm" disabled={busy||!owner} disabledReason={editReason} onClick={()=>void toggle(r)}><Power/>{r.enabled?t('spos.turnOff'):t('spos.turnOn')}</Button>
    <Button variant="outline" size="sm" disabled={busy||!owner||!r.enabled} disabledReason={editReason??(!r.enabled?t('spos.turnOnFirst'):undefined)} onClick={()=>void send({action:'pull_now',id:r.id},t('spos.checked'))}><Play/>{t('spos.checkNow')}</Button>
   </div></li>)}</ul>:<EmptyLine next={owner?t('spos.saveWithConnect'):t('spos.ownerConnects')}>{t('spos.none')}</EmptyLine>)}
  <div className="form-actions"><Button variant="outline" size="sm" aria-expanded={open} disabled={!owner} disabledReason={OWNER_REASON()} onClick={()=>setOpen(v=>!v)}><Link2/>{t('spos.connect')}</Button></div>
  {open&&<PosForm key={brandId} stores={brandStores} busy={busy} onSubmit={input=>send({action:'create',input},t('spos.saved')).then(ok=>{if(ok)setOpen(false);return ok})}/>}
 </ChannelCard>;
}
const metaAccount=(store:string,merchant:string)=>t('spos.storeMerchant',{store,merchant});
