'use client';
// 작업물 목록 카드의 규정 점검 배지(벤치마크 P10). 상세 대화상자와 같은 결정론 점검의 차단·주의 수를 보이고, 누르면 그 작업물 대화상자(규정 점검 패널 포함)를 연다.
// 수는 GET /api/artifact-sources?cards=가 준 값만 쓴다(꾸미지 않는다). 아직 모르면 그리지 않는다. 버튼 높이는 24px 이상이다(WCAG 2.5.8).
import '@/lib/i18n/lazy-campaign';
import {ShieldAlert,ShieldCheck,ShieldQuestion} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useT} from '@/lib/i18n-react';
import {metaText} from '@/lib/format';
import type {ArtifactCardSummary} from '@/lib/artifact-card-summary-server';

export function ComplianceCountBadge({compliance,title,onOpen}:{compliance:ArtifactCardSummary['compliance'];title:string;onOpen:()=>void}){
 const t=useT(),{status,block,warn}=compliance;
 const text=status!=='checked'?t('complianceBadge.notRun'):block||warn?metaText([block?t('complianceBadge.block',{n:block}):null,warn?t('complianceBadge.warn',{n:warn}):null]):t('complianceBadge.pass');
 const Icon=status!=='checked'?ShieldQuestion:block||warn?ShieldAlert:ShieldCheck;
 return <Button type="button" variant={block?'destructive':'outline'} size="xs" className="compliance-count-badge min-h-6 rounded-full" data-testid="compliance-count-badge" data-block={block} data-warn={warn} aria-label={t('complianceBadge.open',{title,summary:text})} onClick={onOpen}><Icon aria-hidden/>{text}</Button>;
}
