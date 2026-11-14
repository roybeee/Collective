// G2 소재 예측 점수 자동 보정 여정(모바일·데스크톱): 스위치 creative_score를 켜고, 작업물 11판의 점수를 실제 API로 계산한 뒤,
// 게시 뒤 관측이 붙은 작업물↔발행 연결(artifact_publication_link) 11건을 로컬 D1 fixture로 넣고 '연결 관측으로 보정'(calibrate_linked)을 부르면
// 브랜드×채널 보정표가 방향성(표본 부족)으로 생기고, 다시 계산한 점수 카드에 표본 n=11과 기간이 보인다.
// 근거: real Chromium·빌드 결과·로컬 D1(wrangler --local)·실제 API / mocked 인증(legacy 로그인 헤더)·mocked 관측(합성 노출·클릭, 외부 수집 없음).
import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
function runSql(sql:string){
 const folder=mkdtempSync(join(tmpdir(),'collective-calibration-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,sql);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'})}finally{rmSync(folder,{recursive:true,force:true})}
}
const record=(owner:string,kind:string,id:string,parent:string,data:unknown)=>`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`;

test('연결 관측으로 보정표를 만들면 점수 카드에 표본이 보인다',async({browser},info)=>{
 test.setTimeout(120_000);
 const owner=`calibration-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 const bad:string[]=[];page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)bad.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)});
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  await page.request.get('/api/workspace');
  await post('/api/feature-flags',{action:'set',flag:'creative_score',enabled:true});
  const title=`보정 표본 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'게시 반응 보정',channels:'Instagram'}}) as {id:string};
  const now=new Date().toISOString(),published=new Date(Date.now()-10*86400000).toISOString(),N=11;
  const ids=Array.from({length:N},(_,i)=>`cal-${info.project.name}-${i}`);
  // 작업물 11판: 첫 문장 길이·숫자·행동 유도를 달리해 점수가 갈리게 한다(합성 문안).
  runSql(ids.map((id,i)=>record(owner,'artifact',id,campaignId,{id,campaignId,campaignVersion:1,role:'content',title:`보정 카피 #${String(i).padStart(2,'0')}`,content:i%2?`오늘 ${i}시 떡볶이 ${4000+i*100}원? 매장에서 포장 주문하세요.\n#가상 #분식 #포장`:`가게 소개 글입니다 ${'천천히 읽어 주세요 '.repeat(i)}`,version:1,status:'approved',origin:'manual',createdAt:now})).join('\n'));
  for(const id of ids)await post('/api/creative-score',{action:'recompute',artifactId:id});
  // 게시 뒤 관측이 붙은 연결(10일 전 게시, 노출 200·클릭 2~12).
  runSql(ids.map((id,i)=>record(owner,'artifact_publication_link',`pub-${id}`,campaignId,{id:`pub-${id}`,artifactId:id,artifactVersion:1,publicationId:`pub-${id}`,campaignId,brandId:'ofd',channel:'buffer',externalId:String(17900000000+i),publishedAt:published,metrics:{impressions:200,clicks:2+i,source:'measurement',definition:'합성 관측(노출 대비 클릭)',observedAt:now},createdAt:now,updatedAt:now})).join('\n'));
  const calibrated=await post('/api/creative-score',{action:'calibrate_linked'}) as {groups:number;written:number;tables:{brandId:string;channel:string;status:string;n:number}[]};
  const table=calibrated.tables.find(t=>t.brandId==='ofd'&&t.channel==='Instagram');
  expect(table?.status).toBe('directional');expect(table?.n).toBe(N);
  const again=await post('/api/creative-score',{action:'calibrate_linked'}) as {written:number};
  expect(again.written).toBe(0);
  const target=ids[1];await post('/api/creative-score',{action:'recompute',artifactId:target});

  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=outputs`);
  const card=page.locator('.artifact-item').filter({hasText:'보정 카피 #01'});
  await expect(card).toBeVisible({timeout:30_000});
  await card.locator('.artifact-row').click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  const score=dialog.getByRole('region',{name:`소재 예측 점수 작업물 ${target} v1`});
  await expect(score).toContainText(`n=${N}`,{timeout:15_000});
  await expect(score).toContainText('기간');
  await expect(score).toContainText('방향성(표본 부족)');
  expect(bad).toEqual([]);
 }finally{await context.close().catch(()=>{})}
});
