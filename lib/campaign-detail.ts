import type {Artifact,Campaign,Event,Metric,Run} from './agency';
import {database,listRecords,readRecord} from './server';

export type ArtifactVersion=Artifact & {originalId?:string};
export type CampaignSequence={campaignId:string;status:'running'|'paused'|'completed'|'blocked';error?:string};
export type CampaignDetail={campaign:Campaign;artifacts:Artifact[];history:ArtifactVersion[];metrics:Metric[];events:Event[];runs:Run[]};
const activeStatuses="('starting','queued','in_progress','uncertain')";
const runColumns='id,campaign_id AS campaignId,role,status,error,created_at AS createdAt,model,tokens';

// Active work must never disappear behind a history limit.
export async function campaignRuns(owner:string,campaignId?:string){
 const scope=campaignId?'owner=? AND campaign_id=?':'owner=?';
 const values=campaignId?[owner,campaignId]:[owner];
 const db=database();
 const [active,recent]=await Promise.all([
  db.prepare(`SELECT ${runColumns} FROM jobs WHERE ${scope} AND status IN ${activeStatuses} ORDER BY created_at DESC`).bind(...values).all<Run>(),
  db.prepare(`SELECT ${runColumns} FROM jobs WHERE ${scope} AND status NOT IN ${activeStatuses} ORDER BY created_at DESC,id DESC LIMIT 200`).bind(...values).all<Run>(),
 ]);
 return [...active.results,...recent.results];
}

export async function campaignDetail(owner:string,id:string):Promise<CampaignDetail>{
 const campaign=await readRecord<Campaign>(owner,'campaign',id);
 const [artifacts,history,metrics,events,runs]=await Promise.all([
  listRecords<Artifact>(owner,'artifact',id),
  listRecords<ArtifactVersion>(owner,'history',id),
  listRecords<Metric>(owner,'metric',id),
  listRecords<Event>(owner,'event',id),
  campaignRuns(owner,id),
 ]);
 return {campaign,artifacts,history:history.toSorted((a,b)=>(a.originalId||a.id).localeCompare(b.originalId||b.id)||b.version-a.version),metrics,events,runs};
}
