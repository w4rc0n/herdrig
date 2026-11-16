# Changelog

## v0.5.0

### Updating from v0.4.7

- When OpenRig stops answering after three failed or timed-out checks, Attach tiles clear their status dot instead of showing "Needs you" or raising a notice. The sidebar says OpenRig is not answering, and the seat status returns when it answers again. Checks are bounded, never overlap, and back off when OpenRig is slow. After updating, close every Attach tab opened before the update, then Attach again and approve the updated helper once per configured Herdr machine. Tabs left open keep the old helper and may still show a false "Needs you". Local Attach does not ask for approval.

### Use more than one OpenRig

Herdrig can now work with several OpenRigs at once, for example one on this computer and one on each of your Herdr
machines. Each one is a connection in `<appHome>/openrig/config.json`.

- Add a machine from the sidebar. When the space you are in is on a Herdr machine where OpenRig runs but isn't added
  yet, Herdrig offers to add it, shows how this computer reaches it, and checks it before saving. **Add a machine…** is
  also in the sidebar's **⋯** menu. With two or more OpenRigs, **System › Connections** lists them, with
  **Add a machine…** and **Remove…**.
- The sidebar follows the space you are in. In a rig's space on a machine, you see that machine's OpenRig. Outside
  OpenRig's spaces you see the OpenRig you used last. The header names the OpenRig it is showing. To look at another
  one, open the picker from the header (Alt+S); your choice holds until you switch spaces. Choosing an OpenRig while
  no space is open keeps your choice.
- Requests waiting for you on another OpenRig show as **◆ N elsewhere** in the header and on the picker's rows, so a
  decision is never hidden because you are looking at another machine.
- Each rig gets one space per machine. A rig named `demo` on two machines has two spaces, each under its own machine
  in Herdr's Spaces list. Each machine has its own **OpenRig** home space, and its operator's space is named after its
  rig (`kernel`), as on this computer.
- Actions, pages, the palette, Attach, the Operator and Need cards act on the OpenRig the row or page came from. Pages
  and the palette name their machine. Configuration and the other System pages open in that OpenRig's home space.
- Sidebar actions use the OpenRig of the row you selected, so another OpenRig's missing feature never blocks or
  enables them. Right-click menus on Specs, Scopes and Terminals rows, and Close cell, act on the OpenRig the sidebar
  shows.
- Each Rig tab shows only its own OpenRig's pages. After a restart, a machine's rig space no longer shows another
  machine's page, and a link clicked there stays with that machine. Switching sections from a page's breadcrumb keeps
  that page's OpenRig, and section-menu counts belong to it.
- After a restart, a Rig tab in a machine's space keeps to that machine's OpenRig, even when another machine's space
  was active while Herdr restored its tabs. A Rig tab opened before this version may show another machine's page once
  after a restart, until you open that tab again; then it stays with its own machine.
- Settings, spec editing and health links act for the OpenRig the page shows. Saving a setting on one machine's page
  never changes another machine's OpenRig. A spec is saved on its own machine, through that machine's helper. Each
  OpenRig's Health page and System badge refresh on that OpenRig's own changes.
- A spec page names its own machine and launches on that OpenRig, and a removed connection offers no spec actions.
  Palette Launch opens the dialog for the OpenRig whose spec you selected, and the Launch dialog's folder hint names
  that spec's machine. New rig, seat focus and worker-view progress stay with the OpenRig the page shows.
- A page opened for another OpenRig keeps that OpenRig when it finds the seat that asked, shows connected assistants
  or graph activity, and offers Resume from a stopped terminal view, even without the sidebar.
- Worker view and Follow work for each machine's OpenRig: where it offers them, Herdrig opens its own worker pages, and
  the tiles run on that machine. The palette and the Worker view button open the same rig-named space.
- Move rig space uses the selected rig's own OpenRig and machine.
- Connected assistants show for each machine's OpenRig, including on a Rig page that reads them before the sidebar
  has.
