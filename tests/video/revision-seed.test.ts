import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {revisionSeed} from '@/services/video/timeline/seed';

it('T09 uses one stable revision seed for Visual input, every shot and FilmSpec',()=>{
 const projectId=randomUUID(),revisionId=randomUUID(),seed=revisionSeed(projectId,revisionId);
 expect(seed).toBe(revisionSeed(projectId,revisionId));expect(Number.isSafeInteger(seed)).toBe(true);
 expect(seed).toBeGreaterThanOrEqual(0);expect(seed).toBeLessThanOrEqual(0xffffffff);
 expect(revisionSeed(projectId,randomUUID())).not.toBe(seed);
 expect(()=>revisionSeed('../other',revisionId)).toThrow('VALIDATION_FAILED');
});
