import {createRemoteRuntime,type OperationScope} from './remote';
import type {MediaRuntime} from './runtime';
/** Production never evaluates scenes in the model worker's process environment. */
export async function createMediaRuntime(root:string,env:Record<string,string|undefined>=process.env,scope?:OperationScope):Promise<MediaRuntime>{
 if(env.VIDEO_RENDER_SOCKET)return createRemoteRuntime(env.VIDEO_RENDER_SOCKET,scope);
 if(env.NODE_ENV==='production')throw Error('RENDER_SERVICE_UNAVAILABLE');
 const {createLocalRuntime}=await import('./local');return createLocalRuntime({root,env});
}
