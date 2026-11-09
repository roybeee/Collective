// G7 권한 표(lib/access.ts) 전수 회귀: 역할 6개 × 작업 12개 × 자원(배정 브랜드·다른 브랜드·배정 지점·다른 지점·자원 없음)을 표로 고정한다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('no external calls')});
const access=await rt.load('lib/access.ts');
let passed=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);passed++};

const actions=['read_campaign','edit_campaign','run_ai','approve_artifact','publish','spend','send_customer','manage_connections','manage_flags','manage_accounts','view_usage','export_data'];
check('action list is explicit and ordered',[...access.ACCESS_ACTIONS],actions);
check('scoped roles',[...access.SCOPED_ROLES],['brand_manager','store_manager','reviewer']);
check('every role has a row for every action',Object.entries(access.ROLE_MATRIX).map(([role,row])=>[role,Object.keys(row).sort().join()]),['owner','admin','member','brand_manager','store_manager','reviewer'].map(r=>[r,[...actions].sort().join()]));

// 자원: 배정 브랜드 ofd·지점 s1(ofd), 다른 브랜드 oda·지점 s9(oda), 같은 브랜드의 다른 지점 s2(ofd), 자원 없음.
const resources={
 brand_in:{brandId:'ofd'},brand_out:{brandId:'oda'},
 store_in:{brandId:'ofd',storeId:'s1'},store_other_same_brand:{brandId:'ofd',storeId:'s2'},store_out:{brandId:'oda',storeId:'s9'},
 none:{},
};
const principals={
 owner:{role:'owner',brandIds:[],storeIds:[]},admin:{role:'admin',brandIds:[],storeIds:[]},member:{role:'member',brandIds:[],storeIds:[]},
 brand_manager:{role:'brand_manager',brandIds:['ofd'],storeIds:[]},
 store_manager:{role:'store_manager',brandIds:['ofd'],storeIds:['s1']},
 reviewer:{role:'reviewer',brandIds:['ofd'],storeIds:[]},
};
const keys=Object.keys(resources),all=keys.map(()=>1),none=keys.map(()=>0);
// 기대 표: 자원 순서 brand_in, brand_out, store_in, store_other_same_brand, store_out, none (1=허용)
const B=[1,0,1,1,0,0],S=[0,0,1,0,0,0],BS=[1,0,1,0,0,0];
const expected={
 owner:Object.fromEntries(actions.map(a=>[a,all])),
 admin:Object.fromEntries(actions.map(a=>[a,a==='manage_flags'?none:all])),
 member:Object.fromEntries(actions.map(a=>[a,['read_campaign','edit_campaign','run_ai','view_usage'].includes(a)?all:none])),
 brand_manager:Object.fromEntries(actions.map(a=>[a,['read_campaign','edit_campaign','run_ai','approve_artifact','publish'].includes(a)?B:none])),
 store_manager:Object.fromEntries(actions.map(a=>[a,a==='read_campaign'?BS:['edit_campaign','approve_artifact','publish'].includes(a)?S:none])),
 reviewer:Object.fromEntries(actions.map(a=>[a,['read_campaign','approve_artifact'].includes(a)?B:none])),
};
for(const [role,p] of Object.entries(principals))for(const action of actions){
 const actual=keys.map(k=>access.can(p,action,resources[k])?1:0);
 check(`${role} × ${action}`,actual,expected[role][action]);
}
// 닫힌 기본값: 모르는 역할·모르는 작업·빈 문자열 자원은 거절, 범위 역할의 배정이 비면 모두 거절.
check('unknown role denies',access.can({role:'root',brandIds:['ofd'],storeIds:[]},'read_campaign',{brandId:'ofd'}),false);
check('unknown action denies',access.can(principals.owner,'delete_everything',{}),false);
check('empty brand id is not in scope',access.can({...principals.brand_manager,brandIds:['']},'read_campaign',{brandId:''}),false);
check('scoped role with no assignment sees nothing',actions.some(a=>keys.some(k=>access.can({role:'brand_manager',brandIds:[],storeIds:[]},a,resources[k]))),false);
// 범위 없는 역할은 자원 없이 역할만으로 판단한다(roleOnly). 범위 역할의 범위 작업은 자원이 필요하다.
check('roleOnly for unscoped and scoped none',[access.roleOnly(principals.member,'publish'),access.roleOnly(principals.owner,'publish'),access.roleOnly(principals.brand_manager,'spend'),access.roleOnly(principals.brand_manager,'publish')],[true,true,true,false]);
check('isScoped',Object.values(principals).map(p=>access.isScoped(p)),[false,false,false,true,true,true]);
// 멤버십 해석: 깨진 행은 아무것도 없는 검토자(닫힘), 중복 id는 하나로, 51개 이상·문자열 아님은 거절.
check('membership parse',JSON.parse(JSON.stringify(access.principalOfMembership({role:'brand_manager',brandIds:['ofd','ofd'],storeIds:[]}))),{role:'brand_manager',brandIds:['ofd'],storeIds:[]});
check('broken membership fails closed',JSON.parse(JSON.stringify([access.principalOfMembership(null),access.principalOfMembership({role:'admin',brandIds:['ofd']}),access.principalOfMembership({role:'reviewer',brandIds:[1]})])),[0,1,2].map(()=>({role:'reviewer',brandIds:[],storeIds:[]})));
check('cleanIds limits',[access.cleanIds(undefined),access.cleanIds(Array.from({length:51},(_,i)=>'b'+i)),access.cleanIds(['a\nb']),access.cleanIds(['x','x','y'])].map(v=>v===null?null:[...v]),[[],null,null,['x','y']]);
check('labels and descriptions are Korean for every scoped role',access.SCOPED_ROLES.every(r=>/[가-힣]/.test(access.scopedRoleLabels[r])&&/[가-힣]/.test(access.scopedRoleDescriptions[r])),true);
check('matrix is frozen',Object.isFrozen(access.ROLE_MATRIX)&&Object.isFrozen(access.ROLE_MATRIX.member),true);
console.log(JSON.stringify({passed}));
