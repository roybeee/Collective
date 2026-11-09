// X8 어절 단위 비교(lib/word-diff.ts): 추가·삭제·교체, 이웃 조각 합치기, 부분 수락 재구성, 큰 글 대체 경로. 순수 함수라 외부 호출 없음.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async url=>{throw new Error('외부 호출 금지: '+url)});
const d=await rt.load('lib/word-diff.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));

// 1) 같은 글은 같은 조각 하나다.
check('identical text is one equal op',JSON.stringify(plain(d.diffOps('오늘 영업합니다','오늘 영업합니다')))===JSON.stringify([{type:'equal',text:'오늘 영업합니다'}]));
check('empty to empty has no ops',d.diffOps('','').length===0);

// 2) 추가: 끝에 어절을 더하면 공백과 어절이 한 추가 조각으로 합쳐진다.
const insert=plain(d.diffOps('오늘 영업합니다','오늘 정상 영업합니다'));
check('insert in the middle',JSON.stringify(insert)===JSON.stringify([{type:'equal',text:'오늘 '},{type:'insert',text:'정상 '},{type:'equal',text:'영업합니다'}]));
const append=plain(d.diffOps('주문 가능','주문 가능 시간 안내'));
check('appended words merge into one insert',append.length===2&&append[1].type==='insert'&&append[1].text===' 시간 안내');

// 3) 삭제.
const del=plain(d.diffOps('지금 바로 꼭 오세요','지금 오세요'));
check('deleted words merge into one delete',del.filter(o=>o.type==='delete').length===1&&del.find(o=>o.type==='delete').text.trim()==='바로 꼭');

// 4) 교체: 삭제와 추가가 한 덩어리가 되고, 사이 공백만 같은 조각은 덩어리 안으로 들어간다.
const rep=plain(d.wordDiff('가격은 만 원입니다','가격은 9천 원입니다'));
check('replace is one change segment',rep.filter(s=>s.kind==='change').length===1&&rep.find(s=>s.kind==='change').removed==='만'&&rep.find(s=>s.kind==='change').added==='9천');
const two=plain(d.wordDiff('가 나 다','라 마 다'));
check('space between two changed words is absorbed into one hunk',two.filter(s=>s.kind==='change').length===1&&two[0].removed==='가 나'&&two[0].added==='라 마');
const apart=plain(d.wordDiff('하나 둘 셋 넷','하나 2 셋 4'));
check('changes separated by a word stay separate hunks with ids 0 and 1',JSON.stringify(apart.filter(s=>s.kind==='change').map(s=>[s.id,s.removed,s.added]))===JSON.stringify([[0,'둘','2'],[1,'넷','4']]));

// 5) 부분 수락 재구성: 모두 받으면 새 글, 아무것도 안 받으면 원문, 일부만 받으면 그 덩어리만 바뀐다.
const a='봄 신메뉴 출시. 딸기 도넛과 우유 도넛을 만나 보세요.\n매장 방문 시 쿠폰을 보여 주세요.',b='봄 한정 신메뉴 출시. 딸기 도넛을 만나 보세요!\n매장에서 쿠폰을 보여 주세요.';
const seg=d.wordDiff(a,b),ids=seg.filter(s=>s.kind==='change').map(s=>s.id);
check('several hunks are found',ids.length>=3);
check('accepting every hunk rebuilds the new text',d.applyChanges(seg,ids)===b);
check('accepting no hunk keeps the original text',d.applyChanges(seg,[])===a);
check('accepting with a Set works the same',d.applyChanges(seg,new Set(ids))===b);
const first=d.applyChanges(seg,[ids[0]]);
check('accepting only the first hunk changes only that part',first.startsWith('봄 한정 신메뉴')&&first.includes('우유 도넛')&&first.includes('매장 방문 시'));
check('every partial combination stays between the two texts in length bounds',ids.every(id=>typeof d.applyChanges(seg,[id])==='string'));
check('equal plus removed parts rebuild the original',seg.map(s=>s.kind==='equal'?s.text:s.removed).join('')===a&&seg.map(s=>s.kind==='equal'?s.text:s.added).join('')===b);

// 6) 줄바꿈도 조각으로 보존된다.
const lines=d.wordDiff('첫 줄\n둘째 줄','첫 줄\n\n둘째 줄');
check('line breaks are preserved through partial accept',d.applyChanges(lines,[0])==='첫 줄\n\n둘째 줄'&&d.applyChanges(lines,[])==='첫 줄\n둘째 줄');

// 7) 한쪽이 빈 글.
check('from empty is one insert hunk',JSON.stringify(plain(d.wordDiff('','새 글')))===JSON.stringify([{kind:'change',id:0,removed:'',added:'새 글'}]));
check('to empty is one delete hunk',plain(d.wordDiff('지울 글','')).length===1&&d.applyChanges(d.wordDiff('지울 글',''),[0])==='');

// 8) 큰 글은 공통 앞뒤를 떼고, 가운데가 표 한도를 넘으면 한 덩어리 교체로 끝난다(멈추지 않는다).
const many=n=>Array.from({length:n},(_,i)=>'어절'+i).join(' ');
const big1='머리 '+many(3000)+' 꼬리',big2='머리 '+many(3000).split(' ').reverse().join(' ')+' 꼬리';
const t0=Date.now(),bigSeg=d.wordDiff(big1,big2);
check('large diffs finish quickly',Date.now()-t0<5000);
check('large diffs still rebuild both texts',d.applyChanges(bigSeg,bigSeg.filter(s=>s.kind==='change').map(s=>s.id))===big2&&d.applyChanges(bigSeg,[])===big1);
check('large diffs keep the common head and tail as equal',bigSeg[0].kind==='equal'&&bigSeg[0].text.startsWith('머리')&&bigSeg.at(-1).kind==='equal'&&bigSeg.at(-1).text.endsWith('꼬리'));
check('changeCount counts change segments',d.changeCount(apart)===2);

console.log(JSON.stringify({passed:passed.length}));