- Each OpenRig remembers its own sidebar view, expanded groups and selected row, when you switch or restart Herdr.
- One machine's OpenRig going quiet doesn't stop the others: its rows say "isn't answering" with **Retry**, and the
  rest keep working.
- Each OpenRig shows its own notice when it runs without its operator. Machine approval names the OpenRig it is for,
  and a narrow sidebar keeps the OpenRig's name readable in the header before it shortens anything else.

### Behaviour changes

- When Herdrig can't tell which OpenRig something is for, it asks or refuses instead of guessing. Every refusal says
  that nothing was sent or written. An edit you were typing is kept, with **Copy my text**.
- If you remove a connection while one of its pages is open, that page stops sending anything, and nothing is sent to
  another OpenRig in its place. Removing one no longer shows notices for spaces that don't exist, and another
  OpenRig's home space no longer offers to move its tabs into yours.
- Herdrig checks that a machine's address still reaches the OpenRig it was set up for before saving a setting or a
  spec there. If the address now answers as a different OpenRig, nothing is saved.
- With more than one OpenRig, each connection needs its own address and its own OpenRig home on this computer (the
  folder `rig` uses for that OpenRig's settings and sign-in). That folder stays on this computer: it's never sent to a
  machine. An entry that can't be used is skipped, and a list with no usable entry sends nothing.
- One OpenRig per added machine. Herdrig reaches each added machine's default OpenRig. With two OpenRigs added on the
  same machine, commands for them there say "Two OpenRigs on <machine> need a home for each; this version supports
  one per machine." and nothing is sent. Two OpenRigs on one machine keep separate home spaces.
- Worker views for an OpenRig added on another Herdr machine never send it this computer's app home, a path that means
  nothing there. Where that OpenRig doesn't offer Herdrig's worker pages, Worker view, Show in worker view and Follow
  for it say they aren't available from this computer yet, and nothing is sent. A single `daemonMachine` setup works
  as before.
- If a machine's OpenRig address changes, Herdrig checks the OpenRig at the new address and asks once before treating
  that machine's existing rig spaces as its own; their tabs stay open. Opening the space while Attach checks it shows
  one review, and Cancel cancels both.
- After it recognises the space, Herdrig lists Attach tabs still using the earlier address by their seats or tab
  titles and explains how to replace their viewers; running tabs stay untouched until you choose. The seat menu that
  started the review dims behind it and closes when the choice finishes.
- A send that OpenRig recorded but didn't deliver (or held while the seat's input is busy) now shows as not sent and
  keeps your text, with the reason. A queued item whose destination isn't running stays queued and says so.
- A sidebar read that fails inside Herdr now shows the error instead of saying OpenRig isn't answering.

### Other changes

- Rig and pod Needs-you counts match terminal seats with an open request. A pod opened directly checks its own OpenRig
  for requests.
- Unconfirmed-space choices are clearer: keep another OpenRig's space open, or save your work before deliberately
  replacing your own space.
- Degraded seats have more room to explain why their terminals couldn't open, and the Terminals preview shows a seat
  that needs attention with OpenRig's reason, such as "tiles need ssh".
- Installing from source keeps your saved OpenRig address. Use `--rediscover` only when you want the installer to find
  it again.
- Failed space-open choices stay visible until dismissed. Send, Queue and Reply keep their text when nothing was sent,
  and a timed-out Pause no longer says the rig may have been archived.
- The README explains using Herdrig's views inside Herdr, or `rig terminal open --window` for OpenRig's own terminal
  view.
- Stop using a machine says when nothing changed. If stopping succeeds but refreshing Herdr fails, the success stays
  visible with a warning.
- On System › Overview, Escape cancels a setting's review without closing the page, and Enter or Space activates the
  row you just selected.
- Enter and Space on Health or another page no longer change the last selected setting. Switching pages or OpenRig
  clears that selection.
- Rig pages no longer stay on "Reading OpenRig's settings…" when startup retries overlap a slow spec-permission read.
- Release packages are checked so that internal review notes stay out of shipped files.

### Known issues

