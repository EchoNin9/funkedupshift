// URL shortener edge redirect (fus.fyi / stage.fus.fyi / e9.cx after cutover).
//
// Runs on viewer-request for the default (only) behavior of the shortener
// CloudFront distribution. Looks the request path up in the CloudFront
// KeyValueStore associated with this function (code -> destination URL,
// written by the tools Lambda on mint — see src/lambda/tools/handler.py)
// and short-circuits with a redirect. No origin fetch happens on either the
// hit or miss path; the distribution's S3 origin is a schema-required
// fallback only, never actually reached from here.
//
// This function has exactly one associated KeyValueStore, so cf.kvs() with
// no argument resolves it automatically.
import cf from "cloudfront";

var LANDING_URL = "https://funkedupshift.com/";

// kvs.get() returns a Promise in the cloudfront-js-2.0 runtime, so the
// handler must be async and await the lookup.
async function handler(event) {
  var request = event.request;
  var code = request.uri.replace(/^\/+/, "");

  if (!code) {
    return miss();
  }

  try {
    var kvsHandle = cf.kvs();
    var raw = await kvsHandle.get(code);
    if (!raw) {
      return miss();
    }
    return resolve(raw);
  } catch (err) {
    // Unknown key (kvs.get throws when missing) or any KVS error — fall
    // through to the branded landing redirect rather than surfacing a raw
    // edge error to the visitor.
    return miss();
  }
}

// KVS values are JSON `{"u": "<url>", "e": <epochSeconds>}` written by the
// tools Lambda on mint/expiry-update (see src/lambda/tools/handler.py).
// Expired links (e <= now) are a miss even though the KVS entry itself is
// still present — DynamoDB TTL removes the source-of-truth table row on its
// own schedule (not immediately), and this function never needs to see
// that; it just stops treating the entry as a hit once it's past e.
//
// Legacy tolerance: entries minted before expiry existed are plain
// (non-JSON) strings, so JSON.parse throws — those are treated as
// non-expiring hits.
//
// ponytail: a sweep that proactively deletes stale KVS entries once
// DynamoDB TTL fires is deliberately unbuilt for phase 1 — an expired entry
// just resolves to a miss here forever after e, at no correctness cost, and
// nothing currently reclaims the KVS storage it uses.
function resolve(raw) {
  var target = raw;
  try {
    var parsed = JSON.parse(raw);
    if (parsed && typeof parsed.u === "string") {
      if (typeof parsed.e === "number" && parsed.e <= Math.floor(Date.now() / 1000)) {
        return miss();
      }
      target = parsed.u;
    }
  } catch (err) {
    // Not JSON — legacy plain-string value; fall through with raw as target.
  }
  return {
    statusCode: 301,
    statusDescription: "Moved Permanently",
    headers: { location: { value: target } },
  };
}

function miss() {
  return {
    statusCode: 302,
    statusDescription: "Found",
    headers: { location: { value: LANDING_URL } },
  };
}
