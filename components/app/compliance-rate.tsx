'use client';
// 규정 점검 패널 머리의 준수율(QA D12): '준수율 N% · 통과 규칙 p / 점검 규칙 c'. 계산은 lib/graders/compliance-rate.ts(순수 함수)다.
// 점검하지 않은 판(not_run)·불러오는 중이면 그리지 않는다. 규정 점검 패널과 같은 lazy 청크(app/panels.tsx)에 실린다.
import '@/lib/i18n/lazy-trust';
import {useT} from '@/lib/i18n-react';
import {complianceRate} from '@/lib/graders/compliance-rate';
import type {ComplianceView} from '@/lib/artifact-sources';

export function ComplianceRate({compliance}:{compliance:ComplianceView|null}){
 const t=useT(),rate=compliance?.status==='checked'?complianceRate(compliance):null;
 if(!rate)return null;
 return <p className="compliance-rate" data-percent={rate.percent}><b>{t('complianceRate.percent',{percent:rate.percent})}</b><small>{t('complianceRate.counts',{passed:rate.passed,checked:rate.checked})}</small></p>;
}
