// 홈 '오늘의 안건'의 워크스페이스·브랜드·지점 범위 출처(레인 X-G). 캠페인에 묶이지 않거나(요금 알림·카카오 재동의·플레이스 초안·광고 제안) 캠페인 탭 밖 기록(GEO 측정)이다.
// 순수 함수만 둔다(DB 접근·범위 판정은 lib/agenda-server.ts). 입력은 저장된 기록 그대로이며 필드가 없거나 형식이 다르면 건너뛴다. 외부 호출·자동 집행은 없다.
// 알림 탭: billing_alert(이번 달 크레딧 80%·100%, lib/billing-server.ts), kakao_reconsent_notice(새 재동의 안내, lib/kakao/consent-server.ts), geo_run(최근 7일 측정 완료·실패, lib/geo-run-server.ts).
// 결정 탭: place_draft(승인 대기 초안, lib/place-drafts-server.ts), ads_proposal(승인 대기 제안, lib/ads-proposals-server.ts). 둘 다 어디(브랜드·지점)를 함께 보인다.
import type {AgendaItem} from './agenda-types';
import type {Names,SourceCampaign} from './agenda-sources';
type R=Record<string,unknown>;
const text=(v:unknown,max=80)=>typeof v==='string'?v.slice(0,max):'';
const id=(v:unknown)=>typeof v==='string'&&v?v:null;
const DAY=86400000;
export const GEO_NOTICE_DAYS=7;
const workspace={campaignId:'',campaignTitle:'',due:null,cost:null} as const;
const placeWhere=(names:Names,brandId:string|null,storeId:string|null)=>[brandId?names.brand(brandId):'',storeId?names.store(storeId):''].filter(Boolean);

// 크레딧 사용 알림: 이번 달(KST) 알림만, 같은 달에 80%·100%가 모두 있으면 높은 단계 하나만 보인다(호출부가 단계 내림차순으로 넘긴다).
export function billingAlertItems(rows:readonly R[],month:string):AgendaItem[]{
 const current=rows.filter(d=>d.month===month&&(d.level===80||d.level===100)).sort((a,b)=>Number(b.level)-Number(a.level));
 const top=current[0];if(!top||!id(top.id))return [];
 return [{...workspace,id:`billing_alert:${top.id}`,kind:'signal',source:'billing',title:text(top.title)||'크레딧 사용 알림',detail:text(top.detail,160),where:['워크스페이스 전체'],section:'observe',nav:{view:'settings',section:'usage'}}];
}

// 카카오 마케팅 수신 재동의 안내(status 'new'). 브랜드 단위이며 연결 및 설정 > 채널 연결의 카카오 카드에서 처리한다.
export function reconsentItem(d:R,names:Names):AgendaItem|null{
 const brandId=id(d.brandId);if(d.status!=='new'||!id(d.id)||!brandId)return null;
 const det=(d.detection??{}) as R,due=typeof det.dueBy==='string'&&det.dueBy?det.dueBy:null;
 return {...workspace,id:`kakao_reconsent:${d.id}`,kind:'signal',source:'kakao',title:text(det.title)||'카카오 수신 재동의 확인',detail:text(det.detail,160),where:[names.brand(brandId)],due,brandId,storeId:null,section:'observe',nav:{view:'settings',section:'channels'}};
}

// GEO(AI 검색 노출) 측정이 끝났거나 멈춘 기록. 최근 7일 안에 바뀐 것만 알림으로 둔다. 측정 화면은 캠페인 성장 탭 근거 섹션의 조건부 확장 패널 안이다.
export function geoRunItem(d:R,c:SourceCampaign,names:Names,now:number):AgendaItem|null{
 if(!id(d.id)||(d.status!=='completed'&&d.status!=='cancelled'))return null;
 const at=Date.parse(text(d.updatedAt,40));if(!Number.isFinite(at)||at<now-GEO_NOTICE_DAYS*DAY)return null;
 const jobs=Array.isArray(d.jobs)?d.jobs as R[]:[],done=jobs.filter(j=>j.status==='completed').length,failed=jobs.filter(j=>j.status==='failed'||j.status==='uncertain').length;
 const title=d.status==='cancelled'||!done?'AI 검색 노출 측정 실패':failed?'AI 검색 노출 측정 일부 실패':'AI 검색 노출 측정 완료';
 return {id:`geo_run:${d.id}`,kind:'signal',source:'geo',title,detail:`완료 ${done}/${jobs.length}건${failed?`, 실패 ${failed}건`:''}`,campaignId:c.id,campaignTitle:c.title,where:[names.brand(c.brandId),names.store(c.storeId)].filter(Boolean),due:null,cost:null,brandId:c.brandId,storeId:c.storeId??null,section:'evidence',panel:'조건부 확장(GEO·해외·MMM)'};
}

// 플레이스 리뷰 답글·소식 초안 승인 대기(status 'draft'). 점포 마케팅 > 지점 > 채널 점검 탭의 초안 카드(app/place-drafts-card.tsx)에서 승인한다.
export function placeDraftItem(d:R,names:Names):AgendaItem|null{
 const storeId=id(d.storeId),brandId=id(d.brandId);if(d.status!=='draft'||!id(d.id)||!storeId)return null;
 const draft=(d.draft??{}) as R,blocking=((d.compliance??{}) as R).blocking===true;
 return {...workspace,id:`place_draft:${d.id}`,kind:'decision',source:'place_draft',title:d.kind==='news_post'?'플레이스 소식 승인 대기':'플레이스 리뷰 답글 승인 대기',detail:(blocking?'규정 점검 막힘: ':'')+text(draft.text),where:placeWhere(names,brandId,storeId),brandId:brandId??undefined,storeId,section:'execute',nav:{view:'stores',...(brandId?{brand:brandId}:{}),store:storeId,tab:'channels'}};
}

// 광고 제안 승인 대기(status 'draft'). 채널(네이버 검색광고·당근 광고)과 광고 계정의 캠페인 번호를 어디에 함께 적는다.
const proposalKinds:Record<string,string>={bid:'입찰가 변경',pause:'중지',resume:'다시 켜기',create_keywords:'키워드 추가',create_campaign:'캠페인 만들기',budget:'일 예산 변경',create_adgroup:'광고그룹 만들기',create_creative:'소재 만들기',update_creative:'소재 고치기'};
export function adsProposalItem(d:R,names:Names):AgendaItem|null{
 if(d.status!=='draft'||!id(d.id))return null;
 const daangn=d.channel==='daangn_ads',brandId=id(d.brandId),storeId=id(d.storeId),target=(d.target??{}) as R,targets=(Array.isArray(target.names)?target.names:[]).filter((x):x is string=>typeof x==='string');
 const account=text(d.campaignId,64);
 return {...workspace,id:`ads_proposal:${d.id}`,kind:'decision',source:'ads_proposal',title:daangn?'당근 광고 제안 승인 대기':'네이버 검색광고 제안 승인 대기',detail:[proposalKinds[String(d.kind)]||'광고 변경',targets.slice(0,3).join(', ')].filter(Boolean).join(': '),
  where:[...placeWhere(names,brandId,storeId),...(account?[`광고 캠페인 ${account}`]:[])],brandId:brandId??undefined,storeId,section:'execute',nav:{view:'settings',section:'channels'}};
}
