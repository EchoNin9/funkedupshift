// Pure CIDR / subnet math. BigInt throughout so IPv4 and IPv6 share one code path.
// Keep this file erasable-syntax only (no enum/namespace/parameter properties): node's
// type stripping runs it directly in cidr.test.mjs. A byte-identical copy lives in the SPA.

export type Family = 4 | 6;

export interface ParsedCidr {
  family: Family;
  /** Network address (host bits cleared). */
  network: bigint;
  prefix: number;
  /** Set when host bits were present in the input and were cleared. */
  note?: string;
}

export interface V4Result {
  family: 4;
  cidr: string;
  network: string;
  broadcast: string;
  netmask: string;
  wildcard: string;
  prefix: number;
  total: string;
  firstUsable: string;
  lastUsable: string;
  usable: string;
  note?: string;
  awsNote?: string;
}

export interface V6Result {
  family: 6;
  cidr: string;
  network: string;
  last: string;
  prefix: number;
  total: string;
  totalPow: string;
  note?: string;
}

export type CalcResult = V4Result | V6Result;

export interface SplitResult {
  parent: string;
  prefix: number;
  total: string;
  subnets: string[];
  shown: number;
  note?: string;
}

export interface OverlapPair {
  a: string;
  b: string;
  message: string;
}

export interface OverlapResult {
  pairs: OverlapPair[];
  errors: { line: number; message: string }[];
  checked: number;
}

// ponytail: split lists at most this many subnets; the UI says "showing first 256 of N".
export const MAX_SPLIT_LIST = 256;

const maxBits = (f: Family): number => (f === 4 ? 32 : 128);
const hostMask = (f: Family, prefix: number): bigint => (1n << BigInt(maxBits(f) - prefix)) - 1n;

