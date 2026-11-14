// 규정 점검 준수율(QA D12): 통과 규칙 수 / 점검 규칙 수. 순수 함수이며 화면(components/app/compliance-rate.tsx)과 테스트가 같이 쓴다.
// 작업물 규정 보기(lib/artifact-sources-server.ts complianceViewOf)는 분류별 '통과'를 그 분류에서 걸리지 않은 규칙 수로, 위반은 표현 건수로 준다.
// 그래서 점검 규칙 수는 통과 합 + 걸린 규칙 수(같은 규칙이 여러 표현에 걸려도 1개)다. 보기에 없는 분류(가맹 모집 범위 등)의 걸림은 세지 않는다.
// 백분율은 내림한다. 한 규칙이라도 걸리면 100%로 보이지 않는다. 자동 점검이며 법률 자문이 아니다.
export type ComplianceRate={passed:number;checked:number;percent:number};
type RateInput={categories:readonly {category:string;pass:number}[];issues:readonly {category:string;ruleId:string}[]};

export function complianceRate(view:RateInput):ComplianceRate|null{
 const checkedCategories=new Set(view.categories.map(c=>c.category));
 const passed=view.categories.reduce((sum,c)=>sum+c.pass,0);
 const hit=new Set(view.issues.filter(i=>checkedCategories.has(i.category)).map(i=>i.ruleId)).size;
 const checked=passed+hit;
 return checked>0?{passed,checked,percent:Math.floor(100*passed/checked)}:null;
}
