// 브라우저 실행 계약. 로그인 세션·쿠키·비밀번호는 장치에만 존재한다.
export type BrowserJobType='read_hours'|'change_hours';
export type BrowserJobStatus='draft'|'approved'|'claimed'|'target_checked'|'prepared'|'submit_started'|'submitted'|'unknown'|'waiting_human'|'verified'|'cancelled';
export type BrowserEvidence={managerUrl:string;managerBusinessId:string;naverPlaceId:string;storeName:string;hours:string;capturedAt:string;source:'real'|'mocked';note?:string};
export type BrowserDevice={id:string;label:string;profileId:string;status:'active'|'revoked';version:number;createdAt:string;updatedAt:string};
export type BrowserBinding={id:string;storeId:string;storeName:string;naverPlaceId:string;managerBusinessId:string;managerUrl:string;deviceId:string;profileId:string;version:number;updatedAt:string};
export type BrowserJob={id:string;storeId:string;type:BrowserJobType;status:BrowserJobStatus;bindingVersion:number;binding:BrowserBinding;beforeHours:string;afterHours:string;digest:string;approvedDigest?:string;approvedBy?:string;approvedUntil?:string;attemptId?:string;leaseHash?:string;leaseUntil?:string;deviceId:string;version:number;createdAt:string;updatedAt:string;submissionStartedAt?:string;evidence?:BrowserEvidence;note?:string};
export type BrowserListing={enabled:boolean;bindings:BrowserBinding[];jobs:BrowserJob[];devices:BrowserDevice[]};
export const BROWSER_JOB_LABELS:Record<BrowserJobStatus,string>={draft:'승인 대기',approved:'실행 대기',claimed:'장치 접수',target_checked:'대상 확인',prepared:'저장 준비',submit_started:'저장 시작',submitted:'저장 응답 확인',unknown:'결과 불명확',waiting_human:'사람 확인 필요',verified:'관리 화면 확인 완료',cancelled:'취소'};
