import {it,expect} from 'vitest';
import {refreshesProjectView} from '@/services/video/stream/view-refresh';
it('script and shot milestones refresh persisted canvas state; token/progress updates do not flood GET',()=>{
 expect(refreshesProjectView('script.ready')).toBe(true);
 expect(refreshesProjectView('shot.updated')).toBe(true);
 expect(refreshesProjectView('result.ready')).toBe(true);
 expect(refreshesProjectView('message.delta')).toBe(false);
 expect(refreshesProjectView('activity.updated')).toBe(false);
});
