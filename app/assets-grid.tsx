'use client';
// 작업물 화면의 카드 목록. 미리보기 문구 정리(lib/history-labels)는 이 화면을 열 때만 내려받는다(UX-PLAN-3 Q7 홈 첫 로딩).
import {CardButton} from '@/components/app/card-button';
import {ArrowUpRight,FileText} from 'lucide-react';
import {roles,type Artifact} from '@/lib/agency';
import {artifactPreview} from '@/lib/history-labels';
import {Status} from './status-badge';
export function AssetsGrid({artifacts,onOpen}:{artifacts:Artifact[];onOpen:(campaignId:string)=>void}){
 return <div className="assets-grid">{artifacts.map(a=><CardButton className="asset-card" key={a.id} onClick={()=>onOpen(a.campaignId)}><div><span className="role-avatar" style={{background:roles.find(r=>r.id===a.role)?.color}}><FileText size={20}/></span><Status status={a.status}/></div><h3>{a.title}</h3><p>{artifactPreview(a.content)}</p><footer><span>{roles.find(r=>r.id===a.role)?.name} · v{a.version}</span><ArrowUpRight size={17}/></footer></CardButton>)}</div>;
}
