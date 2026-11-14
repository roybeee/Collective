// 연속 실행 중 지시 추가(벤치마크 P14). 사용자가 연속 실행 도중 남긴 지시를 run_instruction 기록으로 추가만 하고,
// 그 연속 실행(같은 startedAt)에서 다음에 시작하는 담당 실행 입력부터 addedInstructions로 싣는다(lib/role-instruction.ts). 지금 실행 중인 담당은 이미 제출됐으므로 바뀌지 않는다.
// 연속 실행이 진행 중이 아니거나(멈춤·완료·막힘) 브리프 판이 바뀌면 싣지 않는다. 지시가 없으면 요청에 키가 없어 이전과 바이트 동일하다.
import {ApiError,database,readRecord,listRecords,recordStatement,eventStatement,stamp,uid,str,type EventActor} from './server';
import type {CampaignSequence} from './campaign-sequence';
import {cleanInstruction,INSTRUCTION_MAX_CHARS,INSTRUCTION_MAX_COUNT,type AddedInstruction} from './meeting-instructions';

export type RunInstruction=AddedInstruction&{campaignId:string;campaignVersion:number;sequenceStartedAt:string};
async function sequenceOf(owner:string,campaignId:string):Promise<CampaignSequence|null>{
 try{return await readRecord<CampaignSequence>(owner,'campaign_sequence',campaignId)}
 catch(error){if(error instanceof ApiError&&error.status===404)return null;throw error}
}
const ofSequence=(rows:readonly RunInstruction[],s:CampaignSequence)=>rows.filter(r=>r.sequenceStartedAt===s.startedAt&&r.campaignVersion===s.campaignVersion).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
// 화면 표시용: 지금(또는 마지막) 연속 실행에 추가된 지시. 연속 실행 기록이 없으면 빈 목록.
export async function runInstructions(owner:string,campaignId:string):Promise<RunInstruction[]>{
 const s=await sequenceOf(owner,campaignId);
 return s?ofSequence(await listRecords<RunInstruction>(owner,'run_instruction',campaignId),s):[];
}
// 역할 요청 조립용: 진행 중 연속 실행의 지시만. 연속 실행이 없으면 기록을 읽지 않는다.
export async function pendingRunInstructions(owner:string,campaignId:string,campaignVersion:number):Promise<RunInstruction[]>{
 const s=await sequenceOf(owner,campaignId);
 if(!s||s.status!=='running'||s.campaignVersion!==campaignVersion)return [];
 return ofSequence(await listRecords<RunInstruction>(owner,'run_instruction',campaignId),s);
}
export async function addRunInstruction(owner:string,input:Record<string,unknown>,by?:EventActor):Promise<{instruction:RunInstruction;instructions:RunInstruction[]}>{
 const campaignId=str(input.campaignId,'캠페인',100,true),s=await sequenceOf(owner,campaignId);
 if(!s||s.status!=='running')throw new ApiError(409,'진행 중인 연속 실행에만 지시를 추가할 수 있습니다.');
 const text=cleanInstruction(input.text);if(!text)throw new ApiError(400,`추가 지시는 1~${INSTRUCTION_MAX_CHARS}자로 적어 주세요.`);
 const existing=ofSequence(await listRecords<RunInstruction>(owner,'run_instruction',campaignId),s);
 if(existing.length>=INSTRUCTION_MAX_COUNT)throw new ApiError(409,`한 연속 실행에 지시는 ${INSTRUCTION_MAX_COUNT}개까지 추가할 수 있습니다.`);
 const active=await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND role<>'meeting' AND status IN ('starting','queued','in_progress','uncertain') ORDER BY created_at DESC LIMIT 1").bind(owner,campaignId).first<{id:string}>();
 const instruction:RunInstruction={id:uid(),text,createdAt:stamp(),afterStepId:active?.id??null,campaignId,campaignVersion:s.campaignVersion,sequenceStartedAt:s.startedAt,...(by?{by:{id:by.id,email:by.email}}:{})};
 await database().batch([recordStatement(owner,'run_instruction',instruction.id,instruction,campaignId),eventStatement(owner,campaignId,'연속 실행 중 지시를 추가했습니다. 다음 담당 실행 입력부터 반영합니다.',by)]);
 return {instruction,instructions:[...existing,instruction]};
}
