import { LEGACY_CONNECTION_ID, isMapShape, perConnection, withConnection } from "./rig-connections.js";

/** A sole public catalog entry is unambiguous even when OpenRig has no default. */
export function effectiveScopeProject(explicit,selected,catalog) {
  if(explicit!=null)return explicit;
  if(selected!=null)return selected;
  const projects=Array.isArray(catalog?.projects)?catalog.projects:[];
  return projects.length===1&&typeof projects[0]?.id==='string'&&projects[0].id?projects[0].id:null;
}

/** Read a connection's remembered Scopes project pick, ignoring any id absent from a loaded project catalog. */
export function readScopeProject(shared, config, conn, catalog = null) {
  const raw = shared?.("rig.project");
  const many = (config?.connections ?? []).length > 1;
  let picked;
  if (many) {
    if (typeof conn !== "string" || !conn) return null;
    picked = isMapShape(raw) ? (Object.hasOwn(raw.byConnection, conn) ? raw.byConnection[conn] : undefined) : perConnection(raw, conn);
  } else {
    const id = (typeof conn === "string" && conn) || config?.connectionId || LEGACY_CONNECTION_ID;
    picked = isMapShape(raw) ? (Object.hasOwn(raw.byConnection, id) ? raw.byConnection[id] : undefined) : raw;
  }
  if (typeof picked !== "string" || !picked) return null;
  if (Array.isArray(catalog?.projects) && !catalog.projects.some((p) => p?.id === picked)) return null;
  return picked;
}

/** Store a connection's Scopes project pick; keeps the legacy flat string when one legacy connection is configured. */
export function writeScopeProject(host, config, conn, project) {
  const value = typeof project === "string" && project ? project : null;
  const many = (config?.connections ?? []).length > 1;
  const raw = host.shared?.("rig.project");
  const id = (typeof conn === "string" && conn) || (!many ? (config?.connectionId || LEGACY_CONNECTION_ID) : null);
  if (!id) return false;
  if (!many && id === LEGACY_CONNECTION_ID && !isMapShape(raw)) {
    host.setShared("rig.project", value);
    return true;
  }
  host.setShared("rig.project", withConnection(raw, id, value));
  return true;
}
