import {createHash} from 'node:crypto';
import {moduleRuntime,deterministicClock,deterministicCrypto} from './runtime.mjs';

// 합성 평가 케이스 생성기(G4, 품질 계획 v2). 합성 스펙(JSON) 하나 = 합성 캠페인 하나. 운영 D1에는 아무것도 만들지 않는다.
// 모의 런타임(메모리 SQLite, 고정 시각·결정적 uuid, 스텁 HERMES)에 스펙 레코드를 넣고, 운영과 같은 함수로 요청을 만든 뒤 평가 동결을 거쳐 save_case 본문으로 낸다.
//  역할: roleSources→roleRequestFor(capture_case와 같은 DB 읽기) · 회의 단계: executeMeeting을 스텁 응답(스펙 answers)으로 끝까지 돌린 기록을 freezeMeetingRequest로 동결
//  브리프: executeBrief start로 운영과 같은 입력 검사를 거친 초안을 briefSources→briefRequestFor→freezeBriefRequest로 동결
// 같은 스펙·같은 코드면 출력이 바이트까지 같다(시각·uuid 결정적, 키 순서 고정). 외부 네트워크 호출은 0회이고, 스텁 밖 주소를 부르면 실패한다.
// 거부(throw): 스키마·id(syn- 접두사) 위반, 스펙 문자열의 개인정보 패턴(확정 사실·지점 허용 값 제외), 입력에 글자 그대로 없는 금지 표현, 분기 체크리스트 누락.
export const SPEC_SCHEMA=1;
export const RECORD_KINDS=['brand','campaign','brand_fact','brand_source','campaign_directive','artifact','learning_rule','store','team_meeting','role_output_failure','metric'];
// 스펙이 채워야 하는 요청 분기(설계 2-9: 합성 캠페인이 운영보다 깨끗하면 품질이 부풀려진다). 생성된 역할 요청에서 실제로 확인한다(스펙의 자기 신고를 믿지 않는다).
export const CHECKLIST=['revisionRequest','reviewNote','previousDecisions','operatorPreferences','storeAllow','cautionRule','aiEdited','excerptTruncation'];
const MEETING_TARGET=/^(?:discussion:[a-z]+|synthesis|revision:[a-z]+|quality)$/;
const SYN=/^syn-[a-z0-9][a-z0-9-]{0,80}$/;
const PAD='합성 장문: 확인 계획과 가설을 반복해 적은 문장입니다. ';

