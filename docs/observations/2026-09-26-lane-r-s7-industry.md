# 2026-09-26 레인 R: R3c 선행 — 운영 S7 합성 케이스 기대 업종 갱신

결론: 운영 D1의 합성 S7 역할 케이스 8건에서 기대 업종(`expectations.industry`)만 `['fnb']`에서 `['franchise','fnb']`로 바꾼다. 대표가 승인했다. 이 클라우드 세션에는 소유자 로그인이 없어 직접 쓰지 못한다. 그래서 소유자 브라우저 콘솔에 붙여 넣을 스니펫을 만들었다. 스니펫은 먼저 모든 전제를 확인한다. 그다음 한 건씩 쓰기 직전에 다시 읽고 바꾼다. 끝나면 8건을 다시 읽어 확인한다. 오늘 채점기로는 두 값의 판정이 같다. R3c가 `franchise` 사전을 더하기 전에 이 갱신이 운영에 있어야 한다. 운영 실행은 아직이다(not_run). 스니펫 검사는 `tests/r3c-s7-industry.test.mjs` passed · mocked다.

## 대표 승인
> "R3c 선행 작업, 운영 D1 합성 S7 케이스 기대 업종 갱신을 승인한다. 진행하라."

- 대표, 2026-09-26 16:15 UTC, 레인 R 세션.
- 범위: 아래 8건의 `expectations.industry` 한 필드. 그 밖의 운영 데이터는 바꾸지 않는다.

## 무엇을 바꾸나
- 대상: 운영 D1 `eval_case` 중 합성 S7 역할 케이스 8건. 스펙은 `scripts/eval/specs/syn-s7-franchise.json`(id `syn-s7-franchise`, set dev, 역할 8개)이다.
- 찾는 법: `GET /api/eval` 목록에서 campaignId `syn-s7-franchise-campaign`인 행을 고른다. 목록에는 externalKey·expectations가 없어 한 건씩 전체를 읽는다. source `synthetic`, externalKey가 `syn-s7-franchise:`로 시작, kind `role`인 것만 대상이다. 같은 캠페인의 다른 행은 `ignored`로 세고 건드리지 않는다.
- 바꾸는 값: `industry` `['fnb']` → `['franchise','fnb']`. 주 업종은 가맹(franchise)이다. 상품이 떡볶이·어묵 메뉴라 fnb는 허용 업종으로 남긴다.
- 그대로 두는 값: expectations의 나머지(`prohibitedTerms`·`facts`·`localStore`, 있으면 `inputTokenCap`·`seededDefects`), 그리고 `request`·`specHash`·`externalKey`·`set`·`label`·`source`·`generator`·`campaignId`.
- 쓰는 방법: `POST /api/eval` `{action:'update_case', id, expectations}`(`lib/eval-server.ts` updateCase). expectations는 쓰기 직전에 다시 읽은 값에서 industry만 바꿔 보낸다.
- `facts` 키는 빼고 보낸다. 키가 없으면 서버가 저장된 사실 원장을 그대로 쓴다(`expectationsOf` 기본값). `facts:null`을 보내면 거부되지 않는다. 서버가 받아들이고(200) 저장된 원장을 지운다(`ledger`가 null을 그대로 돌려준다). 그래서 null로 보내면 안 된다.
- updateCase에는 버전 확인(If-Match)이 없다. 보낸 expectations 전체가 저장된다. 그래서 스니펫은 쓰기 직전에 그 케이스를 다시 읽는다. 처음 읽은 값과 다르면 쓰지 않고 멈춘다. 이 확인은 틈을 줄일 뿐 닫지는 못한다. apply·rollback이 도는 동안 다른 탭·세션에서 평가 케이스를 고치지 않는다.
- 서버가 함께 바꾸는 값: `expectationsUpdatedAt`·`updatedAt`. 그래서 이 갱신 전의 run을 재채점하면 S7 케이스에 `caseUpdatedAfterRun` 표시가 붙는다. 판정 자체는 같다(아래).

