// 카드 사실 적격성(lib/fact-eligibility.ts) 단위 테스트와 renderFactCard가 캔버스 작업 전에 그 검사를 쓰는지 확인한다.
import assert from 'node:assert/strict';
import {SourceTextModule,createContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';

let passed=0;const failures=[];function check(label,value){if(value)passed++;else failures.push(label)}
const rt=testRuntime(async()=>{throw new Error('network disabled')});
const {factCardIssue}=await rt.load('lib/fact-eligibility.ts');
const now=Date.parse('2026-09-23T00:00:00Z'),iso=ms=>new Date(ms).toISOString();
const fact=(over={})=>({id:'f'+Math.random(),brandId:'oda',key:'주소',value:'휘경동 377',status:'confirmed',source:'대표 확인',verifiedAt:iso(now-86400000),validUntil:iso(now+86400000),version:1,updatedAt:iso(now),...over});
const COUNT='카드에 넣을 사실을 1~4개 선택하세요.',INVALID='동일 브랜드의 유효한 확인 사실만 이미지에 사용할 수 있습니다.',MIXED='서로 다른 지점 또는 중복 항목의 사실을 한 카드에 넣을 수 없습니다.';

check('valid single fact',factCardIssue('oda',[fact()],now)===null);
check('four distinct facts allowed',factCardIssue('oda',['a','b','c','d'].map(key=>fact({key})),now)===null);
check('empty selection rejected',factCardIssue('oda',[],now)===COUNT);
check('five facts rejected',factCardIssue('oda',['a','b','c','d','e'].map(key=>fact({key})),now)===COUNT);
check('brand mismatch rejected',factCardIssue('oda',[fact({brandId:'ofd'})],now)===INVALID);
check('candidate rejected',factCardIssue('oda',[fact({status:'candidate'})],now)===INVALID);
check('rejected status rejected',factCardIssue('oda',[fact({status:'rejected'})],now)===INVALID);
check('blank source rejected',factCardIssue('oda',[fact({source:'  '})],now)===INVALID);
check('blank value rejected',factCardIssue('oda',[fact({value:' '})],now)===INVALID);
check('blank key rejected',factCardIssue('oda',[fact({key:''})],now)===INVALID);
check('unparseable verifiedAt rejected',factCardIssue('oda',[fact({verifiedAt:'어제'})],now)===INVALID);
check('future verifiedAt rejected',factCardIssue('oda',[fact({verifiedAt:iso(now+60000)})],now)===INVALID);
check('verifiedAt equal to now allowed',factCardIssue('oda',[fact({verifiedAt:iso(now)})],now)===null);
check('expired validUntil rejected',factCardIssue('oda',[fact({validUntil:iso(now-1)})],now)===INVALID);
check('validUntil equal to now rejected',factCardIssue('oda',[fact({validUntil:iso(now)})],now)===INVALID);
check('unparseable validUntil rejected',factCardIssue('oda',[fact({validUntil:''})],now)===INVALID);
check('one invalid fact poisons the card',factCardIssue('oda',[fact({key:'a'}),fact({key:'b',brandId:'ofd'})],now)===INVALID);
check('duplicate key rejected',factCardIssue('oda',[fact({key:'영업시간'}),fact({key:'영업시간',value:'10-22'})],now)===MIXED);
check('two stores rejected',factCardIssue('oda',[fact({key:'a',storeId:'s1'}),fact({key:'b',storeId:'s2'})],now)===MIXED);
check('one store plus brand-wide facts allowed',factCardIssue('oda',[fact({key:'a',storeId:'s1'}),fact({key:'b'})],now)===null);
check('default clock is current time',factCardIssue('oda',[fact({verifiedAt:iso(Date.now()+3600000),validUntil:iso(Date.now()+7200000)})])===INVALID);

// renderFactCard는 브라우저 전용이다. document가 없으면 제작 전에 멈춘다.
const render=await rt.load('lib/creative-render.ts'),brand={id:'oda',name:'ODA',color:'#123456'};
await assert.rejects(render.renderFactCard(brand,[fact()]),/브라우저에서 실행/).then(()=>check('server context refuses to render',true),()=>check('server context refuses to render',false));

// 가짜 document로 캔버스 경로를 실행한다. 부적격 사실은 캔버스를 만들기 전에 거부해야 한다.
let canvases=0;const drawn=[];
const context2d={fillStyle:'',font:'',textBaseline:'',fillRect(){},fillText(text){drawn.push(text)},measureText:text=>({width:Array.from(text).length*10})};
const document={createElement(){canvases++;return {width:0,height:0,getContext:()=>context2d,toDataURL:()=>'data:image/png;base64,AAAA'}}};
const vmContext=createContext({console,document});const modules=new Map();
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:vmContext,identifier:file});modules.set(file,m);return m}
const browserModule=moduleFor('lib/creative-render.ts');
await browserModule.link((spec,ref)=>moduleFor(resolve(dirname(ref.identifier),spec)+'.ts'));await browserModule.evaluate();
const {renderFactCard}=browserModule.namespace;
const liveFact=over=>fact({verifiedAt:iso(Date.now()-60000),validUntil:iso(Date.now()+86400000),...over});
async function outcome(facts){try{return {png:await renderFactCard(brand,facts)}}catch(e){return {error:e.message}}}
check('other brand fact blocked before canvas',(await outcome([liveFact({brandId:'ofd'})])).error===INVALID&&canvases===0);
check('future verifiedAt blocked before canvas',(await outcome([liveFact({verifiedAt:iso(Date.now()+3600000)})])).error===INVALID&&canvases===0);
check('duplicate key blocked before canvas',(await outcome([liveFact({key:'a'}),liveFact({key:'a'})])).error===MIXED&&canvases===0);
check('count blocked before canvas',(await outcome([])).error===COUNT&&canvases===0);
const ok=await outcome([liveFact({value:'휘경동 377 C107'})]);
check('eligible fact renders PNG data URL',ok.png==='data:image/png;base64,AAAA'&&canvases===1);
check('rendered card draws brand and fact value',drawn.join('').includes('ODA')&&drawn.join('').includes('휘경동'));

console.log(JSON.stringify({passed,failed:failures.length,failures}));
assert.deepEqual(failures,[]);
