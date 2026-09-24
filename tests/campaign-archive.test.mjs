// 캠페인 보관(ux-9 권고 2 잔여): 보관·해제, 진행 중 작업이면 409, 보관 중 새 AI 실행(역할·회의·회의 재시도·캠페인 초안)·연속 실행·발행 승인·접수 409,
// 목록·대시보드 제외, 삭제 정책 불변, 권한(캠페인 삭제와 같음). 보관은 캠페인 레코드의 archivedAt·archivedBy만 쓴다(새 kind 없음).
// 외부 호출은 가짜 fetch로만 한다. 유료 모델·Buffer 호출 없음.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};
const ARCHIVED='보관된 캠페인입니다. 보관 해제 후 다시 시도하세요.';
let providerCalls=0,otherCalls=0;
const rt=testRuntime(async(url,options={})=>{
 if(options.method==='POST'&&String(url).endsWith('/responses')){providerCalls++;return Response.json({id:'resp_archive'+providerCalls,status:'completed'})}
 otherCalls++;throw new Error('unexpected external call '+url);
});
const OWNER='archive-owner';
const server=await rt.load('lib/server.ts'),archive=await rt.load('lib/campaign-archive.ts');
const action=await rt.load('app/api/action/route.ts'),campaigns=await rt.load('app/api/campaigns/route.ts'),run=await rt.load('app/api/run/route.ts'),execution=await rt.load('app/api/execution/route.ts');
const meetings=await rt.load('app/api/meetings/route.ts'),brief=await rt.load('app/api/brief/route.ts');
const workspace=await rt.load('app/api/workspace/route.ts'),detail=await rt.load('app/api/campaigns/[id]/route.ts'),deletion=await rt.load('app/api/campaigns/[id]/deletion/route.ts');
async function post(mod,body,headers={}){const h={'content-type':'application/json','oai-authenticated-user-id':OWNER,...headers};for(const k in h)if(h[k]===null)delete h[k];const r=await mod.POST(new Request('https://agency.test/api/test',{method:'POST',headers:h,body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}}
async function get(mod,path,params){const r=await mod.GET(new Request('https://agency.test'+path,{headers:{'oai-authenticated-user-id':OWNER}}),params?{params:Promise.resolve(params)}:undefined);return {status:r.status,data:await r.json()}}
const put=(kind,id,data,parent='')=>server.recordStatement(OWNER,kind,id,data,parent).run();
const record=(kind,id)=>JSON.parse(rt.sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? AND id=?').get(OWNER,kind,`${OWNER}:${kind}:${id}`)?.data||'null');
const jobs=id=>rt.sql.prepare('SELECT COUNT(*) AS n FROM jobs WHERE owner=? AND campaign_id=?').get(OWNER,id).n;
const kinds=()=>new Set(rt.sql.prepare('SELECT DISTINCT kind FROM records WHERE owner=?').all(OWNER).map(r=>r.kind));
const archiveCall=(id,headers)=>post(campaigns,{action:'archive_campaign',id},headers);
const unarchiveCall=(id,headers)=>post(campaigns,{action:'unarchive_campaign',id},headers);
const now=()=>new Date().toISOString();

// --- 순수 판정 ------------------------------------------------------------------------
check('a campaign without archivedAt is not archived',!archive.isArchived({id:'c'}));
check('archivedAt marks an archived campaign',archive.isArchived({id:'c',archivedAt:'2026-09-24T00:00:00.000Z'}));
assert.throws(()=>archive.assertNotArchived({id:'c',archivedAt:'2026-09-24T00:00:00.000Z'}),e=>e.status===409&&e.message===ARCHIVED);passed++;
assert.doesNotThrow(()=>archive.assertNotArchived({id:'c'}));passed++;

// --- 보관 -----------------------------------------------------------------------------
await get(workspace,'/api/workspace');
const cid=(await post(action,{action:'save_campaign',data:{brandId:'ofd',title:'보관 검증',goal:'보관 동작 확인',budget:0}})).data.id;
await rt.env.DB.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').bind(OWNER,await server.encrypt('sk-test-only-archive-key'),'test-model',now()).run();
check('archive requires authentication',(await archiveCall(cid,{'oai-authenticated-user-id':null})).status===401);
check('cross-origin archive is rejected',(await archiveCall(cid,{origin:'https://other.test'})).status===403);
check('another owner cannot archive the campaign',(await archiveCall(cid,{'oai-authenticated-user-id':'other-owner'})).status===404);
check('an unknown campaign action is rejected',(await post(campaigns,{action:'rename_campaign',id:cid})).status===400);
check('the campaign id is required',(await post(campaigns,{action:'archive_campaign'})).status===400);
check('a missing campaign cannot be archived',(await archiveCall('no-such-campaign')).status===404);
const before=record('campaign',cid),kindsBefore=kinds();
const archived=await archiveCall(cid);
check('archive succeeds',archived.status===200&&typeof archived.data.archivedAt==='string');
const after=record('campaign',cid);
{const {archivedAt,archivedBy,...rest}=after;assert.deepEqual(rest,before,'archive writes archivedAt and archivedBy only');passed++;check('archive stores the time it returned',archivedAt===archived.data.archivedAt);check('archive records who archived',archivedBy?.id===OWNER&&archivedBy.email===null)}
check('archive keeps the brief version and stored status',after.version===before.version&&after.status===before.status&&after.updatedAt===before.updatedAt);
check('archive adds no new record kind',[...kinds()].every(k=>kindsBefore.has(k)));
const again=await archiveCall(cid);
check('archiving again keeps the first archive time',again.status===200&&again.data.archivedAt===after.archivedAt&&record('campaign',cid).archivedAt===after.archivedAt);

// 목록·상세 응답은 보관 표시를 그대로 싣는다. 화면(워크스페이스 목록·대시보드)은 이 표시로 숨긴다(아래 화면 연결 검사).
check('the workspace response carries the archive mark',(await get(workspace,'/api/workspace')).data.campaigns.find(c=>c.id===cid)?.archivedAt===after.archivedAt);
check('campaign detail carries the archive mark',(await get(detail,'/api/campaigns/'+cid,{id:cid})).data.campaign.archivedAt===after.archivedAt);

// --- 보관 중에는 새 실행·연속 실행·발행 승인·접수를 막는다 --------------------------------------
const start=await post(run,{action:'start',campaignId:cid,role:'cmo'});
check('a new AI run on an archived campaign is refused with 409',start.status===409&&start.data.error===ARCHIVED);
check('the refused run creates no job and makes no provider call',jobs(cid)===0&&providerCalls===0);
// 실행 경로는 캠페인 id의 앞뒤 공백을 떼고 읽는다(str). 공백을 붙인 id로 보관 검사를 건너뛰지 못한다.
for(const padded of [' '+cid,cid+' ','\n'+cid]){const r=await post(run,{action:'start',campaignId:padded,role:'cmo'});check(`a padded campaign id ${JSON.stringify(padded.replace(cid,'<id>'))} cannot bypass the archive gate`,r.status===409&&r.data.error===ARCHIVED)}
check('padded ids create no job and make no provider call',jobs(cid)===0&&providerCalls===0&&!record('campaign',cid).status.startsWith('running'));
const sequence=await post(run,{action:'start_sequence',campaignId:cid});
check('starting a sequence on an archived campaign is refused with 409',sequence.status===409&&sequence.data.error===ARCHIVED);
check('the refused sequence writes no sequence record',record('campaign_sequence',cid)===null);
// 경합으로 연속 실행이 남아 있어도 다음 역할을 시작하지 않고 막힘으로 멈춘다(백그라운드가 409를 반복 재시도하지 않게).
await put('campaign_sequence',cid,{campaignId:cid,campaignVersion:before.version,status:'running',startedAt:now(),updatedAt:now()},cid);
const advanced=await post(run,{action:'advance_sequence',campaignId:cid});
check('a sequence left running on an archived campaign stops as blocked',advanced.status===200&&advanced.data.status==='blocked'&&advanced.data.error===ARCHIVED);
check('the blocked sequence starts no role',jobs(cid)===0&&providerCalls===0);
const publication={id:'pub-draft',campaignId:cid,creativeId:'creative',status:'draft',version:1,mediaMode:'auto',pngHash:'hash',mediaUrl:'',caption:'캡션',plannedCostKRW:0,createdAt:now(),updatedAt:now()};
await put('execution_publication','pub-draft',publication,cid);
const approve=await post(execution,{action:'approve',campaignId:cid,id:'pub-draft',version:1,confirmed:true,rightsConfirmed:true});
check('approving a publication of an archived campaign is refused with 409',approve.status===409&&approve.data.error===ARCHIVED);
check('the refused approval leaves the publication a draft',record('execution_publication','pub-draft').status==='draft');
await put('execution_publication','pub-approved',{...publication,id:'pub-approved',status:'approved'},cid);
const submit=await post(execution,{action:'execute',campaignId:cid,id:'pub-approved',version:1});
check('submitting a publication of an archived campaign is refused with 409',submit.status===409&&submit.data.error===ARCHIVED);
check('the refused submission records no attempt',record('execution_publication','pub-approved').status==='approved'&&!record('execution_publication','pub-approved').attemptedAt);

// --- 보관 해제 --------------------------------------------------------------------------
const restored=await unarchiveCall(cid);
check('unarchive succeeds',restored.status===200&&restored.data.archivedAt===null);
assert.deepEqual(record('campaign',cid),before,'unarchive removes both archive fields and keeps the rest');passed++;
check('unarchiving a campaign that is not archived is a no-op',(await unarchiveCall(cid)).status===200&&!('archivedAt' in record('campaign',cid)));
const gate=await post(run,{action:'start_sequence',campaignId:cid});
check('after unarchiving, a sequence start reaches its own checks',gate.status===409&&gate.data.error!==ARCHIVED);
const started=await post(run,{action:'start',campaignId:cid,role:'cmo'});
check('after unarchiving, a new AI run starts again',started.status===200&&jobs(cid)===1&&providerCalls===1);

// --- 진행 중 작업이 있으면 보관을 거절한다(상태가 꼬이지 않게) ----------------------------------
const busy=await archiveCall(cid);
check('an active AI job blocks archive',busy.status===409&&busy.data.error.includes('진행 중인 AI 작업')&&!record('campaign',cid).archivedAt);
rt.sql.prepare("UPDATE jobs SET status='completed' WHERE owner=? AND campaign_id=?").run(OWNER,cid);
const meeting={id:'meeting-1',campaignId:cid,campaignVersion:before.version,agenda:'안건',status:'running',steps:[],createdAt:now(),updatedAt:now(),model:'test',stopRequested:false,artifactIds:[],invalidatedRoles:[]};
await put('team_meeting','meeting-1',meeting,cid);
const meetingBusy=await archiveCall(cid);
check('a running team meeting blocks archive',meetingBusy.status===409&&meetingBusy.data.error.includes('회의'));
await put('team_meeting','meeting-1',{...meeting,status:'uncertain'},cid);
check('an uncertain team meeting also blocks archive',(await archiveCall(cid)).status===409);
await put('team_meeting','meeting-1',{...meeting,status:'failed'},cid);
await put('campaign_sequence',cid,{campaignId:cid,campaignVersion:before.version,status:'running',startedAt:now(),updatedAt:now()},cid);
const sequenceBusy=await archiveCall(cid);
check('a running sequence blocks archive',sequenceBusy.status===409&&sequenceBusy.data.error.includes('연속 실행'));
const stopped=await post(run,{action:'stop_sequence',campaignId:cid});
check('the sequence can still be stopped',stopped.status===200&&stopped.data.status==='paused');
await put('execution_publication','pub-submitting',{...publication,id:'pub-submitting',status:'submitting',attemptedAt:now()},cid);
const submitting=await archiveCall(cid);
check('a publication being submitted blocks archive',submitting.status===409&&submitting.data.error.includes('발행'));
// Buffer가 받은 예약 게시(예약 시각이 아직 오지 않음)는 보관 뒤에도 외부에서 나가므로 보관을 거절한다. 예약 시각이 지난 접수는 막지 않는다(아래 초안 검사까지 진행).
const inAnHour=new Date(Date.now()+3600000).toISOString(),anHourAgo=new Date(Date.now()-3600000).toISOString();
await put('execution_publication','pub-submitting',{...publication,id:'pub-submitting',status:'accepted',attemptedAt:now(),scheduledAt:inAnHour},cid);
const scheduled=await archiveCall(cid);
check('a publication scheduled on Buffer blocks archive',scheduled.status===409&&scheduled.data.error.includes('예약된 발행'));
await put('execution_publication','pub-submitting',{...publication,id:'pub-submitting',status:'accepted',attemptedAt:now(),scheduledAt:anHourAgo},cid);
await put('brief_draft','draft-1',{id:'draft-1',campaignId:cid,status:'queued',input:{brandId:'ofd',goal:'보관 동작 확인'},createdAt:now(),updatedAt:now(),model:'test'});
const drafting=await archiveCall(cid);
check('a brief draft being written for the campaign blocks archive',drafting.status===409&&drafting.data.error.includes('초안'));
await put('brief_draft','draft-1',{id:'draft-1',campaignId:cid,status:'completed',input:{brandId:'ofd',goal:'보관 동작 확인'},createdAt:now(),updatedAt:now(),model:'test'});
check('nothing was archived while work was in progress',!record('campaign',cid).archivedAt);
check('once work has stopped the campaign can be archived',(await archiveCall(cid)).status===200&&!!record('campaign',cid).archivedAt);

// --- 보관 중 팀 회의·실패 회의 재시도·캠페인 초안(HERMES AI 실행)도 막는다 ----------------------------------
// HERMES 연결과 서버 작업자를 갖춰 보관 검사만 남긴다(검사가 없으면 회의가 시작되고 초안은 HERMES를 호출한다).
await rt.env.DB.prepare('UPDATE settings SET secret=?,model=? WHERE owner=?').bind(await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.test',key:'hermes-archive-test-key-only',model:'HERMES'})),'HERMES',OWNER).run();
await put('worker_credential','current',{id:'current',tokenHash:'fixture'});
const jobsBefore=jobs(cid),failedMeeting=record('team_meeting','meeting-1');
for(const campaignId of [cid,' '+cid]){
 const r=await post(meetings,{action:'start',id:'meeting-archived',campaignId,campaignVersion:before.version,agenda:'보관 중 회의'});
 check(`a new team meeting on an archived campaign is refused with 409 (${campaignId===cid?'id':'padded id'})`,r.status===409&&r.data.error===ARCHIVED);
}
check('the refused meeting writes no meeting and no job',record('team_meeting','meeting-archived')===null&&jobs(cid)===jobsBefore);
const retry=await post(meetings,{action:'retry_failed',id:'meeting-1'});
check('retrying a failed meeting of an archived campaign is refused with 409',retry.status===409&&retry.data.error===ARCHIVED);
assert.deepEqual(record('team_meeting','meeting-1'),failedMeeting,'the refused retry leaves the failed meeting as it was');passed++;
check('retrying a missing meeting is still 404',(await post(meetings,{action:'retry_failed',id:'no-such-meeting'})).status===404);
const redraft=await post(brief,{action:'start',id:'draft-archived',campaignId:cid,campaignVersion:before.version,data:{brandId:'ofd',title:'보관 검증',goal:'보관 동작 확인',budget:0}});
check('a HERMES brief draft for an archived campaign is refused with 409',redraft.status===409&&redraft.data.error===ARCHIVED);
check('the refused draft writes no draft record',record('brief_draft','draft-archived')===null);
check('no refused AI start reached HERMES or the model provider',otherCalls===0&&providerCalls===1);

// --- 삭제 정책 불변: 보관해도 삭제 판정·버전·건수는 그대로이고 같은 규칙으로 삭제된다 ------------------
const other=(await post(action,{action:'save_campaign',data:{brandId:'ofd',title:'보관 후 삭제',goal:'삭제 정책 확인',budget:0}})).data.id;
await put('artifact','other-art',{id:'other-art',campaignId:other,campaignVersion:1,role:'cmo',title:'작업물',content:'원문',status:'review',version:1,createdAt:now()},other);
const previewBefore=(await get(deletion,`/api/campaigns/${other}/deletion`,{id:other})).data;
check('the archive-then-delete campaign starts deletable',previewBefore.deletable===true);
await archiveCall(other);
const previewAfter=(await get(deletion,`/api/campaigns/${other}/deletion`,{id:other})).data;
check('archiving leaves the deletion verdict, version and work counts unchanged',previewAfter.deletable===previewBefore.deletable&&previewAfter.version===previewBefore.version&&previewAfter.deleted.artifact===previewBefore.deleted.artifact&&previewAfter.jobs===previewBefore.jobs);
const removed=await post(action,{action:'delete_campaign',id:other,version:1,confirmed:true});
check('an archived campaign is deleted by the same rule',removed.status===200&&removed.data.deleted===true&&record('campaign',other)===null&&record('deleted_campaign',other)!==null);
check('a deleted campaign cannot be archived',(await archiveCall(other)).status===404);

// --- 권한: 캠페인 삭제와 같다(직원 403, 관리자·소유자 허용) --------------------------------------
const auth=testRuntime(async()=>{throw new Error('External calls forbidden in archive permission test')});
Object.assign(auth.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const authServer=await auth.load('lib/server.ts'),authCampaigns=await auth.load('app/api/campaigns/route.ts');
await authServer.recordStatement('workspace','campaign','c',{id:'c',brandId:'oda',version:1,status:'draft'}).run();
const admin='a'.repeat(64),member='b'.repeat(64);
for(const [id,role,token] of [['admin','admin',admin],['member','member',member]]){
 auth.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid','workspace',role,'active',Date.now());
 auth.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());
}
const authCall=async(token,body)=>{const r=await authCampaigns.POST(new Request('https://app.test/api/campaigns',{method:'POST',headers:{cookie:'__Host-collective_session='+token,origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}};
const authRecord=()=>authServer.readRecord('workspace','campaign','c');
check('a member cannot archive a campaign',(await authCall(member,{action:'archive_campaign',id:'c'})).status===403&&!(await authRecord()).archivedAt);
check('an admin can archive a campaign',(await authCall(admin,{action:'archive_campaign',id:'c'})).status===200&&(await authRecord()).archivedBy?.email==='admin@test.invalid');
check('a member cannot unarchive a campaign',(await authCall(member,{action:'unarchive_campaign',id:'c'})).status===403&&!!(await authRecord()).archivedAt);
check('an admin can unarchive a campaign',(await authCall(admin,{action:'unarchive_campaign',id:'c'})).status===200&&!(await authRecord()).archivedAt);

// --- 화면 연결 ------------------------------------------------------------------------
const screen=readFileSync('app/workspace.tsx','utf8'),dialog=readFileSync('app/delete-campaign-dialog.tsx','utf8'),panels=readFileSync('app/panels.tsx','utf8');
const has=(name,source,text)=>{assert.ok(source.includes(text),name);passed++};
has('dashboard numbers and the sidebar count exclude archived campaigns',screen,'metrics=workspaceMetrics(live)');
has('the dashboard campaign table excludes archived campaigns',screen,'recent=recentCampaigns(active.length?active:live.campaigns)');
has('next tasks exclude archived campaigns',screen,'tasks=nextTasks(live)');
has('dashboard status counts exclude archived campaigns',screen,'campaignStatusCounts(live.campaigns)');
has('the campaign list hides archived campaigns unless the archive filter is chosen',screen,'filter===ARCHIVE_FILTER?isArchived(c):!isArchived(c)&&');
has('the campaign list offers the archive filter',screen,'<NativeSelectOption value={ARCHIVE_FILTER}>보관함</NativeSelectOption>');
has('the campaign table badge uses the derived status',screen,'<TableCell><CampaignStatus campaign={c}/></TableCell>');
check('the campaign table no longer draws the stored status',!screen.includes('<Status status={c.status}/>'));
has('the campaign badge adds an archive badge next to the progress badge',panels,'status status-archived');
check('the campaign name cell has no second archive badge',!screen.includes('status status-archived'));
has('the artifact list leaves out archived campaigns like the sidebar count',screen,'!data.campaigns.some(c=>c.id===a.campaignId&&isArchived(c))');
has('brand detail cards count visible campaigns like the dashboard',screen,'<span>{live.campaigns.filter(c=>c.brandId===b.id).length}개 캠페인</span><span>브랜드 아카이브</span>');
has('the WebMCP campaign list reports the derived status',screen,'status:c.derivedStatus||c.status');
has('archived rows can be restored from the row menu',screen,"api('unarchive_campaign',{id:c.id},'/api/campaigns')");
has('the dialog archives through the campaigns API',dialog,"api('archive_campaign',{id},'/api/campaigns')");
has('archive is offered when work, runs, meetings or results exist',dialog,'needsTitleConfirmation(preview)');
has('archive is the recommended button',dialog,'보관(권장)');
has('permanent deletion keeps the title confirmation',dialog,'canConfirmDeletion(preview,campaign.title,typed)');

console.log(JSON.stringify({passed},null,2));
