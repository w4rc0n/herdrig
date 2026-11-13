// Local entry point for the grid implementation shared with the verified remote relay.
const { gridMain, viewerArgs, ignoreSizeArgs, sizingClients, sizingChange, SIZING_INTERVAL_MS } = require("./rig-attach-relay.cjs");
module.exports = { viewerArgs, ignoreSizeArgs, sizingClients, sizingChange, SIZING_INTERVAL_MS };
if (require.main === module) gridMain(process.argv[2]);
