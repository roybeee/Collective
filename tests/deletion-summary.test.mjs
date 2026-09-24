// 캠페인 삭제 대화상자 문구(lib/deletion-summary.ts)와 화면 연결을 고정한다(ux-9 권고 1·3과 권고 2의 제목 입력 확인, 결정 7). 보관 기본값은 후속이다.
// 요약: 작업물·실행·회의·성과가 앞에 오고 0건은 빼며, 보존 규칙은 종료·원 캠페인 삭제 표시로 남는다고 적는다. 삭제 불가면 사유를 그대로 보인다.
// 화면 연결은 원문 검사(tests/workspace-wiring.test.mjs와 같은 방식)로 보고, 실제 여정은 e2e/smoke.spec.ts가 확인한다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/deletion-summary.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {deletionSummary,needsTitleConfirmation,canConfirmDeletion,readDeletionPreview,previewFailure,recheckDeletion,recheckPurge,ALREADY_DELETED,STALE_CAMPAIGN,COUNTS_CHANGED}=m.namespace;
let passed=0;
function check(name,actual,expected){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++}
const preview=(extra={})=>({campaignId:'c1',version:3,deletable:true,blockedReason:null,deleted:{campaign:1},retained:{},jobs:0,totals:{deleted:1,retained:0},...extra});

// --- 삭제 요약 ---------------------------------------------------------------------
const busy=preview({deleted:{campaign:1,artifact:2,team_meeting:1,metric:1,history:3,event:4,hermes_submission:2,openai_submission:1},jobs:5});
check('work, runs, meetings and metrics lead the deleted line',deletionSummary(busy).deleted.startsWith('삭제: 작업물 2건·실행 5건·회의 1건·성과 1건·'),true);
check('related records follow with readable names',deletionSummary(busy).deleted,'삭제: 작업물 2건·실행 5건·회의 1건·성과 1건·작업물 이전 버전 3건·캠페인 이력 4건·AI 요청·응답 원문 3건');
check('the campaign brief itself is not listed as a record',deletionSummary(busy).deleted.includes('캠페인 브리프'),false);
check('zero counts are omitted',deletionSummary(preview({deleted:{campaign:1,artifact:0,metric:2},jobs:0})).deleted,'삭제: 성과 2건');
check('kinds without a label are summed as other records',deletionSummary(preview({deleted:{campaign:1,future_kind:2,another_kind:1}})).deleted,'삭제: 기타 기록 3건');
check('a bare campaign says only the brief goes',deletionSummary(preview()).deleted,'삭제: 캠페인 브리프만 지웁니다');
// 레지스트리(lib/record-kinds.ts)에서 캠페인과 함께 지우는 kind는 모두 읽을 수 있는 이름을 가진다. 새 kind를 추가하면 이 표도 채운다.
const registry=moduleFor('lib/record-kinds.ts');await registry.link(()=>{throw new Error('record-kinds는 런타임 import가 없어야 합니다')});await registry.evaluate();
const deletable=JSON.parse(JSON.stringify(registry.namespace.recordKinds)).filter(k=>k.campaignDeletion==='delete'&&k.kind!=='campaign').map(k=>k.kind);
check('every kind deleted with a campaign has a readable label',deletable.filter(kind=>deletionSummary(preview({deleted:{campaign:1,[kind]:1}})).deleted.includes('기타 기록')),[]);

// --- 보존 요약(결정 7) ------------------------------------------------------------------
const kept=preview({retained:{learning_rule:2,viral_experiment_summary:1,store_experiment:1},totals:{deleted:1,retained:4}});
check('viral rules are kept retired and marked, experiments frozen as summaries',deletionSummary(kept).retained,'보존: 학습 규칙 2건(종료 표시로 남김, 원 캠페인 삭제 표시)·실험 요약 1건(원문을 뺀 요약으로 동결)·점포 실험 1건');
check('no retained line when nothing is kept',deletionSummary(preview()).retained,null);
check('zero retained counts are omitted',deletionSummary(preview({retained:{learning_rule:0,store_experiment:1}})).retained,'보존: 점포 실험 1건');

