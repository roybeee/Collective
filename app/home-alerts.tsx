'use client';
// 워크스페이스 첫 화면의 보조 알림 두 개. 학습 화면(app/learning-panel.tsx)과 성과 수집(app/measurement-collect.tsx) 모듈 전체를
// 홈 첫 로딩에 싣지 않으려고 여기 둔다(UX-PLAN-3 Q7). 원래 모듈은 같은 이름으로 다시 내보낸다.
import {useEffect,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {MetaLine} from '@/components/app/meta-line';
import type {LearningRule} from '@/lib/learning';
import type {CollectAlert} from '@/lib/measurement-status';
const armLabels:Record<CollectAlert['arm'],string>={control:'A(대조안)',treatment:'B(실험안)'};
// 워크스페이스 첫 화면의 만료 임박 학습 규칙 알림(loop-11). 학습 화면을 열지 않아도 규칙이 곧 새 AI 작업에서 빠진다는 것을 알린다.
// 보조 알림이라 불러오지 못하면 표시하지 않는다(학습 화면이 불러오기 오류를 따로 보여 준다). 링크는 가장 먼저 만료되는 규칙의 브랜드를 연다.
export function ExpiringRulesAlert({onOpen}:{onOpen:(brandId:string)=>void}){
 const[rules,setRules]=useState<LearningRule[]>([]);
 useEffect(()=>{let active=true;fetch('/api/learning?only=expiring').then(async r=>{if(!r.ok)return;const d=await r.json() as {expiringRules?:LearningRule[]};if(active)setRules(d.expiringRules??[])}).catch(()=>{/* 보조 알림: 실패하면 숨긴다. */});return()=>{active=false}},[]);
 if(!rules.length)return null;
 const brands=new Set(rules.map(r=>r.brandId)).size;
 return <section className="learning-note" role="status" aria-label="만료 임박 학습 규칙"><b>만료 임박 학습 규칙 {rules.length}건</b>{brands>1?`(${brands}개 브랜드)`:''}. 만료되면 새 AI 작업에 전달되지 않습니다. 재검증 실험으로 다시 측정하거나 연장·종료를 정하세요. <Button size="sm" variant="link" onClick={()=>onOpen(rules[0].brandId)}>학습 규칙 보기<ArrowRight/></Button></section>;
}

// 워크스페이스 첫 화면 알림: 진행 중 실험의 자동 수집이 인증 오류·연결 없음으로 실패하고 있다. 보조 알림이라 불러오지 못하면 숨긴다.
export function CollectAlertsView({alerts,onOpen}:{alerts:readonly CollectAlert[];onOpen:(brandId:string)=>void}){
 if(!alerts.length)return null;
 const first=alerts[0];
 return <section className="learning-note" role="status" aria-label="성과 자동 수집 재연결 필요"><MetaLine items={[<b key="t">성과 자동 수집 재연결 필요 {alerts.length}건</b>,`「${first.title}」 ${armLabels[first.arm]}: ${first.reason}${alerts.length>1?` 외 ${alerts.length-1}건`:''}`]}/> <Button size="sm" variant="outline" onClick={()=>onOpen(first.brandId)}>실험 확인</Button></section>;
}
export function CollectAlertsNotice({onOpen}:{onOpen:(brandId:string)=>void}){
 const[alerts,setAlerts]=useState<CollectAlert[]>([]);
 useEffect(()=>{let active=true;fetch('/api/learning?only=collect_alerts').then(async r=>{if(!r.ok)return;const d=await r.json() as {collectAlerts?:CollectAlert[]};if(active)setAlerts(d.collectAlerts??[])}).catch(()=>{/* 보조 알림: 실패하면 숨긴다. */});return()=>{active=false}},[]);
 return <CollectAlertsView alerts={alerts} onOpen={onOpen}/>;
}
