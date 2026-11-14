// 홈 '오늘의 안건' 항목 형식(서버 lib/agenda-server.ts가 만들고 화면 app/agenda-panel.tsx가 그린다). 선언만 둔다(브라우저 번들에 들어간다).
// 결정 인박스 v2(GLOBAL-PLAN X1): 탭 결정(기한 초과·결정 대기)/질문/알림(새 신호·다가오는 기한), 어디(브랜드·지점·계정)·비용·행 안 동작(action)을 함께 돌려준다.
import type {CampaignTab,NavState} from './nav-state';
export type AgendaKind='overdue'|'decision'|'question'|'signal'|'upcoming';
export type AgendaTab='decide'|'ask'|'notify';
export const agendaTabs:{tab:AgendaTab;label:string;kinds:AgendaKind[]}[]=[{tab:'decide',label:'결정',kinds:['overdue','decision']},{tab:'ask',label:'질문',kinds:['question']},{tab:'notify',label:'알림',kinds:['signal','upcoming']}];
export const agendaTabOf=(kind:AgendaKind):AgendaTab=>agendaTabs.find(t=>t.kinds.includes(kind))?.tab??'decide';
// quick: 안건 행에서 바로 처리할 수 있는 동작(UX-PLAN-3 10.3). 기본값을 채워 두고 사람은 확인만 한다. 외부 실행은 없다.
export type AgendaQuick={type:'acknowledge_signal';recordId:string;version:number;campaignVersion:number;nextAction:string;dueBy:string};
// action: 기존 API로 행 안에서 승인·수정 요청할 수 있는 결정. review_artifact → POST /api/action, approve_publication → POST /api/execution(관리자).
export type AgendaAction=
 |{type:'review_artifact';recordId:string;version:number;role:string}
 |{type:'approve_publication';recordId:string;version:number;aiCopy:boolean;codedPng:boolean};
export type AgendaSource='growth'|'artifact'|'publication'|'meeting'|'sequence'|'data_request'|'brief'|'billing'|'kakao'|'geo'|'place_draft'|'ads_proposal';
// panel: 행을 누르면 바로 열 성장 탭 접기 패널의 제목(components/app/lazy-panel.tsx). ctab: 성장 탭이 아닌 출처가 열 캠페인 탭(없으면 성장 섹션으로 이동).
// where: 브랜드·지점·계정처럼 '어디'를 적는 조각(문장 아님). cost: 예정 비용(원, 없으면 null).
// brandId·storeId: 범위 역할 화면 판정(app/account-context.tsx useAccessCheck)에 쓰는 자원. nav: 캠페인에 묶이지 않은 출처(요금 알림·카카오 재동의·플레이스 초안·광고 제안)가 열 화면.
// 캠페인에 묶이지 않은 항목은 campaignId·campaignTitle이 빈 문자열이다.
// titleKey·vars(GLOBAL-PLAN G6 3단계): 서버가 만든 제목의 사전 키와 자리 값. title(한국어)은 그대로 둔다(이전 화면·테스트용). 화면은 영어·일본어일 때만 키로 그린다(lib/agenda-client.ts agendaTitle).
// detailKey·detailVars: 서버가 만든 설명 문장(건수 등)일 때만 단다. 저장된 글(작업물 제목·캡션)은 키가 없다. 키의 한국어 원본은 lib/i18n/ko-agenda.ts.
export type AgendaItem={id:string;kind:AgendaKind;source?:AgendaSource;title:string;titleKey?:string;vars?:Record<string,string|number>;detail:string;detailKey?:string;detailVars?:Record<string,string|number>;campaignId:string;campaignTitle:string;where?:string[];due:string|null;cost?:number|null;section:'decide'|'execute'|'observe'|'prepare'|'evidence'|'learn';panel?:string;ctab?:CampaignTab;quick?:AgendaQuick;action?:AgendaAction;brandId?:string;storeId?:string|null;nav?:NavState};
export type AgendaCounts=Record<AgendaKind,number>;
export type Agenda={items:AgendaItem[];counts:AgendaCounts;tabs:Record<AgendaTab,number>;total:number;generatedAt:string};
