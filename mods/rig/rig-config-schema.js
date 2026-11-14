// Mod-owned controls for OpenRig's public `rig config --help`, its unknown-key `Valid keys:` response,
// and GET /api/config?view=browser (types/defaults/source/application). This imports no OpenRig code.
// Bounds absent from public help are conservative herdrig input policy, not a claim about daemon validation.
import {CONFIG_TIMEZONES} from "./rig-config-timezones.js";
export const CONFIG_SCHEMA_SOURCE = "rig config --help; rig config set -- unknown.key value (Valid keys); GET /api/config?view=browser";
const definitions = {};
function add(type, keys, options = {}) {
  for (const key of keys.split(/\s+/).filter(Boolean)) definitions[key] = { key, type, risk: "low", source: CONFIG_SCHEMA_SOURCE, ...options };
}
add("bool", `transcripts.enabled specs.builtins_visible skills.router_line.enabled onboarding.default_pack.enabled
  launch.non_interruptive launch.codex_login_shell ui.enabled recovery.auto_drive_provider_prompts
  feed.subscriptions.action_required feed.subscriptions.approvals feed.subscriptions.shipped feed.subscriptions.progress feed.subscriptions.audit_log
  runtime.codex.hooks_enabled policies.claude_compaction.enabled snapshots.periodic.enabled terminal.status_bar terminal.fixed_geometry
  terminal.inherit_tmux_environment output.compact provider.usage_windows bundle.services_enabled usage.pi_cost_facts usage.pi_openrouter_charge
  transport.verify_input_box transport.local_user_guard decisions.enabled retention.enabled`);
add("int", `daemon.port`, { min: 0, max: 65535 });
add("int", `daemon.seat_poll_interval_ms`, { min: 1000, max: 2000, unit: "ms" });
add("int", `transcripts.lines`, { min: 1, max: 1000000 });
add("int", `transcripts.poll_interval_seconds`, { min: 1, max: 3600, unit: "s" });
add("int", `runtime.readiness_timeout_seconds`, { min: 1, max: 600, unit: "s" });
add("int", `terminal.history_limit`, { min: 2000, max: 1000000 });
add("int", `health.context_pressure.warning_percent health.context_pressure.critical_percent policies.claude_compaction.threshold_percent`, { min: 1, max: 100, unit: "%" });
add("int", `ui.preview.refresh_interval_seconds ui.preview.max_pins ui.preview.default_lines
  policies.idle_gate_qitem.scan_interval_seconds policies.idle_gate_qitem.active_wake_interval_seconds
  snapshots.periodic.retention_keep output.whoami_peers retention.transitions_days retention.watchdog_days
  retention.stream_days retention.stream_max_items retention.batch_size queue.pickup_stall_threshold_minutes
  queue.stuck_sweep_interval_seconds queue.stuck_sweep_unclaimed_age_minutes queue.wake_retry_interval_seconds
  queue.wake_retry_cap queue.wake_unconfirmed_window_minutes queue.wake_swap_grace_seconds`, { min: 1 });
add("int", `snapshots.periodic.interval_seconds`, { min: 60, unit: "s" });
add("int", `retention.watchdog_keep_per_job retention.events_days retention.closed_content_days retention.closed_metadata_days`, { min: 0 });
add("int", "ui.terminal.max_live_terminals retention.usage_samples_days", { min: 1 });
add("path", "retention.erasure_ledger", { allowEmpty: true, risk: "high" });
add("path", `db.path transcripts.path workspace.root workspace.slices_root workspace.steering_path workspace.specs_root
  workspace.projects_root workspace.catalog_path topology.root context.root skills.root policies.claude_compaction.message_file_path`);
add("path", `policies.claude_compaction.preparation_root decisions.template_dir`, { allowEmpty: true });
add("seat", `agents.advisor_session agents.operator_session workspace.operator_seat_name acp.to`, { allowEmpty: true });
add("text", `daemon.host host.name context.system_world files.allowlist progress.scan_roots`);
add("text", `recovery.provider_auth_env_allowlist policies.idle_gate_qitem.opt_in_sessions decisions.consumers`, { allowEmpty: true });
add("text", `host.selected`, { readOnly: "Change with rig host select" });
add("tz", "ui.timezone");
add("enum", "daemon.db_conflict", { choices: ["", "warn", "stop"] });
add("enum", "workflow.exception_routing", { choices: ["", "orchestrator", "human_only"] });
add("enum", "policies.idle_gate_qitem.auto_register", { choices: ["off", "all"] });
add("enum", "terminal.tmux_server", { choices: ["inherit", "isolated"] });
add("enum", "provider.selected", { choices: ["", "claude", "codex", "claude,codex", "codex,claude"] });
add("enum", "transport.draft_delivery", { choices: ["refuse", "deliver"] });
add("enum", "queue.wake_human_rung", { choices: ["always", "explicit-only"] });
add("stream", "stream.intake", { choices: ["", "off", "queue.worker"] });
export const CONFIG_TERMINAL_KEYS=Object.freeze(['policies.claude_compaction.pre_compact_instruction','policies.claude_compaction.compact_instruction',
  'policies.claude_compaction.message_inline','policies.claude_compaction.post_restore_audit_instruction']);
