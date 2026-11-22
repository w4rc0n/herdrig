// Wires the herdr:// transport (rig-openrig-http.js) into a mod: one call at init, so every view that reads OpenRig through the gate can reach an
// OpenRig over Herdr's connection. Each helper and bridge run goes through the gate under THAT connection's scope, and the approval to use OpenRig
// over Herdr's connection is kept in its own file (openrig-consent.json), apart from spec saving and Attach.
import { HerdrTransport, parseHerdrUrl } from './rig-openrig-http.js';
import { RemoteOpenRig } from './rig-openrig-remote.js';
import { registerHerdrTransport, gateGeneration } from './rig-gate.js';
import { configOfConnection, consentOf, consentText, LEGACY_CONNECTION_ID } from './rig-connections.js';

/** `env`: `{ execFor(scope), hcFor(scope), machines, wait, appHome(), readTextFile, writeTextFile, bridgePath(), config() }`: the mod's own gated
 *  exec and hc for a connection's scope, and its current config (it lists the connections). Returns the registered transport; its `release()` ends the registration (a view calls it when it closes). */
export function installHerdrTransport(env) {
  const transport = new HerdrTransport({
    generation: (scope) => gateGeneration(scope), // a write stops if its connection's settings change while it is staged
    connection: (scope, parsed) => {
      const conn = configOfConnection(env.config(), scope);
      // Only the address the connection itself names: a request built for another OpenRig sends nothing.
      if (!conn || conn.daemonUrl !== parsed.origin || conn.daemonMachine !== parsed.machine) throw Object.assign(Error("That address isn't the connection it was sent for. Nothing was sent."), { notSent: true });
      const id = conn.connectionId ?? LEGACY_CONNECTION_ID, file = `${env.appHome()}/openrig/openrig-consent.json`;
      const host = {
        exec: env.execFor(scope), hc: env.hcFor(scope),
        machines: env.machines, wait: env.wait, appHome: env.appHome(), openrigBridgePath: env.bridgePath(), writeText: env.writeTextFile,
        // A file that exists but can't be read (Herdr answers null only for a missing one): OpenRig was never asked, so it isn't an outage.
        readOpenRigConsent: async () => {
          let text;
          try { text = await env.readTextFile(file); } catch (e) { throw Object.assign(Error("Herdrig couldn't read its approvals file."), { approvalsUnreadable: true, notSent: true, cause: e }); }
          return consentOf(text, id);
        },
        writeOpenRigConsent: async (value) => { const previous = await env.readTextFile(file); return env.writeTextFile(file, consentText(previous, id, value).trimEnd(), previous ?? null); },
      };
      return { remote: new RemoteOpenRig(host), config: { ...conn, expectedHostId: parsed.hostId } };
    },
  });
  // Whether this view's own config still lists the connection (and, for a request, at the address it names): the gate skips a registration that doesn't.
  transport.knows = (scope, url) => {
    const conn = configOfConnection(env.config(), scope);
    if (!conn) return false;
    const parsed = url ? parseHerdrUrl(url) : null;
    return !url || (Boolean(parsed) && conn.daemonUrl === parsed.origin && conn.daemonMachine === parsed.machine);
  };
  transport.release = registerHerdrTransport(transport, { bridgePath: env.bridgePath }); // the view calls it when it closes
  return transport;
}
