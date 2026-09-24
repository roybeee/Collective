// 프롬프트 레지스트리 기준선(prompt-baseline)과 레지스트리(prompt-registry) 테스트가 함께 쓰는 합성 시드·모의 HERMES·실행 헬퍼.
// 실제 고객·매장 정보가 아니다. 입력이 실행마다 같도록 모든 시각은 고정값이고, 역할 실행 전마다 캠페인 행을 고정값으로 되돌린다.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {roleFixture} from './role-fixture.mjs';

export const now='2026-01-01T00:00:00.000Z';
export const sha=text=>createHash('sha256').update(String(text)).digest('hex');
export const brand={id:'pr-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 브랜드 소개(미확인).',audience:'가상동 주민(가설)',tone:'친근하고 명료한',constraints:'가격은 확인 전 확정 문구로 쓰지 않는다.',knowledge:'합성 메모.'};
const base={brandId:brand.id,audience:'가상동 주민(가설)',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'review',version:1,createdAt:now,updatedAt:now};
// 역할 캠페인은 숏폼·검색·현장 채널 스킬을, 회의 캠페인은 YouTube·커뮤니티·커머스 채널 스킬을 쓴다.
export const roleCampaign={...base,id:'pr-role-campaign',title:'가상분식 오픈',goal:'오픈 전 인지와 첫 포장 주문을 만든다.',channels:'Instagram, 네이버 플레이스, 매장 안내'};
export const meetingCampaign={...base,id:'pr-meeting-campaign',title:'가상분식 재방문',goal:'첫 방문 고객의 재방문을 만든다.',channels:'YouTube, 커뮤니티, 커머스'};
export const roleIds=['cmo','insight','strategy','creative','content','growth','data','quality'];

// 회의 단계별 합성 응답. 발언은 앞선 발언 ref 하나에 답하고, 합의는 콘텐츠·그로스 과제를 배정한다.
export function meetingAnswer(x){
 if(x.phase==='discussion')return JSON.stringify({position:'합성 진단: 첫 방문 고객이 다시 올 이유가 브리프에 없습니다. 재방문 동기를 한 가지로 좁혀야 합니다.',evidence:'합성 근거: 제공된 브리프와 작업물만 사용했고 고객 반응은 미측정입니다.',challenge:'합성 반론: 앞선 제안의 측정 기준이 비어 있어 보완이 필요합니다.',proposal:'합성 제안: 재방문 쿠폰 대신 다음 메뉴 안내 카드를 시험하고 회수율을 비교합니다.',respondsTo:(x.allowedRespondsTo||[]).slice(0,1).map(r=>r.ref)});
 if(x.phase==='synthesis')return JSON.stringify({decisions:'합성 결정: 다음 메뉴 안내 카드를 시험한다.',disagreements:'합성: 할인 제안 보류',questions:'합성: 메뉴 확정 시점',tasks:[{role:'content',instruction:'안내 카드 문안 완성',reason:'합의 결정',acceptance:'카드 문안 3종'},{role:'growth',instruction:'배포 조건 정리',reason:'측정 연결',acceptance:'배포 조건 명시'}]});
 if(x.phase==='revision')return JSON.stringify({title:x.role+' 합성 개선본',content:'## 합성 개선본\n안내 카드 문안과 배포 조건을 구체화했습니다. 실적은 미측정입니다.\n첫 장면: 포장 봉투에 다음 메뉴 카드를 넣습니다. CTA: 다음 방문 때 카드를 보여 주세요.\n대조안: 카드 없는 포장과 회수율만 비교합니다.\n\n## 문안 3종\n1. 다음에는 김밥도 같이 드셔 보세요. 카드를 보여 주시면 포장 순서를 먼저 안내합니다.\n2. 오늘 드신 떡볶이와 어울리는 메뉴를 카드 뒷면에 적었습니다. 가격은 매장에서 확인해 주세요.\n3. 다음 방문 때 이 카드를 가져오시면 새 메뉴 준비 일정을 알려 드립니다.\n\n## 배포 조건\n포장 주문 전체에 같은 카드를 넣고, 회수 카드 수를 포장 주문 수로 나눠 회수율을 계산합니다. 매장 담당자가 주간 기록으로 확인합니다.',changes:'합의 과제를 반영했습니다.'});
 return JSON.stringify({verdict:'revise',summary:'합성 검수: 측정 설계 보완 필요',findings:'합성 발견: 회수율 분모 정의가 필요합니다.'});
}