const fail=message=>{throw new Error(message)};
const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
// 키를 정렬한 JSON(해시용). 배열 순서는 그대로다.
export const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:isObject(v)?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`:JSON.stringify(v);
export const sha256=text=>createHash('sha256').update(text).digest('hex');
function* strings(v,path=''){
 if(typeof v==='string')yield [path,v];
 else if(Array.isArray(v))for(const [i,x] of v.entries())yield* strings(x,`${path}[${i}]`);
 else if(isObject(v))for(const [k,x] of Object.entries(v))yield* strings(x,path?`${path}.${k}`:k);
}

export function validateSpec(spec){
 if(!isObject(spec)||spec.schema!==SPEC_SCHEMA)fail(`스펙 schema는 ${SPEC_SCHEMA}이어야 합니다.`);
 if(!SYN.test(spec.id||''))fail('스펙 id는 syn-로 시작하는 소문자·숫자·하이픈이어야 합니다.');
 if(!['dev','sealed'].includes(spec.set))fail('스펙 set은 dev 또는 sealed여야 합니다.');
 if(!Number.isFinite(Date.parse(spec.now||'')))fail('스펙 now는 ISO 시각이어야 합니다.');
 if(!Array.isArray(spec.records)||!spec.records.length)fail('스펙 records가 비었습니다.');
 for(const r of spec.records){
  if(!isObject(r)||!RECORD_KINDS.includes(r.kind))fail(`허용하지 않는 레코드 종류입니다: ${r?.kind}`);
  if(!SYN.test(r.id||'')||!isObject(r.data)||r.data.id!==undefined&&r.data.id!==r.id)fail(`레코드 id는 syn-로 시작하고 data.id와 같아야 합니다: ${r.id}`);
 }
 if(!spec.records.some(r=>r.kind==='campaign'&&r.id===spec.campaignId))fail('campaignId가 가리키는 campaign 레코드가 없습니다.');
 if(!Array.isArray(spec.roles))fail('roles는 역할 id 목록이어야 합니다.');
 if(spec.meeting&&(!Array.isArray(spec.meeting.targets)||!spec.meeting.targets.every(t=>MEETING_TARGET.test(t))))fail('meeting.targets 형식을 확인하세요(discussion:<역할>|synthesis|revision:<역할>|quality).');
 const terms=spec.expectations?.prohibitedTerms;
 if(!Array.isArray(terms)||terms.length<1||terms.length>5)fail('expectations.prohibitedTerms는 1~5개여야 합니다.');
 return spec;
}
// 금지 표현은 입력(브랜드·캠페인 제약, 상시 지시, 회의 안건, 브리프 제약)에 글자 그대로 있어야 한다.
export function unsourcedTerms(spec){
 const data=kind=>spec.records.filter(r=>r.kind===kind).map(r=>r.data);
 const texts=[...data('brand').map(b=>b.constraints),...data('campaign').map(c=>c.constraints),...data('campaign_directive').map(d=>d.text),spec.meeting?.agenda,...(spec.briefs||[]).map(b=>b.data?.constraints)].filter(t=>typeof t==='string');
 return spec.expectations.prohibitedTerms.filter(t=>!texts.some(x=>x.includes(t)));
}

// 스텁 HERMES: 회의는 스펙 answers(단계·역할별 JSON), 브리프·역할 제출은 받기만 한다(조회하지 않는다).
function meetingAnswer(answers,input){
 const pick=(group,role)=>group?.[role]??group?.default;
 const a=input.phase==='discussion'?pick(answers.discussion,input.role):input.phase==='revision'?pick(answers.revision,input.role):answers[input.phase];
 if(!isObject(a))fail(`회의 answers에 ${input.phase}${input.role?':'+input.role:''} 응답이 없습니다.`);
 return input.phase==='discussion'&&!Array.isArray(a.respondsTo)?{...a,respondsTo:(input.allowedRespondsTo||[]).slice(0,1).map(r=>r.ref)}:a;
}
function stubHermes(spec){
 const bodies=new Map(),external=[];let calls=0;
 const fetch=async(url,options={})=>{
  url=String(url);
  if(!url.startsWith('https://hermes-synthetic.example.com/')){external.push(url);throw new Error('생성기는 스텁 HERMES만 부릅니다: '+url)}
  if(url.endsWith('/v1/runs')){const id='syn_run_'+ ++calls;bodies.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
  const id=url.split('/').pop(),input=JSON.parse(bodies.get(id).input);
  if(!input.phase)return Response.json({object:'hermes.run',run_id:id,status:'running'});
  return Response.json({object:'hermes.run',run_id:id,status:'completed',output:JSON.stringify(meetingAnswer(spec.meeting.answers,input)),usage:{total_tokens:0,output_tokens:0},model:'synthetic-stub'});
 };
 return {fetch,external};
}

// 역할 요청에서 분기 체크리스트를 센다.
function coverage(requests){
 const has=(test)=>requests.some(test);
 return {
  revisionRequest:has(r=>!!r.revisionRequest),reviewNote:has(r=>!!r.revisionRequest?.note),previousDecisions:has(r=>!!r.previousDecisions),operatorPreferences:has(r=>!!r.operatorPreferences),
  storeAllow:has(r=>Array.isArray(r.storeAllow)&&r.storeAllow.length>0),cautionRule:has(r=>(r.learning||[]).some(l=>l.direction==='caution')),
  aiEdited:has(r=>(r.previous||[]).some(a=>a.origin==='ai_edited')),excerptTruncation:has(r=>r.contextTruncated===true),
 };
}

export async function synthesizeCases(spec,{generator}){
 validateSpec(spec);
 const unsourced=unsourcedTerms(spec);if(unsourced.length)fail(`입력에 글자 그대로 없는 금지 표현(prohibitedTerms): ${unsourced.join(', ')}`);
 const hermes=stubHermes(spec);
 const {sql,load}=moduleRuntime(hermes.fetch,{},{Date:deterministicClock(spec.now),crypto:deterministicCrypto(spec.id)});
 const server=await load('lib/server.ts'),pii=await load('lib/pii-scan.ts'),aiContext=await load('lib/ai-context.ts'),agency=await load('lib/agency.ts');
 // 개인정보 패턴: 확정 사실 값·지점 허용 값(주소·사업장 유선 번호)은 허용한다. 걸리면 경로만 알린다(값은 출력하지 않는다).
 const allow=[...spec.records.filter(r=>r.kind==='brand_fact'&&r.data.status==='confirmed').map(r=>r.data.value),...spec.records.filter(r=>r.kind==='store').flatMap(r=>aiContext.storeAllowValues(r.data))];
 const leaks=[...strings(spec)].filter(([,t])=>pii.scanText(t,{allow}).length).map(([p])=>p);
 if(leaks.length)fail(`스펙에 개인정보 패턴이 있습니다(경로): ${leaks.join(', ')}`);
 const execution=await load('lib/role-execution.ts'),instruction=await load('lib/role-instruction.ts'),kinds=await load('lib/eval-kinds.ts'),freeze=await load('lib/eval-freeze.ts');
 const meetings=await load('lib/meeting-execution.ts'),briefs=await load('lib/brief-execution.ts'),briefInput=await load('lib/brief-input.ts'),storeAllow=await load('lib/store-allow-server.ts');
 const owner='syn-generator',put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
 await sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes-synthetic.example.com',key:'synthetic-only'})),'HERMES',spec.now);
 await put('worker_credential','current',{id:'current',tokenHash:'synthetic'});
 // padTo: 작업물 본문을 합성 문장으로 그 길이까지 채운다(발췌 잘림 분기, 역할 6,000자·품질 24,000자 한도).
 for(const r of spec.records)await put(r.kind,r.id,{id:r.id,...r.data,...(r.kind==='artifact'&&r.padTo?{content:String(r.data.content).padEnd(r.padTo,PAD)}:{})},r.parent||'');
 const campaign=await server.readRecord(owner,'campaign',spec.campaignId),brand=await server.readRecord(owner,'brand',campaign.brandId);
 const e=spec.expectations,base={prohibitedTerms:e.prohibitedTerms,...(e.industry!==undefined?{industry:e.industry}:{}),...(e.localStore!==undefined?{localStore:e.localStore}:{})};
 const title=spec.label||campaign.title,cases=[];
 const hashOf=({instructions,input})=>sha256(instructions+'\u0000'+input).slice(0,16);
 const push=(kind,target,role,request,expectations,label)=>{
  const handler=kinds.evalKind(kind),body={kind,...(kind==='brief'?{}:{role}),request:JSON.parse(JSON.stringify(request)),expectations,set:spec.set,label};
  cases.push({...body,externalKey:`${spec.id}:${kind}:${target}`,specHash:sha256(canonical(body)).slice(0,32),promptHash:hashOf(handler.build(body.request))});
 };
 // 역할
 const roleRequests=[];
 for(const role of spec.roles){
  const request=JSON.parse(JSON.stringify(await execution.roleRequestFor(owner,campaign,role,await execution.roleSources(owner,campaign,role),brand)));
  kinds.evalKind('role').freeze(request,role);
  roleRequests.push({...request,contextTruncated:instruction.roleRequestPlan(request).outputContract.contextTruncated});
  push('role',role,role,request,{...base,facts:{confirmed:request.evidence.facts.confirmed,prohibited:request.evidence.facts.prohibited}},`${title} · ${agency.roles.find(r=>r.id===role)?.name||role}`);
 }
 const checklist=coverage(roleRequests),missing=CHECKLIST.filter(k=>!checklist[k]);
 if(missing.length)fail(`분기 체크리스트 누락: ${missing.join(', ')}`);
 // 회의 단계
 if(spec.meeting){
  const id=`${spec.id}-meeting`,started=await (await meetings.executeMeeting(owner,{action:'start',id,campaignId:campaign.id,campaignVersion:campaign.version,agenda:spec.meeting.agenda})).json();
  if(started.status!=='running')fail('합성 회의를 시작하지 못했습니다: '+(started.error||started.status));
  let m=started;for(let i=0;i<80&&m.status==='running';i++)m=await (await meetings.executeMeeting(owner,{action:'advance',id})).json();
  if(m.status!=='completed')fail('합성 회의가 끝나지 않았습니다: '+(m.error||m.status));
  const record=await server.readRecord(owner,'team_meeting',id),allowed=await storeAllow.brandStoreAllow(owner,record.snapshot.campaign),facts=record.snapshot.evidence?.facts;
  for(const target of spec.meeting.targets){
   const stepId=`${id}:${target}`,step=record.steps.find(s=>s.id===stepId);if(!step)fail(`회의에 ${target} 단계가 없습니다.`);
   const defects=(spec.meeting.seededDefects||[]).length&&['quality','revision'].includes(step.phase)?{seededDefects:spec.meeting.seededDefects}:{};
   push('meeting_step',target,step.role,freeze.freezeMeetingRequest(record,stepId,allowed),{...base,...defects,...(facts?{facts:{confirmed:facts.confirmed,prohibited:facts.prohibited}}:{})},`${title} · 회의 ${target}`);
  }
 }
 // 브리프
 for(const b of spec.briefs||[]){
  if(!SYN.test(b.id||''))fail(`브리프 id는 syn-로 시작해야 합니다: ${b.id}`);
  const started=await (await briefs.executeBrief(owner,{action:'start',id:b.id,data:b.data,...(b.campaign?{campaignId:campaign.id,campaignVersion:campaign.version}:{})})).json();
  if(started.status!=='queued')fail('합성 브리프 초안을 만들지 못했습니다: '+(started.error||started.status));
  const draft=await server.readRecord(owner,'brief_draft',b.id);
  await put('brief_draft',b.id,{...draft,status:'failed',error:'합성 생성기: 조회하지 않음'});
  const request=freeze.freezeBriefRequest(JSON.parse(JSON.stringify(briefInput.briefRequestFor(await briefs.briefSources(owner,{campaignId:draft.campaignId,input:draft.input,contextDate:draft.createdAt.slice(0,10)})))));
  push('brief',b.id,'brief',request,{...base,facts:{confirmed:request.context.evidence.facts.confirmed,prohibited:request.context.evidence.facts.prohibited}},`${title} · 브리프 ${b.id}`);
 }
 if(hermes.external.length)fail('외부 호출이 있었습니다.');
 return {schema:SPEC_SCHEMA,generator,specId:spec.id,specHash:sha256(canonical(spec)),set:spec.set,checklist,cases};
}
