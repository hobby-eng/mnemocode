import { matchBitcoinEvidence } from './dist/bitcoin-evidence.js';
import { Address, NETWORK } from '@scure/btc-signer';
import { readFile, writeFile, cp, mkdir, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const results = {};
const mnemonic =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const base = {
  kind: 'address',
  profiles: ['native-segwit'],
  location: { network: 'mainnet', account: 0, branch: 0, index: 0 },
};
results.address = {
  decodedLower: Address(NETWORK).decode(address),
  decodedUpper: Address(NETWORK).decode(address.toUpperCase()),
  lower: matchBitcoinEvidence(mnemonic, { ...base, value: address }),
  upper: matchBitcoinEvidence(mnemonic, { ...base, value: address.toUpperCase() }),
};
const root = '/tmp/mnemocode-aud-001/empty-catalog-probe';
await mkdir(root + '/vectors', { recursive: true });
await cp('./dist', root + '/dist', { recursive: true });
await writeFile(root + '/package.json', '{"type":"module"}');
for (const name of ['assets', 'vendor', 'node_modules'])
  await symlink(new URL('./' + name, import.meta.url).pathname, root + '/' + name).catch(
    (error) => {
      if (error.code !== 'EEXIST') throw error;
    },
  );
await writeFile(root + '/vectors/mnemocode-v1.json', JSON.stringify({ version: 1, vectors: [] }));
results.emptyCatalog = {
  stdout: execFileSync(process.execPath, [root + '/dist/mnemocode.js', 'self-test'], {
    encoding: 'utf8',
  }),
};
const packed = JSON.parse(
  await readFile('/tmp/mnemocode-aud-001/evidence/package-inventory.log', 'utf8'),
)[0].files.map((x) => x.path);
results.packageDocs = [
  'docs/SSKR.md',
  'docs/card-designs.md',
  'docs/card-identities.md',
  'docs/ARCHITECTURE.md',
  'docs/REVIEW.md',
].map((path) => ({ path, inPackage: packed.includes(path) }));
await writeFile(
  '/tmp/mnemocode-aud-001/evidence/extra-probes.json',
  JSON.stringify(
    results,
    (_, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v),
    2,
  ),
);
console.log(
  JSON.stringify(
    results,
    (_, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v),
    2,
  ),
);
