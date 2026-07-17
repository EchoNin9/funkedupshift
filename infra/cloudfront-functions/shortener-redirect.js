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
    var target = await kvsHandle.get(code);
    if (!target) {
      return miss();
    }
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: { location: { value: target } },
    };
  } catch (err) {
    // Unknown key (kvs.get throws when missing) or any KVS error — fall
    // through to the branded landing redirect rather than surfacing a raw
    // edge error to the visitor.
    return miss();
  }
}

function miss() {
  return {
    statusCode: 302,
    statusDescription: "Found",
    headers: { location: { value: LANDING_URL } },
  };
}
