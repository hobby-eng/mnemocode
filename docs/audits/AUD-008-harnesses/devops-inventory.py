#!/usr/bin/env python3
"""AUD-008 local build/provenance/packaging inventory; no builds, installs or network."""
import hashlib
import json
from pathlib import Path
import re
import sys
import tomllib
import yaml

ROOT = Path(__file__).resolve().parents[3]
WORKSPACE = ROOT.parent
errors = []

def digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            hasher.update(block)
    return hasher.hexdigest()

def expect(condition, description):
    if not condition:
        errors.append(description)

package = json.loads((ROOT / 'package.json').read_text())
locks = list(yaml.safe_load_all((ROOT / 'pnpm-lock.yaml').read_text()))
app_lock = next(item for item in locks if 'dependencies' in item.get('importers', {}).get('.', {}))
importer = app_lock['importers']['.']
pins = []
for section in ['dependencies', 'devDependencies']:
    for name, version in package[section].items():
        installed_path = (ROOT / 'node_modules' / name / 'package.json').resolve()
        installed = json.loads(installed_path.read_text())
        locked = importer[section][name]
        exact = bool(re.fullmatch(r'\d+\.\d+\.\d+(?:-[\w.]+)?', version))
        expect(exact, f'{name}: direct dependency is not exact')
        expect(locked['specifier'] == version, f'{name}: lock specifier differs')
        expect(locked['version'].split('(')[0] == version, f'{name}: locked version differs')
        expect(installed['version'] == version, f'{name}: installed version differs')
        pins.append({'name': name, 'manifestVersion': version, 'locked': locked,
                     'installedVersion': installed['version'], 'installedManifest': str(installed_path)})
archive_records = []
for number, lock in enumerate(locks):
    for name, entry in lock.get('packages', {}).items():
        integrity = entry.get('resolution', {}).get('integrity')
        expect(bool(integrity) and integrity.startswith('sha512-'), f'lock document {number}: {name} lacks SHA-512 archive integrity')
        archive_records.append({'lockDocument': number, 'package': name, 'integrity': integrity})

cargo = tomllib.loads((ROOT / 'sskr-wasm/rust/Cargo.lock').read_text())
registry = [entry for entry in cargo['package'] if entry.get('source', '').startswith('registry+')]
git_dependencies = [entry for entry in cargo['package'] if entry.get('source', '').startswith('git+')]
for entry in registry:
    expect(bool(re.fullmatch('[0-9a-f]{64}', entry.get('checksum', ''))), f'Cargo checksum missing: {entry["name"]}')
for entry in git_dependencies:
    expect(bool(re.search(r'#[0-9a-f]{40}$', entry['source'])), f'Cargo git full revision missing: {entry["name"]}')
sskr_pins = json.loads((ROOT / 'sskr-wasm/integrity.json').read_text())
for name, expected in sskr_pins.items():
    expect(digest(ROOT / 'sskr-wasm' / name) == expected, f'SSKR pin mismatch: {name}')
actual_sskr_inputs = {str(file.relative_to(ROOT / 'sskr-wasm')) for folder in ['generated', 'rust']
                     for file in (ROOT / 'sskr-wasm' / folder).rglob('*')
                     if file.is_file() and '/target/' not in str(file)}
expect(actual_sskr_inputs == set(sskr_pins), 'SSKR source/generated coverage mismatch')
notice_table = {(name, version) for name, version in re.findall(r'^\| `([^`]+)` \| ([^| ]+) \|',
                (ROOT / 'sskr-wasm/UPSTREAM_NOTICES.md').read_text(), re.M)}
expect(notice_table == {(item['name'], item['version']) for item in cargo['package']}, 'SSKR notice table differs from Cargo.lock')

def toolchain_lines(file):
    source = file.read_text().split('FROM toolchain AS dependencies')[0]
    return '\n'.join(line for line in source.splitlines() if line.strip() and not line.lstrip().startswith('#'))