add("text", CONFIG_TERMINAL_KEYS.join(' '),
  { readOnly: "Value withheld by OpenRig · edit with rig config set in a terminal" });
const high = `daemon.port daemon.host daemon.db_conflict db.path transcripts.path terminal.tmux_server
  workspace.root workspace.slices_root workspace.steering_path workspace.specs_root workspace.projects_root workspace.catalog_path
  topology.root context.root context.system_world skills.root skills.router_line.enabled launch.non_interruptive files.allowlist progress.scan_roots
  ui.enabled recovery.auto_drive_provider_prompts recovery.provider_auth_env_allowlist policies.claude_compaction.preparation_root
  policies.claude_compaction.enabled provider.selected bundle.services_enabled transport.local_user_guard decisions.enabled decisions.template_dir
  retention.enabled retention.transitions_days retention.watchdog_days retention.watchdog_keep_per_job retention.stream_days retention.stream_max_items retention.events_days host.selected`;
for (const key of `${high} retention.closed_content_days retention.closed_metadata_days retention.usage_samples_days`.split(/\s+/)) definitions[key].risk = "high";
for (const key of `daemon.port daemon.host daemon.db_conflict daemon.seat_poll_interval_ms db.path terminal.tmux_server ui.enabled transcripts.enabled transcripts.path`.split(" ")) definitions[key].restart = true;
for (const key of `transcripts.enabled daemon.seat_poll_interval_ms host.name launch.codex_login_shell terminal.inherit_tmux_environment
  agents.advisor_session agents.operator_session workspace.operator_seat_name workflow.exception_routing policies.claude_compaction.threshold_percent
  policies.idle_gate_qitem.auto_register snapshots.periodic.enabled transport.draft_delivery decisions.consumers acp.to stream.intake
  queue.stuck_sweep_interval_seconds queue.wake_retry_cap queue.wake_human_rung`.split(/\s+/)) definitions[key].risk = "medium";
// Required baseline; newer reviewed controls below are offered only for entries the daemon reports.
export const CONFIG_CLI_KEYS = Object.freeze(Object.keys(definitions).sort());
add("int", "output.rebuild_recaps", { min: 0, optional: true }); // public help: 0 lists all recap paths
export const CONFIG_KEYS = Object.freeze(Object.keys(definitions).sort());
export const CONFIG_SCHEMA = Object.freeze(definitions);

// A metadata key can select only a per-key configuration route, never a command.
export function canonicalConfigKey(key) {
  return typeof key === "string" && key.length <= 128 && /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/.test(key)
    && key!=="feed.subscriptions" && (!key.startsWith("feed.subscriptions.")||Object.hasOwn(definitions,key)) && !["init", "init_workspace", "browser"].includes(key.split(".")[0]);
}
const metadataFields = ["type", "choices", "range", "format", "writeRoute", "appliesAt"];
function metadataDefinition(entry, fallback) {
  const key=entry.key, def={...fallback,key,metadata:true};
  if(!canonicalConfigKey(key)||entry.writeRoute!==true||!["boolean","integer","enum","string"].includes(entry.type))
    return {...def,readOnly:"OpenRig hasn't offered a supported write control for this setting."};
  delete def.readOnly;
  // Metadata replaces table limits: an omitted range means no advertised bounds, not the table's bounds.
  delete def.min;delete def.max;delete def.choices;delete def.allowEmpty;
  def.type={boolean:"bool",integer:"int",enum:"enum",string:"text"}[entry.type];
  if(entry.type==="integer"){
    if(Object.hasOwn(entry,"range")&&(!entry.range||typeof entry.range!=="object"||Array.isArray(entry.range)))
      return {...def,readOnly:"OpenRig reported invalid number limits."};
    for(const side of ["min","max"])if(entry.range?.[side]!==undefined){
      if(!Number.isSafeInteger(entry.range[side]))return {...def,readOnly:"OpenRig reported invalid number limits."};
      def[side]=entry.range[side];
    }
    if(def.min!==undefined&&def.max!==undefined&&def.min>def.max)return {...def,readOnly:"OpenRig reported invalid number limits."};
  }
  if(entry.type==="enum"){
    if(!Array.isArray(entry.choices)||!entry.choices.length||entry.choices.length>256||entry.choices.some(v=>typeof v!=="string"||v.length>4096))
      return {...def,readOnly:"OpenRig reported invalid choices."};
    def.choices=[...entry.choices];
  }
  if(entry.type==="string"){
    def.allowEmpty=true;
    if(entry.format==="iana-timezone")def.type="tz";
    else if(entry.format==="absolute-path-or-empty")def.type="path";
    else if(entry.format==="member@rig-or-empty")def.type="seat";
    else if(entry.format==="queue.worker, off, or member@rig"){def.type="stream";def.choices=["off","queue.worker"];def.allowEmpty=false;}
    else if(entry.format)return {...def,readOnly:"OpenRig reported an unsupported setting format."};
  }
  // Unknown timing is not stronger evidence than the older reviewed guidance.
  if(entry.appliesAt==="daemon_restart")def.restart=true;
  if(!fallback){def.risk="high";def.unfamiliar=true;}
  return def;
}

