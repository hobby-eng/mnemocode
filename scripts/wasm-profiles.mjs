// The page profiles of wasm-profiles.json, for scripts/build-wasm.sh and the wasm gate.
//
//   node scripts/wasm-profiles.mjs list               every profile, one per line
//   node scripts/wasm-profiles.mjs features <profile> the cargo features of one, comma-separated
//   node scripts/wasm-profiles.mjs modules            every browser-* feature of the binding, one
//                                                    per line, for the clippy of each alone
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROFILES_FILE = fileURLToPath(new URL("../wasm-profiles.json", import.meta.url));
/** An edition and a page: lower-case words joined by hyphens, one slash between them. */
const PROFILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Every profile by name, each with its `modules` (browser-* features) and `units`. */
export function readProfiles() {
  const { profiles } = JSON.parse(readFileSync(PROFILES_FILE, "utf8"));
  for (const [name, profile] of Object.entries(profiles)) {
    if (!PROFILE_NAME.test(name)) throw new Error(`wasm-profiles.json: bad profile name ${name}`);
    for (const key of ["modules", "units"])
      if (!Array.isArray(profile[key]))
        throw new Error(`wasm-profiles.json: ${name} has no ${key}`);
  }
  return profiles;
}

/** The cargo features of one profile: its modules as browser-<module>, then its units. */
export function featuresOf(profile) {
  return [...profile.modules.map((module) => `browser-${module}`), ...profile.units];
}

/** The binding's browser-* features, as its manifest declares them. */
export function bindingModules() {
  const manifest = readFileSync(
    fileURLToPath(new URL("../crates/mnemocode-wasm/Cargo.toml", import.meta.url)),
    "utf8",
  );
  const features = /^\[features\]\n((?:[^[\n][^\n]*\n|\n)*)/mu.exec(manifest)?.[1] ?? "";
  return [...features.matchAll(/^(browser-[a-z]+)\s*=/gmu)].map((match) => match[1]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, name] = process.argv.slice(2);
  const profiles = readProfiles();
  if (command === "list" && name === undefined) {
    process.stdout.write(
      Object.keys(profiles)
        .map((key) => `${key}\n`)
        .join(""),
    );
  } else if (command === "modules" && name === undefined) {
    process.stdout.write(
      bindingModules()
        .map((feature) => `${feature}\n`)
        .join(""),
    );
  } else if (command === "features" && name in profiles) {
    process.stdout.write(`${featuresOf(profiles[name]).join(",")}\n`);
  } else {
    process.stderr.write(
      "usage: node scripts/wasm-profiles.mjs list | modules | features <profile>\n",
    );
    process.exit(2);
  }
}