// --- 비식별 이관과 완전 삭제(F4b-2, 결정 7) ------------------------------------------------------
const archived=preview({archive:{signals:3,retentionDays:90},purge:{deleted:{learning_rule:2,review_decision:4},skipped:{viral_experiment_summary:1,deidentified_signal:3}}});
check('the archive line names the de-identified signals and retention',deletionSummary(archived).archived,'비식별 보관: 평가 신호 3건(작업물 본문·캠페인 이름·메모 없이 가명 키로 90일 보관)');
check('no archive line when nothing is archived or the server is older',[deletionSummary(preview({archive:{signals:0,retentionDays:90}})).archived,deletionSummary(preview()).archived],[null,null]);
check('the purge line lists what complete deletion removes and skips',deletionSummary(archived).purge,'완전 삭제: 학습 규칙 2건(종료 표시 대신 삭제)·사람 판정 로그 4건을 함께 지웁니다. 실험 요약 1건·비식별 평가 신호 3건을 남기지 않습니다.');
check('the purge line says so when there is nothing extra',deletionSummary(preview({purge:{deleted:{},skipped:{}}})).purge,'완전 삭제: 추가로 지우거나 남기지 않을 학습 자산이 없습니다.');
check('no purge line without purge counts',deletionSummary(preview()).purge,null);
check('a response with archive and purge counts is accepted',readDeletionPreview(JSON.parse(JSON.stringify(archived))).purge.deleted.review_decision,4);
for(const [name,bad] of [['archive without numbers',{...archived,archive:{signals:'3'}}],['purge counts as array',{...archived,purge:{deleted:[],skipped:{}}}],['purge without skipped',{...archived,purge:{deleted:{}}}]]){
 assert.throws(()=>readDeletionPreview(bad),/삭제 영향을 확인하지 못했습니다/,'malformed F4b-2 response rejected: '+name);passed++;
}
check('unchanged purge counts may be deleted',recheckPurge(archived,JSON.parse(JSON.stringify(archived))),null);
check('new decisions stop a complete deletion',[recheckPurge(archived,{...archived,purge:{...archived.purge,deleted:{...archived.purge.deleted,review_decision:5}}}),recheckPurge(preview(),archived)],[COUNTS_CHANGED,COUNTS_CHANGED]);
// 완전 삭제를 고르면 보존 줄에서 완전 삭제가 지우거나 만들지 않는 학습 자산을 빼고, 비식별 보관 줄을 보이지 않는다(F4B2-05). 평가 골든셋은 남는다고 보인다(F4B2-09).
const both=preview({retained:{learning_rule:2,viral_experiment_summary:1,store_experiment:1,review_decision:4,eval_case:2},archive:{signals:3,retentionDays:90},purge:{deleted:{learning_rule:2,review_decision:4},skipped:{viral_experiment_summary:1,deidentified_signal:3}}});
check('default deletion lists every retained asset including the eval golden set',deletionSummary(both).retained,'보존: 학습 규칙 2건(종료 표시로 남김, 원 캠페인 삭제 표시)·실험 요약 1건(원문을 뺀 요약으로 동결)·점포 실험 1건·사람 판정 로그 4건(사유 코드·판정만, 검토 메모 원문 없음)·평가 골든셋 2건(동결한 역할 요청 원문 포함, 완전 삭제에도 남음, 평가 화면에서 개별 삭제)');
check('complete deletion keeps only what it does not remove in the retained line',deletionSummary(both,{purge:true}).retained,'보존: 점포 실험 1건·평가 골든셋 2건(동결한 역할 요청 원문 포함, 완전 삭제에도 남음, 평가 화면에서 개별 삭제)');
check('complete deletion shows no de-identified archive line',[deletionSummary(both,{purge:true}).archived,deletionSummary(both).archived!==null],[null,true]);
check('complete deletion without other retained records shows no retained line',deletionSummary(archived,{purge:true}).retained,null);

// --- 삭제 불가 -----------------------------------------------------------------------
const reason='제작·발행 또는 주문 귀속 이력이 있어 삭제할 수 없습니다. 실행 기록을 보존하고 예약 취소는 Buffer에서 확인하세요.';
const blocked=preview({deletable:false,blockedReason:reason,deleted:{campaign:1,artifact:1},retained:{execution_publication:1,execution_creative:2}});
check('the server reason is shown when deletion is blocked',deletionSummary(blocked).blockedReason,reason);
check('blocked deletion falls back to a generic reason',deletionSummary(preview({deletable:false,blockedReason:null})).blockedReason,'이 캠페인은 지금 삭제할 수 없습니다.');
check('deletable campaigns carry no reason',deletionSummary(busy).blockedReason,null);
check('blocked deletion cannot be confirmed even with the title',canConfirmDeletion(blocked,'도넛 캠페인','도넛 캠페인'),false);
check('blocked deletion cannot be confirmed without work records either',canConfirmDeletion(preview({deletable:false,blockedReason:reason}),'도넛 캠페인',''),false);

