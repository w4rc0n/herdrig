// One connection's live state in the sidebar: its config, last data, stream socket and backoff. The sidebar holds one feed per connection
// (a list of one in a single-OpenRig setup, where the sidebar's own `config`, `data`, ... are the first feed's). Plain state: no I/O here.
export class ConnectionFeed {
  constructor(id = null) {
    this.id = id;
    this.config = null;
    this.data = null; // { topology, attention, at, ... } as this connection last read it
    this.error = null; // last read error
    this.needsApproval = false; // its last read: a herdr:// connection asking for its helper approval again ("Approve helper…")
    this.sidebarState = null;
    this.cliVersion = null;
    this.healthz = null;
    this.live = false; // its event stream is open
    this.eventPath = null;
    this.lists = {}; // path -> { data, error, at } lazily loaded lists, per connection
    this.delay = 1000; // the stream's reconnect backoff
    this.sock = null;
    this.hadDisconnect = false;
    this.forceCapabilityProbe = false;
    this.forceHelpProbe = false; // explicit Refresh/Retry; reconnects only invalidate live provider reads
    this.workerPreviewSupport = null;
    this.hostedReader = null; // this connection's connected-assistant roster reader
    this.providerProbe = null; // { key, at, value }: the cached live provider-availability read
    this.uiTimezone = undefined;
    this.refreshing = false;
    this.again = false;
    this.prioritySeeded = false; // its needs notifications have seen one read (the first is silent)
    this.fullAttention = null; // its background whole attention list: { key, data, ms, nextAt, pending, unsupported, error }
  }

  /** The connection now means another OpenRig (its address, home or machine changed): nothing read from the old one stays, so no row of it is drawn or acted on under the new identity,
   *  and the new one is read from scratch (capabilities probed again, backoff started over, its first needs read silent). The stream and the refresh in flight are the caller's. */
  moved() {
    this.data = null; this.error = null; this.needsApproval = false; this.sidebarState = null; this.cliVersion = null; this.healthz = null; this.terminalOutage = null; this.lossReadHealthz = null; this.live = false; this.lists = {}; this.uiTimezone = undefined;
    this.workerPreviewSupport = null; this.providerProbe = null; this.hostedReader = null; this.prioritySeeded = false; this.fullAttention = null;
    this.delay = 1000; this.hadDisconnect = false; this.forceCapabilityProbe = true;
    this.eventPath = null;
    this.forceHelpProbe = true;
  }
}
