import {start,getRun}from 'workflow/api';
import {directorTurnWorkflow}from './director-turn';
export async function startOperation(projectId:string,operationId:string,kind:string){if(kind!=='chat')throw Error('CAPABILITY_UNAVAILABLE');const run=await start(directorTurnWorkflow,[projectId,operationId]);return{runId:run.runId}}
export function operationStream(runId:string,startIndex:number){return getRun(runId).getReadable({startIndex})}
