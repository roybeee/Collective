// 상품 리서치 수집기 묶음(순수 fetch 어댑터 + 운영자 가져오기 해석기). docs/PRODUCT-RESEARCH-PLAN.ko.md 3·4절.
// 수집기는 저장하지 않는다. 스냅샷 초안(SnapshotDraft)과 쓴 쿼터 단위만 돌려주고, id·가져온 사람·저장은 서버(server.ts)가 붙인다.
// fetch와 시계는 deps로 받는다. 테스트는 가짜 fetch만 넣고 실제 네트워크를 부르지 않는다.
import type {Snapshot} from '../types';

// 수집 결과의 스냅샷 초안. id는 저장 시, importedBy는 운영자 가져오기를 받은 서버가 붙인다.
export type SnapshotDraft=Omit<Snapshot,'id'|'importedBy'>;
// Workers의 fetch는 다른 객체의 메서드로 부르면 Illegal invocation이 날 수 있어 수집기는 꺼내서 부른다(http.ts).
export type CollectDeps={fetch:typeof fetch;now:()=>Date};
// 모든 수집기의 공통 결과. unitsUsed는 공급자 쿼터 단위(quota.ts unitsFor)다.
export type CollectResult={draft:SnapshotDraft;unitsUsed:number};

export {CollectorError,CollectorAuthError,CollectorQuotaError,fetchSourceJson,sha256Hex} from './http';
export type {CollectorErrorCode,FetchedJson,FetchOptions} from './http';
export {unitsFor,canSpend,kstDayKey,quotaDayKey} from './quota';
export type {QuotaOperation} from './quota';
export {collectSearchadKeywords,signSearchad,parseQcCnt,compIdxValue,SEARCHAD_BASE,MAX_HINT_KEYWORDS} from './naver-searchad';
export {collectDatalabSearch,collectDatalabShoppingCategories,collectDatalabShoppingKeywords,DATALAB_BASE} from './naver-datalab';
export type {DatalabTimeUnit,DatalabSearchInput,DatalabCategoryInput,DatalabCategoryKeywordInput} from './naver-datalab';
export {collectShopSearch,stripTags,SHOP_BASE} from './naver-shop';
export {discoverYoutubeVideos,trackYoutubeVideos,YOUTUBE_BASE} from './youtube';
export type {YoutubeDiscoverInput,YoutubeDiscoverResult} from './youtube';
export {collectCoupangBestCategory,collectCoupangSearch,signCoupang,coupangSignedDate,COUPANG_BASE} from './coupang-partners';
export {parseImport,parseCsv,IMPORT_MAX_BYTES,IMPORT_MAX_ROWS} from './imports';
export type {ImportSourceId,ImportInput,ImportIssue,ImportOutcome} from './imports';
