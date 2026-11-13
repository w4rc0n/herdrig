# Changelog

## v0.4.4

- New worker views finish opening in an existing rig space while herdrig refreshes its labels. Changed or focused split targets are still left alone.
- Changing the Spaces list preserves concurrent layout edits, and rig marks and actions stay on the configured machine. Uninstalling restores personal Spaces blocks safely.
- Worker views with empty cells keep working when refreshed or reopened. If a rig's seats cannot load, its existing tiles stay open.
- Use the keyboard to Retry an unavailable rig in All seats. Long names fit narrow rows, requests stay with their seats, and rig links return to the right view. Typeahead accepts Shift-uppercase letters.
- Copy & edit refuses a spec file replaced while its built-in folder is being copied, without following a replacement symlink.
- Long requests no longer interrupt sidebar redraws, and Needs cards avoid repeating work on the same message.
- Sidebar row menus show both Move actions. Closing a row menu leaves no drag behind, and typing focus then Enter focuses the sidebar.

- Menus support arrow keys, Home/End, Enter and Escape, with prefix typeahead and a visible selection that stays in view. Disabled actions show their reason.
- Dialogs start on the safe control, show a clear focus ring, and wrap Tab/Shift+Tab within their controls. New rig selects its first spec and supports typeahead; Designer drags wait for three pixels of movement.
- Keep the selected sidebar row in view while using the keyboard, without jumping back to the top.
- Busy icons stay still with reduced motion. Hover shortened names and labels to read the full text.
- A very long needs message (long runs of spaces or blank lines, or a long summary) no longer slows Herdr's window while it draws the need cards.
- Cancel sidebar drags with Esc, reorder rows with Move up/down, and use the palette's Focus sidebar command.
  PageUp and PageDown move ten rows in trees and tables.
- Blocked seats in Priority keep their blocked mark and label instead of a working glow.
- Topology's All seats tab shows seats across rigs, grouped by rig or status, with filters, rig links and selected-row actions. Unavailable rigs have their own Retry row.
- If one rig's seats cannot load, the sidebar keeps your other rigs visible and offers Retry for that rig.
- Empty worker-view tiles look empty, with a quiet title and no cursor. Reopening updates old blanks
  without restarting your seat viewers; the helper update asks for approval.
- Worker views show update progress and readable tab names, with one connection warning per machine. Mission titles open their workflows or slices, and palette no-match guidance stays actionable.
- See which space and machine are opening while a rig grid is built.
- Copy & edit of a built-in rig spec includes its whole folder, so culture and startup files stay with the copy. Copying a folder on the box asks for separate permission.
- Choose herdrig's own Spaces list in System → Layout: Herdr's list with a rig mark on rig spaces, each rig's status at the row's right,
  the OpenRig icon on its home space and the rig menu on right-click, or Both (Herdr's list plus a **Rig spaces** block with only rig
  spaces). Herdr's list stays the default. Each change goes through one screen, touches only your personal layout (a copy is made first
  when you are on a layout Herdr ships), records the way back and is undone from the same row; uninstalling switches back first.
- Uninstalling takes herdrig's own blocks (the Rig sidebar and, if used, its Spaces blocks) out of your personal layouts before removing the mods, so the next start stays on your layout instead of falling back to Herdr's. Every other block, your sizes and Herdr's own layouts are left as they are; a layout that changed meanwhile or does not read back as planned is put back or left alone and reported.

## v0.4.3

