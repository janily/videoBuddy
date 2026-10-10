import {createRemoteRuntime,type OperationScope} from './remote';
/** Confirmation comes from the isolated service after every owned native job exits. */
export async function confirmOperationStopped(_root:string,env:Record<string,string|undefined>,scope:OperationScope):Promise<boolean>{
 if(!env.VIDEO_RENDER_SOCKET)return false;
 try{const runtime=await createRemoteRuntime(env.VIDEO_RENDER_SOCKET);try{await runtime.quiesce(scope);return true}finally{await runtime.close()}}catch{return false}
}
