'use client';
import {cssVars} from '@/lib/ui/css-vars';
// 워크스페이스의 브랜드·AI 팀·성과 목록 화면. 홈 첫 로딩에 싣지 않고 그 화면을 열 때 내려받는다(app/workspace.tsx, UX-PLAN-3 Q7).
import {ArrowRight,ChartNoAxesCombined,MapPin,Plus,ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {CardButton} from '@/components/app/card-button';
import {roles} from '@/lib/agency';
import type {WorkspaceData} from '@/lib/client';
import {MetricCard} from './campaign-metrics';
export function BrandsView({data,onArchive,onStores,onCampaigns}:{data:WorkspaceData;onArchive:(id:string)=>void;onStores:(id:string)=>void;onCampaigns:(id:string)=>void}){
 return <><div className="brand-detail-grid">{data.brands.map(b=><section className="brand-detail-card" key={b.id}><div className={'brand-monogram tint tint-text '+b.id} ref={cssVars({'--tint':b.bg,'--tint-fg':b.color})}>{b.short}</div><div className="brand-detail-body"><p className="eyebrow">{b.category}</p><h2>{b.name}</h2><p>{b.description}</p><div className="brand-tags"><span>{data.campaigns.filter(c=>c.brandId===b.id).length}개 캠페인</span><span>브랜드 아카이브</span></div><div><Button variant="outline" onClick={()=>onArchive(b.id)}>브랜드 아카이브<ChevronRight/></Button><Button variant="ghost" onClick={()=>onStores(b.id)}>점포 마케팅<MapPin/></Button><Button variant="ghost" onClick={()=>onCampaigns(b.id)}>캠페인 보기<ArrowRight/></Button></div></div></section>)}</div><p className="subtle-note">초기 브랜드 지식은 대표님과의 대화를 바탕으로 작성했습니다. 제품·가격·매장 정보는 캠페인에 맞게 확인하고 갱신하세요.</p></>;
}
export function AgentsView({runs,onDetail}:{runs:WorkspaceData['runs'];onDetail:(id:string)=>void}){
 return <><div className="team-banner"><div><span className="eyebrow">AI 팀</span><h2>좋은 결과는,<br/>서로 다른 관점에서 시작됩니다.</h2></div><p>전략을 세우는 팀과 검증하는 팀.<br/>8개의 전문성이 캠페인 하나에 집중합니다.</p></div><div className="agents-grid">{roles.map((r,i)=>{const count=runs.filter(x=>x.role===r.id&&x.status==='completed').length;return <CardButton className="agent-card" key={r.id} onClick={()=>onDetail(r.id)}><div><span className="role-avatar tint" ref={cssVars({'--tint':r.color})}>{r.initial}</span><span className="agent-no">/{String(i+1).padStart(2,'0')}</span></div><h3>{r.name}</h3><span className="agent-en">{r.en}</span><p>{r.job}</p><footer><span>{count?`${count}개 작업 완료`:'첫 작업 대기'}</span><ChevronRight size={17}/></footer></CardButton>})}</div></>;
}
export function ResultsView({data,reload,onMetric}:{data:WorkspaceData;reload:()=>Promise<void>;onMetric:()=>void}){
 return <>{data.metrics.length?data.metrics.map(m=><div key={m.id}><p className="metric-campaign-name">{data.campaigns.find(c=>c.id===m.campaignId)?.title}</p><MetricCard metric={m} all={data.metrics} onSaved={reload}/></div>):<div className="results-empty"><div className="measurement-visual"><ChartNoAxesCombined size={38}/><span>결정 전에 데이터</span></div><h2>성장은 실제 숫자로 확인합니다.</h2><p>캠페인의 매출, 비용, 주문 수를 기록하세요.<br/>광고·제작비 차감 후 공헌이익을 확인합니다.</p><Button variant="outline" disabled={!data.campaigns.length} disabledReason={!data.campaigns.length?'먼저 대상을 고르세요.':undefined} onClick={onMetric}><Plus/>첫 성과 기록</Button>{!data.campaigns.length&&<small>먼저 캠페인 브리프를 만들어 주세요.</small>}</div>}<div className="measurement-notes"><div><h3>측정 기준</h3><p>동일 매장·동일 길이의 기간으로 비교하고 할인·환불을 순매출에 반영합니다.</p></div><div><h3>해석 기준</h3><p>단순 전후 차이는 관찰 변화입니다. 인과 효과 판단에는 비교군과 추가 검증이 필요합니다.</p></div></div></>;
}
