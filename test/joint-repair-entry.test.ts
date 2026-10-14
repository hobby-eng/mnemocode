// The joint repair's entry, mnemocode/sskr/joint-repair, gives the names of what its plans and
// repairs hold, as it did before the CORE-15 split moved them into modules without an entry
// (AUD-024-API001). The type checks run in the test tsconfig of pnpm check: a name missing from
// the entry fails it.
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DIGEST_BITS,
  type ElementHelp,
  type JointAssessment,
  type JointPlan,
  type MarkedElement,
  type RepairedSet,
  type RepairedShares,
  type RepairSearch,
  type ShareAssessment,
} from "../src/sskr/joint-repair.js";

describe("the joint repair's entry", () => {
  it("gives the width of the digest that bc-shamir keeps beside the secret, 4 bytes", () => {
    expect(DIGEST_BITS).toBe(32);
  });

  it("names the types of a plan's assessment and of a repaired set", () => {
    expectTypeOf<JointPlan["assessment"]>().toEqualTypeOf<JointAssessment>();
    expectTypeOf<JointAssessment["shares"][number]>().toEqualTypeOf<ShareAssessment>();
    expectTypeOf<JointAssessment["helps"][number]>().toEqualTypeOf<ElementHelp>();
    expectTypeOf<Awaited<ReturnType<JointPlan["search"]>>>().toEqualTypeOf<RepairSearch>();
    expectTypeOf<RepairSearch["sets"][number]>().toEqualTypeOf<RepairedSet>();
    expectTypeOf<RepairedSet>().toExtend<RepairedShares>();
    expectTypeOf<RepairedShares["unsettled"][number]>().toEqualTypeOf<MarkedElement>();
  });
});
