'use client';
// 화면 언어 선택(GLOBAL-PLAN G6 1단계): 한국어 · English · 日本語. 고르면 바로 바뀌고(새로고침 없음) localStorage 'locale'에 남는다(lib/i18n.ts).
// 선택지 이름은 각 언어의 자기 이름이고, 묶음의 접근 이름('언어'·'Language'·'言語')은 지금 언어를 따른다. 머리 띠에는 두지 않는다(홈 첫 로딩 예산): 계정 메뉴·설정 팀·권한에서 연다.
import {useState} from 'react';
import {Segmented} from './segmented';
import {setLocale,type Locale} from '@/lib/i18n';
import {useLocale,useT} from '@/lib/i18n-react';
import '@/lib/i18n/lazy'; // 이 화면의 한국어 원본(lib/i18n/ko-lazy.ts)을 등록한다. 홈 첫 로딩에는 싣지 않는다.

const names:Record<Locale,string>={ko:'한국어',en:'English',ja:'日本語'};
const order:readonly Locale[]=['ko','en','ja'];

export function LocaleToggle({className}:{className?:string}){
 const t=useT(),locale=useLocale(),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false);
 async function choose(next:Locale){
  if(next===locale||busy)return;setBusy(true);setFailed(false);
  try{setFailed(!(await setLocale(next)))}finally{setBusy(false)}
 }
 return <div className={className?`locale-toggle ${className}`:'locale-toggle'}>
  <p className="text-sm text-muted-foreground">{t('locale.lead')}</p>
  <Segmented label={t('locale.label')} value={locale} disabled={busy} onChange={next=>void choose(next)} options={order.map(l=>({value:l,label:<span lang={l}>{names[l]}</span>}))}/>
  {failed&&<p role="alert" className="form-error">{t('locale.failed')}</p>}
 </div>;
}