- Opening a rig that already has its own space on your configured machine finds that space again even when the tunnel address was written differently when the space was made (127.0.0.1, 127.0.0.3 or localhost, same port). Before, a second space was built. herdrig only reuses it when it can show it is the same OpenRig (the space carries the OpenRig's host id, or every seat in it is one that OpenRig lists for that rig); otherwise it opens nothing and says what to do. Spaces it builds now carry the host id. The OpenRig home space gets the same treatment, so a changed tunnel address no longer builds a second OpenRig home.

- Spaces made before v0.4.3 are matched by their seat session names and tmux server flags rather than a recorded daemon identity. If you run two OpenRig daemons on the same machine sharing one tmux socket, herdrig cannot tell their spaces apart and may adopt the wrong one; close the space and reopen it to stamp it. Spaces made by v0.4.3 or later carry the daemon identity and are matched exactly.

## v0.4.2

- **Security:** Remote spec writes use a separate verified helper and folder permission. Worker tiles enforce their read-only flag; setup approval includes the helper checksum and is renewed when it changes.
- Scopes and workflows stay reachable with one project even when OpenRig has no default project.
- Save and Copy & edit on OpenRig's machine, with changed-file checks and unsaved-draft recovery.
- Location breadcrumbs and one tab row per page make navigation clearer; narrow pages keep actions and graph edges reachable.
- Browse real workflows and current packets under Scopes, with obligations, plan sources and copy-only next actions.
- Running seats without usable activity reports say Not reported and no longer count as idle.
- Answer receipts preserve OpenRig's actual outcome, including when a request is still waiting and nothing ran.
- Absolute timestamps support UTC exactly; other configured zones use local time with an explicit Configuration note.
- Open worker views here when OpenRig runs on your other machine. Saved pages, read-only seats and Follow use
  the approved helper. Optional pruning closes inactive viewers without stopping seats; failures keep your tiles.
- Copy & edit of a built-in spec keeps the copy's agents reachable: the copy points at the built-in's agents by their full path instead of a path
  that only worked beside the original. If the built-in also lists files beside itself (such as CULTURE.md), Specs names them and says plainly
  that the copy will not launch until they exist beside it. A spec whose agents can't be located is not copied.

- Copy & edit of a built-in rig spec copies the spec's whole folder (its CULTURE.md and guidance files too), uses OpenRig's own `rig specs add`,
  and names the copy `<name>-copy`, so a starter, factory, kernel or pm copy can launch. On OpenRig's machine this needs its own permission
  (separate from saving specs), naming the folder copied and where it goes. If you already have a copy, Specs opens it; an unfinished one is
  renamed and its fixed text is put in the editor for you to save. The spec helper changes, so setup asks once more.

- Choose OpenRig's Herdr machine in one setup screen that names the account, helper file and checksum.
  It verifies the helper before saving the choice, asks again for a changed helper, and offers Stop using in Connections.

- Move an older rig space to OpenRig's machine without making a second space. Personal tabs stay here.
- Move a Rig page to OpenRig's home even when it shares a tab with a shell. The shell and its tab stay where they are.
- Remote Seats tiles fit their panes while alone and yield sizing to Attach, matching local tiles. Sizing settles within about five seconds.
- Graph arrows meet cleanly and stay clear of headers and other routes. Handoffs light the whole path briefly;
  details stay above the graph. Set reducedMotion to keep status changes and graph entrances still.
- Edit OpenRig settings in System, with a save or reset for each setting, clear source labels and confirmation
  for consequential changes. Saves go to the displayed OpenRig, including when it runs on another machine.

## v0.4.1

- Move OpenRig tabs handles each tab separately, reuses the destination Rig page, and names anything left behind. A restored TUI offers an explicit replacement.
- OpenRig can put its spaces, pages and TUI on the machine where it runs, with a one-click choice.
- The sidebar folds and returns reliably when you switch spaces, keeping your scroll position.
- Attach keeps its normal terminal size while worker tiles on this computer are open. Tiles on a remote machine get the same fix in the next release.
- Cleared health notes stay out of warnings. System → Health explains problems and keeps cleared history folded.
- Rig and pod status counts use plain coloured text, leaving status marks on the seats and rig itself.
- Dismiss updates directly from the sidebar, with Undo and Show dismissed.
- Press Enter in the palette to open the top match.
- Specs explains where to edit files, offers Copy & edit for built-ins, and names the machine for launch folders.
- With OpenRig 0.7.12 or later, Worker view and Show in worker view turn on when herdr-app runs on the same machine as OpenRig; otherwise they say why.

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
