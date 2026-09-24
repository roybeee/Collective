// ⑦(docs/DATA-PROCESSING.ko.md 4.4, 레인 B): 검토 메모 입력란과 자료 업로드 화면에 개인정보 입력 금지 안내가 있다.
// 화면 원문 검사로 고정한다. 안내는 설명 텍스트만 더하고 기존 라벨·버튼 이름(E2E가 쓰는 '추가 메모'·'자료 보관' 등)은 그대로 둔다.
// B1 사유 선택(작업물 수정 요청 사유 칩, 브리프 제안 미사용 사유, 자료 사용 제외 사유)은 코드 목록이라 글을 적을 수 없어 안내 대상이 아니다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

let passed=0;
const ok=(name,value)=>{assert.ok(value,name);passed++};
const source=file=>readFileSync(file,'utf8');
// 시작 표지부터 끝 표지 전까지를 자른다(한 줄 압축 코드라 줄 단위로 나눌 수 없다).
const body=(text,start,end)=>{const from=text.indexOf(start);assert.ok(from>=0,'missing '+start);const to=text.indexOf(end,from+start.length);assert.ok(to>=0,'missing '+end);return text.slice(from,to)};
// parts가 text 안에 이 순서대로 모두 있다.
const inOrder=(text,...parts)=>{let at=-1;for(const p of parts){at=text.indexOf(p,at+1);if(at<0)return false}return true};

const MEMO='고객 이름·전화번호·주소 같은 개인정보는 적지 마세요. 이 내용은 AI 작업 입력으로 쓰일 수 있습니다.';
const UPLOAD='개인정보가 담긴 파일은 올리지 마세요. 고객 이름·전화번호·주소 같은 개인정보는 메모에도 적지 마세요. 자료 내용은 AI 작업 입력으로 쓰일 수 있습니다.';

// --- 작업물 검토 메모(app/panels.tsx ArtifactDialog): 메모 입력란 바로 아래, 수정 요청 버튼 앞 ---------------------
const artifact=body(source('app/panels.tsx'),'export function ArtifactDialog','export function CampaignPanel');
ok('the artifact review memo shows the personal data notice',artifact.includes(MEMO));
ok('the notice sits under the memo textarea and before the review buttons',inOrder(artifact,'<Textarea value={note}',MEMO,'>수정 요청</Button>'));
ok('the memo placeholder stays unchanged',artifact.includes('placeholder="검토 의견을 남기세요. 수정 요청에는 의견이 필요합니다."'));

// --- 자료 업로드(app/brand-archive.tsx SourceDialog): 첫 입력란 앞, 파일 선택과 메모보다 먼저 보인다 -----------------
const upload=body(source('app/brand-archive.tsx'),'function SourceDialog','function ObservationDialog');
ok('the upload dialog shows the personal data file notice',upload.includes(UPLOAD));
ok('the upload notice comes before every field, so no field label or accessible name changes',upload.indexOf(UPLOAD)<upload.indexOf('<Field'));
ok('the upload notice comes before the file picker and the memo field',inOrder(upload,UPLOAD,'<Input type="file"',"'추가 메모'"));
ok('upload labels used by E2E stay unchanged',['<DialogTitle>브랜드 자료 추가</DialogTitle>',"label={file?'추가 메모':'확인한 내용 · 원문 텍스트'}","{progress||'자료 보관'}"].every(t=>upload.includes(t)));

// --- 의뢰 정보(app/brand-archive.tsx 브랜드 등록 설명·의뢰 정보 탭) ---------------------------------------------------
// 대표 결정(2026-09-24)으로 의뢰 목적·시장·경쟁사를 개인정보 패턴을 가린 뒤 AI 조사에 보내게 되어 '보내지 않습니다' 안내를 바꿨다. 패턴 가림은 이름을 잡지 못하므로 적지 말라는 문장을 같은 안내에 둔다.
const INTAKE='의뢰 목적·시장·경쟁사는 전화·이메일·주소 같은 개인정보 패턴을 가린 뒤 AI 조사에 보냅니다. 고객 이름·전화번호·주소 같은 개인정보는 적지 마세요.';
ok('brand registration and the intake tab say intake notes are masked and ask not to write personal data',source('app/brand-archive.tsx').split(INTAKE).length===3);

console.log(JSON.stringify({passed}));