## 왜 지금 먼저이고, 왜 채점 결과가 바뀌지 않는가
- 업종을 읽는 채점기는 `industry_metric_leak` 하나다(`lib/eval-kinds.ts` baseContext → `lib/graders/content.ts:66`). 온라인 채점은 업종을 비워 둔다(`lib/online-grading.ts`).
- 이 채점기는 케이스 업종 목록에 **없는** 업종의 사전만 본다. 주 업종과 허용 업종을 똑같이 뺀다.
- `lib/graders/industry.ts` `INDUSTRY_TERMS`에는 아직 `franchise` 사전이 없다. 그래서 지금은 `['fnb']`와 `['franchise','fnb']`가 같은 사전 목록을 보고, 판정이 같다.
- R3c는 `franchise` 사전과 `GRADERS_VERSION` 표시를 더한다. 그때 S7이 `['fnb']`로 남아 있으면 S7 출력의 가맹 모집 표현이 새 `industry_metric_leak` fail이 된다. 그래서 R3c 코드를 게시하고 재채점하기 전에 이 갱신이 운영에 먼저 있어야 한다.
- 검사: 테스트 i절(mocked)이 S7 같은 출력 문장 5개(가맹 상담·정보공개서, 떡볶이 대표 메뉴, 수강료·체험 수업 같은 다른 업종 용어 포함)로 확인했다. `industry_metric_leak` 판정과 전체 채점기 결과가 두 목록에서 같다. 표본에는 pass와 fail이 모두 있다.
- R3c가 사전을 더하면 i절의 첫 검사("franchise 사전 없음")가 의도대로 실패한다. R3c PR이 그 절을 "두 목록의 판정이 갈린다"로 바꾼다.

## 저장소 스펙을 바꾸지 않는 이유
- 생성기(`scripts/eval/synthesize.mjs:110`)는 케이스마다 specHash를 `sha256(canonical(body))` 앞 32자로 만든다. body에 expectations가 들어간다.
- 스펙의 industry를 바꾸면 8건의 specHash가 모두 바뀐다. 그 출력을 다시 가져오면 `existingExternal`이 같은 externalKey에 다른 specHash라며 409로 거부한다.
- 스펙은 레인 Q 파일이다. 서버 평가의 정본은 D1 `eval_case`다(`docs/EVAL.ko.md` "서버 평가(F1b)는 D1 `eval_case`가 정본"). 그래서 운영 값만 고친다.
- 알려진 차이: 갱신 뒤 저장소 스펙은 `['fnb']`, 운영 D1은 `['franchise','fnb']`다.
- 레인 Q 요청 한 줄: `syn-s7-franchise.json`의 `expectations.industry`를 `['franchise','fnb']`로 바꾸는 일은 S7 재가져오기(기존 8건 삭제 뒤 새로 생성·가져오기)를 계획할 때 그 PR에서만 함께 한다. 그 전에는 스펙을 그대로 두고 D1 값을 정본으로 본다. 갱신 전에 끝난 S7 run을 재채점하면 S7 케이스에 `caseUpdatedAfterRun` 표시가 붙는다(`lib/eval-server.ts` expectationsChangedAt). 판정은 같다.
- 이 요청은 레인 Q가 읽는 `docs/STATUS.md` 레인 Q 칸에도 있어야 한다(`docs/LANES.ko.md`: `scripts/eval/`은 Q 칸에 요청). 이 문서만으로는 전달되지 않는다.

## 실행 방법
운영 앱: `https://mealzip-agency.hflameb.chatgpt.site`(tree `1ac4369`, 묶음 14 = `8651021`). `/api/eval`은 소유자 전용이다. 로그인하지 않으면 401이다.

