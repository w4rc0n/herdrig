import { appHome, layout, notify, panes, readTextFile, run as rawRun, setShared, shared, spaces, terminals } from "herdr";
import { parseConfig } from "./rig-core.js";
import { gatedFetch, gatedRun, numberedConfigReads } from "./rig-gate.js";
import { handleResolvedRigLink } from "./rig-link-open.js";
import { resolveLinkConfig, resolveRigLink } from "./rig-link-target.js";
import { syncRetainedOrigins } from "./rig-space-context.js";

const configReads = numberedConfigReads();
const READ_FAILED = Symbol("read-failed");
const run = (name, args, conn) => gatedRun(rawRun, name, args, conn);
const fetchFor = (conn) => (url) => gatedFetch(url, undefined, undefined, conn);

function readLinkConfig(rawText) {
  const resolved = rawText === READ_FAILED ? null : resolveLinkConfig(rawText, () => shared("rig.data"));
  if (resolved) return resolved;
  const base = parseConfig(rawText === READ_FAILED ? null : rawText);
  return {
    ...base,
    connections: [],
    configInvalid: base.configInvalid ?? "OpenRig settings are unavailable for links.",
    linkUnavailable: true,
  };
}

export async function handleLink(click) {
  const config = await configReads(async () => readLinkConfig(await Promise.resolve().then(() => readTextFile(`${appHome()}/openrig/config.json`)).catch(() => READ_FAILED)));
  if (!config || config.linkUnavailable || config.configInvalid) return "pass";
  syncRetainedOrigins(config);
  const pathLink = click?.link?.kind === "file";
  const target = resolveRigLink(click, { config, ...(pathLink ? {
    spaces: spaces(), terminals: terminals(), panes: panes(), state: shared("rig.spaceState"),
  } : {}) });
  const host = {
    spaces, panes, terminals, layout, shared, setShared, notify,
    run: (name, args) => run(name, args, target.conn),
    fetch: (url, conn) => fetchFor(conn)(url),
  };
  return handleResolvedRigLink(host, config, target, click?.source?.space);
}
