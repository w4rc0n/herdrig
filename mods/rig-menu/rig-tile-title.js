const clean = value => String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();

/** Presentation only: never use a title to establish terminal ownership. */
export function workerPaneTitle(seat, label = "") {
  const id = clean(seat?.logicalId) || clean(label);
  const slice = Array.from(clean(seat?.activeSlice ?? seat?.slice));
  const part = slice.length > 24 ? slice.slice(0, 23).join("") + "…" : slice.join("");
  return [id, part].filter(Boolean).join(" · ");
}

export function tileTitle(seat, { label = "", runtime = null, readOnly = false } = {}) {
  return [workerPaneTitle(seat, label), clean(runtime ?? seat?.runtime) || "unreported"].filter(Boolean).join(" · ") + (readOnly ? " · read-only" : "");
}

export function gridViewerPayload(argv) {
  if (argv?.[0] === "env" && /^HERDR_OPENRIG_GRID_TILE=[a-z0-9-]+$/.test(argv[1] ?? "")) argv = argv.slice(2);
  if (!Array.isArray(argv) || argv.length !== 3 || typeof argv[2] !== "string"
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(argv[2])) return null;
  try {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let value = 0, bits = 0, escaped = "";
    for (const ch of argv[2].replace(/=+$/, "")) {
      value = (value << 6) | alphabet.indexOf(ch); bits += 6;
      if (bits >= 8) { bits -= 8; escaped += "%" + ((value >>> bits) & 255).toString(16).padStart(2, "0"); }
    }
    const payload = JSON.parse(decodeURIComponent(escaped));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch { return null; }
}

/** Planned equivalence ignores presentation; live/recorded argv must still match exactly. */
export function gridViewerIdentity(argv) {
  if (argv?.[0] === "env" && /^HERDR_OPENRIG_GRID_TILE=[a-z0-9-]+$/.test(argv[1] ?? "")) argv = argv.slice(2);
  const payload = gridViewerPayload(argv);
  return payload ? [argv[0], argv[1], Object.keys(payload).filter(k => k !== "title").sort().map(k => [k, payload[k]])] : argv;
}
