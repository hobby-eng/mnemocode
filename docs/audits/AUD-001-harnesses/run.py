from pathlib import Path
import subprocess,datetime,json,hashlib,sys,time,os
base=Path('/tmp/mnemocode-aud-001');name=sys.argv[1];cmd=sys.argv[2:];e=base/'evidence';start=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (e/(name+'.log')).open('wb') as log:
    try:
        result=subprocess.run(cmd,cwd=base/'workspace',stdout=log,stderr=subprocess.STDOUT,timeout=300)
        exitcode=result.returncode
    except subprocess.TimeoutExpired:
        log.write(b'\nAUDIT HARNESS: 300 second timeout.\n');exitcode=124
record={'name':name,'argv':cmd,'cwd':'isolated workspace copied from source manifest','start':start,'end':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':exitcode,'log':name+'.log','sha256':hashlib.sha256((e/(name+'.log')).read_bytes()).hexdigest(),'environment':{k:v for k,v in os.environ.items() if k in ['NODE_OPTIONS','NO_COLOR','CI','PNPM_HOME']}}
(e/(name+'.command.json')).write_text(json.dumps(record,indent=2));print(json.dumps(record))
print((e/(name+'.log')).read_text(errors='replace')[-16000:])
