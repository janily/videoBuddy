import {readFile}from 'node:fs/promises';import {join}from 'node:path';import {createHash}from 'node:crypto';
import {getStyle}from './registry';
export async function loadStageKnowledge(slug:string,stage:'style'|'demo'){
 const pack=getStyle(slug);if(stage==='demo')throw Error('TREATMENT_REQUIRED: demo access is not enabled before a trusted Treatment');
 const rules=await readFile(join(process.cwd(),'style-packs',pack.id,'STYLE.md'),'utf8');const sha256=createHash('sha256').update(rules).digest('hex');if(sha256!==pack.rulesHash)throw Error('STYLE_RULES_INTEGRITY');return{slug:pack.id,rules,sha256,upstreamCommit:pack.upstreamCommit};
}
