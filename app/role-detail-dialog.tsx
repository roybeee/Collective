'use client';
// 에이전트 상세 대화상자. 실무 지침(lib/practice)이 커서 홈 첫 로딩에 싣지 않고 열 때 내려받는다(app/workspace.tsx).
import {ArrowRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import type {roles} from '@/lib/agency';
import {practices} from '@/lib/practice';
export default function RoleDetailDialog({role,onClose,onStart}:{role:(typeof roles)[number];onClose:()=>void;onStart:()=>void}){
 const p=practices[role.id];
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="agent-info-dialog"><DialogHeader><span className="role-avatar" style={{background:role.color}}>{role.initial}</span><DialogTitle>{role.name}</DialogTitle><DialogDescription>{role.en}</DialogDescription></DialogHeader><h3>{role.job}</h3><p>{role.deliverable}</p>{p&&<div className="practice-detail"><p className="practice-focus">{p.focus}</p><h4>실무 접근법</h4><ul>{p.methods.map(x=><li key={x}>{x}</li>)}</ul><h4>필수 산출물</h4><ul>{p.outputs.map(x=><li key={x}>{x}</li>)}</ul><h4>완료 전 점검</h4><ul>{p.review.map(x=><li key={x}>{x}</li>)}</ul><p>{p.handoff}</p></div>}<Button onClick={onStart}>캠페인에서 작업 시작<ArrowRight/></Button></DialogContent></Dialog>;
}