Some other actions can still show a sidebar refresh error when the OpenRig sidebar is absent. Machine-choice recovery skips that optional refresh correctly.

After you point herdrig at a different OpenRig, a seat click, Attach, Focus pane or the sidebar seat preview can still use an old Attach tab from the previous OpenRig when a rig and seat have the same names, and that tab can hide a needs-you notification. Close the old tabs.

With more than one OpenRig added, Copy & edit of a built-in spec that has its own folder (such as `starter`) is refused on this computer with "This needs to know which OpenRig it is for, and it didn't say. Nothing was sent." Nothing is changed. To copy one by hand, in a terminal on this computer (with two OpenRigs on this computer, first set `OPENRIG_HOME` to the OpenRig home of the one you want, as its connection names it, so each `rig` command reaches that one):

1. `rig specs show <name>` prints the built-in's `rig.yaml` path. `rig specs add <the folder that holds it>` copies the folder into your spec library.
2. In the copy's `rig.yaml`, change each `agent_ref: "local:…"` to `path:` and the full path that the `local:` path names from the built-in's folder. For `starter`, `local:../../../agents/development/implementer` becomes `path:<full path>/agents/development/implementer`, where `<full path>` is the folder three levels above `starter`'s. Without this the copy doesn't launch.
3. Give the copy its own name. `rig specs rename <name> <new name>` refuses because two specs share the name, and lists both IDs with their paths: run it again with the ID whose path is in your spec library. (The ID `rig specs add` printed is the built-in's, which can't be renamed.)

Tested with OpenRig 0.7.14 and 0.7.16, and herdr-app 0.1.16.

## v0.4.7

- Fixed: with many Attach tabs open, herdrig could ask OpenRig for status so often that OpenRig stopped answering. Each tile now waits for its last answer, gives up after a few seconds, and backs off when OpenRig is slow or not answering. With a configured Herdr machine, the first new Attach or space open asks you once to approve the updated Attach helper.

## v0.4.6

- Overview keyboard navigation moves focus with the highlighted row. Enter and Space on another row leave settings alone; Tab lets you save again by keyboard, and Escape stays with an open edit, review or save.
- Stop using a machine names which save needs checking. Try again finishes only Herdr's follow-up, leaves a newer choice alone, and focuses Done after recovery. Its hint distinguishes Use from Stop.
- Machine setup and Stop using this machine work when the saved OpenRig address ends in a slash.
- Archive distinguishes a completed or unconfirmed Pause from a later refusal. Actions refused before anything was sent say so.
- If a launch or new rig may already have gone through, Check the rig list opens its Rig page without losing Back history. A command that could not start keeps its form available; uncertain outcomes are not offered again.
- Model changes name the queue they reached. Interrupted multi-part answers name every recorded part, including when OpenRig reports an empty reason or an already-settled request.
- Open rig space reuses a rig's existing space instead of making a second one, including a space an older herdrig made and one that holds only its Rig page. It never takes over a space whose terminals carry another OpenRig's address (it makes its own beside it); when it can't tell whether a space is this OpenRig's at a different address, it says so and opens nothing.
- Attach and a seat click no longer focus a terminal that only OpenRig's own labels describe, and such a terminal no longer hides a seat's "needs you" notification.
- A click inside a settings text box no longer saves it while you type, and a click on the paired pressure editor's label, hint or the gap between its two boxes no longer saves a half-typed value.
- After a launch or new rig may already have gone through, changing the name, mode or spec in the same dialog no longer brings Create back: the dialog keeps its result and its way out, Check the rig list.
- An archive that Herdr stopped waiting for now says it may have completed, in the message, the headline and the dialog title, and a running rig's earlier pause stays stated.

### Known issue

Some other actions can still show a sidebar refresh error when the OpenRig sidebar is absent. Machine-choice recovery skips that optional refresh correctly.

After you point herdrig at a different OpenRig, a seat click, Attach, Focus pane or the sidebar seat preview can still use an old Attach tab from the previous OpenRig when a rig and seat have the same names, and that tab can hide a needs-you notification. Close the old tabs. Fixed in the next minor release.

