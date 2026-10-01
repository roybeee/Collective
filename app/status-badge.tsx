// 상태 배지(작업물·캠페인)와 빈 상태. 홈 첫 로딩에서 쓰므로 app/panels.tsx 전체를 싣지 않도록 따로 둔다(UX-PLAN-3 Q7).
import {FileText} from 'lucide-react';
import {statuses,type Campaign} from '@/lib/agency';
import {campaignStatus,isArchivedCampaign} from '@/lib/workspace-metrics';
export function Status({status,title}:{status:string;title?:string}){return <span className={'status status-'+status} title={title}>{statuses[status]||({approved:'승인 완료',review:'검토 대기',revision:'수정 요청',outdated:'이전 버전'} as Record<string,string>)[status]||status}</span>}
export function CampaignStatus({campaign}:{campaign:Pick<Campaign,'status'|'derivedStatus'|'statusReason'>&{archivedAt?:string|null}}){return <span className="campaign-status"><Status status={campaignStatus(campaign)} title={campaign.statusReason}/>{isArchivedCampaign(campaign)&&<span className="status status-archived" title="보관한 캠페인입니다. 새 AI 실행·팀 회의·연속 실행·발행 승인은 보관 해제 후 할 수 있습니다.">보관됨</span>}</span>}
export function Empty({title,text,action}:{title:string;text:string;action?:React.ReactNode}){return <div className="empty-state"><FileText size={28}/><h3>{title}</h3><p>{text}</p>{action}</div>}
