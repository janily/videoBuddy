if(process.env.RUN_VIDEO_STYLE_TESTS!=='1'){console.error('BLOCKED: RUN_VIDEO_STYLE_TESTS=1 and authorized media credentials required');process.exit(2)}
console.error('BLOCKED: no validated cloud media runtime/profile; 43 styles remain in delivery scope. See docs/engineering/blockers.md');process.exit(2);
