'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {MetaLine} from './meta-line';
import {StatList} from './stat-list';
import {cssVars} from '@/lib/ui/css-vars';
import {whyDisabled} from '@/lib/ui/why-disabled';
import {notifySaved} from '@/lib/ui/notify';
import {api} from '@/lib/client';
import type {Brand} from '@/lib/agency';
import type {BrandLearnRun} from '@/lib/brand-learn-server';
import {learnedFactCount} from '@/lib/brand-learn';
import {campaignTemplates,type TemplateId} from '@/lib/campaign-templates';

// 홈 시작하기 카드의 '브랜드 초안 만들기'(에픽 G1). app/workspace.tsx가 lazy로만 불러온다(홈 첫 로딩 JS 예산).
// 흐름: 공개 페이지 주소 → 서버가 1회 읽어 후보(이름·로고·색·소개·사실 후보 수·말투 신호)를 보인다 → '후보로 저장'이 사실 원장 확인 후보로 쓴다 → 템플릿 3개가 기존 브리프 저장 경로로 캠페인 초안을 만든다.
// 확정은 브랜드 아카이브 확인 사실 탭에서 사람이 한다. 스위치(brand_autolearn)가 꺼져 있으면 버튼은 이유와 함께 비활성이다.
const API='/api/brand-learn';
type Status={enabled:boolean;offReason:string|null;runs:BrandLearnRun[]};
type Props={brands:Brand[];brandId:string;onBrandChange:(id:string)=>void;canManage:boolean;reload:()=>Promise<void>;onOpenCampaign:(id:string)=>void;onOpenArchive:(brandId:string)=>void};
const looksLikeUrl=(s:string)=>/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s.trim());
const voiceLabel=(run:BrandLearnRun)=>{const v=run.result.voice;return v.style==='미확인'?'미확인(문장이 적음)':`${v.style}(문장 ${v.sentences}개 기준)`};
export function OnboardingUrlCard({brands,brandId,onBrandChange,canManage,reload,onOpenCampaign,onOpenArchive}:Props){
 const [text,setText]=useState(''),[loaded,setLoaded]=useState<(Status&{brandId:string})|null>(null),[run,setRun]=useState<BrandLearnRun|null>(null),[busy,setBusy]=useState(false),[saved,setSaved]=useState<{imported:number;skipped:number}|null>(null);
 // 스위치 상태는 브랜드마다 읽는다. 다른 브랜드의 응답은 brandId가 달라 '확인 중'으로 보인다(효과 안에서 상태를 비우지 않는다).
 useEffect(()=>{if(!brandId)return;const controller=new AbortController();fetch(`${API}?brandId=${encodeURIComponent(brandId)}`,{signal:controller.signal}).then(r=>r.ok?r.json() as Promise<Status>:null).then(d=>{if(!controller.signal.aborted)setLoaded(d?{brandId,enabled:d.enabled===true,offReason:d.offReason??null,runs:Array.isArray(d.runs)?d.runs:[]}:{brandId,enabled:false,offReason:'스위치 상태를 확인하지 못했습니다.',runs:[]})}).catch(()=>{});return()=>controller.abort()},[brandId]);
 const status=loaded?.brandId===brandId?loaded:null;
 const enabled=status?.enabled===true,offReason=status===null?'스위치 상태를 확인하고 있습니다.':status.offReason??'';
 const gate=whyDisabled([[!enabled,offReason]]);
 const previewReason=whyDisabled([[!enabled,offReason],[!text.trim(),'필수 칸을 먼저 채우세요.'],[!looksLikeUrl(text),'공개 페이지 주소(https://…)를 넣어 주세요. 매장명만으로는 아직 페이지를 찾지 못합니다.']]);
 async function preview(e:FormEvent){
  e.preventDefault();if(previewReason)return;setBusy(true);
  try{const r=await api('preview',{brandId,url:text.trim()},API) as unknown as {run:BrandLearnRun};setRun(r.run);setSaved(null)}
  catch(err){toast.error((err as Error).message)}finally{setBusy(false)}
 }
 async function save(){
  if(!run)return;setBusy(true);
  try{const r=await api('save_candidates',{runId:run.id},API) as unknown as {run:BrandLearnRun;imported:number;skipped:{key:string;reason:string}[]};setRun(r.run);setSaved({imported:r.imported,skipped:r.skipped.length});notifySaved('후보를 저장했습니다.',{description:`확인 후보 ${r.imported}건을 사실 원장에 넣었습니다. 건너뜀 ${r.skipped.length}건. 확정은 브랜드 아카이브 확인 사실 탭에서 합니다.`})}
  catch(err){toast.error((err as Error).message)}finally{setBusy(false)}
 }
 async function applyVisual(hex:string){
  if(!run)return;setBusy(true);
  try{const r=await api('apply_visual',{runId:run.id,hex},API) as unknown as {run:BrandLearnRun};setRun(r.run);await reload();notifySaved('브랜드 색을 적용했습니다.',{description:`이전 색 ${r.run.appliedVisual?.previousColor??'미확인'}은 학습 기록에 남아 있습니다.`})}
  catch(err){toast.error((err as Error).message)}finally{setBusy(false)}
 }
 async function fromTemplate(template:TemplateId){
  setBusy(true);
  try{const r=await api('create_from_template',{brandId,template},API);await reload();notifySaved('캠페인 초안을 만들었습니다.',{description:'[확인 필요] 표시는 브리프에서 대표가 확인한 뒤 채웁니다.'});onOpenCampaign(r.id)}
  catch(err){toast.error((err as Error).message)}finally{setBusy(false)}
 }
 const name=run?.result.name,logo=run?.result.logo,tagline=run?.result.tagline,colors=run?.result.colors??[];
 return <section className="mt-5 grid gap-3 border-t pt-4" aria-label="브랜드 초안 만들기">
  <div><b>브랜드 초안 만들기</b><p className="ui-note">공개 페이지 주소 한 줄을 서버가 한 번 읽어 후보를 뽑습니다. 확정은 사실 원장에서 사람이 합니다.</p></div>
  <form className="grid gap-2" onSubmit={preview}>
   <label className="field"><span>URL 또는 매장명</span><Input value={text} onChange={e=>setText(e.target.value)} placeholder="https://…" inputMode="url" autoComplete="off"/></label>
   <div className="flex flex-wrap items-end gap-2">
    <NativeSelect aria-label="학습할 브랜드" value={brandId} onChange={e=>onBrandChange(e.target.value)}>{brands.map(b=><NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}</NativeSelect>
    <Button type="submit" variant="outline" disabled={busy||!!previewReason} disabledReason={previewReason}>브랜드 초안 만들기</Button>
   </div>
  </form>
  {run&&<section className="notice grid gap-3" aria-label="브랜드 초안 후보">
   <StatList label="브랜드 초안 후보" items={[['이름',name?<MetaLine items={[name.value,name.confidence==='strong'?'근거 강함':'근거 약함']}/>:'미확인'],['로고 후보',logo?<Button variant="link" size="fit" asChild><a href={logo.value} target="_blank" rel="noreferrer">{logo.source==='og'?'대표 이미지 주소 열기':'아이콘 주소 열기'}</a></Button>:'미확인'],['소개',tagline?.value??'미확인'],['찾은 사실 후보',`${learnedFactCount(run.result)}건`],['말투 신호',voiceLabel(run)]]}/>
   <ul className="flex flex-wrap gap-2" aria-label="색 후보">{colors.map(c=><li key={c.hex} className="flex items-center gap-1 text-sm"><span className="brand-dot tint" ref={cssVars({'--tint':c.hex})}/><span>{c.hex}</span><small>{c.source==='meta'?'테마 색':`${c.count}회`}</small></li>)}{!colors.length&&<li className="text-sm">색 후보 없음</li>}</ul>
   <p className="ui-note">모두 미확인 후보입니다. 저장하면 사실 원장의 확인 후보가 되고, 로고·색은 학습 기록의 제안으로 남습니다.</p>
   <div className="flex flex-wrap gap-2">
    <Button onClick={()=>void save()} disabled={busy||!enabled||run.status==='saved'} disabledReason={whyDisabled([[!enabled,offReason],[run.status==='saved','이미 저장한 후보입니다.']])}>후보로 저장</Button>
    {colors[0]&&<Button variant="outline" onClick={()=>void applyVisual(colors[0].hex)} disabled={busy||!enabled||!canManage||!!run.appliedVisual} disabledReason={whyDisabled([[!enabled,offReason],[!canManage,'브랜드 색 적용은 관리자만 할 수 있습니다.'],[!!run.appliedVisual,'이미 적용한 색입니다.']])}>{colors[0].hex} 색을 브랜드 색으로 적용</Button>}
   </div>
   {saved&&<p className="ui-note">확인 후보 {saved.imported}건 저장, 건너뜀 {saved.skipped}건. <Button variant="link" size="fit" onClick={()=>onOpenArchive(brandId)}>브랜드 아카이브 확인 사실 탭에서 확정</Button></p>}
  </section>}
  <div className="grid gap-2">
   <b>첫 캠페인 템플릿</b>
   <p className="ui-note">브랜드 이름·업종·지점 수만 넣은 초안입니다. 가격·수치는 넣지 않고 [확인 필요]로 둡니다.</p>
   <div className="flex flex-wrap gap-2">{campaignTemplates.map(t=><Button key={t.id} variant="outline" title={t.summary} onClick={()=>void fromTemplate(t.id)} disabled={busy||!enabled} disabledReason={gate}>{t.name}</Button>)}</div>
  </div>
 </section>;
}