// --- 제목 입력 확인 ----------------------------------------------------------------------
check('work, runs, meetings or metrics require typing the title',[{artifact:1},{team_meeting:1},{metric:1}].map(d=>needsTitleConfirmation(preview({deleted:{campaign:1,...d}}))).concat(needsTitleConfirmation(preview({jobs:1}))),[true,true,true,true]);
check('history and events alone do not require the title',needsTitleConfirmation(preview({deleted:{campaign:1,history:2,event:5}})),false);
check('the title must match exactly',canConfirmDeletion(busy,'도넛 캠페인','도넛'),false);
check('surrounding spaces are forgiven',canConfirmDeletion(busy,'도넛 캠페인','  도넛 캠페인 '),true);
check('a lightweight campaign needs no title',canConfirmDeletion(preview({deleted:{campaign:1,event:2}}),'도넛 캠페인',''),true);

// --- 응답 검증(외부 경계) ------------------------------------------------------------------
check('a valid response is accepted as is',readDeletionPreview(JSON.parse(JSON.stringify(busy))),JSON.parse(JSON.stringify(busy)));
for(const [name,bad] of [['non-object',null],['missing deletable',{...busy,deletable:undefined}],['count map as array',{...busy,deleted:[]}],['text job count',{...busy,jobs:'5'}],['missing version',{...busy,version:undefined}]]){
 assert.throws(()=>readDeletionPreview(bad),/삭제 영향을 확인하지 못했습니다/,'malformed response rejected: '+name);passed++;
}

// --- 이미 삭제된 캠페인(조회 404) ------------------------------------------------------------
// 다른 탭에서 지웠으면 조회가 404다. 다시 시도해도 404이므로 '다시 시도' 대신 목록 새로 고침을 보이고, 누르면 목록을 새로 고친 뒤 닫는다.
check('a 404 preview means the campaign is already gone',previewFailure(404,'항목을 찾을 수 없습니다.'),{gone:true,message:ALREADY_DELETED});
check('other failures keep the server message and allow retry',previewFailure(500,'서버 오류'),{gone:false,message:'서버 오류'});
check('failures without a message fall back to the retry text',previewFailure(502,null).message,'삭제 영향을 확인하지 못했습니다. 다시 시도해 주세요.');
check('a member 403 is not treated as already deleted',previewFailure(403,'관리자만 할 수 있습니다.').gone,false);

// --- 삭제 직전 재조회 ---------------------------------------------------------------------------
// 서버는 제목 확인을 강제하지 않는다. 대화상자를 연 뒤 기록이 늘거나 캠페인이 바뀌면 확인한 내용과 달라지므로 삭제하지 않는다.
check('an unchanged preview may be deleted',recheckDeletion(busy,JSON.parse(JSON.stringify(busy)),3),null);
check('count order and zero entries do not count as a change',recheckDeletion(preview({deleted:{campaign:1,artifact:1,event:0}}),preview({deleted:{metric:0,artifact:1,campaign:1}}),3),null);
check('a new work record stops the deletion',recheckDeletion(preview(),preview({deleted:{campaign:1,artifact:1}}),3),COUNTS_CHANGED);
check('a new run stops the deletion',recheckDeletion(busy,{...busy,jobs:6},3),COUNTS_CHANGED);
check('a record removed meanwhile also asks to check again',recheckDeletion(busy,{...busy,deleted:{...busy.deleted,history:2}},3),COUNTS_CHANGED);
check('a campaign edited elsewhere stops the deletion',recheckDeletion(busy,{...busy,version:4},3),STALE_CAMPAIGN);
check('a stale list is caught even when the preview itself matches',recheckDeletion(busy,busy,2),STALE_CAMPAIGN);
check('a newly blocked campaign shows the server reason',recheckDeletion(busy,{...busy,deletable:false,blockedReason:reason},3),reason);
check('a newly blocked campaign without a reason falls back',recheckDeletion(busy,{...busy,deletable:false,blockedReason:null},3),'이 캠페인은 지금 삭제할 수 없습니다.');

