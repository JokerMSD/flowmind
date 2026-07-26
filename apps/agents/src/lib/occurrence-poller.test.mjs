import assert from "node:assert/strict";
import test from "node:test";

import { pollOccurrenceCycle } from "./occurrence-poller.js";

test("keeps the last occurrences when a polling cycle fails", async () => {
  const previousOccurrences = [{ id: "occurrence-1" }];

  const result = await pollOccurrenceCycle(async () => {
    throw new Error("API unavailable");
  }, previousOccurrences);

  assert.equal(result.occurrences, previousOccurrences);
  assert.ok(result.error instanceof Error);
});

test("polls again after an error and accepts the next successful result", async () => {
  const previousOccurrences = [{ id: "occurrence-1" }];
  const refreshedOccurrences = [{ id: "occurrence-2" }];
  let calls = 0;
  const loadOccurrences = async () => {
    calls += 1;
    if (calls === 1) throw new Error("API unavailable");
    return refreshedOccurrences;
  };

  const failedCycle = await pollOccurrenceCycle(loadOccurrences, previousOccurrences);
  const successfulCycle = await pollOccurrenceCycle(loadOccurrences, failedCycle.occurrences);

  assert.equal(calls, 2);
  assert.equal(failedCycle.occurrences, previousOccurrences);
  assert.equal(successfulCycle.occurrences, refreshedOccurrences);
  assert.equal(successfulCycle.error, null);
});