1. 소유자로 로그인한 앱 페이지를 연다. 개발자 도구(F12) → Console. 대표가 직접 하거나, 대표가 허용한 개발 도구가 대표의 로그인 브라우저에서 한다(`docs/PUBLISH.ko.md` 5단계와 같은 same-origin 방식).
2. 아래 스니펫을 통째로 붙여 넣고 Enter. 첫 실행은 `const MODE='check';` 그대로다. 쓰기가 없다. Chrome이 붙여 넣기 경고를 띄우면 안내대로 `allow pasting`(한국어 화면은 `붙여넣기 허용`)을 입력한 뒤 다시 붙여 넣는다.
3. 출력 한 줄을 본다. `ok` true, `found` 8, `toChange` 8, `already` 0이어야 한다. 다르면 멈추고 그 줄을 레인 R에 붙여 넣는다.
4. 스니펫의 `const MODE='check';`를 `const MODE='apply';`로 바꿔 한 번 더 붙여 넣는다.
5. 출력 한 줄(`ok` true, `changed` 8, `verified` 8 예상)을 레인 R에 붙여 넣는다. 레인 R이 아래 '실행 기록'에 적는다.

- 되돌리기는 `const MODE='rollback';`이다(아래 '되돌리기').
- 다시 실행해도 안전하다. 매번 D1을 새로 읽는다. 이미 바뀐 건은 `already`로 세고 쓰지 않는다. 중간에 멈췄으면 원인을 본 뒤 같은 MODE로 다시 실행한다. 남은 건만 바꾼다.
- 서버 오류(5xx)나 응답 없음으로 멈췄으면 2분쯤 기다린 뒤 다시 실행한다. 서버가 쓴 뒤 잠금을 풀지 못했으면 잠금 행이 2분 동안 남는다. 그 사이에 다시 실행하면 첫 쓰기가 409로 거부된다(쓰기 없음).
- apply·rollback이 도는 동안 다른 탭·세션에서 평가 케이스를 고치지 않는다. 앱 화면의 다른 저장도 같은 잠금을 쓰므로 409가 날 수 있다.
- 출력에는 `= ? & %`가 없다. 브라우저 자동화 도구로 콘솔을 읽어도 막히지 않는다(`docs/HANDOFF.ko.md`).

