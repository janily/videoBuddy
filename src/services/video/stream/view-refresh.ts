/** Read canonical view only when persisted content changed, not for every token. */
export function refreshesProjectView(type:string):boolean {
 return ['message.committed','understanding.updated','preview.ready','result.ready','script.ready','shot.updated','operation.terminal'].includes(type);
}