// --- 화면 연결 -------------------------------------------------------------------------
const dialog=readFileSync('app/delete-campaign-dialog.tsx','utf8'),workspace=readFileSync('app/workspace.tsx','utf8'),css=readFileSync('app/globals.css','utf8');
const has=(name,source,text)=>{assert.ok(source.includes(text),name);passed++};
const lacks=(name,source,text)=>{assert.ok(!source.includes(text),name);passed++};
has('the dialog loads the deletion preview',dialog,"'/api/campaigns/'+encodeURIComponent(id)+'/deletion'");
has('the dialog renders the summary module',dialog,'deletionSummary(');
has('the delete button waits for confirmation',dialog,'canConfirmDeletion(');
has('the dialog explains decision 7',dialog,'바이럴 출처 학습 규칙은 지우지 않고 종료 상태와 원 캠페인 삭제 표시로 남깁니다');
lacks('the old wording that rules are deleted is gone',dialog,'연결된 실험·학습 규칙을 삭제');
// eng-hygiene-7 ③: 표는 Workspace 밖 컴포넌트라 워크스페이스 값·동작(tableProps)을 props로 함께 받는다. 대시보드 호출에는 rowMenu가 없다.
has('the dashboard table has no delete action',workspace,'<CampaignTable items={recent.slice(0,3)} {...tableProps}/>');
has('the campaign list shows the row menu',workspace,'<CampaignTable items={campaigns} rowMenu {...tableProps}/>');
lacks('the inline row delete button is gone',workspace,'campaign-delete-button');
has('delete lives in the row menu',workspace,'<DropdownMenuItem variant="destructive" onSelect={()=>setDeleteTarget(c)}><Trash2/>삭제…</DropdownMenuItem>');
has('members never see the row menu',workspace,'rowMenu&&canManage&&<DropdownMenu');
// 상세 시트 헤더의 삭제 버튼(app/panels.tsx)은 이 클래스로 경고색을 유지한다.
has('the sheet delete button keeps its danger color',css,'.campaign-delete-button{color:#b42318}.campaign-delete-button:hover{color:#912018;background:#fff1f0}');
has('the dialog re-checks the preview right before deleting',dialog,'recheckDeletion(preview,fresh,campaign.version)');
has('the dialog deletes the version it re-checked',dialog,"api('delete_campaign',{id,version:fresh.version,confirmed:true})");
has('an already deleted campaign refreshes the list instead of retrying',dialog,'previewFailure(response.status,result?.error)');
has('an already deleted campaign offers a list refresh',dialog,'<span>{ALREADY_DELETED}</span><Button variant="outline" size="sm" onClick={refreshGone}>');
has('a stale list is flagged before typing the title',dialog,'{stale&&!gone&&<p role="alert" className="form-error">{STALE_CAMPAIGN}</p>}');
// F4b-2: 완전 삭제 선택은 소유자에게만 보이고 기본 해제다. 고르면 소유자 전용 경로(/api/campaigns)로 purgeLearning을 보내고 추가 삭제 건수도 다시 확인한다.
has('the dialog explains de-identified retention',dialog,'평가 신호는 원문 없이 비식별로 90일 보관합니다');
has('the purge option is owner-only',dialog,'const isOwner=canChange(useAccount(),true)');
has('the purge option starts unchecked',dialog,'const[purge,setPurge]=useState(false)');
has('the purge checkbox is labelled',dialog,'<b>학습 자산까지 완전 삭제(소유자만)</b> {summary.purge}');
has('complete deletion goes through the regular delete action with the purge flag',dialog,"api('delete_campaign',{id,version:fresh.version,confirmed:true,purgeLearning:true}):api('delete_campaign'");
has('complete deletion re-checks the extra counts',dialog,'(purging?recheckPurge(preview,fresh):null)');
has('the dialog shows the archive line',dialog,'{summary.archived&&<p>{summary.archived}</p>}');
has('the summary follows the purge choice',dialog,'deletionSummary(preview,{purge:purging})');
has('the dialog description changes for complete deletion',dialog,'바이럴 출처 학습 규칙·이 캠페인의 사람 판정 로그·이전에 보관한 비식별 평가 신호도 지우고');
has('the success message follows what the server did',dialog,"toast.success(done.purgedLearning?'캠페인과 학습 자산을 완전히 삭제했습니다.':'캠페인을 삭제했습니다.')");

console.log(JSON.stringify({passed},null,2));
