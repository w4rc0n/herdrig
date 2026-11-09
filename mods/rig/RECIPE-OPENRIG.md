## Before you add it: OpenRig

This mod shows OpenRig in Herdr. It doesn't install anything. If the person has no OpenRig yet, **you** install it
with OpenRig's own guide. If they have one, you use it exactly as it is. **You're done when the person is talking to
OpenRig's operator in a Herdr tab.** A running daemon or a filled sidebar isn't done on its own.

Start with `rig --version`.

### If it prints nothing: install OpenRig

OpenRig's own setup guide is the procedure: the **`rigs` skill**, step 1, and
[reference/getting-started.md](https://github.com/mvschwarz/openrig/blob/main/docs/reference/getting-started.md).
Follow it, with these points for someone already in Herdr:

1. **Say what will change, and wait for a yes.** Use OpenRig's own list,
   [What OpenRig changes on your machine](https://github.com/mvschwarz/openrig#what-openrig-changes-on-your-machine),
   and ask which account the team should use: Claude, Codex or both. In the same message, ask about Herdr, in these
   words:

   > OpenRig's setup also installs **Herdr**, the older terminal app, for its own view. You're already in herdr-app,
   > so you don't need it: I'll skip it (`--no-herdr`) unless you want it.

2. **Show the plan first.** Run `sh install.sh --dry-run` from OpenRig's `scripts/install.sh`, then
   `rig setup --dry-run` once the CLI is installed, and show the person both.

3. **Install.**
   - If they **skip Herdr** (the usual answer), use the manual route that `install.sh` wraps, because the script always
     runs plain `rig setup`:
     `npm install -g @openrig/cli`, then `rig setup --providers <claude|codex|both> --no-herdr`, then `rig doctor`.
   - If they **want Herdr too**, `sh install.sh` as OpenRig documents it.

4. **Start it.** `rig daemon start`. That also starts OpenRig's own team, the **kernel**, whose **operator** helps
   the person set up their project team. Keep it. Then read `rig status` (the `Kernel:` line) and
   `rig ps --nodes --rig kernel`. Started isn't ready.

Then go to **Add the mod**.

### If it prints a version: use the OpenRig that's there

- **Don't reinstall, don't re-run setup, and don't change its port, home or config.** Don't start a second daemon.
  `rig status --json` tells you what's running.
- **Stopped** (`"state": "stopped"`): say so, then run `rig daemon start`, or leave it to the sidebar's **Start
  OpenRig** button.
- **Running without its operator** (`kernel.state` is `skipped`, or there's no `kernel` rig): say what you found and
  offer `rig up kernel --existing`. Run it only on a yes.
- **Older OpenRig:** the mod greys out what that version can't do, each control with its reason, and works for the
  rest. If the person wants those controls, suggest OpenRig's own upgrade route (its README, "Upgrading an existing
  instance", and its `openrig-upgrade` skill, which keeps live seats running). **Upgrade only on their yes, and
  only that way.**
- Their teams, kernel and seats show up as they are. Nothing gets re-created.

### Add the mod

Copy the folders and fit the sidebar into their layout, as **Built from** and **Watch out** below describe. Do this
the same way on both paths.

**Their OpenRig name (optional).** Sending, queueing, changing a seat's model, and editing quiet hours or modes in
**System → People** record which registered person ran the `rig` command; without a name in `config.json`, those CLI
controls stay disabled with a hint while **Needs** Decision Card actions (`POST /api/mission-control/action`, which
falls back to `human@host` with `authority: "primary-user"` when unattributed) and everything else work.
- `rig gateway participants --json` lists the people OpenRig knows.
- If the person is there and confirms it's them, or after
  `rig gateway human add <name> --display-name "<Name>" --delivery-class B` on their yes, write this one file. It's the
  mod's own, not OpenRig's:
  `~/.config/herdr-app/openrig/config.json` → `{ "person": "<name>@external" }`
- Never guess the name.

### Done when

1. The sidebar shows their rigs, with no message above the tree.
2. **Open the operator in Herdr:** click the speech-bubble icon in the sidebar's header (**Talk to the operator**),
   or run `herdr-app do rig.operator`. An **Operator** tab opens with the operator's conversation.
   - **Don't use `rig terminal open saved:kernel --window` here.** Inside Herdr it reads as a desktop terminal, so it
     opens a separate window, or fails on a headless machine. It doesn't open a Herdr tab.
3. **The person is talking to the operator.** They type what they want built, and which project folder, in that tab.
   Or, with their yes, send it for them, as OpenRig's `rigs` skill step 2 does:
   `rig send operator-agent@kernel 'This is the agent that installed OpenRig. The person will answer in your pane. Goal: <goal>. Project folder: <absolute path>.'`
   If they'd rather talk later, say the handoff is still pending. The way back is the same icon.

### If the sidebar shows a message

The sidebar and these steps use the same words.

| The sidebar says | What it means | Do |
|---|---|---|
| "OpenRig isn't installed." | No `rig` on Herdr's PATH | Install it (above). If you just installed it and the message stays, restart Herdr once so it picks up the new PATH. Don't edit PATH. |
| "OpenRig is installed, but it isn't running." | Daemon stopped | `rig daemon start`, or the **Start OpenRig** button |
| "OpenRig isn't answering." | The CLI and the window disagree, or the daemon is unhealthy | `rig status`, then OpenRig's help: `rig context get help` |
| "OpenRig's operator is starting." | Kernel booting | Wait. It clears by itself. |
| "OpenRig is running without its operator." | Kernel skipped or stopped | Offer `rig up kernel --existing` (copied by **Copy fix**) |
| "The operator can't start: no Claude Code or Codex sign-in." | No working login | `rig doctor`, then OpenRig's sign-in steps |
| "The operator isn't running." | Kernel failed or degraded | `rig ps --nodes --rig kernel`, then OpenRig's "Incomplete setup and restart" table |
| "The rig command failed." | `rig` exists but errors | Read its message, then `rig context get help` |

For anything else, OpenRig's own help is the source: `rig context get help`. Don't improvise a recovery.