## 스니펫
<!-- s7-snippet:start -->
```js
// R3c 선행: 운영 D1 합성 S7 역할 케이스 8건의 기대 업종을 ['fnb'] → ['franchise','fnb']로 바꾼다(대표 승인 2026-09-26 16:15 UTC).
// 소유자로 로그인한 앱 페이지의 콘솔에 통째로 붙여 넣는다. 먼저 check(쓰기 없음), 맞으면 MODE를 apply로 바꿔 한 번 더. 되돌리기는 rollback.
// apply·rollback이 도는 동안 다른 탭·세션에서 평가 케이스를 고치지 않는다.
// 출력은 요약 JSON 한 줄뿐이다. 케이스 내용·금지 표현·사실 값·서버 오류 본문은 찍지 않는다.
(async()=>{
  const MODE='check';
  const SPEC_ID='syn-s7-franchise';
  const CAMPAIGN_ID='syn-s7-franchise-campaign';
  const FROM=['fnb'];
  const TO=['franchise','fnb'];
  const EXPECTED=8;
  const API='/api/eval';
  const OPTS={credentials:'same-origin',cache:'no-store'};
  // 그대로여야 하는 케이스 필드. expectations의 industry 밖 키는 restOf로 따로 본다.
  const FIELDS=['request','externalKey','specHash','set','label','source','generator','campaignId'];
  // 갱신 응답을 믿을 수 없을 때(5xx·응답 없음·읽을 수 없는 응답) 붙이는 말. 서버가 이미 썼을 수 있다.
  const MAYBE='이 건은 바뀌었을 수도 있습니다. 2분쯤 기다린 뒤 같은 MODE로 다시 실행하면 바뀐 건은 already로 세고 남은 건만 바꿉니다.';
  const s={target:EXPECTED,found:0,ignored:0,toChange:0,already:0,changed:0,changedIds:[],pendingIds:[],failed:[],verified:0};
  // 끝낼 때 한 줄만 찍고 돌려준다. reason은 멈췄을 때만 있다.
  const finish=reason=>{
    const out=reason?{mode:MODE,ok:false,reason,...s}:{mode:MODE,ok:true,...s};
    console.log(JSON.stringify(out));
    return out;
  };
  // 키를 정렬한 JSON(비교용). 배열 순서는 그대로 본다.
  const canon=v=>Array.isArray(v)?'['+v.map(canon).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}':JSON.stringify(v);
  const same=(a,b)=>canon(a)===canon(b);
  const restOf=e=>{const o={...e};delete o.industry;return canon(o)};
  // 처음 읽은 값(c)과 비교해 industry 밖 기대 판정과 FIELDS가 모두 같은지 본다.
  const kept=(k,c)=>restOf(k.expectations)===restOf(c.expectations)&&FIELDS.every(f=>same(k[f],c[f]));
  const read=async path=>{const res=await fetch(path,OPTS);return {status:res.status,body:res.ok?await res.json():null}};
  const readCase=id=>read(API+'?case='+encodeURIComponent(id));
  try{
    if(!['check','apply','rollback'].includes(MODE))return finish('MODE는 check·apply·rollback 중 하나여야 합니다. 아무것도 바꾸지 않았습니다.');
    // 방향: apply는 FROM → TO, rollback은 TO → FROM. check는 apply 방향으로 세기만 한다.
    const [src,dst]=MODE==='rollback'?[TO,FROM]:[FROM,TO];
    // 1) 찾기: 목록에서 S7 캠페인 행을 고른 뒤 한 건씩 전체를 읽는다(목록에는 externalKey·expectations가 없다).
    const list=await read(API);
    if(list.status===401||list.status===403)return finish('로그인하지 않았거나 소유자 세션이 아닙니다(HTTP '+list.status+'). 소유자로 로그인한 앱 페이지에서 다시 실행하세요.');
    if(!list.body)return finish('평가 목록을 읽지 못했습니다(HTTP '+list.status+'). 아무것도 바꾸지 않았습니다.');
    const cases=[];
    for(const row of list.body.cases.filter(c=>c.campaignId===CAMPAIGN_ID)){
      const one=await readCase(row.id);
      if(!one.body)return finish('케이스를 읽지 못했습니다(HTTP '+one.status+'). 아무것도 바꾸지 않았습니다.');
      const c=one.body;
      // S7 합성 역할 케이스만 대상이다. 같은 캠페인의 다른 행은 세기만 하고 건드리지 않는다.
      if(c.source==='synthetic'&&(c.kind||'role')==='role'&&typeof c.externalKey==='string'&&c.externalKey.startsWith(SPEC_ID+':'))cases.push(c);
      else s.ignored++;
    }
    s.found=cases.length;
    if(cases.length!==EXPECTED)return finish('S7 합성 역할 케이스가 '+EXPECTED+'건이어야 하는데 '+cases.length+'건입니다. 아무것도 바꾸지 않았습니다.');
    // 2) 전제: 첫 쓰기 전에 전부 본다. 바꿀 건(src)과 이미 바뀐 건(dst)만 있어야 하고, 진행 중 평가 실행이 쓰면 안 된다.
    const todo=cases.filter(c=>same(c.expectations.industry,src));
    const done=cases.filter(c=>same(c.expectations.industry,dst));
    s.toChange=todo.length;s.already=done.length;s.pendingIds=todo.map(c=>c.id);
    const odd=cases.length-todo.length-done.length;
    if(odd)return finish('기대 업종이 바꾸기 전 값도 바꾼 뒤 값도 아닌 케이스가 '+odd+'건 있습니다. 아무것도 바꾸지 않았습니다.');
    const ids=new Set(cases.map(c=>c.id));
    const busy=list.body.runs.filter(r=>['queued','running'].includes(r.status)&&(r.caseIds||[]).some(id=>ids.has(id)));
    if(busy.length)return finish('진행 중(queued·running) 평가 실행 '+busy.length+'건이 S7 케이스를 쓰고 있습니다. 끝나거나 취소된 뒤 다시 실행하세요. 아무것도 바꾸지 않았습니다.');
    if(MODE==='check'){s.verified=done.length;return finish()}
    // 3) 한 건씩 바꾼다. 쓰기 직전에 다시 읽고, 쓴 뒤 응답을 확인한다. 이상하면 그 자리에서 멈춘다(재시도하지 않는다).
    for(const c of todo){
      // 처음 읽은 뒤 이 케이스가 바뀌었으면(다른 탭·세션의 수정) 쓰지 않는다. 서버에 버전 확인이 없어 틈을 줄일 뿐 닫지는 못한다.
      const now=await readCase(c.id);
      if(!now.body)return finish('쓰기 직전 케이스를 읽지 못해 멈췄습니다(HTTP '+now.status+'). pendingIds 첫 건은 쓰지 않았습니다. 같은 MODE로 다시 실행하면 남은 건만 바꿉니다.');
      const f=now.body;
      if(!same(f.expectations.industry,src)||!kept(f,c))return finish('처음 읽은 뒤 pendingIds 첫 건이 바뀌어 쓰지 않고 멈췄습니다. 다른 탭·세션의 평가 케이스 수정을 끝낸 뒤 같은 MODE로 다시 실행하세요.');
      // industry만 바꾼다. facts 키는 뺀다: 빼면 서버가 저장된 사실 원장을 그대로 쓰고, null을 보내면 원장이 지워진다.
      const expectations={...f.expectations,industry:dst};
      delete expectations.facts;
      let res,next=null;
      try{
        res=await fetch(API,{...OPTS,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_case',id:c.id,expectations})});
      }catch{
        s.failed.push({id:c.id,status:0});
        return finish('갱신 응답을 받지 못해 멈췄습니다. '+MAYBE);
      }
      // 5xx는 서버가 쓴 뒤일 수 있다(쓴 뒤 잠금 해제 실패, 프록시 오류). 4xx는 서버가 쓰기 전에 거부한 것이다.
      if(res.status>=500){
        s.failed.push({id:c.id,status:res.status});
        return finish('갱신 응답이 서버 오류입니다(HTTP '+res.status+'). '+MAYBE);
      }
      if(!res.ok){
        s.failed.push({id:c.id,status:res.status});
        return finish('갱신이 거부돼 멈췄습니다(HTTP '+res.status+'). 이 건은 바뀌지 않았습니다. 원인을 확인한 뒤 같은 MODE로 다시 실행하면 남은 건만 바꿉니다.');
      }
      try{next=await res.json()}catch{next=null}
      if(!next||!next.expectations){
        s.failed.push({id:c.id,status:res.status});
        return finish('갱신 응답을 읽지 못해 멈췄습니다(HTTP '+res.status+'). '+MAYBE);
      }
      if(!same(next.expectations.industry,dst)||restOf(next.expectations)!==restOf(f.expectations)){
        s.failed.push({id:c.id,status:res.status});
        return finish('갱신 응답의 기대 판정이 예상과 달라 멈췄습니다. 이 결과를 레인 R에 붙여 넣으세요.');
      }
      s.changed++;s.changedIds.push(c.id);s.pendingIds=s.pendingIds.filter(id=>id!==c.id);
    }
    // 4) 8건을 다시 읽어 확인한다: 업종은 목표 값, 나머지 기대 판정·요청·키·해시는 처음 읽은 값과 같아야 한다.
    for(const c of cases){
      const k=(await readCase(c.id)).body;
      if(k&&same(k.expectations.industry,dst)&&kept(k,c))s.verified++;
    }
    if(s.verified!==EXPECTED)return finish('다시 읽은 '+EXPECTED+'건 중 '+s.verified+'건만 확인됐습니다. 이 결과를 레인 R에 붙여 넣으세요.');
    return finish();
  }catch(e){
    return finish('예상하지 못한 오류로 멈췄습니다(오류 종류 '+(e&&e.name||'알 수 없음')+'). 이 결과를 레인 R에 붙여 넣으세요.');
  }
})();
```
<!-- s7-snippet:end -->

