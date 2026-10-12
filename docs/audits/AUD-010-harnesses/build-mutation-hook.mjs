// AUD-010 build reviewer: a Node.js module hook for build-startup-mutations.mjs. It changes one
// compiled module of dist/ in memory as it loads, never on disk: AUD010_MUTATION holds
// {"id", "file", "search", "replace"}; the text `search` must occur exactly once in the module
// whose URL ends with `file`, or the load fails, so that a mutation can never silently miss.
// globalThis.aud010Applied counts the modules changed.
import { registerHooks } from "node:module";

const mutation = JSON.parse(process.env.AUD010_MUTATION ?? "null");
globalThis.aud010Applied = 0;
if (mutation !== null)
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!url.endsWith(mutation.file)) return result;
      const source = new TextDecoder().decode(result.source);
      const count = source.split(mutation.search).length - 1;
      if (count !== 1)
        throw new Error(`Mutation ${mutation.id}: "${mutation.search}" occurs ${count} times in ${mutation.file}.`);
      globalThis.aud010Applied += 1;
      return { ...result, source: source.replace(mutation.search, () => mutation.replace) };
    },
  });
