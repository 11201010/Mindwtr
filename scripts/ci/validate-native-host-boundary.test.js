import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("native saved-state guard never exposes an adapter exception", () => {
  const source = readFileSync("apps/android-native/bundle/host-entry.ts", "utf8");
  const start = source.indexOf("const requireSaved =");
  expect(start).toBeGreaterThan(-1);
  const guardSource = source.slice(start, source.indexOf("\n};", start) + 3);
  const state = { persistenceFailure: null };
  const requireSaved = new Function("useTaskStore", guardSource + "; return requireSaved;")({ getState: () => state });
  expect(() => requireSaved()).not.toThrow();
  for (const message of ["x", "秘密a秘密", "https://name:secret@example.com", "raw private task text"]) {
    const failure = { message };
    state.persistenceFailure = failure;
    let thrown;
    try { requireSaved(); } catch (error) { thrown = error; }
    expect(thrown?.message).toBe("SAVE_FAILED: Previous changes could not be saved; retry before continuing");
    expect(state.persistenceFailure).toBe(failure);
  }
});
