#!/usr/bin/env python3
"""Validate this specification package; DOES NOT run VideoBuddy application tests.
Usage: python checks/validate_handoff.py [--root PATH]
Requires: jsonschema. No network requests, cloud calls, or secrets required.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote
try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError as exc:
    raise SystemExit('Missing jsonschema. Install in an isolated environment: python -m pip install jsonschema') from exc

def run(root: Path) -> dict:
    errors: list[str] = []
    stats: dict[str, object] = {}
    def check(condition: bool, message: str) -> None:
        if not condition: errors.append(message)
    def read(rel: str):
        return json.loads((root / rel).read_text(encoding='utf-8'))
    required = ['README.md','CODEX_START_HERE.md','VideoBuddy_Codex_Development_Spec_v5_1.md','config/env.example','design/preview.html','contracts/public.schema.json']
    for rel in required: check((root / rel).is_file(), f'Missing required file: {rel}')
    all_files = list(p for p in root.rglob('*') if p.is_file())
    for p in all_files:
        check(p.suffix.lower() not in {'.woff','.woff2','.ttf','.otf','.ttc','.eot'}, f'Font file not allowed: {p}')
        check(p.name not in {'.env','.env.local','.env.production'}, f'Unexpected secrets/config file: {p}')
    json_files = list(root.rglob('*.json'))
    for p in json_files:
        try: json.loads(p.read_text(encoding='utf-8'))
        except (ValueError, UnicodeError) as exc: errors.append(f'Invalid JSON {p.relative_to(root)}: {exc}')
    stats['json_files_parsed'] = len(json_files)
    md_files = list(root.rglob('*.md')); json_fence_count = 0; links = 0
    known_sources={'D01','R01','R02','V01','V02','V03','V04','V05','V06','V07','V08','V09','M01','A01'}
    for p in md_files:
        text=p.read_text(encoding='utf-8'); fence=None; content=[]
        for n,line in enumerate(text.splitlines(),1):
            m=re.match(r'^\s*(`{3,}|~{3,})([^\s]*)\s*$',line)
            if m:
                if fence is None:
                    fence=(m.group(1),m.group(2),n);content=[]
                elif m.group(1)[0]==fence[0][0] and len(m.group(1))>=len(fence[0]) and not m.group(2):
                    if fence[1]=='json':
                        try: json.loads('\n'.join(content)); json_fence_count+=1
                        except ValueError as exc:errors.append(f'Invalid JSON fence {p.relative_to(root)}:{fence[2]} {exc}')
                    fence=None
                else: content.append(line)
            elif fence is not None: content.append(line)
        check(fence is None, f'Unclosed fence in {p.relative_to(root)}')
        for href in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)',text):
            href=href.strip().split(' "')[0]
            if '://' in href or href.startswith(('#','mailto:','data:')): continue
            dest=(p.parent/unquote(href.split('#')[0])).resolve(); links+=1
            check(dest.exists(), f'Broken local link {p.relative_to(root)} -> {href}')
        for src in re.findall(r'\[((?:D|R|V|M|A)\d{2})\]',text):
            check(src in known_sources, f'Unknown source ID {src} in {p.relative_to(root)}')
    stats.update(markdown_files=len(md_files),json_fences_parsed=json_fence_count,local_links_checked=links)
    schema=read('contracts/public.schema.json'); Draft202012Validator.check_schema(schema)
    definitions=schema['$defs']; examples=read('examples/manifest.json')
    valid=invalid=0
    for ex in examples:
        validator=Draft202012Validator({'$ref':'#/$defs/'+ex['definition'],'$defs':definitions}, format_checker=FormatChecker())
        actual=validator.is_valid(read(ex['file']))
        check(actual==ex['valid'],f"Example expectation mismatch {ex['file']} (expected valid={ex['valid']})")
        if ex['valid']: valid+=1
        else: invalid+=1
    stats.update(contract_definitions=len(definitions),valid_examples=valid,rejected_examples=invalid)
    tasks=read('acceptance/tasks.json'); tests=read('acceptance/test-matrix.json'); requirements=read('acceptance/requirements.json')
    tids={t['id'] for t in tasks}; reqids={r['id'] for r in requirements}; testids={x['id'] for x in tests}
    check(len(tasks)==len(tids)==22,'Expected 22 unique tasks')
    check(len(requirements)==len(reqids)==22,'Expected 22 unique requirements')
    check(len(tests)==len(testids)==92,'Expected 92 unique acceptance tests')
    graph={t['id']:t['dependsOn'] for t in tasks}; visited=set(); pending=set()
    def visit(tid):
        if tid in pending: errors.append(f'Task cycle at {tid}'); return
        if tid in visited:return
        if tid not in graph:errors.append(f'Unknown dependency {tid}');return
        pending.add(tid)
        for dep in graph[tid]:visit(dep)
        pending.remove(tid);visited.add(tid)
    for t in tasks:
        visit(t['id']); check(t['status']=='not_started',f"Specification must not pre-mark task done: {t['id']}")
        check(set(t['requirements'])<=reqids,f"Unknown requirement in {t['id']}")
        check(any(x['taskId']==t['id'] for x in tests),f"Task without tests {t['id']}")
    for x in tests:
        check(x['taskId'] in tids and set(x['requirements'])<=reqids,f"Test invalid links {x['id']}")
        check(x['status']=='not_run',f"Application test status falsely completed {x['id']}")
    for req in requirements:
        check(bool(req['tasks']) and bool(req['tests']),f"Uncovered requirement {req['id']}")
        check(set(req['tasks'])<=tids and set(req['tests'])<=testids,f"Requirement broken refs {req['id']}")
    plan=(root/'docs/06_IMPLEMENTATION_PLAN.md').read_text()
    for t in tasks:check(f"## {t['id']}｜" in plan,f"Missing human task {t['id']}")
    table=(root/'docs/07_ACCEPTANCE_AND_DEPLOYMENT.md').read_text()
    for x in tests:check(f"| {x['id']} |" in table,f"Missing human acceptance {x['id']}")
    stats.update(tasks=len(tasks),requirements=len(requirements),acceptance_targets=len(tests))
    styles=read('acceptance/style-matrix.json');cat=read('design/style-catalog.json')
    check(len(styles)==43 and len({s['slug'] for s in styles})==43,'Expected 43 styles')
    check({s['slug'] for s in styles}=={s['id'] for s in cat['styles']},'Style identity mismatch')
    check(len({s['categoryZh'] for s in styles})==9,'Expected 9 categories')
    check(dict(Counter(s['taskId'] for s in styles))=={'T15':16,'T16':12,'T17':10,'T18':5},'Wrong style task distribution')
    for s in styles:
        check({e['aspect'] for e in s['evidence']}=={'16:9','9:16'},f"Missing aspect {s['slug']}")
        check(all(e['status']=='not_run' and e['artifactId'] is None for e in s['evidence']),f"False style completion {s['slug']}")
    agents=read('acceptance/agent-cases.json')
    check(len(agents)==16 and all(x['status']=='not_run' for x in agents),'Agent evaluation target mismatch')
    refs=read('design/reference-manifest.json')
    for f in refs:
        p=root/f['path'];check(p.exists(),f"Missing approved reference {f['path']}")
        if p.exists():check(hashlib.sha256(p.read_bytes()).hexdigest()==f['sha256'],f"Approved design changed {f['path']}")
    stats.update(styles=len(styles),style_baseline_targets=sum(len(s['evidence']) for s in styles),agent_eval_targets=len(agents),unchanged_design_files=len(refs))
    excerpt=read('examples/excerpt-map.json')
    for a in excerpt['assertions']:
        got=None
        for seg in excerpt['segments']:
            check(seg['previewEndMs']-seg['previewStartMs']==seg['sourceEndMs']-seg['sourceStartMs'],'Excerpt durations differ')
            if seg['previewStartMs']<=a['previewTimeMs']<seg['previewEndMs']:
                got=seg['sourceStartMs']+a['previewTimeMs']-seg['previewStartMs'];break
        check(got==a['expectedSourceTimeMs'],f"Incorrect excerpt mapping {a}")
    # Merged doc must contain current source chapters, not stale assembled versions.
    merged=(root/'VideoBuddy_Codex_Development_Spec_v5_1.md').read_text()
    for p in sorted((root/'docs').glob('0*.md')):
        expected=p.read_text().replace('../design/','design/').replace('../config/','config/')
        check(expected in merged, f'Merged document stale: {p.name}')
    stats['excerpt_mappings_checked']=len(excerpt['assertions'])
    bootstrap=read('acceptance/bootstrap-cases.json')
    check(len(bootstrap)==8 and {b['id'] for b in bootstrap}=={f'BT-{i:02d}' for i in range(1,9)}, 'Expected 8 bootstrap cases')
    check(all(b['taskId']=='T00' and b['status']=='not_run' for b in bootstrap), 'Bootstrap tests must remain unrun T00 targets')
    bootstrap_doc=(root/'docs/00_EMPTY_REPO_BOOTSTRAP.md').read_text()
    for b in bootstrap:
        check(f"| {b['id']} |" in bootstrap_doc, f"Missing bootstrap case {b['id']}")
    check('空仓库' in (root/'CODEX_START_HERE.md').read_text(), 'Entry must explicitly target empty repository')
    check('T00-A' in plan and 'T00-B' in plan and 'T00-C' in plan, 'Bootstrap phases missing')
    check('以当前工作目录中的presentationBuddy或其videoBuddy衍生工程为骨架' not in (root/'CODEX_START_HERE.md').read_text(), 'Stale existing-app start instruction')
    stats['empty_repository_acceptance_targets']=len(bootstrap)
    report={'scope':'specification package only; not application, model, cloud, media or user tests','status':'passed' if not errors else 'failed','counts':stats,'errors':errors}
    return report

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);args=ap.parse_args()
    report=run(args.root.resolve())
    print(json.dumps(report,ensure_ascii=False,indent=2))
    raise SystemExit(0 if report['status']=='passed' else 1)
if __name__=='__main__':main()
