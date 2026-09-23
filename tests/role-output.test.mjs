import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/role-output.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {roleOutputContract,parseRoleOutput,isQuestionOnly,artifactUsable,upstreamContext,substantiveIssue,scrubInternalIds,labelArchive,idLabels}=m.namespace;
const bad='현재 메시지에는 수행할 작업이 명시되지 않았습니다. 원하시는 작업을 선택해 주세요. 1. 시장 조사 2. 전략 수립';
assert.equal(isQuestionOnly(bad),true);
assert.throws(()=>parseRoleOutput(bad,'insight'));
const contract=roleOutputContract('insight');
const valid={contractVersion:contract.version,role:'insight',sections:contract.sections.map(s=>({id:s.id,content:'자료 필요: 현장 관찰이 없습니다. 확인 전에는 가설로 취급하며 메뉴 확정 후 고객에게 직접 질문합니다.'}))};
assert.ok(parseRoleOutput(JSON.stringify(valid),'insight',contract).includes('자료 필요'));
assert.throws(()=>parseRoleOutput(JSON.stringify({...valid,sections:valid.sections.slice(1)}),'insight',contract));
assert.throws(()=>parseRoleOutput(JSON.stringify({...valid,role:'strategy'}),'insight',contract));
assert.throws(()=>parseRoleOutput(JSON.stringify({...valid,sections:valid.sections.map(s=>({...s,content:bad}))}),'insight',contract));
assert.throws(()=>parseRoleOutput(JSON.stringify({...valid,sections:valid.sections.map(s=>({...s,content:'가'.repeat(40001)}))}),'insight',contract));
assert.equal(parseRoleOutput('기존 실행의 사용 가능한 결과','cmo'),'기존 실행의 사용 가능한 결과');
const artifact={id:'a',role:'cmo',content:'검토 가능한 실행 기획',status:'approved',version:1,campaignVersion:2};
assert.equal(artifactUsable(artifact,2),true);
assert.equal(artifactUsable({...artifact,status:'revision'},2),false);
assert.equal(artifactUsable({...artifact,campaignVersion:1},2),false);
assert.equal(artifactUsable({...artifact,content:bad},2),false);
assert.equal(artifactUsable({...artifact,campaignVersion:undefined,origin:'manual'},2),true);
const prior=upstreamContext([{...artifact,content:'a'.repeat(9000)},{...artifact,id:'later',role:'growth'}],'strategy',2);
assert.equal(prior.length,1);assert.equal(prior[0].ref,'총괄 파트너 v1');assert.equal(prior[0].id,undefined);assert.equal(prior[0].excerpt,true);assert.equal(prior[0].originalLength,9000);assert.ok(prior[0].content.length<=6000);
assert.equal(upstreamContext([{...artifact,content:'가'.repeat(9000)}],'quality',2)[0].excerpt,false);
// 형식을 바꾼 재질문과 속 빈 초안은 JSON 계약을 통과해도 실질 산출물이 아니다.
const draft='고객 상황: 퇴근길 1인 가구가 20분 안에 따뜻한 한 끼를 찾습니다. 현재 대안은 편의점 도시락과 배달이며 장벽은 배달비와 대기 시간입니다.\n[가설] 매장 픽업 할인보다 준비 시간 보장이 더 큰 선택 이유입니다. 반증: 픽업 주문 비율이 2주간 10% 미만이면 기각합니다.\n[자료 필요] 실제 메뉴 가격과 조리 시간은 대표 확인 후 반영합니다. 확인 담당은 매장 운영자이며 오픈 전 주에 점검합니다.';
const rendered=parseRoleOutput(JSON.stringify({...valid,sections:valid.sections.map(s=>({...s,content:draft}))}),'insight',contract);
assert.equal(substantiveIssue(rendered),null);
assert.match(substantiveIssue(parseRoleOutput(JSON.stringify(valid),'insight',contract)),/250자/);
const placeholders=valid.sections.map(s=>({...s,content:[1,2,3].map(i=>`자료 필요 ${i}: 현장 관찰이 없습니다. 확인 전에는 가설로 취급하며 메뉴 확정 후 고객에게 직접 질문합니다.`).join('\n')}));
assert.match(substantiveIssue(parseRoleOutput(JSON.stringify({...valid,sections:placeholders}),'insight',contract)),/자료 필요/);
const variants=['다음 중 무엇을 원하시는지 한 가지만 지정해 주세요. 1) 전략 2) 카피','어떤 방향으로 작성할지 알려 주시면 바로 작성하겠습니다. '+'브랜드와 목표는 확인했습니다. '.repeat(20),'요청하신 캠페인 자료를 모두 검토했습니다. '.repeat(8)+'\n1. 인스타그램 중심 오픈 캠페인\n2. 배달앱 중심 할인 캠페인\n3. 매장 체험 이벤트\n위 선택지 중 하나를 선택해 주시면 해당 방향으로 전체 산출물을 작성하겠습니다.'];
for(const text of variants){assert.equal(isQuestionOnly(text),false);assert.ok(substantiveIssue(text),text.slice(0,20));}
assert.ok(substantiveIssue(parseRoleOutput(JSON.stringify({...valid,sections:valid.sections.map(s=>({...s,content:'어떤 방향으로 작성할지 알려 주시면 바로 작성하겠습니다.'}))}),'insight',contract)));
assert.equal(substantiveIssue('## 확인 계획\n\n1. 메뉴 가격 확인\n2. 오픈일 확인\n확정 가격을 알려 주시면 카피에 반영합니다. '+draft),null);
// 고객에게 보여 줄 투표·퀴즈 문안은 재질문이 아니다(AQ4 오탐 회귀).
const poll='다음 중 가장 먹어 보고 싶은 피자를 골라 주세요!\n1) 마르게리타\n2) 페퍼로니\n3) 고르곤졸라\n댓글로 번호를 남겨 주세요.';
assert.equal(substantiveIssue(`## 게시 카피\n\n${draft}\n\n## 참여형 게시물 문안\n\n${poll}`),null);
assert.equal(substantiveIssue(`## 참여형 게시물 문안\n\n${poll}\n\n## 게시 카피\n\n${draft}`),null);
assert.equal(substantiveIssue(`## 스토리 투표 문안\n\n둘 중 하나만 골라 주세요. 1) 바삭한 도우 2) 쫄깃한 도우\n\n## 게시 카피\n\n${draft}`),null);
// 실질 초안과 함께 둔 확인 계획 요청은 재질문이 아니다. 재질문 섹션을 뺀 본문이 최소 실질량(250자) 이상이어야 한다.
const drafted=`## 조건부 초안\n\n${draft}\n\n## 실행 계획\n\n${draft}`;
for(const ask of ['## 확인 계획\n1) 메뉴 가격 2) 영업시간\n아래 항목을 알려 주시면 [확인 필요] 표시를 해제하겠습니다','## 확인 계획\n대표님이 오픈일을 정해 주시면 바로 진행하겠습니다.','## 확인 계획\n가격 확인 결과를 알려 주시면 작성하겠습니다.','## 카피 선택\n1. 카피 A안 2. 카피 B안 중 하나를 선택해 주시면 게시 일정에 맞춰 올리겠습니다.']){assert.equal(substantiveIssue(`${drafted}\n\n${ask}`),null,ask);assert.ok(substantiveIssue(`## 조건부 초안\n\n${draft.slice(0,120)}\n\n${ask}`),ask);}
assert.equal(substantiveIssue(draft+'\n대표님이 오픈일을 정해 주시면 바로 진행하겠습니다.'),null);
// 재작성 결과의 changes 절은 재질문 검사에서 뺀다.
assert.equal(substantiveIssue(`${drafted}\n\n## 수정 요청 반영 위치\n\n가격 확인 결과를 알려 주시면 작성하겠습니다.`),null);
// 섹션 대부분이 재질문이면 실질 초안이 조금 있어도 실패한다.
assert.ok(substantiveIssue(['## 전략','## 카피','## 측정'].map(h=>h+'\n\n어떤 방향으로 작성할지 알려 주시면 바로 작성하겠습니다.').join('\n\n')+'\n\n## 메모\n\n'+draft));
// '자료 필요'만 있는 섹션이 절반을 넘으면 줄 비율이 80% 미만이어도 실질 초안이 아니다.
assert.match(substantiveIssue(`## 핵심 인사이트\n\n${draft}\n\n`+[1,2,3,4,5].map(i=>`## 항목 ${i}\n\n자료 필요: 실측 기록이 없어 확인 후 작성합니다.`).join('\n\n')),/자료 필요/);
// 내부 식별자는 저장 본문에서 사람이 읽는 출처 표현으로 바뀐다.
const leaked='캠페인 브리프 `campaign.id=37da2d59-038a-4403-8374-de1f01f430f7, version=1`과 이전 작업물 `ai-f8710d51c4f2a179f4eb21008f184872, version=1`, 브랜드 아카이브 revision 17을 기준으로 판단했습니다.';
const scrubbed=scrubInternalIds(leaked,idLabels({campaign:{id:'37da2d59-038a-4403-8374-de1f01f430f7',version:1}}));
assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(scrubbed)&&!/ai-[0-9a-f]{32}/.test(scrubbed)&&!/revision \d+/.test(scrubbed),scrubbed);
assert.ok(!scrubbed.includes('브리프 브리프')&&!scrubbed.includes('이전 작업물 이전 작업물'),scrubbed);
assert.ok(scrubbed.includes('캠페인 브리프 v1과 이전 작업물')&&scrubbed.includes('브랜드 자료를 기준으로'),scrubbed);
// 입력에 없는 식별자는 다른 출처로 둔갑하지 않고, 알려진 식별자는 입력의 ref 라벨로 바뀐다.
const sourceId='5b0c3f7e-1111-4222-8333-123456789abc';
assert.equal(scrubInternalIds(`[확인 사실: 자료 id=${sourceId}]`),'[확인 사실: 자료 내부 참조]');
const labels=idLabels({campaign:{id:'37da2d59-038a-4403-8374-de1f01f430f7',version:2},archive:labelArchive({confirmedSources:[{id:'0a0b0c0d-1111-4222-8333-123456789abc-e3-0'},{id:sourceId}]}),artifacts:[{id:'ai-f8710d51c4f2a179f4eb21008f184872',role:'insight',version:3}]});
assert.equal(scrubInternalIds(`브랜드 자료 \`id=${sourceId}\`(상권 조사)에 따르면`,labels),'브랜드 자료 #2(상권 조사)에 따르면');
assert.equal(scrubInternalIds('[확인 사실: 자료 id=0a0b0c0d-1111-4222-8333-123456789abc-e3-0]',labels),'[확인 사실: 브랜드 자료 #1]');
assert.equal(scrubInternalIds('이전 작업물 `ai-f8710d51c4f2a179f4eb21008f184872, version=3`의 가설',labels),'이전 작업물 고객 인사이트 v3의 가설');
assert.equal(scrubInternalIds('캠페인 브리프(id=37da2d59-038a-4403-8374-de1f01f430f7) 목표',labels),'캠페인 브리프 v2 목표');
// 아카이브를 가리키지 않는 revision 표현은 그대로 둔다.
assert.equal(scrubInternalIds('메뉴판 revision 2를 기준으로'),'메뉴판 revision 2를 기준으로');
assert.equal(scrubInternalIds('The revision 2 plan'),'The revision 2 plan');
assert.ok(scrubInternalIds('archiveRevision: 17 기준').startsWith('브랜드 자료'));
// 모델 출력 길이에 비례한 시간 안에 끝난다(SEC-2).
for(const input of ['a'.repeat(40000),'캠페인 브리프'+' '.repeat(40000)+'x','브랜드 자료'+' '.repeat(40000)+'x']){const t=Date.now();scrubInternalIds(input,labels);assert.ok(Date.now()-t<250,input.slice(0,8))}
assert.equal(scrubInternalIds('참고 출처 없음. 브리프 v1 목표를 따릅니다.'),'참고 출처 없음. 브리프 v1 목표를 따릅니다.');
const url='https://example.com/menu?id=37da2d59-038a-4403-8374-de1f01f430f7';assert.equal(scrubInternalIds(`출처: ${url} 참고`),`출처: ${url} 참고`);
// 입력 자료에는 사람이 인용할 ref 라벨이 붙는다.
const labeled=labelArchive({revision:3,confirmedSources:[{id:'s1',title:'메뉴표'},{id:'s2',title:'상권'}]});
assert.equal(labeled.confirmedSources[1].ref,'브랜드 자료 #2');assert.equal(labeled.confirmedSources[0].id,'s1');
// 재작성 결과의 changes 절은 본문 끝에 남는다.
assert.ok(parseRoleOutput(JSON.stringify({...valid,changes:'2번 항목에 가격 확인 계획을 추가했습니다.'}),'insight',contract).includes('## 수정 요청 반영 위치\n\n2번 항목에 가격 확인 계획을 추가했습니다.'));
console.log('PASS: structured role output, ODA nonanswers, legacy compatibility, predecessor validity, bounded upstream context, substantive output, internal id scrubbing');
