import { createHash } from 'node:crypto';
export function canonicalJson(value: unknown): string {
 if (value === null || typeof value !== 'object') {
  const result=JSON.stringify(value);if(result===undefined)throw Error('NON_JSON_VALUE');return result;
 }
 if(Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
 const object=value as Record<string,unknown>;
 return '{'+Object.keys(object).sort().filter(k=>object[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonicalJson(object[k])).join(',')+'}';
}
export function canonicalHash(value: unknown) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
