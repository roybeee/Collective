'use client';
import {MetaLine} from './meta-line';
import type {EvidenceConfidence} from '@/lib/evidence-confidence';

// X7 근거 3단계 표시(lib/evidence-confidence.ts). 단계 이름과 건수를 글자로 적는다(퍼센트·색만으로 뜻을 전하지 않는다).
export function ConfidenceLabel({confidence}:{confidence:EvidenceConfidence}){
 const c=confidence.counts;
 return <p className="confidence-label" data-level={confidence.level} aria-label={`${confidence.label}: 근거 있는 문장 ${c.cited}개 / 전체 ${c.sentences}개`}>
  <b>{confidence.label}</b>
  <MetaLine items={[`근거 있는 문장 ${c.cited}/${c.sentences}`,`확정 사실 인용 ${c.confirmedFacts}건`,c.checkFlags?`확인 필요 ${c.checkFlags}건`:null,c.warns?`규정 주의 ${c.warns}건`:null,c.blocks?`규정 차단 ${c.blocks}건`:null]}/>
 </p>;
}
