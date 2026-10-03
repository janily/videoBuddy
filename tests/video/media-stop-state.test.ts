import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {assertMediaStopsResolved,unknownMediaStopMessage} from '@/services/video/media/stop-state';
import {errorResponse} from '@/services/video/http/route-utils';
it('keeps legacy absent and verified empty markers valid, but a physical unknown blocks new production',()=>{
 expect(()=>assertMediaStopsResolved({})).not.toThrow();expect(()=>assertMediaStopsResolved({unresolvedMediaStops:{}})).not.toThrow();
 expect(()=>assertMediaStopsResolved({unresolvedMediaStops:{[randomUUID()]:'preview'}})).toThrow('MEDIA_STOP_UNKNOWN');
});
it('returns a non-retryable conflict for an unknown physical stop instead of a retryable service error',async()=>{
 const response=errorResponse(Error('MEDIA_STOP_UNKNOWN'));expect(response.status).toBe(409);expect((await response.json()).error).toMatchObject({code:'MEDIA_STOP_UNKNOWN',message:unknownMediaStopMessage,retryable:false});
});