## 예상 출력 모양
출력은 JSON 한 줄이다. 케이스 id(무작위 UUID)와 건수, HTTP 상태만 있다. 요청 본문·브랜드 이름·사실 값·금지 표현·업종 값·서버 오류 본문·소유자 계정은 없다.

<!-- s7-keys:start -->
| 키 | 뜻 |
|---|---|
| `mode` | 실행한 MODE(check·apply·rollback) |
| `ok` | 끝까지 확인됐으면 true. 멈췄으면 false |
| `reason` | 멈춘 이유(한국어). `ok`가 false일 때만 있다 |
| `target` | 기대 건수 8 |
| `found` | 찾은 S7 합성 역할 케이스 수 |
| `ignored` | 같은 캠페인이지만 대상이 아닌 행 수(건드리지 않음) |
| `toChange` | 이번 방향으로 바꿀 건수 |
| `already` | 이미 목표 값인 건수(쓰지 않음) |
| `changed` | 이번 실행에서 바꾼 건수 |
| `changedIds` | 이번 실행에서 바꾼 케이스 id |
| `pendingIds` | 아직 목표 값으로 확인되지 않은 케이스 id(check는 바꿀 예정인 id). 멈췄으면 첫 id가 멈춘 건이다 |
| `failed` | 실패한 갱신의 `{id, status}`. 4xx는 쓰기 전 거부(그 건은 그대로). 5xx·0(응답 없음)·응답을 읽지 못한 200은 바뀌었을 수도 있음 |
| `verified` | 목표 값으로 확인된 건수. apply·rollback은 쓴 뒤 다시 읽어 확인한 수, check는 읽은 그대로의 수 |
<!-- s7-keys:end -->

