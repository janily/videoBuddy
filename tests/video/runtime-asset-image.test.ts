import {it,expect} from 'vitest';
import {validateRuntimeAssetRenderer} from '@/services/video/media/runtime-asset-image';
it('requires both actual trusted renderer files from the pinned image, rejecting stale, missing or duplicate checksums',()=>{
 const expected={'render.mjs':'a'.repeat(64),'runtime-assets.mjs':'b'.repeat(64)},valid=expected['render.mjs']+'  /opt/videobuddy/render.mjs\n'+expected['runtime-assets.mjs']+'  /opt/videobuddy/runtime-assets.mjs';
 expect(()=>validateRuntimeAssetRenderer(valid,expected)).not.toThrow();for(const output of [valid.replace('a'.repeat(64),'c'.repeat(64)),valid.split('\n')[0],valid+'\n'+valid.split('\n')[0]])expect(()=>validateRuntimeAssetRenderer(output,expected)).toThrow('RUNTIME_ASSET_RENDERER_UNAVAILABLE');
});