## v0.4.5

- After you change OpenRig's address, menus on rows still showing the old OpenRig refuse instead of acting on the new one.
- Pause, Archive and Delete wait until OpenRig shows the agents affected. If that review fails, nothing runs. Pause and Resume also stop a retry if their current agents cannot be checked.
- Enter opens and closes a settings row menu; Esc closes it too. Holding a setting's activation key still saves only once until you move away and back.
- Menu navigation waits until the page opens. If settings change after an action was sent, the result warns that it may have been recorded and asks you to check again.
- Settings keyboard help now names the ways out: Esc leaves the list and Ctrl+Tab switches tabs. Tab and Shift+Tab currently keep focus at the list edges.
- Every setting can be changed with the keyboard: Tab to it, then Space or Enter. Controls show their focus; Left and Right move between enum choices without wrapping.
- A multi-part answer that spans a settings change stops honestly and says which part was recorded.
- Pause, Resume and Snapshot work again from a rig in the Spaces list. Terminal menus and All seats links keep that connection too.
- Spec editing no longer gets stuck when settings reload quickly.
- Settings check current values before saving. If a confirmation changed underneath you, review it again; Undo returns to the value checked before your save.
- Queue work to connected assistants keeps working after verification. Their requests no longer mark unrelated seats as needing you, and parked requests name their owner.
- Actions with several steps keep the OpenRig settings they started with and refuse to continue if those settings change.
- Clicking away from a setting you haven't edited keeps changes made elsewhere.
- A connections list is not supported yet; herdrig says so and leaves it unchanged.
- Opening a rig's page, Attach or worker views checks its existing space first. If OpenRig cannot confirm the match, the sidebar explains why and nothing opens, instead of creating a second space.
- Paired settings keep changes made elsewhere and reset in a safe order. A lost save reply pauses further changes until settings are checked. Undo checks again before each restored value; a simultaneous change can still win or be overwritten because OpenRig offers no atomic settings update. If a proxy or tunnel retains an interrupted save, it can still arrive after that check and replace a newer value; recovery now warns you to check the setting again if it matters.
- A slow settings save pauses further changes until OpenRig answers and its current values are checked. Undo preserves changes made elsewhere, and switching connections keeps their settings separate.
- Find the Spaces list in **System → Layout**, in the sidebar and on the System page. The sidebar also includes Overview and Notifications; palette commands select their matching row.
- All seats keeps connected assistants in order and shows each once when a rig cannot load. Reconnecting checks for assistants again, and the sidebar keeps the selected assistant in view.
- Confirm setting changes beside the value you edited, with Cancel focused first. Saves show when they are still being checked, then offer Undo for a full ten seconds.
- Click a setting to edit it, then press Enter or Tab or click away to save. Esc restores the old value; invalid text stays open. Undo restores your previous setting for ten seconds after checking for changes elsewhere. Consequential changes still ask first.
- See connected assistants under each rig and in All seats, with their check-in status. Queue work to them, copy their address, or read their queued work without mistaking them for terminal seats.
- Settings use the controls and limits OpenRig reports, while older versions keep their existing controls. New settings ask for confirmation before saving. Empty fields show an error only after you edit them.
- Ctrl+Enter saves a spec without adding a blank line or indentation to its file; intentional blank lines stay intact.
- A quiet OpenRig keeps its live connection instead of repeatedly reloading the sidebar. A stream that stops answering still reconnects.
- Helper verification reads the installed files safely before checking their hashes. Existing helper permissions stay valid.

## v0.4.4

- Copy & edit keeps newer file changes and unsaved drafts, and recovers agent paths from your copy. All seats' Show all works from the keyboard; parked work stays with its owner.
- Tab reaches the machine setup's Copy buttons. New rig keeps your field focused while loading specs, and Cancel is focused when no daemon is found. Typing notifications off or on in the palette does exactly that.
- Set how many older recap paths a rebuild briefing previews when OpenRig reports that setting; zero lists them all. Older OpenRig versions keep their existing settings controls.
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
