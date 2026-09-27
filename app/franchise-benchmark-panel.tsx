'use client';
// 가맹 모집 화면 '벤치마크' 탭(트랙 R R7a, 계획 화면 V9 '경쟁 브랜드는 어떤가'): 공정위 가맹정보 공개 API에서 사람이 버튼으로 한 번 적재한 타 브랜드 수치를 보인다(토큰 0, 주기 조회 없음).
// '타 브랜드 공개 수치. 자사 예상매출 근거가 아님'을 모든 숫자보다 먼저 고정한다. 파생 지표(순증감·폐점률)는 공식과 분모를 함께 보이고, 분모 20 미만 비율은 숨긴다(서버 계산).
// 대표·관리자는 공공데이터 키를 저장·삭제하고 적재한다. 키는 서버가 암호화해 저장하고 화면에 다시 보이지 않는다. 직원은 읽기만 한다. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {franchiseGet,franchisePost,problemOf,messageOf,ProblemBox,Disclaimer,Section,kst,type Json,type Problem} from './franchise-common';

// ── 보기 모양(서버 benchmark 보기) ──
type Money={rawThousandKrw:number|null;krw:number|null};
type Rate={value:number|null;numerator:number|null;denominator:number|null;hidden:boolean;formula:string;note:string};
export type BenchmarkRowView={brandName:string;industryLarge:string|null;industryMiddle:string|null;stores:number|null;newStores:number|null;contractEnded:number|null;contractTerminated:number|null;ownerChanged:number|null;
 avgSales:Money;avgSalesPerArea:Money;derived:{netChange:{value:number|null;formula:string;note:string};closureRate:Rate}};
type Failure={code:string;httpStatus:number|null;message:string};
export type BenchmarkFetchView={id:string;status:string;statusLabel:string;request:{year:number;brands:string[];industry:string|null};startedAt:string;finishedAt:string|null;lastActivityAt:string;attempts:number;retries:number;rowCount:number;failure:Failure|null};
export type BenchmarkLatest={id:string;ref:string;baseYear:number;performanceYear:number;collectedAt:string;apiModifiedAt:string|null;rawSha256:string;request:{year:number;brands:string[];industry:string|null};rows:BenchmarkRowView[];missing:string[];truncated:boolean};
export type BenchmarkViewData={enabled:boolean;role:string;notice:string;disclaimer:string;dataset:{label:string;source:string;unitNote:string;yearNote:string};formulas:{netChange:string;closureRate:string};
 limits:{brands:number;minRateDenominator:number};today:string;credential:{saved:boolean;savedAt:string|null};readiness:{canLoad:boolean;blocked:{code:string;message:string}|null};fetches:BenchmarkFetchView[];latest:BenchmarkLatest|null;ruleVersion:string};

// ── 고정 문구 ──
export const KEY_CLEAR_CONFIRM='저장한 공공데이터 키를 지웁니다. 다시 적재하려면 키를 새로 저장해야 합니다.';
export const KEY_NOTE='공공데이터포털(data.go.kr)에서 공정거래위원회 가맹정보 API 활용 신청이 승인된 뒤 받은 일반 인증키를 붙여 넣습니다. 키는 암호화해 저장하고 다시 보여 주지 않습니다.';
export const LOAD_NOTE='버튼을 누를 때만 한 번 적재합니다(주기 조회 없음, 토큰 0). 브랜드는 한 줄에 하나씩 30개까지, 또는 업종 검색어(예: 제과제빵)로 가맹점 수가 많은 30개를 가져옵니다.';
export const MEMBER_NOTE='공공데이터 키 저장과 적재는 대표·관리자가 합니다.';

// ── 순수 도우미(단위 검사 대상) ──
const fmt=(n:number)=>new Intl.NumberFormat('ko-KR').format(n);
export const loadInput=(f:{year:string;brands:string;industry:string}):Json=>({year:Number(f.year),brands:f.brands.split(/\r?\n|,/).map(s=>s.trim()).filter(Boolean),industry:f.industry.trim()});
export const countText=(n:number|null)=>n===null?'-':fmt(n);
export const moneyText=(m:Money)=>m.krw===null||m.rawThousandKrw===null?'미기재':`${fmt(m.krw)}원 (원값 ${fmt(m.rawThousandKrw)}천원)`;
export const rateText=(r:Rate)=>r.hidden?`표본 부족 (분모 ${r.denominator}개)`:r.value===null?'-':`${(r.value*100).toFixed(1)}% (${r.numerator}/${r.denominator})`;
export function loadMessage(result:Json):string{
 const failure=result.failure as {message?:string}|null|undefined;
 return result.status==='success'?`적재했습니다. 브랜드 ${Number(result.rowCount)}개를 저장했습니다.`:`적재 기록을 남겼습니다(${String(result.status)}): ${failure?.message??'원인을 확인하지 못했습니다.'}`;
}

