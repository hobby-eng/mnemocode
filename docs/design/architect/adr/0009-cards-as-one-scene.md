# Cards drawn as one scene, to PDF and to pixels in process

## Context

The TS writes card PDFs with pdf-lib, turns them into page images with pdftocairo through a pipe
(CAP-CARDS-PAGE-IMAGES) and, for a browser without Poppler, reads its own PDFs back into drawing
steps (CAP-CARDS-PDF-READER). pdftocairo receives the whole backup; after execve its memory is
dumpable, readable by the same user and swappable (platform report, N-NO-SECRET-CHILD). Preview
plans its decoys twice, once per output (defect).

## Decision

Templates and sheets draw into one scene (paths, text runs, images, QR modules). The scene is
written to PDF with pdf-writer and the bundled font (skrifa, subsetter; no shaper, since the owner dropped ligatures on 2026-10-27) and drawn to
pixels with tiny-skia, then encoded as PNG or JPEG; both come from the same plan. The browser gets
pixels from the binding's `cards` module. pdftocairo, the pipe and the PDF reader go (crates
report decision 5).

## Rejected alternatives

- Keeping pdftocairo: a secret in another program, a child process to allow, a dependency on the
  person's system.
- Rasterising the PDF in Rust: a PDF interpreter for our own output.

## Consequences

- PNG, JPEG and page pixels cannot be byte-equal to cairo's; their parity level is the owner's of 2026-10-27
  (PLAN, "Parity with TS 0.1.0"): equal decoded pixels for other PNG files, a measured tolerance
  for page images, PNG or JPEG (RUST-14).
- One plan per export; the CLI needs no child-process permission.
