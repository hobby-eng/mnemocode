# Hidden records in QR filler bytes

## Context

The owner approved a QR export choice for existing PDF and PNG outputs and a standalone wrapper.
Ordinary scanners show the printed contact or chosen public text; MnemoCode recovers the exact
selected codes, share or SeedStitch legend. The investigation is retained outside the repository
in workspace `tmp/colour-qr/`. Colour and microtext are outside this implementation.

## Decision

Keep the implementation in the existing QR module: `qr::hidden` owns the envelope, public mask,
capacity, generation, checked reading, QR placement and Reed–Solomon correction. It uses existing
qrcodegen, rqrr and sha2 dependencies. Existing ordinary QR reading still returns public text.
The hidden reader extracts the complete interleaved stream itself, using rqrr for detection and
format information. Correction is tested across all 40 level-M block layouts at their correction
bound against the independent qrcodegen encoder.

The envelope preserves exact UTF-8 records and has a 32-bit reading check; it adds no encryption.
The format, mask and nonstandard-padding limitation are public in `docs/HIDDEN_QR.md`. Generation
verifies the visible and hidden layers before returning a matrix or PNG. Capacity overflow is a
refusal; no record is truncated.

`CardSettings.hidden_qr` selects the same matrix factory in layout planning and rendering. The
public vCard uses the actual printed contact and omits the website. PDF sidecar PNGs use that same
contact. Each share has its own QR; this change never combines shares. A separate PNG may use
user-supplied public text. Ordinary export remains the default.

The CLI offers the choice in existing export questions, `--qr-hidden` and `--qr-text` for scripts,
and `qr-hide` / `qr-open` for existing records. Existing QR recovery sources try the hidden reader
before ordinary text. The WASM QR module and card export expose the same operations; the wallet-tools
host receives an integration handover with the field names and decoding order.

## Limits

A raw-byte tool detects the nonstandard filler. An ordinary scanner may enforce standard filler
and refuse the code; compatibility checks do not establish universal scanner support. Recreating a
QR from its visible content removes its hidden record. Physical printing is not established by
synthetic tests. Dates or passwords are never inserted into public text automatically.