// ── 탭 본체 ──
export function FranchiseBenchmark({brandId,admin,initial}:{brandId:string;admin:boolean;initial?:BenchmarkViewData}){
 const [data,setData]=useState<BenchmarkViewData|null>(initial??null),[error,setError]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const d=await franchiseGet<BenchmarkViewData>({view:'benchmark',brandId},signal);if(!signal?.aborted){setData(d);setError('')}}
  catch(e){if(!signal?.aborted)setError(messageOf(e))}
 },[brandId]);
 useEffect(()=>{if(initial)return;const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load,initial]);
 return <Section title="경쟁 브랜드 벤치마크(공정위 공개 수치)">
  <p className="notice" role="note"><strong>{data?.notice??'타 브랜드 공개 수치. 자사 예상매출 근거가 아님'}</strong></p>
  <Disclaimer/>
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load()}>다시 불러오기</Button></div>}
  {!data?!error&&<p role="status">벤치마크를 불러오고 있습니다.</p>:<>
   {data.readiness.blocked&&<p className="notice" role="status">막힘: {data.readiness.blocked.message}</p>}
   {admin?<KeyBox brandId={brandId} data={data} onDone={()=>void load()}/>:<p className="subtle-note">{MEMBER_NOTE}</p>}
   {admin&&<LoadForm brandId={brandId} data={data} onDone={()=>void load()}/>}
   <History fetches={data.fetches}/>
   <Latest data={data}/>
  </>}
 </Section>;
}

function KeyBox({brandId,data,onDone}:{brandId:string;data:BenchmarkViewData;onDone:()=>void}){
 const [key,setKey]=useState(''),[busy,setBusy]=useState(false),[problem,setProblem]=useState<Problem|null>(null),[message,setMessage]=useState('');
 async function send(action:'benchmark_key_save'|'benchmark_key_clear'){
  if(action==='benchmark_key_clear'&&!window.confirm(KEY_CLEAR_CONFIRM))return;
  setBusy(true);setProblem(null);setMessage('');
  const r=await franchisePost(action,action==='benchmark_key_save'?{brandId,apiKey:key}:{brandId});
  setBusy(false);setKey('');
  if(r.status===200){setMessage(action==='benchmark_key_save'?'공공데이터 키를 저장했습니다.':'공공데이터 키를 지웠습니다.');onDone()}else setProblem(problemOf(r));
 }
 return <div className="franchise-box">
  <h4>공공데이터 키</h4>
  <p className="subtle-note">{KEY_NOTE}</p>
  <p>{data.credential.saved?`저장됨 (${kst(data.credential.savedAt)})`:'저장 안 됨'}</p>
  <label className="field"><span>일반 인증키</span><Input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)} aria-label="공공데이터 일반 인증키"/></label>
  <div className="franchise-actions">
   <Button size="sm" disabled={busy||!data.enabled||!key.trim()} onClick={()=>void send('benchmark_key_save')}>키 저장</Button>
   {data.credential.saved&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void send('benchmark_key_clear')}>키 지우기</Button>}
  </div>
  {message&&<p role="status">{message}</p>}
  <ProblemBox problem={problem}/>
 </div>;
}

function LoadForm({brandId,data,onDone}:{brandId:string;data:BenchmarkViewData;onDone:()=>void}){
 const [f,setF]=useState({year:String(Number(data.today.slice(0,4))-1),brands:'',industry:''});
 const [busy,setBusy]=useState(false),[problem,setProblem]=useState<Problem|null>(null),[message,setMessage]=useState('');
 async function submit(){
  setBusy(true);setProblem(null);setMessage('');
  const r=await franchisePost('benchmark_load',{brandId,...loadInput(f)});
  setBusy(false);
  if(r.status===200&&r.body.result){setMessage(loadMessage(r.body.result));onDone()}else setProblem(problemOf(r));
 }
 return <div className="franchise-box">
  <h4>적재</h4>
  <p className="subtle-note">{LOAD_NOTE}</p>
  <label className="field"><span>기준년도</span><Input inputMode="numeric" value={f.year} onChange={e=>setF({...f,year:e.target.value})} aria-label="기준년도"/></label>
  <label className="field"><span>비교 브랜드(한 줄에 하나)</span><Textarea rows={4} value={f.brands} onChange={e=>setF({...f,brands:e.target.value})} aria-label="비교 브랜드"/></label>
  <label className="field"><span>업종 검색어(선택)</span><Input value={f.industry} onChange={e=>setF({...f,industry:e.target.value})} aria-label="업종 검색어"/></label>
  <Button size="sm" disabled={busy||!data.readiness.canLoad} onClick={()=>void submit()}>적재</Button>
  {busy&&<p role="status">공공데이터포털에서 적재하고 있습니다. 최대 100초 걸릴 수 있습니다.</p>}
  {message&&<p role="status">{message}</p>}
  <ProblemBox problem={problem}/>
 </div>;
}

