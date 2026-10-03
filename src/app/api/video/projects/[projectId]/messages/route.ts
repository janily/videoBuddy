import {SendMessageRequestSchema}from '@/contracts/video/commands';
import {requestOwner}from '@/services/video/access/session';
import {body,writeAccess,projectService,json,errorResponse}from '@/services/video/http/route-utils';
import {requireGeneration}from '@/services/video/config/environment';
import {CommandService}from '@/services/video/commands/submit';
import {createOrRead,updateJson}from '@/services/video/storage/atomic-store';
import {canonicalHash}from '@/services/video/domain/hash';
import {ProjectControl}from '@/contracts/video/project';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {assertWorkerReady} from '@/services/video/commands/worker-heartbeat';
type Context={params:Promise<{projectId:string}>};
export async function GET(request:Request,{params}:Context){try{const projects=projectService(),control=await projects.access(requestOwner(request),(await params).projectId);const url=new URL(request.url);const limit=Number(url.searchParams.get('limit')||50),before=Number(url.searchParams.get('beforeOrdinal')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(before)||before<1)throw Error('VALIDATION_FAILED');const all=(await projects.messages(control)).filter(m=>m.ordinal<before);const page=all.slice(-limit);return json({messages:page,nextBeforeOrdinal:all.length>page.length?page[0].ordinal:null})}catch(e){return errorResponse(e)}}
export async function POST(request:Request,{params}:Context){try{
 const scope=writeAccess(request),input=await body(request,SendMessageRequestSchema),projects=projectService(),{projectId}=await params;
 const control=await projects.access(scope,projectId);requireGeneration();await assertWorkerReady(process.env.VIDEO_DATA_DIR!);
 if(new Set(input.attachmentIds).size!==input.attachmentIds.length||input.attachmentIds.some(id=>!control.assets.some(asset=>asset.id===id&&asset.status==='ready'&&asset.analysisRef)))throw Error('ASSET_INVALID');
 const {clientCommandId,...semantic}=input;const canonical=await createOrRead(projects.store,`projects/${projectId}/client-messages/${input.clientMessageId}`,{hash:canonicalHash(semantic),body:input});if(canonical.hash!==canonicalHash(semantic))throw Error('IDEMPOTENCY_CONFLICT');
 const service=new CommandService(projects.store,async(p,operationId,kind)=>{
  const key=`projects/${p}/control`;
  const c=await updateJson(projects.store,key,(c:ProjectControl)=>{if(c.deletedAt||c.ownerKeyHash!==scope)throw Error('ACCESS_NOT_FOUND');if(!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED');if(c.ordinalReservations[operationId])return c;return{...c,controlVersion:c.controlVersion+1,nextOrdinal:c.nextOrdinal+2,ordinalReservations:{...Object.fromEntries(Object.entries(c.ordinalReservations).slice(-127)),[operationId]:{user:c.nextOrdinal,assistant:c.nextOrdinal+1}}}});
  const candidate=crypto.randomUUID();const op=await updateJson(projects.store,`projects/${p}/operations/${operationId}`,(o:{userMessageId?:string})=>({...o,userMessageId:o.userMessageId||candidate}));
  await projects.archiveMessage(p,{id:op.userMessageId,ordinal:c.ordinalReservations[operationId].user,role:'user',text:canonical.body.text,attachmentIds:canonical.body.attachmentIds,...(canonical.body.target!==undefined?{target:canonical.body.target}:{}),status:'completed',contentVersion:1,clientMessageId:canonical.body.clientMessageId,operationId});
  if(kind!=='chat')throw Error('CAPABILITY_UNAVAILABLE');await new LocalOperationQueue(projects.store,process.env.VIDEO_DATA_DIR!).enqueue(p,operationId,kind);return{runId:operationId};
 });
 const receipt=await service.submit(projectId,'chat',canonical.body);void clientCommandId;return json(receipt,202);
}catch(e){return errorResponse(e)}}
