'use client';
import '@/lib/i18n/lazy-trust';
import {MetaLine} from './meta-line';
import type {EvidenceConfidence} from '@/lib/evidence-confidence';
import {useT} from '@/lib/i18n-react';

// X7 근거 3단계 표시(lib/evidence-confidence.ts). 단계 이름과 건수를 글자로 적는다(퍼센트·색만으로 뜻을 전하지 않는다).
export function ConfidenceLabel({confidence}:{confidence:EvidenceConfidence}){
 // 단계 이름은 사전(trust.level.<단계>)에서 읽는다. confidence.label은 같은 한국어 이름이다(lib/evidence-confidence.ts CONFIDENCE_LABELS).
 const t=useT(),c=confidence.counts,label=t(`trust.level.${confidence.level}`);
 return <p className="confidence-label" data-level={confidence.level} aria-label={t('trust.conf.aria',{label,cited:c.cited,total:c.sentences})}>
  <b>{label}</b>
  <MetaLine items={[t('trust.conf.cited',{cited:c.cited,total:c.sentences}),t('trust.conf.facts',{n:c.confirmedFacts}),c.checkFlags?t('trust.conf.checkFlags',{n:c.checkFlags}):null,c.warns?t('trust.conf.warns',{n:c.warns}):null,c.blocks?t('trust.conf.blocks',{n:c.blocks}):null]}/>
 </p>;
}