// 모의 HERMES. 제출 본문을 실행 번호별로 보관하고, 조회하면 역할(roleFixture)·회의(meetingAnswer)·학습 합성 응답으로 완료한다.
export function mockHermes(extra=async()=>undefined){
 const bodies=new Map(),external=[],failures={submit:0};let calls=0;
 const fetch=async(url,options={})=>{
  url=String(url);
  const handled=await extra(url,options);if(handled)return handled;
  if(!url.startsWith('https://hermes.example.com/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
  if(url.endsWith('/v1/runs')){if(failures.submit>0){failures.submit--;return new Response('{}',{status:503})}const id='pr_'+ ++calls;bodies.set(id,options.body);return Response.json({run_id:id})}
  const id=url.split('/').pop(),sent=JSON.parse(bodies.get(id)),input=JSON.parse(sent.input);
  const output=input.phase?meetingAnswer(input):input.task?roleFixture(sent.input):JSON.stringify({cases:[],blockers:'합성: 도구 없음'});
  return Response.json({object:'hermes.run',run_id:id,status:'completed',output,usage:{total_tokens:100,output_tokens:600},model:'mock-model'});
 };
 return {fetch,bodies,external,failures,calls:()=>calls};
}

export async function seed(server,sql,owner){
 const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
 await sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET secret=excluded.secret,model=excluded.model').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'})),'HERMES',now);
 await put('brand',brand.id,brand);
 for(const c of [roleCampaign,meetingCampaign])await put('campaign',c.id,c);
 await put('brand_fact','pr-fact-address',{id:'pr-fact-address',brandId:brand.id,key:'주소',value:'가상동 12',status:'confirmed',source:'합성 원장',verifiedAt:now,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},brand.id);
 await put('campaign_directive','pr-directive',{id:'pr-directive',campaignId:roleCampaign.id,text:'합성 지시: 날짜는 D-day 상대 일정으로 쓴다.',createdAt:now,createdBy:{id:'synthetic-member',email:null,role:'member'}},roleCampaign.id);
 await put('worker_credential','current',{id:'current',tokenHash:'fixture'});
 // 회의 캠페인의 현행 작업물. 회의 스냅샷은 작업물을 updated_at 순으로 읽으므로 행 시각도 역할마다 다른 고정값으로 넣어 순서가 실행마다 같게 한다.
 for(const [i,role] of roleIds.entries()){const a={id:'pr-seed-'+role,campaignId:meetingCampaign.id,campaignVersion:1,role,title:'합성 '+role,content:'## 합성 '+role+' 작업물\n조건부 초안입니다. 실적은 미측정이며 담당자가 현장 기록으로 확인합니다.',version:1,status:'review',origin:'ai',createdAt:now};sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:artifact:${a.id}`,owner,'artifact',meetingCampaign.id,JSON.stringify(a),`2026-01-01T00:00:0${i}.000Z`)}
 await put('viral_case','pr-case',{id:'pr-case',brandId:brand.id,title:'합성 사례',channel:'YouTube',url:'https://example.com/synthetic-case',account:'합성 계정',publishedAt:'',observedAt:now,scope:'합성 관찰',observations:'합성 관찰 기록',transcript:'',views:null,baselineViews:null,comparison:'',createdAt:now,origin:'manual'},brand.id);
 return put;
}

// 역할 하나를 시작·조회한다. 시작 전에 캠페인 행을 고정값으로 되돌려 입력의 campaign 필드가 실행마다 같게 한다.
export async function runRole(execution,server,owner,campaign,role){
 await server.recordStatement(owner,'campaign',campaign.id,campaign).run();
 const started=await (await execution.executeRole(owner,{action:'start',campaignId:campaign.id,role})).json();
 if(!started.id)throw new Error(`${role} 시작 실패: ${JSON.stringify(started)}`);
 const body=JSON.parse((await server.readRecord(owner,'hermes_submission',started.id)).body);
 const polled=await (await execution.executeRole(owner,{action:'poll',id:started.id})).json();
 return {role,jobId:started.id,inputHash:started.id.split(':').pop(),instructions:body.instructions,input:body.input,status:polled.status};
}

// 역할 실행이 만든 작업물 행의 시각(updated_at·createdAt)을 역할 순서의 고정값으로 바꾸고 캠페인 행을 시드 값으로 되돌린다. 내용·실행 메타는 그대로다.
// 회의는 작업물을 updated_at 순으로 읽고 작업물 객체를 입력에 실으므로, 이렇게 해야 순서와 입력이 실행마다 같다.
export async function pinRoleArtifacts(server,sql,owner,campaign){
 for(const [i,role] of roleIds.entries()){
  const row=sql.prepare("SELECT id,data FROM records WHERE owner=? AND kind='artifact' AND parent_id=? AND json_extract(data,'$.role')=?").get(owner,campaign.id,role);
  if(!row)throw new Error(`${role} 작업물이 없습니다.`);
  sql.prepare('UPDATE records SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.data),createdAt:now}),`2026-01-01T00:01:0${i}.000Z`,row.id);
 }
 await server.recordStatement(owner,'campaign',campaign.id,campaign).run();
}

// 회의를 시작해 완료까지 진행한다. 단계별 제출 본문(지시·입력)을 순서대로 돌려준다.
export async function runMeeting(meeting,server,owner,campaign,id){
 const started=await (await meeting.executeMeeting(owner,{action:'start',id,campaignId:campaign.id,campaignVersion:campaign.version,agenda:'합성 안건: 재방문 동기를 정리한다.'})).json();
 if(started.status!=='running')throw new Error('회의 시작 실패: '+JSON.stringify(started));
 let m=started;
 for(let i=0;i<60&&m.status==='running';i++)m=await (await meeting.executeMeeting(owner,{action:'advance',id})).json();
 if(m.status!=='completed')throw new Error('회의 미완료: '+JSON.stringify({status:m.status,error:m.error}));
 const stored=await server.readRecord(owner,'team_meeting',id),steps=[];
 for(const s of stored.steps){const saved=JSON.parse((await server.readRecord(owner,'hermes_submission',s.attempt?`${s.id}:retry:${s.attempt}`:s.id)).body);steps.push({step:s.id.slice(id.length+1),instructions:saved.instructions,input:saved.input})}
 return {meeting:stored,steps};
}

// 공개 저장소 raw 경로 모의(https://raw.githubusercontent.com/roybeee/Collective/<ref>/prompts/<단위>.json). 실제 GitHub 네트워크 호출은 0회다.
// publishRepo(ref): 작업 트리 prompts/ 파일을 그 ref로 올린다. publish(ref,unit,body): 한 단위 본문을 바꿔 올린다. mode.fail·mode.status로 가져오기 실패를 만든다.
export const RAW='https://raw.githubusercontent.com/roybeee/Collective/';
export const SOURCE_SHA='f3a0'.repeat(10);
export function rawGithub(){
 const files=new Map(),calls=[],mode={fail:false,status:200};
 const handler=async url=>{
  if(!url.startsWith('https://raw.githubusercontent.com/'))return undefined;
  calls.push(url);
  if(mode.fail)throw new TypeError('fetch failed');
  if(mode.status!==200)return new Response('upstream',{status:mode.status});
  const text=files.get(url.slice(RAW.length));
  return text===undefined?new Response('404: Not Found',{status:404}):new Response(text,{status:200,headers:{'content-type':'text/plain; charset=utf-8'}});
 };
 const publish=(ref,unit,body)=>files.set(`${ref}/prompts/${unit}.json`,JSON.stringify({schema:1,unit,body},null,1));
 const publishRepo=ref=>{for(const f of readdirSync('prompts'))files.set(`${ref}/prompts/${f}`,readFileSync('prompts/'+f,'utf8'))};
 const repoBody=unit=>JSON.parse(readFileSync(`prompts/${unit}.json`,'utf8')).body;
 return {handler,files,calls,mode,publish,publishRepo,repoBody};
}
// 테스트 헬퍼: 활성화 게이트(F3b) 없이 prompt_release 포인터를 직접 설정한다. 운영 코드에는 이런 경로가 없다(activate는 409).
export const setRelease=(server,owner,unit,active,extra={})=>server.recordStatement(owner,'prompt_release',unit,{id:unit,unit,active,previous:null,targets:[],stagedCampaignIds:[],evalRunId:null,approvedBy:null,updatedAt:now,history:[],...extra}).run();
// 기대 버전 id: <단위>@<정규화 본문 JSON의 sha256 앞 12자>.
export const versionId=(unit,body)=>`${unit}@${sha(JSON.stringify(body)).slice(0,12)}`;
