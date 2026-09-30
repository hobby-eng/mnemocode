"""Check source identity, pinned runtime bytes, direct dependency pins and package boundaries."""
import hashlib
import json
from pathlib import Path
root = Path.cwd()
out = root / 'docs/audits/AUD-004-evidence'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
snapshot = json.loads((out / 'snapshot.json').read_text())
changed = [n for n, h in snapshot['files'].items() if not (root / n).exists() or sha(root / n) != h]
manifest = json.loads((root / 'vendor/sskr/integrity.json').read_text())
for name, digest in manifest.items():
    assert sha(root / 'vendor/sskr' / name) == digest, name
package = json.loads((root / 'package.json').read_text())
pins = package['dependencies'] | package['devDependencies']
for name, version in pins.items():
    actual = json.loads((root / 'node_modules' / name / 'package.json').read_text())['version']
    assert actual == version, (name, version, actual)
packed = json.loads((out / 'package-unrestricted.log').read_text())[0]
paths = {f['path'] for f in packed['files']}
for required in ['dist/mnemocode.js', 'dist/index.js', 'dist/cards.js', 'dist/sskr/index.js',
                 'vectors/mnemocode-v1.json', 'vectors/sskr-v1.json', 'vendor/sskr/integrity.json',
                 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']:
    assert required in paths, required
assert not any('-evidence/' in p or p.startswith(('output/', 'test-results/', '.git/')) for p in paths)
assets = [str(p.relative_to(root)) for p in (root / 'assets').rglob('*') if p.is_file()]
assert set(assets) <= paths
build = {str(p.relative_to(root)): sha(p) for p in sorted((root / 'dist').rglob('*')) if p.is_file()}
(out / 'build-hashes.json').write_text(json.dumps(build, indent=2) + '\n')
result = {'pinnedSskrFiles': len(manifest), 'installedDirectPins': len(pins), 'packedFiles': len(paths),
          'bundledAssets': len(assets), 'builtFiles': len(build), 'trackedChangesSinceSnapshot': changed}
(out / 'integrity-results.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
assert not changed, 'Concurrent changes require another review before concluding'
