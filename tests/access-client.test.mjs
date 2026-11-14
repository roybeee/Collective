// 레인 X-G 화면 권한 판정(lib/access-client.ts): 범위 없는 역할(대표·관리자·직원)은 기존 화면 규칙(useCanManage 값)과 같고, 범위 역할은 lib/access.ts 표를 자원(브랜드·지점)으로 읽는다.
// access 모양이 깨졌으면 범위 없음으로 넓히지 않고 직원 규칙으로 막는다. 저장소(setWorkspaceAccess)는 같은 값이면 알리지 않는다. 근거: 순수 함수(외부 호출 0회).
import {koSource} from './helpers/i18n-source.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
const rt=testRuntime(async()=>{throw new Error('외부 호출 없음')});
const c=await rt.load('lib/access-client.ts'),a=await rt.load('lib/access.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const actions=a.ACCESS_ACTIONS,ofd={brandId:'ofd',storeId:null},seongsu={brandId:'ofd',storeId:'s1'},other={brandId:'oda',storeId:null};

// 범위 없는 역할: access가 없으면 어떤 작업·자원이든 canManage 값 그대로다(대표·관리자 true, 직원 false).
for(const action of actions){check(c.clientCan(true,null,action,other)===true,`owner/admin keep canManage=true for ${action}`);check(c.clientCan(false,null,action,ofd)===false,`member keeps canManage=false for ${action}`)}
// 범위 역할: 표와 같다. canManage 값은 보지 않는다(범위 역할 계정은 저장 역할이 직원이라 canManage=false).
const bm={role:'brand_manager',brandIds:['ofd'],storeIds:[]},sm={role:'store_manager',brandIds:['ofd'],storeIds:['s1']},rv={role:'reviewer',brandIds:['ofd'],storeIds:[]};
for(const [access,resource] of [[bm,ofd],[bm,other],[sm,seongsu],[sm,ofd],[sm,{brandId:'ofd',storeId:'s2'}],[rv,ofd],[rv,other]])for(const action of actions)
 check(c.clientCan(false,access,action,resource)===a.can(access,action,resource),`${access.role} ${action} ${JSON.stringify(resource)} follows ROLE_MATRIX`);
check(c.clientCan(false,bm,'approve_artifact',ofd)&&c.clientCan(false,bm,'publish',ofd),'brand manager approves and publishes in the assigned brand');
check(!c.clientCan(false,bm,'approve_artifact',other)&&!c.clientCan(true,bm,'approve_artifact',other),'brand manager is denied outside the brand even if canManage were true');
check(!c.clientCan(false,bm,'spend',ofd),'brand manager cannot apply ads (spend)');
check(c.clientCan(false,sm,'publish',seongsu)&&!c.clientCan(false,sm,'publish',ofd)&&!c.clientCan(false,sm,'publish',{brandId:'ofd',storeId:'s2'}),'store manager publishes only for the assigned store');
check(c.clientCan(false,rv,'approve_artifact',ofd)&&!c.clientCan(false,rv,'publish',ofd),'reviewer approves artifacts but cannot publish');
// access 모양 확인: 깨진 값은 null(직원 규칙으로 막힘), 정상 값은 그대로.
check(c.parseClientAccess(null)===null&&c.parseClientAccess({role:'owner',brandIds:[],storeIds:[]})===null&&c.parseClientAccess({role:'reviewer',brandIds:'ofd',storeIds:[]})===null&&c.parseClientAccess({role:'reviewer',brandIds:[1],storeIds:[]})===null,'malformed access is rejected');
check(JSON.stringify(c.parseClientAccess({role:'reviewer',brandIds:['ofd'],storeIds:[],extra:1}))===JSON.stringify({role:'reviewer',brandIds:['ofd'],storeIds:[]}),'valid access keeps only role·brandIds·storeIds');
check(c.denyKind(null)==='admin'&&c.denyKind(bm)==='scope','deny kind: admin-only for unscoped roles, scope for scoped roles');
// 저장소: 값이 바뀔 때만 알린다.
let calls=0;const off=c.subscribeWorkspaceAccess(()=>calls++);
c.setWorkspaceAccess(undefined);check(calls===0&&c.workspaceAccess()===null,'no access → stays null without notifying');
c.setWorkspaceAccess(bm);check(calls===1&&c.workspaceAccess()?.role==='brand_manager','new access notifies once');
c.setWorkspaceAccess({...bm,brandIds:['ofd']});check(calls===1,'same access does not notify');
c.setWorkspaceAccess(null);check(calls===2&&c.workspaceAccess()===null,'clearing notifies');
off();c.setWorkspaceAccess(sm);check(calls===2,'unsubscribed listener is not called');
// 화면 연결: 승인·발행 버튼이 useAccessCheck/useCan을 쓰고, 워크스페이스가 access를 넘긴다.
const src=f=>readFileSync(f,'utf8');
check(src('app/workspace.tsx').includes('setWorkspaceAccess((data as WorkspaceData&{access?:unknown}).access)'),'workspace hands /api/workspace access to the client store');
check(/access\.check\('approve_artifact',\{brandId:campaign\.brandId/.test(koSource('app/panels.tsx'))&&koSource('app/panels.tsx').includes('!canApprove?approveDenied'),'artifact dialog approve uses the scoped check');
check(/access\.check\('publish',\{brandId:campaign\.brandId/.test(koSource('app/execution-panel.tsx'))&&koSource('app/execution-panel.tsx').includes("{canPublish&&p.status==='draft'"),'execution approve/submit uses the publish check');
check(src('app/agenda-panel.tsx').includes('canAct={canActOn(item)}')&&src('app/agenda-panel.tsx').includes("t(actionOf(i)==='publish'?'access.deniedPublish':'access.deniedApprove')"),'inbox rows judge each row by its brand·store');
check(src('app/ads-proposals-card.tsx').includes("useCan('publish',scope)")&&src('app/ads-proposals-card.tsx').includes("useCan('spend',scope)"),'ads proposals card checks publish and spend');
console.log(JSON.stringify({passed}));