export function configDefinition(entry) {
  const key = entry?.key ?? "";
  if(CONFIG_TERMINAL_KEYS.includes(key))return definitions[key];
  if(entry?.visibility==='withheld')return {key,type:'text',risk:'high',readOnly:'Value withheld by OpenRig · edit in a terminal'};
  if(entry?.source==="unavailable"||entry?.visibility==="unavailable")return {key,type:"text",risk:"high",readOnly:"OpenRig hasn't reported this setting's value."};
  if (entry?.source === "env") return { ...(definitions[key] ?? {}), key,
    readOnly: entry.envVar || entry.envKey ? `Set by ${entry.envVar ?? entry.envKey} in OpenRig's environment. Change it there.`
      : "Set in OpenRig's environment. Change it there." };
  if(metadataFields.some(field=>Object.hasOwn(entry??{},field))){
    return metadataDefinition(entry,definitions[key]);
  }
  if (Object.hasOwn(definitions,key)) return definitions[key];
  const readOnly = key.startsWith("slack.") ? "Set in OpenRig's Slack connector, not here"
    : key.startsWith("people.") ? "Set in OpenRig's person registry (rig people)"
    : key.startsWith("health.policy.") ? "Set in OpenRig's health policy"
    : ["ui.terminal.max_live_terminals", "retention.usage_samples_days"].includes(key) ? "Only the daemon reads this; rig config set doesn't accept it"
    : "This setting is not in herdrig's reviewed key table";
  return { key, readOnly, type: "text", risk: "high", source: CONFIG_SCHEMA_SOURCE };
}

export function validateConfigValue(def, value) {
  if (!def || def.readOnly) return def?.readOnly ?? "Unknown setting";
  if (typeof value !== "string") return "Use a text value";
  if(value.length>65536)return "Use at most 65536 characters";
  if (/[\x00-\x1f\x7f]/.test(value)) return "Control characters are not allowed";
  if (def.allowEmpty && value === "") return null;
  if (def.type === "bool") return ["true", "false"].includes(value) ? null : "Choose On or Off";
  if (def.type === "enum") return def.choices.includes(value) ? null : "Choose one of the listed values";
  if (def.type === "int") return (def.metadata?/^-?\d+$/:/^\d+$/).test(value) && Number.isSafeInteger(Number(value)) && (def.min === undefined || Number(value) >= def.min)
    && (def.max === undefined || Number(value) <= def.max) ? null : def.min!==undefined&&def.max!==undefined?`Use a whole number ${def.min}–${def.max}`
      :def.min!==undefined?`Use a whole number, ${def.min} or more.`:def.max!==undefined?`Use a whole number, ${def.max} or less.`:"Use a whole number.";
  if (def.type === "path") return value.startsWith("/") ? null : "Use an absolute path, starting with /";
  if (def.type === "seat" || def.type === "stream") {
    const address=def.metadata?(def.type==="seat"?/^[^@\s]+@[^@\s]+$/:/^[a-zA-Z0-9\-_.]+@[a-zA-Z0-9\-_.]+$/):/^[A-Za-z0-9][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9_.-]*$/;
    return (def.type === "stream" && def.choices.includes(value)) || address.test(value) ? null : "Use a seat address: member@rig";
  }
  if (def.type === "tz") {
    if(typeof Intl==="undefined")return CONFIG_TIMEZONES.has(value)?null:"Use a supported IANA timezone, such as Europe/London";
    try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return null; } catch (_) { return "Use an IANA timezone, such as Europe/London"; }
  }
  return value || def.allowEmpty ? null : "Enter a value";
}

