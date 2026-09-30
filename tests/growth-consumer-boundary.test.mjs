// Consumer pseudonyms and consent evidence must not enter model or franchise paths.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {join,resolve,dirname,relative} from 'node:path';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';
import {seed,mockHermes,runRole,roleCampaign,brand} from './helpers/prompt-seed.mjs';

let passed=0;const check=(value,label)=>{assert.ok(value,label);passed++;};
const root=process.cwd();
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=join(d,e.name);return e.isDirectory()?(!e.name.startsWith('.')&&e.name!=='node_modules'?walk(p):[]):/\.tsx?$/.test(e.name)&&!e.name.endsWith('.d.ts')?[p]:[];});
function imports(file){
 const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,false,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),specs=[],opaque=[];
 const literal=n=>n&&(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))?n.text:null;
 function visit(n){
  if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier)specs.push(literal(n.moduleSpecifier));
  if(ts.isImportEqualsDeclaration(n)&&ts.isExternalModuleReference(n.moduleReference))specs.push(literal(n.moduleReference.expression));
  if(ts.isImportTypeNode(n)&&ts.isLiteralTypeNode(n.argument))specs.push(literal(n.argument.literal));
  if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(n.expression)&&n.expression.text==='require'))){const value=literal(n.arguments[0]);if(value)specs.push(value);else opaque.push(n.getText(source));}
  ts.forEachChild(n,visit);
 }
 visit(source);return {specs:specs.filter(Boolean),opaque};
}
function resolveSpec(from,spec){
 const base=spec.startsWith('@/')?join(root,spec.slice(2)):spec.startsWith('.')?resolve(dirname(join(root,from)),spec):null;
 if(!base)return null;
 const file=[base,base+'.ts',base+'.tsx',join(base,'index.ts'),join(base,'index.tsx')].find(p=>existsSync(p)&&statSync(p).isFile());
 return file?relative(root,file):null;
}
const files=['app','lib','components','hooks','db'].flatMap(walk),parsed=new Map(files.map(f=>[f,imports(f)]));
const graph=new Map(files.map(f=>[f,parsed.get(f).specs.map(s=>resolveSpec(f,s)).filter(Boolean)]));
function reachable(roots){const found=new Set(roots),queue=[...roots];while(queue.length){for(const next of graph.get(queue.shift())??[])if(!found.has(next)){found.add(next);queue.push(next);}}return found;}
const consumer=['lib/growth-consumer.ts','lib/growth-consumer-server.ts','app/api/growth/consumer/route.ts'];
check(consumer.every(f=>graph.has(f)),'all consumer boundary modules exist');
const modelRoots=['lib/role-execution.ts','lib/meeting-execution.ts','lib/brief-execution.ts','lib/research-execution.ts','lib/learning-execution.ts','lib/eval-server.ts','lib/ai-context.ts','lib/role-instruction.ts',...files.filter(f=>f.startsWith('lib/')&&f!=='lib/client.ts'&&(/\bfetch\s*\(/.test(readFileSync(f,'utf8'))||parsed.get(f).specs.some(s=>s.endsWith('/hermes')||s==='./hermes')))];
const reached=reachable(modelRoots),kinds=['growth_customer','growth_consumer_consent','growth_consumer_order_link','growth_consumer_order_history','growth_consumer_request'];
check(modelRoots.every(f=>graph.has(f)),'model entrypoints exist');
check(consumer.every(f=>!reached.has(f)),'model paths cannot reach consumer modules');
check([...reached].every(f=>!parsed.get(f)?.opaque.length),'no opaque model-path dynamic imports');
check([...reached].filter(f=>f!=='lib/record-kinds.ts').every(f=>!kinds.some(kind=>readFileSync(f,'utf8').includes(kind))),'model paths cannot name consumer records');
check(consumer.every(f=>!/\bfetch\s*\(/.test(readFileSync(f,'utf8'))),'consumer backend has no outbound calls');
check(!reachable(consumer).has('lib/franchise-server.ts'),'consumer backend does not join franchise records');
check(!reachable(['lib/franchise-server.ts']).has('lib/growth-consumer-server.ts'),'franchise backend does not join consumer records');

// Real record storage with a mocked model boundary: unusual marker values make leakage observable.
const hermes=mockHermes(),{load,sql}=testRuntime(hermes.fetch),server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts');
const owner='consumer-boundary-owner',marker='CONSUMER_PRIVATE_LINK_SENTINEL';await seed(server,sql,owner);
for(const [index,kind] of kinds.entries())await server.recordStatement(owner,kind,'private-'+index,{id:'private-'+index,brandId:brand.id,customerId:marker,noticeVersion:marker,evidenceRef:marker},brand.id).run();
const result=await runRole(execution,server,owner,roleCampaign,'cmo');
check(result.status==='completed','mocked model run completes');
check(!result.input.includes(marker),'role model input excludes pseudonyms and consent evidence');
check([...hermes.bodies.values()].every(body=>!body.includes(marker)),'outbound model bodies exclude all consumer record markers');
check(hermes.external.length===0,'no real external model calls');
console.log(JSON.stringify({passed,model:'mocked',storage:'real memory SQL',boundary:'static transitive and mocked runtime'}));