our_toolchain = toolchain_lines(ROOT / 'Dockerfile.sskr')
shared_toolchain = toolchain_lines(WORKSPACE / 'multi-chain-wallet-tools/Dockerfile.reproducible')
expect(our_toolchain == shared_toolchain, 'canonical Docker toolchain stage differs')

ci = yaml.load((ROOT / '.github/workflows/ci.yml').read_text(), Loader=yaml.BaseLoader)
release = yaml.load((ROOT / '.github/workflows/executable.yml').read_text(), Loader=yaml.BaseLoader)
actions = []
for filename, workflow in [('ci.yml', ci), ('executable.yml', release)]:
    expect(workflow.get('permissions', {}).get('contents') == 'read', f'{filename}: default contents permission')
    expect(workflow.get('concurrency', {}).get('cancel-in-progress') == "${{ !startsWith(github.ref, 'refs/tags/') }}", f'{filename}: concurrency cancellation')
    for job_name, job in workflow['jobs'].items():
        for step in job.get('steps', []):
            if 'uses' in step:
                use = step['uses']
                expect(bool(re.search(r'@[a-f0-9]{40}$', use)), f'{filename}/{job_name}: action is not SHA-pinned: {use}')
                actions.append({'workflow': filename, 'job': job_name, 'uses': use})
expect('workflow_call' in ci['on'], 'CI is not reusable')
expect(release['jobs']['release']['needs'] == ['verify', 'sskr', 'build'], 'release dependencies differ')
expect(release['jobs']['verify']['uses'] == './.github/workflows/ci.yml', 'release does not call local CI')
expect(release['jobs']['release']['permissions'] == {'contents': 'write', 'id-token': 'write', 'attestations': 'write'}, 'release token scopes differ')
workflow_inspection = {'pinnedActions': actions, 'releaseNeeds': release['jobs']['release']['needs'],
    'ciRuns': [step['run'] for step in ci['jobs']['verify']['steps'] if 'run' in step],
    'releaseSSKRRun': [step['run'] for step in release['jobs']['sskr']['steps'] if 'run' in step],
    'runnerMatrices': {'portable': ci['jobs']['portable']['strategy']['matrix']['os'],
                      'executable': release['jobs']['build']['strategy']['matrix']['os']},
    'releasePermissions': release['jobs']['release']['permissions']}

# package.json has simple literal paths; no npm packing command or lifecycle script is executed.
allowlist = package['files']
def allowed(file):
    if file.startswith('./'):
        file = file[2:]
    return file in ['package.json', 'README.md', 'LICENSE'] or any(file == item or file.startswith(item.rstrip('/') + '/') for item in allowlist)
readme_links = sorted(set(link.split('#')[0] for link in re.findall(r'\]\(([^)]+)\)', (ROOT / 'README.md').read_text())
                          if not link.startswith(('https:', 'http:', '#'))))
package_documentation = [{'path': file, 'existsInCheckout': (ROOT / file).exists(), 'selectedByFilesAllowlist': allowed(file)} for file in readme_links]
for item in package_documentation:
    expect(item['existsInCheckout'], f'README local link is missing: {item["path"]}')
package_exports = [{'path': file, 'exists': (ROOT / file).is_file(), 'selectedByFilesAllowlist': allowed(file)}
                   for group in package['exports'].values() for file in group.values()]
for item in package_exports:
    expect(item['exists'] and item['selectedByFilesAllowlist'], f'Export missing/unselected: {item["path"]}')

artifacts = []
for file in sorted((ROOT / 'release').glob('mnemocode-*')):
    artifacts.append({'path': str(file.relative_to(ROOT)), 'sha256': digest(file), 'bytes': file.stat().st_size,
                      'modifiedAtUnixSeconds': file.stat().st_mtime})
