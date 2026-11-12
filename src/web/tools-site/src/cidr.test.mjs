// Run: node --test src/web/tools-site/src/cidr.test.mjs (Node 22+ strips types; no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, split, findOverlaps, contains, parseIPv6, formatIPv6, parseCidr } from "./cidr.ts";

test("v4 /0", () => {
  const r = calculate("0.0.0.0/0");
  assert.equal(r.total, "4294967296");
  assert.equal(r.network, "0.0.0.0");
  assert.equal(r.broadcast, "255.255.255.255");
  assert.equal(r.netmask, "0.0.0.0");
  assert.equal(r.wildcard, "255.255.255.255");
  assert.equal(r.usable, "4294967294");
});

test("v4 /8", () => {
  const r = calculate("10.0.0.0/8");
  assert.equal(r.total, "16777216");
  assert.equal(r.broadcast, "10.255.255.255");
  assert.equal(r.netmask, "255.0.0.0");
  assert.equal(r.firstUsable, "10.0.0.1");
  assert.equal(r.lastUsable, "10.255.255.254");
  assert.equal(r.usable, "16777214");
});

test("v4 /24", () => {
  const r = calculate("192.168.1.0/24");
  assert.equal(r.total, "256");
  assert.equal(r.netmask, "255.255.255.0");
  assert.equal(r.wildcard, "0.0.0.255");
  assert.equal(r.broadcast, "192.168.1.255");
  assert.equal(r.firstUsable, "192.168.1.1");
  assert.equal(r.lastUsable, "192.168.1.254");
  assert.equal(r.usable, "254");
  assert.equal(r.prefix, 24);
});

test("v4 /30", () => {
  const r = calculate("10.0.0.4/30");
  assert.equal(r.total, "4");
  assert.equal(r.usable, "2");
  assert.equal(r.firstUsable, "10.0.0.5");
  assert.equal(r.lastUsable, "10.0.0.6");
  assert.equal(r.broadcast, "10.0.0.7");
});

test("v4 /31 (RFC 3021)", () => {
  const r = calculate("10.0.0.0/31");
  assert.equal(r.total, "2");
  assert.equal(r.usable, "2");
  assert.equal(r.firstUsable, "10.0.0.0");
  assert.equal(r.lastUsable, "10.0.0.1");
});

test("v4 /32 and bare address", () => {
  for (const input of ["10.1.2.3/32", "10.1.2.3"]) {
    const r = calculate(input);
    assert.equal(r.total, "1");
    assert.equal(r.usable, "1");
    assert.equal(r.firstUsable, "10.1.2.3");
    assert.equal(r.lastUsable, "10.1.2.3");
    assert.equal(r.netmask, "255.255.255.255");
    assert.equal(r.prefix, 32);
  }
});

test("AWS mode /16, /24, /28", () => {
  let r = calculate("10.0.0.0/16", true);
  assert.equal(r.usable, "65531");
  assert.equal(r.firstUsable, "10.0.0.4");
  assert.equal(r.lastUsable, "10.0.255.254");
  assert.equal(r.awsNote, undefined);
  r = calculate("10.0.0.0/24", true);
  assert.equal(r.usable, "251");
  assert.equal(r.firstUsable, "10.0.0.4");
  assert.equal(r.lastUsable, "10.0.0.254");
  r = calculate("10.0.0.0/28", true);
  assert.equal(r.usable, "11");
  assert.equal(r.firstUsable, "10.0.0.4");
  assert.equal(r.lastUsable, "10.0.0.14");
});

test("AWS mode outside /16-/28 gives awsNote, never a negative count", () => {
  for (const cidr of ["10.0.0.0/29", "10.0.0.0/8", "10.0.0.0/32"]) {
    const r = calculate(cidr, true);
    assert.match(r.awsNote, /\/16 to \/28/);
    assert.ok(BigInt(r.usable) > 0n);
  }
  assert.equal(calculate("10.0.0.0/29", true).usable, "6");
});

