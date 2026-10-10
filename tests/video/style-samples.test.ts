import {expect,it} from 'vitest';
import {parseSampleOptions,sampleExportArguments} from '../../scripts/video/style-samples';
it('defaults to a dry run over all 43 styles; rejects unknown or unsafe selection',()=>{
 const plan=parseSampleOptions([]);expect(plan.execute).toBe(false);expect(plan.styles).toHaveLength(43);
 expect(parseSampleOptions(['--execute','--styles=watercolor']).styles).toEqual(['watercolor']);
 expect(()=>parseSampleOptions(['--styles=../../secret'])).toThrow();
 expect(()=>parseSampleOptions(['--unexpected'])).toThrow();
});
it('exports a six second sample and midpoint still through the isolated media runtime',()=>{
 const args=sampleExportArguments('sha256:'+'a'.repeat(64),'1000:1000','/data/picture.mp4','/output','watercolor',4);
 expect(args).toContain('--network');expect(args).toContain('none');expect(args.join(' ')).toContain('tpad=stop_mode=clone:stop_duration=6');
 expect(args.slice(args.indexOf('-t'),args.indexOf('-t')+2)).toEqual(['-t','6']);
 expect(args).toContain('/output/watercolor.jpg');expect(args).toContain('/output/watercolor.mp4');
 expect(args.slice(args.indexOf('-ss'),args.indexOf('-ss')+2)).toEqual(['-ss','2']);
 expect(()=>sampleExportArguments('sha256:'+'a'.repeat(64),'1000:1000','relative','/output','watercolor',4)).toThrow();
});