<!-- s7-output:start -->
apply 성공(첫 실행):
```json
{"mode":"apply","ok":true,"target":8,"found":8,"ignored":0,"toChange":8,"already":0,"changed":8,"changedIds":["id-1","id-2","id-3","id-4","id-5","id-6","id-7","id-8"],"pendingIds":[],"failed":[],"verified":8}
```

apply 중간 멈춤(4번째 갱신이 HTTP 500):
```json
{"mode":"apply","ok":false,"reason":"갱신 응답이 서버 오류입니다(HTTP 500). 이 건은 바뀌었을 수도 있습니다. 2분쯤 기다린 뒤 같은 MODE로 다시 실행하면 바뀐 건은 already로 세고 남은 건만 바꿉니다.","target":8,"found":8,"ignored":0,"toChange":8,"already":0,"changed":3,"changedIds":["id-1","id-2","id-3"],"pendingIds":["id-4","id-5","id-6","id-7","id-8"],"failed":[{"id":"id-4","status":500}],"verified":0}
```
<!-- s7-output:end -->

- 기대 값: check(처음) `ok` true·`toChange` 8·`already` 0·`verified` 0. apply(처음) `changed` 8·`verified` 8. apply(두 번째) `changed` 0·`already` 8·`verified` 8. rollback `changed` 8·`verified` 8.

## 멈춤 조건
모두 멈추면 `ok` false와 `reason`을 찍는다. 재시도하지 않는다. 출력에는 서버 오류 본문을 넣지 않는다. HTTP 상태만 넣는다.

첫 쓰기 전(쓰기 0):
- MODE가 check·apply·rollback이 아니다.
- 목록 읽기가 401·403이다(비로그인·소유자 아님). 그 밖의 목록·케이스 읽기 실패. JSON이 아닌 응답(로그인 화면 등)은 '예상하지 못한 오류'로 멈춘다.
- 찾은 S7 합성 역할 케이스가 8건이 아니다(7건·9건 모두).
- 기대 업종이 바꾸기 전 값도 바꾼 뒤 값도 아닌 케이스가 1건이라도 있다(예: `['education']`, 문자열 `'fnb'`, 순서가 바뀐 `['fnb','franchise']`, `['fnb','education']`). 업종 목록은 [주 업종, ...허용 업종] 순서가 뜻을 가진다.
- 진행 중(queued·running) 평가 run이 S7 케이스를 하나라도 쓴다. check도 이것을 본다. 끝난 run과 S7 케이스를 쓰지 않는 run은 막지 않는다.