test("v6 /0, /64, /127, /128", () => {
  let r = calculate("::/0");
  assert.equal(r.family, 6);
  assert.equal(r.total, "340282366920938463463374607431768211456");
  assert.equal(r.totalPow, "2^128");
  assert.equal(r.last, "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff");
  r = calculate("2001:db8:abcd:12::/64");
  assert.equal(r.total, "18446744073709551616");
  assert.equal(r.totalPow, "2^64");
  assert.equal(r.network, "2001:db8:abcd:12::");
  assert.equal(r.last, "2001:db8:abcd:12:ffff:ffff:ffff:ffff");
  r = calculate("2001:db8::/127");
  assert.equal(r.total, "2");
  assert.equal(r.last, "2001:db8::1");
  r = calculate("2001:db8::5/128");
  assert.equal(r.total, "1");
  assert.equal(r.totalPow, "2^0");
  assert.equal(r.network, "2001:db8::5");
});

test("v6 address forms", () => {
  assert.equal(parseIPv6("::"), 0n);
  assert.equal(parseIPv6("::1"), 1n);
  assert.equal(calculate("::").cidr, "::/128");
  assert.equal(calculate("::1").cidr, "::1/128");
  const r = calculate("2001:db8::/32");
  assert.equal(r.network, "2001:db8::");
  assert.equal(r.last, "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff");
  assert.equal(r.totalPow, "2^96");
  assert.equal(parseIPv6("::ffff:1.2.3.4"), 0xffff01020304n);
  assert.equal(formatIPv6(parseIPv6("::FFFF:1.2.3.4")), "::ffff:102:304");
  assert.equal(parseIPv6("2001:DB8::A"), parseIPv6("2001:db8::a"));
  assert.equal(parseIPv6("1:2:3:4:5:6:1.2.3.4"), parseIPv6("1:2:3:4:5:6:102:304"));
});

test("canonical IPv6 formatting (RFC 5952)", () => {
  assert.equal(formatIPv6(parseIPv6("2001:0db8:0000:0000:0000:0000:0000:0001")), "2001:db8::1");
  assert.equal(formatIPv6(parseIPv6("2001:db8:0:0:1:0:0:1")), "2001:db8::1:0:0:1");
  assert.equal(formatIPv6(parseIPv6("2001:db8:0:1:1:1:1:1")), "2001:db8:0:1:1:1:1:1"); // single zero not compressed
  assert.equal(formatIPv6(parseIPv6("1:0:0:2:0:0:0:3")), "1:0:0:2::3"); // longest run wins
  assert.equal(formatIPv6(0n), "::");
});

test("host bits are normalised with a note", () => {
  const p = parseCidr("10.0.0.5/24");
  assert.equal(p.prefix, 24);
  assert.match(p.note, /10\.0\.0\.0\/24/);
  const r = calculate("10.0.0.5/24");
  assert.equal(r.network, "10.0.0.0");
  assert.match(r.note, /normalised to 10\.0\.0\.0\/24/);
  assert.equal(calculate("10.0.0.0/24").note, undefined);
  assert.match(calculate("2001:db8::1/64").note, /2001:db8::\/64/);
});

test("invalid input throws clear errors", () => {
  assert.throws(() => calculate("10.0.0.256/24"), /greater than 255/);
  assert.throws(() => calculate("010.0.0.1"), /leading zero/);
  assert.throws(() => calculate("10.0.0.1/33"), /out of range/);
  assert.throws(() => calculate("::1/129"), /out of range/);
  assert.throws(() => calculate("1::2::3"), /more than one '::'/);
  assert.throws(() => calculate("1:2:3:4:5:6:7:8:9"), /too many groups/);
  assert.throws(() => calculate("12345::1"), /longer than 4 hex digits/);
  assert.throws(() => calculate("1:2:3"), /expected 8 groups/);
  assert.throws(() => calculate("10.0.0/24"), /four octets/);
  assert.throws(() => calculate("10..0.1"), /empty octet/);
  assert.throws(() => calculate("10.0.0.1/abc"), /prefix/);
  assert.throws(() => calculate("10.0.0.1/-1"), /prefix/);
  assert.throws(() => calculate(""), /Enter a CIDR/);
  assert.throws(() => calculate("hello"), /not a valid/);
  assert.throws(() => calculate("g::1"), /hexadecimal/);
});

