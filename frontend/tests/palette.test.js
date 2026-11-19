import test from "node:test";
import assert from "node:assert/strict";
import { fuzzyScore } from "../src/palette.js";

test("子序列匹配成功且大小写不敏感", () => {
  assert.ok(fuzzyScore("New File", "nf") >= 0);
  assert.ok(fuzzyScore("New File", "NF") >= 0);
});

test("不匹配返回 -1", () => {
  assert.equal(fuzzyScore("New File", "xyz"), -1);
  assert.equal(fuzzyScore("abc", "abcd"), -1);
});

test("连续命中得分高于分散命中", () => {
  assert.ok(fuzzyScore("abc", "ab") > fuzzyScore("a-b-c", "ab"));
});

test("越靠前的命中得分越高", () => {
  assert.ok(fuzzyScore("abc", "a") > fuzzyScore("xxabc", "a"));
});

test("空查询返回 0 附近分值（不报错）", () => {
  assert.ok(fuzzyScore("abc", "") > -1);
});
