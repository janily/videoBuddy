import type {Server} from 'node:http';
export function verifyRuntimeAssetInputs(root:string,assets:unknown):Promise<void>;
export function createRuntimeAssetServer(root:string,assets:unknown):Server;
