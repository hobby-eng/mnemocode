# AUD-007 checks

AUD-007 reviewed `4760919` with its working-tree changes (see the report). Its browser check was a
Node.js script. This repository admits no Node.js (TOOL-01), so the script stays with the audit's
local evidence, `AUD-007-evidence/browser-smoke.mjs`, and its two scenarios are Rust tests of the
WebAssembly binding, run natively on the public test data:

- the width range of the narrowest picture, 40 by 40 pixels, on Aida 14 and on linen 36:
  `the_narrowest_picture_offers_only_widths_that_are_taken_when_typed`;
- a card sheet whose hidden QR was turned on and off again keeps its ordinary QR choice:
  `the_hidden_qr_switch_keeps_the_ordinary_choice`.

Run them from the repository root:

```sh
cargo test --locked -p mnemocode-wasm --all-features narrowest_picture
cargo test --locked -p mnemocode-wasm --all-features hidden_qr_switch
```

Each prints one passed test; a failed assertion fails the command. They need no input beyond the
repository: the picture is drawn by `mnemocode_embroidery::sample::narrow_png`.
