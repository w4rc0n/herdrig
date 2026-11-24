import { appHome, layout, notify, panes, readTextFile, run as rawRun, setShared, shared, spaces, terminals } from "herdr";
import { gatedFetch, gatedRun, observeConfig } from "./rig-gate.js";
import { handleResolvedRigLink } from "./rig-link-open.js";
import { resolveLinkConfig, resolveRigLink } from "./rig-link-target.js";
import { syncRetainedOrigins } from "./rig-space-context.js";

const run = (name, args, conn) => gatedRun(rawRun, name, args, conn);
const fetchFor = (conn) => (url) => gatedFetch(url, undefined, undefined, conn);

export async function handleLink(click) {
  let rawText;
  try { rawText = await readTextFile(`${appHome()}/openrig/config.json`); }
  catch { return "pass"; }
  const config = resolveLinkConfig(rawText, () => shared("rig.data"));
  if (!config) return "pass";
  syncRetainedOrigins(config);
  const pathLink = click?.link?.kind === "file";
  const target = resolveRigLink(click, { config, ...(pathLink ? {
    spaces: spaces(), terminals: terminals(), panes: panes(), state: shared("rig.spaceState"),
  } : {}) });
  if (target.ok) observeConfig(config);
  const host = {
    spaces, panes, terminals, layout, shared, setShared, notify,
    run: (name, args) => run(name, args, target.conn),
    fetch: (url, conn) => fetchFor(conn)(url),
  };
  return handleResolvedRigLink(host, config, target, click?.source?.space);
}
