from pathlib import Path
import json
s=json.load(open('docs/hand-off/videobuddy-v5.1/contracts/public.schema.json'))
def js(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'))
def convert(x):
 if '$ref'in x:return x['$ref'].split('/')[-1]+'Schema'
 if 'const'in x:return 'z.literal('+js(x['const'])+')'
 if 'enum'in x:return 'z.enum('+js(x['enum'])+')'
 if 'oneOf'in x:return 'z.union(['+','.join(convert(v) for v in x['oneOf'])+'])'
 if 'anyOf'in x and 'type'not in x:return 'z.union(['+','.join(convert(v) for v in x['anyOf'])+'])'
 t=x.get('type')
 if t=='object':
  req=x.get('required',[])
  v='z.strictObject({'+','.join(js(k)+':'+convert(v)+('' if k in req else '.optional()') for k,v in x.get('properties',{}).items())+'})'
  if x.get('minProperties'):v+='.refine(v=>Object.keys(v).length>='+str(x['minProperties'])+')'
  if x.get('anyOf'):v+=".refine(v=>('text' in v && typeof v.text==='string' && v.text.trim().length>0)||('attachmentIds' in v && Array.isArray(v.attachmentIds) && v.attachmentIds.length>0))"
  return v
 if t=='array':
  v='z.array('+convert(x['items'])+')'
  for k,f in [('minItems','min'),('maxItems','max')]:
   if k in x:v+='.'+f+'('+str(x[k])+')'
  if x.get('uniqueItems'):v+='.refine(v=>new Set(v).size===v.length)'
  return v
 if t=='null':return 'z.null()'
 if t=='boolean':return 'z.boolean()'
 if t in ['integer','number']:
  v='z.number()'+('.int()'if t=='integer'else '')
  for k,f in [('minimum','min'),('maximum','max')]:
   if k in x:v+='.'+f+'('+str(x[k])+')'
  return v
 if t=='string':
  v='z.string()'
  for k,f in [('minLength','min'),('maxLength','max')]:
   if k in x:v+='.'+f+'('+str(x[k])+')'
  if x.get('pattern'):v+='.regex(new RegExp('+js(x['pattern'])+'))'
  if x.get('format')=='uuid':v+='.uuid()'
  if x.get('format')=='date-time':v+='.datetime({offset:true})'
  return v
 raise Exception(x)
Path('src/contracts/video').mkdir(parents=True,exist_ok=True)
text="// Generated from approved v5 public schema; application runtime has no dependency on docs.\nimport { z } from 'zod';\n"
for k,v in s['$defs'].items():text+='export const '+k+'Schema = '+convert(v)+';\nexport type '+k+' = z.infer<typeof '+k+'Schema>;\n'
text+='export const commandSchemas = {'+','.join(k+':'+k+'Schema'for k in s['$defs'] if k.endswith('Request'))+'};\n'
text+='export function validateCommand(kind:string,body:unknown) { const schema = commandSchemas[kind as keyof typeof commandSchemas]; if (!schema) throw new Error("VALIDATION_FAILED: unknown command"); const result=schema.safeParse(body); if(!result.success) throw new Error("VALIDATION_FAILED: "+result.error.message); return result.data; }\n'
Path('src/contracts/video/commands.ts').write_text(text)
