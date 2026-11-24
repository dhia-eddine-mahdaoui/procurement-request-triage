import { describe, expect, it } from "vitest";
import { runEval } from "../eval/run.js";

// Regression floors, set a little below the measured numbers (see README). The blind set is
// deliberately not tuned against, so its floor is low and its failures are documented.
describe("extraction eval", () => {
  it("keeps field accuracy above the recorded floors", async () => {
    const rep = await runEval();
    expect(rep.summary.dev.accuracy).toBeGreaterThanOrEqual(0.98);
    expect(rep.summary.heldout.accuracy).toBeGreaterThanOrEqual(0.95);
    expect(rep.summary.blind.accuracy).toBeGreaterThanOrEqual(0.8);
    expect(rep.summary.all.docs).toBe(30);
    expect(rep.summary.all.precision).toBeGreaterThanOrEqual(0.97); // a wrong value is worse than a missing one
  }, 60_000);
});
