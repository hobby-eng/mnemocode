// Compare the existing build with current sources. Bind its identity separately before running.
// Imports are excluded; neither path calls the full self-test or a PDF/image renderer.
import { assertCoreSelfTest as baseline } from "../../../dist/cli/self-test.js";
import { assertCoreSelfTest as current } from "../../../src/cli/self-test.ts";
import { checkSskrKnownAnswers } from "../../../src/sskr/known-answers.ts";
import { nodeSharePlatform } from "../../../src/sskr/share-platform-node.ts";

const results = [];
const SAMPLES = 3;
for (const [label, check] of [
  ["existing-build", baseline],
  ["current-source", current],
]) {
  const milliseconds = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const started = performance.now();
    check();
    milliseconds.push(performance.now() - started);
  }
  results.push({ label, milliseconds });
}
const started = performance.now();
await checkSskrKnownAnswers(nodeSharePlatform);
results.push({
  label: "current-SSKR-first-use-including-engine-initialization",
  milliseconds: [performance.now() - started],
});
console.log(
  JSON.stringify(
    { results, meaning: "Observed local measurements, not a timing acceptance limit." },
    null,
    2,
  ),
);
