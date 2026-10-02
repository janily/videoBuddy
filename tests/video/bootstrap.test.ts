import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import baseline from '../../docs/engineering/design-baseline.json';
it('BT-08 original approved design bytes remain intact', () => {
 for (const [path, hash] of Object.entries(baseline)) expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
});