test("split 10.0.0.0/16 into /18", () => {
  const r = split("10.0.0.0/16", { prefix: 18 });
  assert.equal(r.total, "4");
  assert.equal(r.shown, 4);
  assert.deepEqual(r.subnets, ["10.0.0.0/18", "10.0.64.0/18", "10.0.128.0/18", "10.0.192.0/18"]);
  assert.equal(r.note, undefined);
});

test("split into 3 rounds up to 4", () => {
  const r = split("10.0.0.0/16", { count: 3 });
  assert.equal(r.prefix, 18);
  assert.equal(r.total, "4");
  assert.equal(r.subnets.length, 4);
  assert.match(r.note, /rounded up to 4/);
  assert.equal(split("10.0.0.0/16", { count: 4 }).note, undefined);
});

test("split limits and errors", () => {
  const big = split("10.0.0.0/8", { prefix: 24 });
  assert.equal(big.total, "65536");
  assert.equal(big.subnets.length, 256);
  assert.equal(big.shown, 256);
  assert.equal(big.subnets[255], "10.0.255.0/24");
  const v6 = split("2001:db8::/32", { prefix: 64 });
  assert.equal(v6.total, "4294967296");
  assert.equal(v6.subnets.length, 256);
  assert.equal(split("10.0.0.0/24", { prefix: 24 }).subnets.length, 1);
  assert.throws(() => split("10.0.0.0/24", { prefix: 16 }), /larger than the parent/);
  assert.throws(() => split("10.0.0.0/24", { prefix: 33 }), /out of range/);
  assert.throws(() => split("10.0.0.0/30", { count: 16 }), /beyond \/32/);
  assert.throws(() => split("10.0.0.0/24", { count: 0 }), /at least 1/);
  assert.throws(() => split("10.0.0.0/24", {}), /Choose/);
});

test("overlap: containment, identical, disjoint, mixed families, bad line", () => {
  const r = findOverlaps(
    ["10.0.0.0/8", "10.1.0.0/16", "", "192.168.0.0/24", "192.168.0.0/24", "172.16.0.0/12", "::/0", "bogus", "2001:db8::/32"].join("\n"),
  );
  assert.equal(r.checked, 7);
  assert.deepEqual(r.errors.map((e) => e.line), [8]);
  assert.match(r.errors[0].message, /not a valid/);
  const msgs = r.pairs.map((p) => p.message);
  assert.ok(msgs.includes("line 1 (10.0.0.0/8) contains line 2 (10.1.0.0/16)"));
  assert.ok(msgs.includes("line 4 (192.168.0.0/24) is identical to line 5 (192.168.0.0/24)"));
  assert.ok(msgs.includes("line 7 (::/0) contains line 9 (2001:db8::/32)"));
  assert.equal(r.pairs.length, 3); // /0 v6 never overlaps v4; 172.16/12 is disjoint
});

test("overlap: reversed containment wording and no overlaps", () => {
  const r = findOverlaps("10.1.0.0/16\r\n10.0.0.0/8");
  assert.equal(r.pairs[0].message, "line 2 (10.0.0.0/8) contains line 1 (10.1.0.0/16)");
  const none = findOverlaps("10.0.0.0/24\n10.0.1.0/24");
  assert.equal(none.pairs.length, 0);
  assert.equal(findOverlaps("").checked, 0);
});

test("contains: true, false, cross-family", () => {
  assert.equal(contains("10.0.0.77", "10.0.0.0/24").contains, true);
  assert.equal(contains("10.0.1.1", "10.0.0.0/24").contains, false);
  assert.equal(contains("2001:db8::1", "2001:db8::/32").contains, true);
  assert.equal(contains("2001:db9::1", "2001:db8::/32").contains, false);
  const cross = contains("10.0.0.1", "::/0");
  assert.equal(cross.contains, false);
  assert.match(cross.message, /cannot overlap/);
  assert.throws(() => contains("10.0.0.256", "10.0.0.0/8"), /greater than 255/);
  assert.throws(() => contains("10.0.0.1", "10.0.0.0/40"), /out of range/);
  assert.throws(() => contains("10.0.0.0/8", "10.0.0.0/8"), /plain address/);
});