export function configPairPlan(warning, critical, currentWarning, currentCritical) {
  const w = Number(warning), c = Number(critical);
  if (![warning, critical].every(v => /^\d+$/.test(v)) || w < 1 || c > 100 || w >= c) return { error: "Warning must be below critical (1–100%)" };
  const keys = ["health.context_pressure.warning_percent", "health.context_pressure.critical_percent"];
  return { changes: w >= Number(currentCritical) ? [[keys[1], critical], [keys[0], warning]] : [[keys[0], warning], [keys[1], critical]] };
}

export function configDeletesHistory(def, value, current) {
  if(!def.key.startsWith("retention.")||def.type==="path")return false;
  if(def.key==="retention.enabled")return value==="true"&&(current===false||current==="false");
  return Number(value)>0 && (current==null||Number(current)===0||Number(value)<Number(current));
}

export function configConsequence(def, value, oldValue = null) {
  const key = def.key;
  if(def.unfamiliar)return `A setting this OpenRig offers that herdrig doesn't know: ${key}. OpenRig validates the saved value; check its documentation before changing it.`;
  if (["daemon.port", "daemon.host"].includes(key)) return `After the daemon restarts, herdrig and every other OpenRig client must use the new ${key.endsWith("port") ? "port" : "host"}: ${value}. herdrig's connection must be updated separately.`;
  if (key === "retention.erasure_ledger") return "Queue erasure records will be appended at this path before erasure commits. Nothing is moved from the old path; an empty value disables the ledger.";
  if(key==='retention.transitions_days'&&configDeletesHistory(def,value,oldValue))return `${oldValue==null?"Today OpenRig's transition retention is unreported.":Number(oldValue)===0?'Today OpenRig keeps all queue transitions.':`Today OpenRig keeps ${oldValue} days of queue transitions.`} The next retention sweep deletes transitions older than ${value} days. They can't be recovered.`;
  const keeps={"retention.closed_content_days":"content of closed queue work","retention.closed_metadata_days":"closed queue rows","retention.events_days":"history-only events"};
  if(keeps[key])return value==="0"?`OpenRig will keep ${keeps[key]} at future retention sweeps. Previously deleted history is not recovered.`
    : !configDeletesHistory(def,value,oldValue)?`OpenRig will keep ${keeps[key]} for ${value} days. Raising this limit keeps more history; previously deleted history is not restored.`
    : `Today this setting is ${oldValue??"unreported"}. The next retention sweep removes ${keeps[key]} older than ${value} days. ${key==="retention.closed_content_days"?"The rows stay without their content. ":""}Deleted history cannot be recovered.`;
  if(key==="retention.enabled"&&value==="false")return "Future retention sweeps are disabled. Previously deleted history is not recovered.";
  if (key.startsWith("retention.")) return configDeletesHistory(def,value,oldValue)
    ? `The next retention sweep may delete older history using ${key} = ${value}. Deleted history cannot be recovered.`
    : `This retention limit changes at the next sweep. Raising it keeps more history; previously deleted history is not restored.`;
  if (key === "db.path") return "Takes effect when the daemon restarts. OpenRig starts with the database at the new path; nothing is copied.";
  if (key === "terminal.tmux_server") return "Takes effect when the daemon restarts. Running seats keep their current tmux server.";
  if (key === "ui.enabled") return "After a daemon restart, OpenRig serves its web UI and a terminal connection on this machine when enabled.";
  if (["launch.non_interruptive", "recovery.auto_drive_provider_prompts"].includes(key)) return "When enabled, agents' permission prompts will be answered automatically.";
  if (["recovery.provider_auth_env_allowlist", "transport.local_user_guard"].includes(key)) return "This changes which credentials or local users OpenRig trusts.";
  if (["files.allowlist", "progress.scan_roots"].includes(key)) return "These folders become readable through OpenRig's file views.";
  if (def.type === "path") return "OpenRig will read and write at the new path. Nothing is moved from the old one.";
  return `This changes how OpenRig uses ${key}. ${def.restart ? "Takes effect when the daemon restarts." : "OpenRig does not confirm when it takes effect."}`;
}
