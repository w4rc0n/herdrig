import {rigOrigin} from './rig-space-context.js';
import {LEGACY_CONNECTION_ID} from './rig-connections.js';
// Keep the legacy keys readable; named connections remain separate even when
// they use the same daemon address.
export const workerConnectionId=config=>config?.connectionId&&config.connectionId!==LEGACY_CONNECTION_ID?[config.connectionId]:[];
export const workerIdentity=config=>JSON.stringify([rigOrigin(config?.daemonUrl),config?.daemonMachine,config?.rig??null,...workerConnectionId(config)]);
export const workerViewKey=(config,view)=>JSON.stringify([rigOrigin(config?.daemonUrl),config?.daemonMachine,view,...workerConnectionId(config)]);
