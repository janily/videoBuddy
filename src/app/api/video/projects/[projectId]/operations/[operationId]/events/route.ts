import{StreamEventSchema}from'@/contracts/video/commands';
import{requestOwner}from'@/services/video/access/session';
import{projectService,errorResponse}from'@/services/video/http/route-utils';
import{parseCursor}from'@/services/video/stream/sse-parser';
import{LocalEventLog}from'@/services/video/stream/local-event-log';
export const runtime='nodejs';export const maxDuration=300;
export async function GET(request:Request,{params}:{params:Promise<{projectId:string;operationId:string}>}){try{
 const projects=projectService(),{projectId,operationId}=await params;await projects.access(requestOwner(request),projectId);
 const op=(await projects.store.readFresh<{canonicalRunId?:string;streamEpoch:number}>(`projects/${projectId}/operations/${operationId}`)).value;
 if(!op.canonicalRunId)return Response.json({error:{code:'OPERATION_NOT_STARTED',message:'任务尚未开始，可用原请求恢复。',retryable:true,requestId:crypto.randomUUID()}},{status:409,headers:{'Cache-Control':'private,no-store'}});
 const raw=request.headers.get('last-event-id')||new URL(request.url).searchParams.get('cursor'),cursor=raw?parseCursor(raw):null;
 if(cursor&&cursor.epoch!==op.streamEpoch)return Response.json({reset:true,epoch:op.streamEpoch},{status:409,headers:{'Cache-Control':'private,no-store'}});
 const events=new LocalEventLog(process.env.VIDEO_DATA_DIR!),startIndex=cursor?cursor.index+1:0;
 if(cursor&&cursor.index>await events.tailIndex(projectId,operationId))throw Error('CURSOR_INVALID');
 const reader=events.follow(projectId,operationId,startIndex).getReader(),encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({async start(controller){let closed=false;
  const close=()=>{if(!closed){closed=true;controller.close();void reader.cancel()}};
  const heartbeat=setInterval(()=>{if(!closed)controller.enqueue(encoder.encode(': heartbeat\n\n'))},15000);
  const rotate=setTimeout(close,240000);request.signal.addEventListener('abort',close,{once:true});
  try{for(;;){const{done,value}=await reader.read();if(done||closed)break;const event=StreamEventSchema.parse(value.event);
   if(event.projectId!==projectId||event.operationId!==operationId||event.epoch!==op.streamEpoch)throw Error('STREAM_INVALID');
   controller.enqueue(encoder.encode(`id: ${op.streamEpoch}:${value.index}\nevent: video\ndata: ${JSON.stringify(event)}\n\n`));
  }}catch{close()}finally{clearInterval(heartbeat);clearTimeout(rotate);request.signal.removeEventListener('abort',close);close()}
 },cancel(){return reader.cancel()}});
 return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private,no-store,no-transform','X-Accel-Buffering':'no'}});
}catch(error){return errorResponse(error)}}
