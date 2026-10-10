/** Public canvas data contains text and private artifact identifiers, never storage paths. */
export interface ScriptShot {
 id:string;startSec:number;endSec:number;scriptLine:string;visualIntent:string;
 state?:'text'|'drawing'|'drawn'|'rendering'|'rendered';sourceAvailable?:boolean;sourceOperationId?:string;sourceTake?:number;posterArtifactId?:string;clipArtifactId?:string;
}
export interface ScriptDraft {
 briefVersion:number;summary:string;selectionReason:string;shots:ScriptShot[];
 state:'drafting'|'ready'|'stale'|'failed';errorMessage?:string;operationId?:string;
}