export function parseIPv4(input: string): bigint {
  const s = input.trim();
  const parts = s.split(".");
  if (parts.length !== 4) throw new Error(`"${s}" is not a valid IPv4 address: expected four octets like 192.168.0.1.`);
  let v = 0n;
  for (const p of parts) {
    if (p === "") throw new Error(`"${s}" is not a valid IPv4 address: empty octet.`);
    if (!/^[0-9]+$/.test(p)) throw new Error(`"${s}" is not a valid IPv4 address: "${p}" is not a decimal number.`);
    if (p.length > 1 && p.startsWith("0")) {
      throw new Error(`"${s}" is ambiguous: octet "${p}" has a leading zero (it could be read as octal). Remove the leading zero.`);
    }
    const n = Number(p);
    if (n > 255) throw new Error(`"${s}" is not a valid IPv4 address: octet ${n} is greater than 255.`);
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

export function parseIPv6(input: string): bigint {
  const s = input.trim();
  const bad = (why: string) => new Error(`"${s}" is not a valid IPv6 address: ${why}.`);
  if (s === "") throw bad("empty address");
  if (s.includes("%")) throw bad("zone identifiers (%) are not supported");
  if (s.includes(":::")) throw bad("unexpected ':::'");
  const halves = s.split("::");
  if (halves.length > 2) throw bad("more than one '::'");
  const compressed = halves.length === 2;
  const toGroups = (t: string): string[] => (t === "" ? [] : t.split(":"));
  let head = toGroups(halves[0]);
  let tail = compressed ? toGroups(halves[1]) : [];
  if (!compressed) head = s.split(":");
  // Embedded IPv4 tail occupies the last two groups.
  const last = compressed ? tail : head;
  if (last.length > 0 && last[last.length - 1].includes(".")) {
    const v4 = parseIPv4(last[last.length - 1]);
    last.splice(last.length - 1, 1, ((v4 >> 16n) & 0xffffn).toString(16), (v4 & 0xffffn).toString(16));
  }
  const all = head.concat(tail);
  for (const g of all) {
    if (g === "") throw bad("empty group");
    if (g.length > 4) throw bad(`group "${g}" is longer than 4 hex digits`);
    if (!/^[0-9a-fA-F]+$/.test(g)) throw bad(`"${g}" is not hexadecimal`);
  }
  if (compressed ? all.length > 7 : all.length !== 8) {
    throw bad(all.length > 8 || compressed ? "too many groups" : "expected 8 groups");
  }
  const zeros = compressed ? 8 - all.length : 0;
  const groups = head.concat(new Array(zeros).fill("0"), tail);
  let v = 0n;
  for (const g of groups) v = (v << 16n) | BigInt(parseInt(g, 16));
  return v;
}

export function formatIPv4(v: bigint): string {
  return [24n, 16n, 8n, 0n].map((sh) => ((v >> sh) & 0xffn).toString()).join(".");
}

/** RFC 5952: lowercase, longest run of 2+ zero groups compressed, leftmost on ties. */
export function formatIPv6(v: bigint): string {
  const g: number[] = [];
  for (let i = 7; i >= 0; i--) g.push(Number((v >> BigInt(i * 16)) & 0xffffn));
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = g.map((n) => n.toString(16));
  if (bestLen < 2) return hex.join(":");
  return hex.slice(0, bestStart).join(":") + "::" + hex.slice(bestStart + bestLen).join(":");
}

export const formatAddr = (f: Family, v: bigint): string => (f === 4 ? formatIPv4(v) : formatIPv6(v));

export function parseAddress(input: string): { family: Family; value: bigint } {
  const s = input.trim();
  if (s === "") throw new Error("Enter an IP address.");
  if (s.includes("/")) throw new Error(`"${s}" looks like a CIDR block; enter a plain address here.`);
  return s.includes(":") ? { family: 6, value: parseIPv6(s) } : { family: 4, value: parseIPv4(s) };
}

export function parseCidr(input: string): ParsedCidr {
  const s = input.trim();
  if (s === "") throw new Error("Enter a CIDR block like 10.0.0.0/24.");
  const slash = s.indexOf("/");
  const addrText = slash < 0 ? s : s.slice(0, slash);
  const { family, value } = parseAddress(addrText);
  const max = maxBits(family);
  let prefix = max;
  if (slash >= 0) {
    const p = s.slice(slash + 1).trim();
    if (!/^[0-9]{1,3}$/.test(p)) throw new Error(`"${p}" is not a valid prefix length; use a whole number 0-${max}.`);
    prefix = Number(p);
    if (prefix > max) throw new Error(`Prefix /${prefix} is out of range; IPv${family} prefixes run 0-${max}.`);
  }
  const network = value & ~hostMask(family, prefix);
  const out: ParsedCidr = { family, network, prefix };
  if (network !== value) {
    out.note = `Host bits were set in the input; normalised to ${formatAddr(family, network)}/${prefix}.`;
  }
  return out;
}

export function calculate(input: string, aws = false): CalcResult {
  const c = parseCidr(input);
  const hm = hostMask(c.family, c.prefix);
  const total = hm + 1n;
  const last = c.network | hm;
  const cidr = `${formatAddr(c.family, c.network)}/${c.prefix}`;
  if (c.family === 6) {
    return {
      family: 6, cidr, network: formatIPv6(c.network), last: formatIPv6(last), prefix: c.prefix,
      total: total.toString(), totalPow: `2^${128 - c.prefix}`, note: c.note,
    };
  }
  let first = c.network + 1n;
  let lastUsable = last - 1n;
  let usable = total - 2n;
  let awsNote: string | undefined;
  if (c.prefix === 32) {
    first = lastUsable = c.network;
    usable = 1n;
  } else if (c.prefix === 31) {
    first = c.network;
    lastUsable = last;
    usable = 2n;
  }
  if (aws) {
    if (c.prefix >= 16 && c.prefix <= 28) {
      first = c.network + 4n;
      lastUsable = last - 1n;
      usable = total - 5n;
    } else {
      awsNote = `AWS only allows VPC and subnet sizes from /16 to /28, so /${c.prefix} cannot be created; showing standard figures instead.`;
    }
  }
  return {
    family: 4, cidr, network: formatIPv4(c.network), broadcast: formatIPv4(last),
    netmask: formatIPv4(((1n << 32n) - 1n) ^ hm), wildcard: formatIPv4(hm), prefix: c.prefix,
    total: total.toString(), firstUsable: formatIPv4(first), lastUsable: formatIPv4(lastUsable),
    usable: usable.toString(), note: c.note, awsNote,
  };
}

/** Split a block by target prefix or into N subnets (N rounded up to a power of two). */
export function split(input: string, opts: { prefix?: number; count?: number }): SplitResult {
  const c = parseCidr(input);
  const max = maxBits(c.family);
  let target: number;
  let note = c.note;
  if (opts.prefix !== undefined) {
    if (!Number.isInteger(opts.prefix)) throw new Error("Target prefix must be a whole number.");
    target = opts.prefix;
    if (target < c.prefix) throw new Error(`Target /${target} is larger than the parent /${c.prefix}; choose /${c.prefix} or longer.`);
    if (target > max) throw new Error(`Target /${target} is out of range; IPv${c.family} prefixes run up to /${max}.`);
  } else if (opts.count !== undefined) {
    const n = opts.count;
    if (!Number.isInteger(n) || n < 1 || !Number.isSafeInteger(n)) throw new Error("Number of subnets must be a whole number of at least 1.");
    let bits = 0;
    while ((1n << BigInt(bits)) < BigInt(n)) bits++;
    target = c.prefix + bits;
    if (target > max) throw new Error(`/${c.prefix} cannot be split into ${n} subnets; that would need /${target}, beyond /${max}.`);
    if ((1n << BigInt(bits)) !== BigInt(n)) {
      const msg = `${n} is not a power of two; rounded up to ${1n << BigInt(bits)} subnets of /${target}.`;
      note = note ? `${note} ${msg}` : msg;
    }
  } else {
    throw new Error("Choose a target prefix or a number of subnets.");
  }
  const total = 1n << BigInt(target - c.prefix);
  const shown = total < BigInt(MAX_SPLIT_LIST) ? Number(total) : MAX_SPLIT_LIST;
  const step = 1n << BigInt(max - target);
  const subnets: string[] = [];
  for (let i = 0; i < shown; i++) subnets.push(`${formatAddr(c.family, c.network + BigInt(i) * step)}/${target}`);
  return { parent: `${formatAddr(c.family, c.network)}/${c.prefix}`, prefix: target, total: total.toString(), subnets, shown, note };
}

/** One CIDR per line; blank lines ignored. Per-line errors do not abort the list. */
export function findOverlaps(text: string): OverlapResult {
  const entries: { line: number; label: string; c: ParsedCidr; last: bigint }[] = [];
  const errors: { line: number; message: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === "") return;
    try {
      const c = parseCidr(raw);
      entries.push({
        line: i + 1, label: `${formatAddr(c.family, c.network)}/${c.prefix}`, c,
        last: c.network | hostMask(c.family, c.prefix),
      });
    } catch (e) {
      errors.push({ line: i + 1, message: e instanceof Error ? e.message : "Invalid CIDR." });
    }
  });
  const pairs: OverlapPair[] = [];
  // ponytail: O(n^2) pairwise compare; fine for hand-pasted lists, slow past a few thousand lines.
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const x = entries[i];
      const y = entries[j];
      if (x.c.family !== y.c.family) continue;
      if (x.c.network > y.last || y.c.network > x.last) continue;
      const nameX = `line ${x.line} (${x.label})`;
      const nameY = `line ${y.line} (${y.label})`;
      let message: string;
      if (x.c.network === y.c.network && x.c.prefix === y.c.prefix) message = `${nameX} is identical to ${nameY}`;
      else if (x.c.prefix < y.c.prefix) message = `${nameX} contains ${nameY}`;
      else message = `${nameY} contains ${nameX}`;
      pairs.push({ a: x.label, b: y.label, message });
    }
  }
  return { pairs, errors, checked: entries.length };
}

/** Is the address inside the block? Different families are simply false. */
export function contains(ip: string, cidr: string): { contains: boolean; message: string } {
  const a = parseAddress(ip);
  const c = parseCidr(cidr);
  const block = `${formatAddr(c.family, c.network)}/${c.prefix}`;
  const addr = formatAddr(a.family, a.value);
  if (a.family !== c.family) return { contains: false, message: `${addr} is IPv${a.family} but ${block} is IPv${c.family}; they cannot overlap.` };
  const inside = (a.value & ~hostMask(c.family, c.prefix)) === c.network;
  return { contains: inside, message: inside ? `${addr} is inside ${block}.` : `${addr} is not inside ${block}.` };
}
