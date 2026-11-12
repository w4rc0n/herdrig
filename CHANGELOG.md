# Changelog

## v0.4.0

- **Security:** Safer handling of shell configuration and Attach relay files.
- Local Attach requests share one queue, and running terminal seats can attach too.
- Attach inside a rig's space opens a tab there; no duplicate rig spaces.
- OpenRig follows your space: the sidebar folds outside rig spaces, while rig tabs and the TUI use rig spaces or an OpenRig home instead of your own spaces. Existing tabs offer Move or Keep here.
- Needs cards lead with a short headline and clear choices, keep Details folded, and show the words you sent. Requests and seats waiting for you share one count throughout the interface.
- Seat rows show a live “now” line from visible transcript text, excluding drafts and incoming messages.
- Preview a spec as a static rig graph, and see handoffs move across a running rig's graph. New rig previews work through your existing OpenRig connection without a local rig command.
- Status marks stay calm between changes and pulse briefly when a seat starts work or needs you, greatly reducing constant redrawing in the Rig page and sidebar.
- Archive and Restore have their own controls and remembered lists. Empty grid tiles explain their purpose and ignore input; seat activity uses plainer words, and the palette labels requests and updates as Needs.
- The Specs page groups specs by kind (Rigs, Agents, Workflows), with your own specs first.
- Automatic health notes no longer appear in Needs; only an active critical problem shows there, linking to System.

## v0.3.0

- **Security:** Local Attach, Operator and the TUI no longer start on another Herdr machine just because its space is focused. This fixes a problem present in v0.2.1; failed starts never open an unlabelled fallback tab.
- Attach and seat grids can use another Herdr machine when `daemonMachine` is configured; local mode remains the default.
- Dismiss updates in Needs and preview a spec before creating a rig.
- Needs request details render Markdown, identify the right owner, discard stale receipts and keep coverage notes quiet.
- Repeated Attach or Operator opens share one tab while an earlier open is still finishing.
- Topology filters show how many seats they hide, keep every pod discoverable and reset when the page reopens.
- The README explains which terminal features await an OpenRig release and which still need upstream support.
- See the Herdrig version in System; update instructions explain how to replace the four mod folders safely.
- Worker-view support notes stay short in pages and menus, with details in tooltips; stopped-rig Delete describes removal without claiming it stops seats or takes a snapshot.

## v0.2.1

- Recover rig tiles restored as shells with an explicit confirmation.
- Show seat activity and queued work correctly with OpenRig 0.7.11; failed Resume reports failure.
- Check local tmux before opening a grid and offer cleanup for failed viewer tiles.
- Keep activity and Needs rows compact; refresh the dark preview.

## v0.2.0

- Add a Needs you priority view, rig spaces with equal seat grids, and New rig and Delete controls with Archive and Undo.
- Add copy controls, selectable text and recent activity, with clearer navigation and quieter seat rows.

## v0.1.3

- Secure Copy & edit: copy only the spec text OpenRig served into local spec folders, refusing planted links.
- Refuse daemon-supplied sources when launching a rig from a spec.

## v0.1.2

- Secure Attach and Operator: start tmux directly through a fixed relay without running a shell or daemon-supplied commands.
- Confine spec edits to local spec folders and resolve links before writing.

## v0.1.1

- Expand the README, use the Herdrig title and add a dark preview.

## v0.1.0

- First public release: OpenRig topology, specs, scopes, terminals, Needs and system pages inside Herdr, with Attach, a command palette and context menus.
