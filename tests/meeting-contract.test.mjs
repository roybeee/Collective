import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const runtime=testRuntime(async()=>{throw new Error('No provider calls in parser tests');});
const {parseMeetingOutput,publicMeeting,meetingMarkdown}=await runtime.load('lib/meetings.ts');
const previous={id:'m:discussion:cmo',phase:'discussion',role:'cmo',status:'completed'};
const current={id:'m:discussion:insight',phase:'discussion',role:'insight',status:'running'};
const valid={position:'진단',evidence:'자료 필요',challenge:'선행 가설의 한계',proposal:'현장 검증',respondsTo:[previous.id]};
const checks=[];
function check(name,fn){fn();checks.push(name);}
check('first discussion accepts empty references',()=>assert.equal(parseMeetingOutput(JSON.stringify({...valid,respondsTo:[]}),previous,[]).respondsTo.length,0));
check('later discussion accepts prior completed discussion',()=>assert.equal(parseMeetingOutput(JSON.stringify(valid),current,[previous,current]).respondsTo[0],previous.id));
check('duplicate valid references are deduplicated',()=>assert.equal(parseMeetingOutput(JSON.stringify({...valid,respondsTo:[previous.id,previous.id]}),current,[previous]).respondsTo.length,1));
for(const [name,value] of [['missing',undefined],['empty',[]],['not array',previous.id],['unknown',['secret-provider-value']],['self',[current.id]],['wrong type',[4]],['cross meeting',['other:discussion:cmo']]]){
 check(name+' reference rejects with safe field diagnostic',()=>assert.throws(()=>parseMeetingOutput(JSON.stringify({...valid,respondsTo:value}),current,[previous,current]),e=>e.message.includes('respondsTo')&&!e.message.includes('secret-provider-value')));
}
check('future completed discussion is not accepted',()=>assert.throws(()=>parseMeetingOutput(JSON.stringify({...valid,respondsTo:['m:discussion:strategy']}),current,[previous,current,{id:'m:discussion:strategy',role:'strategy',phase:'discussion',status:'completed'}]),/respondsTo/));
check('completed revisions are not valid references',()=>assert.throws(()=>parseMeetingOutput(JSON.stringify({...valid,respondsTo:['revision-id']}),current,[previous,{id:'revision-id',role:'content',phase:'revision',status:'completed'}]),/respondsTo/));
check('incomplete previous discussions are not references',()=>assert.throws(()=>parseMeetingOutput(JSON.stringify(valid),current,[{...previous,status:'failed'}]),/respondsTo/));
const failed={...current,status:'failed',attempt:1,failureKind:'invalid_output',providerId:'private-provider-current',raw:'private-raw-current',error:'respondsTo: 배열이 필요합니다.',tokens:45,attempts:[{attempt:0,status:'failed',providerId:'private-provider-old',raw:'private-raw-old',error:'응답 형식 오류',tokens:25}]};
const meeting={id:'m',agenda:'제품 사실과 위치 전략',status:'failed',createdAt:'2026-09-23T00:00:00Z',stopRequested:false,steps:[{...previous,output:valid,tokens:100},failed],snapshot:{artifacts:[],secret:'private-snapshot'}};
check('public diagnostics redact current and historical raw provider data',()=>{const serialized=JSON.stringify(publicMeeting(meeting));assert.ok(!serialized.includes('private-'));assert.ok(serialized.includes('respondsTo'));});
check('export includes failed phase diagnostics attempts and known usage',()=>{const exported=meetingMarkdown(publicMeeting(meeting));assert.ok(exported.includes('상태: failed'));assert.ok(exported.includes('respondsTo'));assert.ok(exported.includes('시도 1: failed · 토큰 25'));assert.ok(exported.includes('시도 2: failed · 토큰 45'));assert.ok(!exported.includes('private-'));});
check('provider failure is not offered as domain repair',()=>assert.equal(publicMeeting({...meeting,steps:[{...failed,failureKind:'provider_failed'}]}).steps[0].retryAvailable,false));
check('legacy valid raw result is not offered as domain repair',()=>assert.equal(publicMeeting({...meeting,steps:[{...failed,failureKind:undefined,raw:JSON.stringify({...valid,respondsTo:[]})}]}).steps[0].retryAvailable,false));
check('cancelled meeting never offers repair',()=>assert.equal(publicMeeting({...meeting,status:'cancelled'}).steps[1].retryAvailable,false));
console.log(JSON.stringify({passed:checks.length,checks},null,2));