checksum_results = []
for checksum_file in (ROOT / 'release').glob('mnemocode-*.sha256'):
    for line in checksum_file.read_text().splitlines():
        expected, name = line.split('  ', 1)
        actual = digest(checksum_file.parent / name)
        expect(actual == expected, f'Release checksum mismatch: {name}')
        checksum_results.append({'path': name, 'expected': expected, 'actual': actual, 'matches': actual == expected})
notices = (ROOT / 'release/mnemocode-0.1.0-linux-x64-licenses.txt').read_text()
noticed_packages = [{'name': name, 'version': version, 'license': license_}
                   for name, version, license_ in re.findall(r'^npm package (\S+) (\S+) \(([^\n]+)\)$', notices, re.M)]
for item in noticed_packages:
    expect(f'{item["name"]}@{item["version"]}' in app_lock['packages'], f'Notice package/version outside lock: {item}')
expect(any(item['name'] == 'age-encryption' and item['version'] == package['dependencies']['age-encryption'] for item in noticed_packages), 'Candidate encryption dependency missing from notices')
expect('Node.js v' + (ROOT / '.node-version').read_text().strip() in notices, 'Node runtime license heading mismatch')

files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.node-version', 'AGENTS.md', '.gitignore',
    '.prettierignore', 'Dockerfile.sskr', '.github/workflows/ci.yml', '.github/workflows/executable.yml',
    'scripts/build-executable.mjs', 'scripts/verify-executable.mjs', 'scripts/executable-files.mjs',
    'scripts/executable-notices.mjs', 'scripts/build-sskr-wasm.mjs', 'scripts/verify-toolchain.mjs',
    'scripts/verify-terminal-input-requirements.txt', 'sskr-wasm/integrity.json', 'sskr-wasm/NOTICE.md',
    'sskr-wasm/UPSTREAM_NOTICES.md', 'sskr-wasm/rust/Cargo.toml', 'sskr-wasm/rust/Cargo.lock',
    'src/bundled-files.ts', 'src/sskr/runtime.ts', 'src/cli/protection-flags.json', 'src/cli/self-test.ts',
    'test/sskr-integrity.test.ts', 'README.md', 'THIRD_PARTY_NOTICES.md', 'NOTICE', 'docs/CANDIDATES.md',
    'docs/HEIRS.md', 'tsconfig.json', 'tsconfig.cards.json']
source_hashes = {file: digest(ROOT / file) for file in files}
procedure_files = ['docs/FULL_AUDIT_GUIDE.md', 'docs/audits/AUDIT_STANDARD.md',
                   'docs/audits/AUDIT_TEMPLATE.md', 'docs/audit-report.schema.json']
procedure_hashes = {file: digest(WORKSPACE / 'multi-chain-wallet-tools' / file) for file in procedure_files}
report = {'errors': errors, 'lockDocumentCount': len(locks), 'directDependencyCount': len(pins),
    'directDependencyPins': pins, 'archiveIntegrityCount': len(archive_records),
    'archiveIntegrityMissingCount': sum(item['integrity'] is None for item in archive_records),
    'cargoPackageCount': len(cargo['package']), 'cargoRegistryChecksumCount': len(registry),
    'cargoGitDependencies': git_dependencies, 'sskrPinCount': len(sskr_pins),
    'sskrNoticePackageCount': len(notice_table), 'canonicalToolchainMatchesWorkspace': our_toolchain == shared_toolchain,
    'workflow': workflow_inspection, 'packageIsPrivate': package['private'], 'packageDocumentation': package_documentation,
    'packageExports': package_exports, 'existingArtifacts': artifacts, 'existingArtifactChecksums': checksum_results,
    'existingNoticedPackages': noticed_packages, 'sourceHashes': source_hashes, 'procedureHashes': procedure_hashes,
    'noBuildInstallNetworkOrPackCommandExecuted': True}
print(json.dumps(report, indent=2))
sys.exit(bool(errors))