쓰는 도중(그 자리에서 멈춤):
- 쓰기 직전 다시 읽은 값이 처음 읽은 값과 다르다(업종, 업종 밖 기대 판정, 요청·키·해시 등). 또는 그 읽기가 실패했다. 그 건은 쓰지 않았다. `pendingIds` 첫 id가 그 건이다.
- 갱신 응답이 4xx다(이 라우트는 400·401·403·404·409·413을 낸다). 서버가 쓰기 전에 거부했다. 그 건은 바뀌지 않았다. 409는 진행 중 run이 끼어들었거나, 같은 워크스페이스의 다른 쓰기(다른 탭·앱 화면 저장·백그라운드 작업)와 잠금이 겹친 것이다.
- 갱신 응답이 5xx다. 그 건은 바뀌었을 수도 있다. 서버는 저장한 뒤에도 5xx를 낼 수 있다(쓴 뒤 잠금 해제 실패, 프록시 오류). 2분쯤 기다린 뒤 같은 MODE로 다시 실행하면 바뀐 건은 `already`로 센다.
- 응답 없이 끊겼다(`status` 0). 또는 2xx인데 응답을 읽지 못했다(잘린 본문, expectations가 없는 본문). 그 건은 바뀌었을 수도 있다. 다시 실행하면 `already`로 센다.
- 응답의 기대 판정이 예상과 다르다(업종이 목표 값이 아니거나 업종 밖 키가 달라짐).

쓴 뒤:
- 다시 읽은 8건 중 확인되지 않은 건이 있다. 업종, 업종 밖 기대 판정, 그리고 `request`·`externalKey`·`specHash`·`set`·`label`·`source`·`generator`·`campaignId`를 처음 읽은 값과 비교한다. 쓰기가 없던 두 번째 apply도 같다(확인 기준은 8건 고정).

## 되돌리기
- `const MODE='rollback';`으로 실행한다. 방향이 거울이다: `['franchise','fnb']`인 건을 `['fnb']`로 바꾸고, 이미 `['fnb']`인 건은 `already`로 센다. 그 밖의 값이면 멈춘다. 다른 전제·확인은 apply와 같다.
- 되돌린 뒤 expectations는 가져온 원본과 JSON이 바이트까지 같다(테스트 g절).
- `expectationsUpdatedAt`·`updatedAt`은 되돌린 시각으로 남는다(서버 기록). 원래 없던 값으로 돌리지 않는다.
- R3c 사전을 게시한 뒤에 되돌리면 S7 가맹 모집 표현이 새 fail이 된다. R3c 게시 뒤에는 되돌리지 않는다.

## 실행 기록
대기: 소유자 세션 실행 전(not_run).

| 단계 | 결과 | 근거 |
|---|---|---|
| check | not_run | 소유자 세션 실행 전 |
| apply | not_run | 소유자 세션 실행 전 |
| 두 번째 check(확인) | not_run | 소유자 세션 실행 전 |

