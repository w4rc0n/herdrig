// Pure herdr://<machine>/<hostId> URL parsing shared by the send gate and the Herdr HTTP transport.
const MACHINE = "[a-z0-9][a-z0-9._-]{0,31}";
const HOST = "[A-Za-z0-9._:-]{1,128}";
const HERDR_URL = new RegExp(`^herdr://(${MACHINE})/(${HOST})(/[^#\\s]*)?$`);

export const herdrOrigin = (machine, hostId) => `herdr://${machine}/${hostId}`;
export const isHerdrUrl = (url) => typeof url === "string" && url.startsWith("herdr://");

/** `{machine, hostId, origin, path}` of a herdr:// URL, or null. */
export function parseHerdrUrl(url) {
  const m = HERDR_URL.exec(String(url ?? ""));
  return m ? { machine: m[1], hostId: m[2], origin: herdrOrigin(m[1], m[2]), path: m[3] || "/" } : null;
}
