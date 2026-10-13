import { test } from "node:test";
import assert from "node:assert/strict";
import { list, windows } from "./when.ts";

test("hours read as plain windows", () => {
  const v: (number | null)[] = Array(24).fill(null);
  for (let h = 6; h < 24; h++) v[h] = 10;
  v[7] = v[8] = 90;
  v[18] = 80;
  assert.deepEqual(windows(v, (x) => x < 50), ["before 07:00", "09:00–18:00", "after 19:00"]);
  assert.deepEqual(windows(v, (x) => x >= 75), ["07:00–09:00", "18:00–19:00"]);
  assert.equal(list(["a", "b", "c"]), "a, b and c");
  assert.equal(list(["a"]), "a");
});
