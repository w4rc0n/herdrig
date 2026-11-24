import { addressParts } from "./rig-connections.js";
import { followedConnection } from "./rig-follow.js";
import { publishedConfigFor } from "./rig-gate.js";
import { parseConfig, sharedLoopbackDaemonUrl } from "./rig-core.js";
import { openRigSpaceContext } from "./rig-space-context.js";

/** Parse openrig/config.json and, for a single-connection install with no configured address,
 *  read the loopback address published by the Rig sidebar (`shared("rig.data")`).
 *  Corrupt or invalid config files return null and are never enriched from shared state. */
export function resolveLinkConfig(rawText, published) {
  if (rawText !== null && rawText !== undefined) {
    if (typeof rawText !== "string") return null;
    let parsed;
    try { parsed = JSON.parse(rawText); } catch { return null; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  }
  const base = parseConfig(rawText);
  if (base.configInvalid) return null;
  if (base.daemonUrl || (base.connections?.length ?? 0) !== 1) return base.missing ? null : base;
  const data = typeof published === "function" ? published() : published;
  if (data?.byConnection && typeof data.byConnection === "object" && Object.keys(data.byConnection).length > 1) return null;
  if (publishedConfigFor(base, data)?.configInvalid) return null;
  const discovered = sharedLoopbackDaemonUrl(base, data);
  const parts = discovered ? addressParts(discovered) : null;
  if (!discovered || !parts || parts.hostname === "0.0.0.0") return null;
  const normalized = discovered.replace(/\/+$/, "");
  const [only] = base.connections;
  return {
    ...base,
    missing: false,
    daemonUrl: normalized,
    daemonUrlSource: "cli",
    connections: [{ ...only, daemonUrl: normalized }],
  };
}

const pass = () => ({ ok: false, why: "pass" });
const ambiguous = () => ({ ok: false, why: "ambiguous" });
const validId = /^[A-Za-z0-9_][A-Za-z0-9._:-]{0,159}$/;
const queueId = /^qitem-[A-Za-z0-9_-]{1,121}$/;
const decodedId = (value) => {
  try {
    const id = decodeURIComponent(value);
    return validId.test(id) ? id : null;
  } catch { return null; }
};

function destination(path) {
  const [route, query = ""] = path.split("?", 2);
  const [, api, section, name, tail, extra] = route.split("/");
  if (api !== "api" || extra !== undefined) return null;
  const id = name === undefined ? null : decodedId(name);
  if (name !== undefined && !id) return null;
  if ((section === "queue" && id === "attention-aggregate" && !tail) || (section === "attention" && !id))
    return { entry: { section: "needs", needsTab: "requests" } };
  if (section === "queue" && queueId.test(id ?? "") && (tail === undefined || ["transitions", "update"].includes(tail)))
    return { queue: id };
  if (section === "rigs" && id && id !== "summary" && (tail === undefined || ["nodes", "sessions", "graph"].includes(tail)))
    return { entry: { section: "topology", kind: "rig", rigId: id } };
  if (section === "specs" && id && tail === undefined)
    return { entry: { section: "specs", id } };
  if ((section === "missions" || section === "slices") && id && tail === undefined) {
    const projects = query.split("&").filter(part => part.startsWith("project="));
    const project = projects.length === 1 ? decodedId(projects[0].slice(8)) : null;
    if (project) return { entry: { section: "scopes", [section.slice(0, -1)]: id, project } };
  }
  if (section === "health" && tail === undefined) {
    if (!id) return { entry: { section: "system", subview: "health" } };
    if (id.startsWith("health-")) return { entry: { section: "system", subview: "health", healthFinding: id } };
    if (queueId.test(id)) return { entry: { section: "system", subview: "health", healthQitem: id } };
  }
  if (section === "terminal" && id === "views" && (tail === undefined || /^(?:saved|rig):[A-Za-z0-9_][A-Za-z0-9._:-]{0,153}$/.test(decodedId(tail) ?? "")))
    return { entry: { section: "terminals", ...(tail === undefined ? {} : { view: decodedId(tail) }) } };
  return null;
}

/** Resolve the URL or detected path to an active, configured OpenRig only. */
export function resolveRigLink(click, { config, spaces = [], terminals = [], panes = [], state = {} } = {}) {
  const link = click?.link;
  if (!config || config.missing || config.configInvalid || !link || (link.kind !== "url" && link.kind !== "file")) return pass();
  if (link.kind === "file" && link.path) return pass();
  const text = typeof link.raw === "string" ? link.raw : "";
  const token = /^[^\s\\]+/.exec(text)?.[0]?.split("#", 1)[0];
  if (!token || /[\x00-\x1f\x7f]/.test(token)) return pass();
  let path = token, origin = null;
  if (link.kind === "url") {
    const http = /^https?:\/\/[^/?#]+(\/api\/.*)$/i.exec(token);
    origin = http ? addressParts(token)?.origin : null;
    if (!origin || addressParts(link.url)?.origin !== origin) return pass();
    path = http[1];
  }
  const [spelling, ...query] = path.split("?");
  path = [spelling.replace(/(?:\.$|:\d+(?::\d+)?$)/, ""), ...query].join("?");
  const target = path.startsWith("/api/") ? destination(path) : null;
  if (!target) return pass();

  const connections = config.connections ?? [];
  let connection;
  if (origin) {
    const matches = connections.filter(candidate => addressParts(candidate.daemonUrl)?.origin === origin);
    if (matches.length > 1) return ambiguous();
    connection = matches[0];
  } else {
    const space = spaces.find(candidate => candidate.id === click.source?.space);
    const links = space ? openRigSpaceContext([space], terminals, panes, state ?? {})[0]?.rigLinks ?? [] : [];
    const owner = followedConnection({ connections, space, links });
    connection = owner.why === "space" ? connections.find(candidate => candidate.id === owner.id)
      : connections.length === 1 ? connections[0] : null;
    if (!connection && connections.length > 1) return ambiguous();
  }
  const activeOrigin = addressParts(connection?.daemonUrl)?.origin;
  if (!activeOrigin) return pass();
  const conn = connection.id;
  return { ok: true, conn, origin: activeOrigin, ...target, ...(target.entry ? { entry: { ...target.entry, conn } } : {}) };
}
