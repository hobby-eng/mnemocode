# Changelog

## 0.1.0 (unreleased)

### Formats

- `colors-unicode` is written as four-digit codes instead of Private Use symbols, which many programs could not show. The symbol form can still be decoded.

### Recovery

- `recover-date` accepts `?` for each forgotten digit and up to three incomplete dates. Identical patterns are not tried twice, and a limit stops a search that is too large before it starts.
- Added `recover-word`. It lists every word that can replace one forgotten word and marks the candidates that match a known detail of the wallet. With `--legacy-valid-last-word` it lists the valid last words of a legacy phrase.
- A date needs a four-digit year. `23-09-26` was read as the year 23 and is now an error.

### Secret handling

- MnemoCode clears its temporary copies of the phrase data after use.

### Card exports

- Every collection, including A4, is one page laid out as a design proposal.
- A collection sheet has a dark page with a grey world map, a centred heading, and the slogan in the bottom line. Light cards have a light page.
- The optional QR code of a collection has its own corner on the same page. No separate QR page is made.
- Individual cards have no QR code.
- `--page-size business` gives separate numbered cards, one per page. `a6` and `a4` give one sheet, and `a6` is the default for every template. The `wallet` size is removed.
- Images are made with the Poppler program `pdftocairo`. The rounded corners of a separate card are transparent in PNG.
- Separate business cards print their number and the size of the set before the code.
- Invented email and website addresses end in `.example`, so they cannot belong to a real company.
- `--cards-dir` is refused together with a sheet size.
- Each Shamir share has its own page, and a QR code holds exactly one share.
- Other programs can render the same cards through the `mnemocode/cards` entry point, which has no Node.js dependency. A card session keeps the same invented person, company and studio for every export of one working session.
- Text on business cards is aligned with its icon or logo, and a role no longer touches the name above it.

### Toolchain and dependencies

- The development runtime is Node.js 26.10.0.
- Updated the npm dependencies, including Vitest 5.0.2 with its V8 coverage provider, TypeScript 7.0.2, Prettier 3.9.9, tsx 4.23.15 and `@types/node` 26.6.3.
- Pinned pnpm 10.19.0. A toolchain check makes CI read the Node.js version from `.node-version` and the pnpm version from `package.json`.
- The npm package includes the guides for shares, cards and the source layout.

### Audit remediation

- Fixed every AUD-002 finding: the address error that blocked the release, size limits for secret files, strict whole numbers in options, clear errors for wallet details and paths, checks of the PNG structure, the integrity of audit records, and outdated documentation.
- Added regression tests for wallet details, numeric options, size limits of secret files, missing and nested paths, and malformed PNG files.
- Added `pnpm test:coverage` for V8 coverage reports.