function History({fetches}:{fetches:BenchmarkFetchView[]}){
 if(!fetches.length)return <p className="subtle-note">아직 적재 기록이 없습니다.</p>;
 return <div className="ledger-table-wrap"><table className="ledger-table franchise-table"><caption>적재 기록(최근 20건)</caption>
  <thead><tr><th scope="col">시작</th><th scope="col">상태</th><th scope="col">조건</th><th scope="col">시도</th><th scope="col">마지막 활동</th><th scope="col">저장 행</th><th scope="col">실패 원인</th></tr></thead>
  <tbody>{fetches.map(x=><tr key={x.id}><td>{kst(x.startedAt)}</td><td>{x.statusLabel}</td>
   <td>{`기준년도 ${x.request.year}`}{x.request.brands.length?` · 브랜드 ${x.request.brands.length}개`:''}{x.request.industry?` · 업종 ${x.request.industry}`:''}</td>
   <td>{`시도 ${x.attempts}회 · 재시도 ${x.retries}회`}</td><td>{kst(x.lastActivityAt)}</td><td>{x.rowCount}</td><td>{x.failure?x.failure.message:'-'}</td></tr>)}</tbody>
 </table></div>;
}

function Latest({data}:{data:BenchmarkViewData}){
 const m=data.latest;
 if(!m)return <p className="subtle-note">저장된 벤치마크가 없습니다.</p>;
 return <div className="franchise-box">
  <h4>최근 적재한 벤치마크</h4>
  <ul className="franchise-list" aria-label="벤치마크 읽는 법">
   <li>{`기준년도 ${m.baseYear} · 추정 실적년도 ${m.performanceYear}(확인 필요) · 수집 ${kst(m.collectedAt)} · API 수정일 ${m.apiModifiedAt??'응답에 없음'}`}</li>
   <li>{`출처: ${data.dataset.label} · 참조 ${m.ref} · 원자료 해시 ${m.rawSha256.slice(0,12)}`}</li>
   <li>{data.dataset.unitNote}</li>
   <li>{data.dataset.yearNote}</li>
   <li>{data.formulas.netChange} (명의 변경은 폐점으로 세지 않습니다)</li>
   <li>{`${data.formulas.closureRate} · 분모 ${data.limits.minRateDenominator}개 미만이면 비율을 숨깁니다`}</li>
   {m.missing.length>0&&<li>{`찾지 못한 브랜드: ${m.missing.join(', ')}`}</li>}
   {m.truncated&&<li>{`업종 결과가 ${data.limits.brands}개를 넘어 가맹점 수가 많은 ${data.limits.brands}개만 저장했습니다.`}</li>}
  </ul>
  <div className="ledger-table-wrap"><table className="ledger-table franchise-table"><caption className="sr-only">경쟁 브랜드 공개 수치</caption>
   <thead><tr><th scope="col">브랜드</th><th scope="col">업종</th><th scope="col">연말 가맹점 수</th><th scope="col">신규 개점</th><th scope="col">계약 종료</th><th scope="col">계약 해지</th><th scope="col">명의 변경</th><th scope="col">순증감</th><th scope="col">폐점률</th><th scope="col">평균 매출</th><th scope="col">면적(3.3㎡)당 평균 매출</th></tr></thead>
   <tbody>{m.rows.map(r=><tr key={r.brandName}><td>{r.brandName}</td><td>{[r.industryLarge,r.industryMiddle].filter(Boolean).join(' · ')||'-'}</td><td>{countText(r.stores)}</td><td>{countText(r.newStores)}</td>
    <td>{countText(r.contractEnded)}</td><td>{countText(r.contractTerminated)}</td><td>{countText(r.ownerChanged)}</td><td>{countText(r.derived.netChange.value)}</td><td>{rateText(r.derived.closureRate)}</td>
    <td>{moneyText(r.avgSales)}</td><td>{moneyText(r.avgSalesPerArea)}</td></tr>)}</tbody>
  </table></div>
 </div>;
}
