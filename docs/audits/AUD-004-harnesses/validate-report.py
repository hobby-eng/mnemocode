"""Validate audit shape, cross-record IDs, links, source identity and staged-file boundary."""
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import jsonschema

root=Path.cwd(); folder=root/'docs/audits'; out=folder/'AUD-004-evidence'
def strict(p):
    def pairs(items):
        result={}
        for k,v in items:
            assert k not in result, 'Duplicate JSON key: '+k
            result[k]=v
        return result
    return json.loads(p.read_text(),object_pairs_hook=pairs)
record=strict(folder/'AUD-004-2026-09-30.json')
schema=strict(root.parent/'multi-chain-wallet-tools/docs/audit-report.schema.json')
jsonschema.Draft202012Validator(schema).validate(record)
markdown=(folder/'AUD-004-2026-09-30.md').read_text()
ids={x['id'] for x in record['findings']+record['observations']}
assert set(re.findall(r'AUD-004-(?:SEC|FUN|API|BLD|DOC|UI|ARC)\d{3}',markdown))==ids
assert len(record['checks']['coverage'])==32
assert len({c['id'] for c in record['checks']['coverage']})==32
for doc in [folder/'AUD-004-2026-09-30.md',folder/'AUD-004-harnesses/README.md']:
    for target in re.findall(r'\]\(([^)]+)\)',doc.read_text()):
        if target.startswith(('https://','http://','#')):continue
        assert (doc.parent/target.split('#')[0]).exists(), (doc,target)
for script in (folder/'AUD-004-harnesses').glob('*.py'):ast.parse(script.read_text())
for script in (folder/'AUD-004-harnesses').glob('*.mjs'):
    subprocess.run(['node','--check',str(script)],check=True)
snapshot=strict(out/'snapshot.json')
changed=[n for n,h in snapshot['files'].items() if hashlib.sha256((root/n).read_bytes()).hexdigest()!=h]
assert changed==['docs/audits/README.md'], changed
staged=subprocess.check_output(['git','diff','--cached','--name-only'],text=True).splitlines()
assert not any('AUD-004' in p or '-evidence/' in p for p in staged)
for command in record['checks']['commands']:
    assert hashlib.sha256((out/(command['label']+'.log')).read_bytes()).hexdigest()==command['logSha256']
result={'schemaValid':True,'duplicateKeys':False,'markdownJsonIdsMatch':True,'relativeLinksResolve':True,
        'coverageChecks':32,'findings':len(record['findings']),'observations':len(record['observations']),
        'auditScriptsSyntaxValid':True,'onlyAuditorTrackedChange':'docs/audits/README.md',
        'productionSnapshotStable':True,'auditEvidenceStaged':False,'commandHashesMatch':True}
(out/'report-validation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
