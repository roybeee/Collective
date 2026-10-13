import {MetaLine} from '@/components/app/meta-line';
import {Note} from '@/components/app/note';
import type {BrowserDevice,BrowserJob} from '@/lib/store-browser';
import {WeeklyScheduleView} from './store-browser-weekly';

const publicStates={not_checked:'공개 화면 확인 전',pending:'공개 반영 확인 대기',matched:'공개 화면 일치',different:'공개 화면과 다름',unavailable:'공개 화면 확인 불가'};
export function StoreBrowserDeviceHealth({device}:{device:BrowserDevice}){
 const h=device.health;
 return <div><p>마지막 상태 보고: {device.lastSeenAt||'보고 전'}</p>{h?<p><MetaLine items={[h.process==='ready'?'실행 프로그램 응답':'실행 프로그램 오류',h.browser==='ready'?'브라우저 접속 가능':h.browser==='blocked'?'브라우저 접근 차단':'브라우저 연결 끊김',h.auth==='ready'?'로그인 확인':h.auth==='login_required'?'로그인 필요':h.auth==='captcha'?'본인 확인 필요':'로그인 확인 전']}/></p>:<p>실행 프로그램·브라우저·로그인 상태 확인 전입니다.</p>}{h?.note&&<p>{h.note}</p>}<Note>마지막 보고 기준의 상태입니다. 실제 네이버 화면을 확인하기 전에는 작업 성공 여부를 알 수 없습니다.</Note></div>;
}

export function StoreBrowserPublicReadback({job}:{job:BrowserJob}){
 const result=job.publicReadback;
 return <div><b>{publicStates[result?.state||'not_checked']}</b>{result?.note&&<p>{result.note}</p>}{result?.evidence&&<><p><MetaLine items={[result.evidence.source==='real'?'실제 공개 화면 근거':'모의 공개 화면 근거',result.evidence.capturedAt]}/></p>{result.evidence.note&&<p>{result.evidence.note}</p>}{result.evidence.schedule?<WeeklyScheduleView schedule={result.evidence.schedule}/>:['read_hours','change_hours'].includes(job.type)&&result.evidence.hours&&<p className="whitespace-pre-wrap">{result.evidence.hours}</p>}</>}<p>관리 화면 저장 확인과 공개 플레이스 반영은 각각 확인합니다.</p></div>;
}
