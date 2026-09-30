"""Record audit commands using the existing checkout and pinned workspace tools."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/audits/AUD-004-evidence'
def now():return datetime.now(timezone.utc).isoformat()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def save(name,value):
 path=OUT/name
 if path.exists():raise RuntimeError('Refusing to overwrite '+str(path))
 path.write_text(json.dumps(value,indent=2)+'\n')
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
if sys.argv[1:] == ['capture']:
 files={name:sha(ROOT/name) for name in git('ls-files').splitlines()}
 save('snapshot.json',{'capturedAt':now(),'branch':git('branch','--show-current'),'commit':git('rev-parse','HEAD'),'workingTree':git('status','--short'),'files':files,'sourceFingerprint':hashlib.sha256(''.join(f'{n}\0{h}\n' for n,h in sorted(files.items())).encode()).hexdigest()})
 (OUT/'baseline.diff').write_text(git('diff','--'))
 procedures=['docs/FULL_AUDIT_GUIDE.md','docs/audits/AUDIT_STANDARD.md','docs/audits/AUDIT_TEMPLATE.md','docs/audit-report.schema.json']
 save('procedure-hashes.json',{name:sha(ROOT.parent/'multi-chain-wallet-tools'/name) for name in procedures})
 (OUT/'environment.log').write_text(f'{now()}\n{platform.platform()}\nPython {sys.version}\n')
 print('AUD-004 baseline captured; public data only. One test worker; no full-cost MHFE.')
else:
 label=sys.argv[1];assert sys.argv[2]=='--';command=sys.argv[3:]
 assert not (OUT/f'{label}.command.json').exists()
 env=os.environ.copy();env.update({'CARGO_HOME':str(ROOT.parent/'workingspace/cargo'),'RUSTUP_HOME':str(ROOT.parent/'workingspace/rustup'),'CARGO_BUILD_JOBS':'1','PATH':str(Path.home()/'.local/bin')+':'+str(ROOT.parent/'workingspace/cargo/bin')+':'+env['PATH']})
 start=now();log=OUT/f'{label}.log'
 with log.open('wb') as stream:r=subprocess.run(command,cwd=ROOT,env=env,stdout=stream,stderr=subprocess.STDOUT)
 record={'label':label,'command':command,'cwd':str(ROOT),'startedAt':start,'endedAt':now(),'exitCode':r.returncode,'logSha256':sha(log)}
 save(f'{label}.command.json',record);print(log.read_text(),end='');print(json.dumps(record));raise SystemExit(r.returncode)
