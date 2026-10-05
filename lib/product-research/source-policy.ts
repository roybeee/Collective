// 상품 리서치(MD·AI·성장2 근거) 전용 정책. 광고 관리 전용 연동에는 적용하지 않는다.
// allowed는 기존 사용 경로를 유지한다는 뜻이며 법무 검토 완료나 공급자 승인을 뜻하지 않는다.
import {SOURCE_IDS,type Snapshot} from './types';
export const SOURCE_POLICY_VERSION='md-policy-2026-10-05';
export type ResearchSourcePolicy={allowed:boolean;code:string|null;reason:string|null};
const deny=(code:string,reason:string):ResearchSourcePolicy=>({allowed:false,code,reason});
export function researchSourcePolicy(sourceId:unknown):ResearchSourcePolicy{
 if(typeof sourceId!=='string'||!SOURCE_IDS.some(id=>id===sourceId))return deny('unknown_source','출처를 확인할 수 없어 상품 리서치에 사용할 수 없습니다.');
 if(sourceId==='youtube_data')return deny('source_policy_blocked','YouTube 자료는 현재 상품 리서치 수집·MD 분석·AI 입력·성장2 이관에 사용할 수 없습니다.');
 if(sourceId==='naver_searchad_keyword')return deny('source_policy_blocked','네이버 검색광고 자료는 광고 관리 목적의 별도 검토가 필요하여 상품 리서치 수집·MD 분석·AI 입력·성장2 이관이 중단되었습니다.');
 if(sourceId==='naver_shop_search')return deny('source_policy_blocked','네이버 쇼핑 검색은 서비스 종료로 자동 수집·MD 분석·AI 입력·성장2 이관이 중단되었습니다.');
 return {allowed:true,code:null,reason:null};
}
export function snapshotResearchPolicy(snapshot:Snapshot|undefined,now:number=Date.now()):ResearchSourcePolicy{
 if(!snapshot)return deny('missing_snapshot','원본 수집 자료가 없어 근거로 사용할 수 없습니다.');
 const source=researchSourcePolicy(snapshot.sourceId);if(!source.allowed)return source;
 const value=snapshot.fetchedAt;
 const iso=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
 const day=iso?Date.parse(value.slice(0,10)+'T00:00:00Z'):NaN;
 const validDay=Number.isFinite(day)&&new Date(day).toISOString().slice(0,10)===value.slice(0,10);
 const fetched=iso&&validDay?Date.parse(value):NaN;
 if(!Number.isFinite(now)||!Number.isFinite(fetched)||fetched>now)return deny('invalid_snapshot_time','수집 시각이 없거나 잘못되었거나 미래여서 근거로 사용할 수 없습니다.');
 return source;
}
