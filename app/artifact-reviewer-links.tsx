'use client';
// 작업물 대화상자의 외부 검토자 링크(GLOBAL-PLAN G4, docs/SHARE-LINKS.ko.md, 레인 X-G). app/panels.tsx ArtifactDialog가 대표·관리자에게만 lazy로 그린다.
// 판정·한도(같은 판 10개)·스위치(share_links)는 서버(/api/share)가 한다. 스위치가 꺼져 있고 만든 링크가 없으면 아무것도 그리지 않는다(이전 화면과 같다).
import {ShareLinksCard} from '@/components/app/share-links-card';

export function ArtifactReviewerLinks({artifactId,version,title}:{artifactId:string;version:number;title:string}){
 return <div className="artifact-reviewer-links"><ShareLinksCard kind="artifact" id={artifactId} version={version} canManage title={title} hideWhenOff/></div>;
}