## 검사 근거
- `node --experimental-vm-modules tests/r3c-s7-industry.test.mjs` — passed · mocked (180/180 검사). 문서의 스니펫을 그대로 꺼내 실제 `/api/eval` 라우트(메모리 SQLite, 로컬 인증 헤더 주입, fetch 심)에 대고 돌렸다. 데이터는 실제 스펙 `syn-s7-franchise`(8건)과 구경꾼 `syn-s2-bakery`(15건)를 생성기로 만들어 가져왔다. 외부 네트워크 0회.
  - a check 쓰기 0 · b apply가 S7 8건의 industry만 바꿈(나머지 바이트 동일, S2 바이트 동일, facts 키 없음) · c 두 번째 apply 쓰기 0 · d 쓰기 0 멈춤과 막지 않는 것 · e 섞인 상태 · f 4번째 갱신 실패 8종 뒤 재실행 · f-2 응답 이상 · f-3 쓰기 직전 다시 읽기 · f-4 쓴 뒤 다시 읽기 · g rollback과 그 전제 · h 출력 · i 채점기 동등성 · j 이 문서의 출력 모양·키 표·멈춤 예시 문구.
  - d 멈춤: queued·running run(check 포함), 업종 `['education']`·문자열 `'fnb'`·`['fnb','franchise']`·`['fnb','education']`, 7건·9건, 401·403, 목록 500, 케이스 404, JSON이 아닌 200, 잘못된 MODE. 막지 않는 것: 끝난 run, S7을 쓰지 않는 queued run, 같은 캠페인의 다른 키(`syn-s7-franchise-v2:` 포함)·수동·회의 단계 행(`ignored`).
  - f: 4xx 2종(진행 중 run의 실제 409, 본문에 내용을 담은 모의 409)은 '바뀌지 않았다'로 알리고 D1에서도 그대로다. 5xx·응답 없음·읽을 수 없는 응답 6종(라우트 전 500, 쓴 뒤 502, 쓴 뒤 잠금 해제 실패 500, 응답 잃음, 잘린 200, expectations 없는 200)은 '바뀌었을 수도'로 알린다. 쓴 뒤 실패 5종은 D1에 그 건이 쓰여 있다. 잠금 해제 실패 뒤 곧바로 다시 실행하면 실제 409(잠금 충돌)로 쓰기 없이 멈추고, 잠금이 만료되면 끝난다. 8종 모두 다시 apply하면 `verified` 8이다.
  - f-2: 응답의 업종 밖 키가 달라짐, 응답의 업종이 목표 값이 아님. f-3: 실제 동시 편집(두 번째 건 쓰기 직전에 소유자가 금지 표현 하나를 더함)이면 그 건을 쓰지 않고 멈추고, 더한 금지 표현이 남는다. 다시 실행하면 그것을 지키며 끝난다. 쓰기 직전 읽기의 업종·해시·금지 표현 어긋남과 404도 그 건을 쓰지 않는다. f-4: 쓴 뒤 다시 읽기에서 `request`·`externalKey`·`specHash`·`set`·`label`·`source`·`generator`·`campaignId`·업종·금지 표현 중 하나만 달라도 `ok` false, `verified` 7이다. 쓰기 없는 두 번째 apply도 같다.
  - h: 모든 실행이 한 줄만 찍는다. 출력에 S7 내용·스펙 문자열·업종 값·소유자 id·이메일·서버 오류 본문·`= ? & %`가 없다.
  - 모의 부분: 403, 목록 500, 케이스 404, JSON이 아닌 200, POST의 모의 409 본문·500·502·응답 잃음·잘린 본문·expectations 없는 본문·응답 이상, 잠금 해제 실패(런타임 훅이 D1 DELETE를 던지게 함, 라우트의 거부를 Next.js처럼 500으로 바꿈), 쓰기 직전·쓴 뒤 읽기 어긋남은 fetch 심·런타임 훅이 만든 것이다. 회의 단계 행은 저장 행을 직접 넣었다. 401, 진행 중 run의 409, 남은 잠금의 409, 동시 편집(실제 update_case), 나머지 읽기·갱신은 실제 라우트 응답이다.
  - 변이 확인: 스니펫 변이 41개를 하나씩 넣고 이 검사를 돌렸다. 41개 모두 검사가 실패했다(로컬에서 확인, 커밋하지 않음). 대상: 진행 중 run 검사(check 순서, 과잉 차단), 업종 비교(순서 무시, 포함 관계), 키 접두어의 `:`, 응답 확인(업종, 업종 밖 키), 쓰기 직전 다시 읽기(통째로, 업종, 업종 밖 키·필드, 읽기 실패), 쓴 뒤 다시 읽기(업종, 업종 밖 키, 필드 8개 각각), 확인 기준 8건 고정, 4xx·5xx·응답 없음·읽을 수 없는 응답의 분류, 5xx 뒤 계속 쓰기, `facts`(null로 보냄, 그대로 보냄), 출력(오류 메시지·스택, 서버 본문, 소유자), rollback 방향, check의 쓰기 금지.
- 운영 실행: not_run(위 실행 기록).
