'use client';
// 사실 근거 상태(스위치 fact_evidence_state, 마케팅 스킬 이식 P3): 확인 사실 탭의 근거 상태 입력과 라벨.
// app/brand-facts-panel.tsx가 스위치가 켜졌을 때만 React.lazy로 이 청크를 내려받는다(꺼짐이면 내려받지 않는다). 문구는 화면 구역 'trust'다.
import '@/lib/i18n/lazy-trust';
import {useT} from '@/lib/i18n-react';
import {MetaLine} from '@/components/app/meta-line';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {factEvidenceState,statementQuote,type BrandFact,type FactBasis} from '@/lib/brand-facts';

// 근거 상태 입력값(빈 값=지정 안 함). 저장 본문 조립은 화면 패널(app/brand-facts-panel.tsx basisPayload)이 한다.
export type BasisForm={basis:''|FactBasis;speaker:string};

export default function FactEvidenceFields({mode,fact,form,onChange}:{mode:'form'|'badge';fact?:BrandFact;form?:BasisForm;onChange?:(next:BasisForm)=>void}){
 const t=useT();
 if(mode==='badge'){
  if(!fact)return null;
  const state=factEvidenceState(fact);
  if(!state)return null;
  return <p className="subtle-note"><MetaLine items={[t('trust.fact.state',{label:t(`trust.fact.state.${state}`)}),state==='statement'&&t('trust.fact.quote',{quote:statementQuote(fact)})]}/></p>;
 }
 if(!form||!onChange)return null;
 return <fieldset className="form-stack" aria-label={t('trust.fact.basis')}>
  <label className="field"><span>{t('trust.fact.basis')}</span><NativeSelect value={form.basis} onChange={e=>onChange({...form,basis:e.target.value as BasisForm['basis']})}>
   <NativeSelectOption value="">{t('trust.fact.basis.none')}</NativeSelectOption>
   <NativeSelectOption value="document">{t('trust.fact.basis.document')}</NativeSelectOption>
   <NativeSelectOption value="statement">{t('trust.fact.basis.statement')}</NativeSelectOption>
  </NativeSelect></label>
  {form.basis==='statement'&&<label className="field"><span>{t('trust.fact.speaker')}</span><Input required maxLength={60} value={form.speaker} onChange={e=>onChange({...form,speaker:e.target.value})} placeholder={t('trust.fact.speakerHint')}/></label>}
  <p className="subtle-note">{t('trust.fact.basisNote')}</p>
 </fieldset>;
}
