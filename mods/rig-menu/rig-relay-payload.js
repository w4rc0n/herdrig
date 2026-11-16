// The send gate's reading of the attach relay's payload: [node, <...>/rig-attach-relay.cjs, base64 JSON]. The relay (a standalone file installed on machines, pinned by its SHA-256) decodes with Buffer,
// while this portable plain JS accepts and rejects exactly what the relay does: canonical base64, at most 16 KiB, strict UTF-8, a JSON object.
// test/relay-payload-parity.test.mjs holds the two together over hostile payloads and a deterministic fuzz, so the gate and the relay cannot name different destinations for one payload.
const RELAY_MAX_PAYLOAD_BYTES = 16384;
const RELAY_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** The payload object of a base64 token; throws (with the relay's own wording) for anything but canonical base64 of at most 16 KiB of strict UTF-8 JSON that is an object. */
function relayDecodeToken(value) {
  if (typeof value !== "string" || !value || value.length > 4 * Math.ceil(RELAY_MAX_PAYLOAD_BYTES / 3)) throw new Error("payload is missing or too large");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("payload is not canonical base64");
  const bytes = [];
  let acc = 0, bits = 0;
  for (const ch of value.replace(/=+$/, "")) {
    acc = (acc << 6) | RELAY_B64.indexOf(ch); bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); acc &= (1 << bits) - 1; }
  }
  if (bytes.length > RELAY_MAX_PAYLOAD_BYTES) throw new Error("payload is not canonical base64");
  let again = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    again += RELAY_B64[(n >> 18) & 63] + RELAY_B64[(n >> 12) & 63] + (i + 1 < bytes.length ? RELAY_B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? RELAY_B64[n & 63] : "=");
  }
  if (again !== value) throw new Error("payload is not canonical base64");
  let text = "";
  for (let i = 0; i < bytes.length;) { // strict UTF-8: no overlong forms, no surrogates, nothing above U+10FFFF, no truncated or stray bytes
    const b = bytes[i];
    let need = 0, min = 0, cp = 0;
    if (b < 0x80) { text += String.fromCharCode(b); i++; continue; }
    if (b >= 0xc2 && b <= 0xdf) { need = 1; min = 0x80; cp = b & 0x1f; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; min = 0x800; cp = b & 0x0f; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; min = 0x10000; cp = b & 0x07; }
    else throw new Error("payload is not UTF-8");
    for (let k = 1; k <= need; k++) { const c = bytes[i + k]; if (c === undefined || (c & 0xc0) !== 0x80) throw new Error("payload is not UTF-8"); cp = (cp << 6) | (c & 0x3f); }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new Error("payload is not UTF-8");
    text += String.fromCodePoint(cp); i += need + 1;
  }
  const cfg = JSON.parse(text);
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("payload is not an object");
  return cfg;
}
/** The daemon a relay will read: a local HTTP(S) origin, normalised; anything else is "" (the relay contacts no daemon). */
function relayDaemonOrigin(value) {
  if (typeof value !== "string") return "";
  const m = /^(https?):\/\/(localhost|\[::1\]|0\.0\.0\.0|127\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?\/?$/i.exec(value.trim());
  if (!m) return "";
  const scheme = m[1].toLowerCase(), host = m[2].toLowerCase(), port = m[3] == null ? null : Number(m[3]);
  if (host.startsWith("127.") && host.split(".").some((part) => Number(part) > 255 || String(Number(part)) !== part)) return "";
  if (port !== null && (port < 1 || port > 65535)) return "";
  return `${scheme}://${host}${port !== null && port !== (scheme === "https" ? 443 : 80) ? `:${port}` : ""}`;
}

/** The payload object of a relay argv token, or null (the relay would refuse it, so it reaches no daemon). */
export function decodeRelayToken(token) { try { return relayDecodeToken(token); } catch { return null; } }
export { relayDaemonOrigin };
