// Run: node --test src/web/tools-site/src/datafmt.test.mjs (Node 22+ strips types; no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatJson, minifyJson, sortKeysDeep, jsonErrorLocation, diffValues } from "./datafmt.ts";

const O = { sortKeys: false };

test("format with indent 2, 4 and tab", () => {
  const src = '{"a":1,"b":[1,2]}';
  assert.equal(formatJson(src, { indent: 2, sortKeys: false }), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  assert.equal(formatJson(src, { indent: 4, sortKeys: false }), '{\n    "a": 1,\n    "b": [\n        1,\n        2\n    ]\n}');
  assert.equal(formatJson(src, { indent: "tab", sortKeys: false }), '{\n\t"a": 1,\n\t"b": [\n\t\t1,\n\t\t2\n\t]\n}');
});

test("minify", () => {
  assert.equal(minifyJson('{ "a" : 1,\n "b" : [ 1, 2 ] }', O), '{"a":1,"b":[1,2]}');
  assert.equal(minifyJson('{"b":1,"a":2}', { sortKeys: true }), '{"a":2,"b":1}');
});

test("sortKeys is deep, sorts objects inside arrays, keeps array order", () => {
  const out = sortKeysDeep({ b: [{ z: 1, a: 2 }, { y: 1, x: 2 }], a: { d: 1, c: 2 } });
  assert.equal(JSON.stringify(out), '{"a":{"c":2,"d":1},"b":[{"a":2,"z":1},{"x":2,"y":1}]}');
  assert.equal(formatJson('{"b":2,"a":{"z":1,"y":2}}', { indent: 2, sortKeys: true }), '{\n  "a": {\n    "y": 2,\n    "z": 1\n  },\n  "b": 2\n}');
});

test("jsonErrorLocation: V8 'position N' on multi-line text", () => {
  // "{\n  \"a\": 1,\n  oops\n}": line 3 starts at index 12; o of oops is at index 14 -> column 3
  const text = '{\n  "a": 1,\n  oops\n}';
  assert.equal(text.indexOf("oops"), 14);
  assert.deepEqual(jsonErrorLocation(text, new Error("Unexpected token o in JSON at position 14")), { line: 3, column: 3 });
  // position 0 is line 1 column 1; position right after a newline is column 1
  assert.deepEqual(jsonErrorLocation(text, new Error("x at position 0")), { line: 1, column: 1 });
  assert.deepEqual(jsonErrorLocation(text, new Error("x at position 2")), { line: 2, column: 1 });
});

test("jsonErrorLocation: '(line L column C)' and Firefox forms", () => {
  assert.deepEqual(jsonErrorLocation("", new Error("Expected ',' or '}' after property value in JSON at position 17 (line 2 column 5)")), { line: 2, column: 5 });
  assert.deepEqual(jsonErrorLocation("", new Error("JSON.parse: expected ',' or '}' after property value in object at line 4 column 9 of the JSON data")), { line: 4, column: 9 });
});

test("jsonErrorLocation: null for an unrecognised message", () => {
  assert.equal(jsonErrorLocation("{}", new Error("something odd")), null);
  assert.equal(jsonErrorLocation("{}", "plain string"), null);
});

test("jsonErrorLocation: a real JSON.parse failure points at the bad line", () => {
  const text = '{\n  "a": 1,\n  "b": 2,\n  "c": oops,\n  "d": 4\n}';
  let err;
  try {
    JSON.parse(text);
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  const loc = jsonErrorLocation(text, err);
  assert.ok(loc, `no location from: ${err.message}`);
  assert.equal(loc.line, 4);
});

test("diffValues: key order is irrelevant", () => {
  assert.deepEqual(diffValues({ a: 1, b: { c: [1, 2], d: "x" } }, { b: { d: "x", c: [1, 2] }, a: 1 }), []);
});

test("diffValues: added, removed, changed scalar", () => {
  assert.deepEqual(diffValues({ a: 1 }, { a: 1, b: 2 }), [{ path: "$.b", kind: "added", after: 2 }]);
  assert.deepEqual(diffValues({ a: 1, b: 2 }, { a: 1 }), [{ path: "$.b", kind: "removed", before: 2 }]);
  assert.deepEqual(diffValues({ a: 1 }, { a: 2 }), [{ path: "$.a", kind: "changed", before: 1, after: 2 }]);
  assert.deepEqual(diffValues(1, 2), [{ path: "$", kind: "changed", before: 1, after: 2 }]);
});

test("diffValues: nested path and array length differences", () => {
  assert.deepEqual(diffValues({ a: { b: [0, { c: 1 }] } }, { a: { b: [0, { c: 2 }] } }), [{ path: "$.a.b[1].c", kind: "changed", before: 1, after: 2 }]);
  assert.deepEqual(diffValues([1], [1, 2]), [{ path: "$[1]", kind: "added", after: 2 }]);
  assert.deepEqual(diffValues([1, 2], [1]), [{ path: "$[1]", kind: "removed", before: 2 }]);
});

test("diffValues: type changes are 'changed'", () => {
  assert.deepEqual(diffValues({ a: { x: 1 } }, { a: [1] }), [{ path: "$.a", kind: "changed", before: { x: 1 }, after: [1] }]);
  assert.deepEqual(diffValues({ a: null }, { a: {} }), [{ path: "$.a", kind: "changed", before: null, after: {} }]);
});

test("diffValues: keys that are not identifiers are bracket-quoted", () => {
  assert.deepEqual(diffValues({ "my key": 1 }, { "my key": 2 }), [{ path: '$["my key"]', kind: "changed", before: 1, after: 2 }]);
});

test("a ~5 MB JSON formats in under 3 s", () => {
  const rows = [];
  for (let i = 0; rows.length < 40000; i++) rows.push({ id: i, name: `item-${i}`, tags: ["a", "b", "c"], nested: { x: i * 1.5, y: null, z: "lorem ipsum dolor sit amet" } });
  const text = JSON.stringify(rows);
  assert.ok(text.length > 4_500_000, `only ${text.length} bytes`);
  const t0 = performance.now();
  const out = formatJson(text, { indent: 2, sortKeys: true });
  const ms = performance.now() - t0;
  console.log(`5MB format: ${text.length} bytes in ${ms.toFixed(0)} ms`);
  assert.ok(out.length > text.length);
  assert.ok(ms < 3000, `took ${ms} ms`);
});
