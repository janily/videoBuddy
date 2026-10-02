import{readFile}from'node:fs/promises';
const manifest=JSON.parse(await readFile('.next/diagnostics/workflows-manifest.json','utf8'));
const workflows=JSON.stringify(manifest.workflows);
if(!workflows.includes('directorTurnWorkflow'))throw Error('BUILD_WORKFLOW_MISSING: Director is not registered; start() must be reachable from entrypoint');
console.log('Director durable workflow registered in actual build manifest.');
