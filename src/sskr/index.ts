// mnemocode/sskr for Node.js programs: the share functions with the self-test and the Node.js
// platform (shares.ts), share forms and transport, and the classes of the host-neutral share
// modules. A part of another program imports those modules themselves, never this aggregator.

export {
  splitSskrMnemonic,
  combineSskrShares,
  combineSskrShareSet,
  restoreShareSet,
  validateThreshold,
} from "./shares.js";
export type { RepairedSet } from "./joint-repair.js";
export {
  normalizeShare,
  shareToColors,
  colorsToShare,
  shareInfo,
  urToTransport,
  validateShareSet,
} from "./transport.js";
export type { ShareInfo } from "./transport.js";
export { readRepairableShare } from "./repair.js";
export type { ReadRepairableShare } from "./repair.js";
// The classes of the host-neutral share modules, with the Node.js platform to build them with.
export { ShareSet, ShareExport } from "./share-set.js";
export { ShareSplit } from "./split.js";
export { ShareInput } from "./share-input.js";
export { RepairReport } from "./repair-report.js";
export { nodeFillRandom, nodeSharePlatform } from "./share-platform-node.js";
export type { SharePlatform } from "./share-platform.js";
