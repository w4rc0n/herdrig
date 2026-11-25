# Changelog

## v0.5.11

Clearer partial-launch results, safer Ctrl-click terminal links, and an up-to-date old-strip Leave dialog.

- After a launch that only partly started or may have started, the Launch dialog hides the form so the full result and Check the rig list fit without clipping, titles a partial launch "<rig> partly started", puts Close directly under the result, and moves keyboard focus to Check the rig list.
- Ctrl-click terminal links refuse spaces stamped for a different OpenRig host, and when no OpenRig space or Rig tab is open yet the notice tells you to open an OpenRig page or space from the Rig sidebar first.
- "Leave OpenRig's old strip" counts a single view as "1 view" instead of "1 views", and an open Leave confirmation stays up to date with the strip's current views while open.
- Moving a tab that holds both a Rig page and a live TUI verifies the fresh TUI at home before closing the original tab, and multi-connection in-place open records stay separate per OpenRig when two connections share a rig ID.
- System → Health keeps distinct Back history across the Health list, individual findings, and linked queue items, and clears finding detail state when switching to another System tab.
- Listed OpenRig connections validate `openrigHome` paths so malformed values no longer count as usable entries in connection loading, targeting, or Remove.
- TUI process detection recognizes configured `config.rig` commands that pass Node options before the CLI entry, while still rejecting `node -e` and non-command positions.
- The standalone installer and `check` command now find `herdr-app` the same way (`--herdr-app`, then `HERDR_APP_BIN`, then `PATH`).

## v0.5.10

Ctrl-click OpenRig links and API addresses in Herdr terminals to open them on the Rig page, and see "seat · slice" names on worker panes.

- Ctrl-click a recognized OpenRig link or `/api/…` address in any Herdr terminal to open it on the Rig page (requires Herdr 0.1.17 or later; older Herdr skips `rig-link` and says why, and `--no-links` opts out). Plain request IDs are not clickable because Herdr does not detect them as links.
- Worker panes are named "seat · slice" from live OpenRig data on Herdr 0.1.17 and later, or just the seat when no slice is active. Follow updates the name as work changes.
- A brief read failure in the Rig sidebar’s Needs list no longer brings answered requests back.
- Saving an earlier spec draft clears its reminder, including drafts saved by older versions.
- In the Rig page's Recent activity, an entry whose text is only a request ID reads "Untitled row" instead of "No work served".
- Launching a spec where only some seats start now says which seats started and which didn't, with OpenRig's reason, and shows the rig in the sidebar. A launch where no seat starts gives OpenRig's reason instead of "stopped without saying why".

## v0.5.9

Old-view cleanup remembers confirmed closes across restarts, and spec saves and compaction recovery keep the right state when a connection changes or a reply arrives late.

- Closed old views stay closed in Herdrig’s cleanup list when the same OpenRig comes back after a restart.
- A confirmed spec save keeps later edits based on the version it wrote, even when the connection changes during the save. Discarding an earlier draft shows the saved file, and identical drafts open as a preview.
- Compaction recovery keeps a late receipt when Check again is in progress and restores the original warning if a resend is refused before any input is sent.
- The Rig sidebar retries incomplete seat lists sooner, shows newly read updates promptly, and catches up followed views after its event stream reconnects.
- Starting Herdr from an OpenRig seat terminal no longer attributes Herdrig CLI actions to that seat. Actions with an explicit person keep using that person.
- A critical health finding in the sidebar's Needs list no longer shows raw request IDs.
- When the Rig grid repeatedly fails to check existing spaces, it waits longer between retries, up to one minute.

## v0.5.8

The Rig sidebar is quieter when idle, Herdr 0.1.17 is supported, and spec drafts stay with the connection they were written for.

- In a large idle setup, the Rig sidebar sent about one thirteenth as many requests and used substantially less CPU. With OpenRig’s full event stream, the sidebar updates from live events and checks once a minute during quiet periods. It checks more often when the full stream is unavailable or a recovery check is pending.
- Tested with the official Herdr 0.1.17 build.
- Spec drafts stay with the OpenRig connection they were written for, even when a replacement uses the same address. Earlier drafts with an unknown connection can be checked before saving. You can close that preview and reopen it later.
- When a quiet sidebar replaces its idle event stream (about every two minutes), it no longer repeats the capability check and the full read.
- On Herdr 0.1.17, a quiet sidebar keeps its connection to OpenRig instead of reconnecting and re-reading everything every 30 seconds.
- In herdrig's Spaces list, a repository kept as `<project>/.bare` is named after the project, as in Herdr 0.1.17.
- A late OpenRig refusal that confirms no input was sent clears the compaction recovery warning.
- When OpenRig accepts compaction after the seat card has shown an unconfirmed warning, the card updates to say the request reached OpenRig.
- Old-view cleanup receipts apply to the OpenRig connections that answered. The sidebar retries failed settings reads on the next check, and framed errors give retry advice only when it fits the failure.

## v0.5.7

Recover unconfirmed compaction requests, keep unrelated Rig tabs intact during cleanup, and see clearer setup and status feedback.

- If OpenRig accepts compaction and the state refresh fails, the recovery controls and warning stay on the seat card when you leave and reopen it.
- The Rig sidebar no longer shows a stale-context error while waiting for Herdr to open panes. If Herdr reports an internal context error, Herdrig explains it in plain language and keeps the original error in Details.
- Leaving OpenRig’s old strip keeps unrelated Rig tabs and their history intact. Cleanup keeps an old view available to retry while a local OpenRig is still being checked.
- Request Details keeps the row IDs referenced in the message. Sweep checks no longer count as human requests in Pulse, and the palette keeps your draft when it cannot verify which requests take replies.
- Setup dialogs and the Rig palette explain when settings could not be read. Add this computer shows health-check refusals, accepts IPv6 loopback aliases, and moves focus to Close if the save could not be confirmed.
- Claude compaction shows preparation and offers Cancel while the command waits for its reply, even with a small clock difference between Herdr and OpenRig. Grid title updates keep the original viewer if its replacement pane disappears.
- Pages with an unresolved connection hide header Actions until a connection is chosen. A saved rig spec reports graph refresh failure while keeping the successful save receipt.
- The Rig graph marks open tasks whose seats are unreachable. Old-strip cleanup reports saved layouts it cannot check, including layouts with malformed children. The Codex model picker refreshes when Herdr signals that the whole cache folder may have changed.
- An unconfirmed compaction request stays on its seat card when you navigate away. Check again reads the current state. You can clear the warning without sending anything or explicitly confirm another request.

## v0.5.6

Rig graphs show who is still working on a handoff, and connection setup and recovery give clearer results.

- A working task line pulses green continuously, including through a 15-second idle grace period. The idle line is dashed and dim. Lines for seats that need you or are blocked are steady amber. The needs-you chip is red where there is room to show it. Stopped lines are grey. The legend explains the states on screen. Reduced motion keeps all lines steady.
- An open task shows idle minutes on redraw after the graph observes its seat go idle from working. A seat first seen idle without a reported timestamp shows plain idle.
- Needs breadcrumbs use the current request title. Recent activity keeps more of the work description, up to 240 characters. Request cards count hidden lines across paragraphs.
- Change model / harness keeps supported Codex effort choices when the local model cache advertises additional efforts.
- Typing guard controls show readable names for OpenRig settings and explain what happens when you replace one with Quiet while I type. **Hold all messages and notices** also holds direct messages. You can still type.
- On a seat page that opens before the OpenRig version is loaded, Compact now avoids a duplicate capability check.
- Herdrig clears inherited OpenRig address selectors before running the CLI. If you used variables such as `OPENRIG_HOST` or `OPENRIG_PORT` to reach your daemon, pin its address in Herdrig’s connection settings. Add this computer checks the rig program directly and refuses a leading environment assignment.
- Herdrig shares one copy of each connection’s rig and request rows across its views. In a large fixture, the shared snapshot was about half its previous size. Rig pages still refresh when their own connection’s rows change.
- Checks on stalled work open the original queue row even when it is outside Needs. Needs cards keep instructions that follow a repeated heading.
- A message, queued request, or reply confirmed as held by OpenRig stays available to copy from its receipt. Reopening the composer starts with an empty field.
- Resume asks you to review the plan again if a fresh check finds that it changed before starting the rig.
- The typing guard asks you to review again if its setting changes before you confirm. The held-messages panel stays open on seat pages opened by name.
- Seat compaction status recovers after a temporary read failure and keeps newer results when an older read finishes late. If a refresh fails, the seat page offers Check again and keeps technical details in the log.
- When the selected model lists its effort levels, switching models offers those levels.
- Add this computer preserves spaces in the resolved OpenRig home and shows the result when Check or Save finishes. An unresolved page keeps its connection chooser if its old connection ID returns for a different destination.
- Open rig grids stay in place during a terminal-server outage and reconnect their viewers after the server comes back and the grid is out of focus. Spec editors reload when their connection changes, folder checks can finish across settings polls, and seat status refreshes without the Rig sidebar.
- Machine approval keeps Done available while the Rig sidebar is hidden. Show the sidebar to continue, or repeat the original action if the sidebar that held it has closed.
- Start fresh from a Resume plan or roll call targets the seat you selected.
- Add this computer checks for another connection using the same resolved OpenRig home. Save rechecks that the folder and its recorded daemon still match what you reviewed.
- Saved Worker views keep their connection while Herdrig discovers the address for a default OpenRig setup. Once it answers, Herdrig checks that the connection matches the saved destination.
- When OpenRig accepts a compaction command but the state refresh fails, the seat page reports that the command reached OpenRig and asks you to check before trying again.
- Add a machine keeps **This computer** available when Herdr’s machine list cannot be read and the local OpenRig is eligible to add.
- If OpenRig supplies a Claude compaction attempt ID before the dialog closes, Herdrig verifies the start against that attempt. While the receipt is pending, or when it cannot name the attempt, a new manual preparation can still belong to another request on the same seat.
- When an OpenRig connection changes, the sidebar discards health responses from its old daemon before they can mark seats unreachable.
- Saving a spec refreshes its library entry even when a previous read is still running. Held messages stay open when you switch between links to the same seat. Checks with an invalid queue item ID now explain why they cannot open it.
- A model-change request that leaves effort alone describes it as unchanged.

## v0.5.5

Rig spaces name their seat tiles, and seat pages show reported Pi token totals and offer supported compaction.

- The old-strip dialog uses singular wording when only one view remains.

- Topology marks the lead OpenRig reports for each rig. Model change requests go to that lead, or to the advisor when changing the lead's own seat.
- Change model / harness shows available models and efforts from the local runtime, with a marked current selection and manual model entry when the list is unavailable. Codex uses its local model list.
- Attach focuses a seat's existing viewer whether you opened it from the seat page, menu or palette.
- With OpenRig 0.7.20 or later, a seat whose tmux server stops answering is marked unreachable. The sidebar warns once per outage, affected actions explain why they are unavailable, and Worker view can still open reachable seats.
- The Rig palette opens the card you selected. The machine approval result names the machine, and the message dialog keeps room for the draft.

- Multi-line text on the Rig page, such as a question asked of you, a request's body or a Health finding, now shows each line on its own row instead of running the lines together. A request card shows its first three lines, then how many more are in Details.
- Fix the seat page rendering error for Codex and terminal seats when compaction is unavailable.

- Old-strip cleanup counts views in the current layout, checks the destination again before switching, and reports views it could not verify. Only one cleanup can run in a window at a time, and the Rig page shows one result.
- Pi seat pages show OpenRig's reported input and output token totals when the context window is unavailable. They say when the first usage report is pending or the last report may be out of date.
- OpenRig context menus fit their actions without an empty footer. Longer menus scroll, and disabled actions show their reason beside the action.
- Ask OpenRig to compact one Claude or Pi seat from its context card, with confirmation and progress. **Check again** retries a failed support check. Claude's submitted command stays unconfirmed until there is evidence it compacted.
- Rig-space tiles show the seat name, slice when reported, and runtime. Open rig space refreshes older unnamed viewer tiles once; your seat sessions stay running. With tmux set-titles enabled, tmux's own title can still replace the header.
- **OpenRig's checks on stuck rows read as checks, not new requests.** A check names the row it's about ("Check on: …"), opens that row, isn't counted with your requests and doesn't toast. The row itself is what to act on, and the check then closes by itself.
- Resume rig shows what each seat will do before it starts, then checks which conversations came back. Bare shells and missing sessions are called out, with Check again and a separate Start fresh choice where available.
- **Quiet while I type** on an agent seat keeps OpenRig's reminders out of its pane. The seat page shows its typing guard and a read-only held-messages drawer; turning the guard off does not replay held messages. Reopening the menu retries an unsuccessful support check.

- When OpenRig holds a message without delivering it, its dialog now shows the held text with Copy and keeps sending disabled.

- Reply checks OpenRig before sending. If the check fails, your draft stays and you can try again; a failed send after a successful check still asks you to verify whether it arrived.

- A refused Send, Queue or Reply keeps its reason visible beside your draft. When OpenRig says "No text was sent", you can correct the draft and try again; uncertain or retained sends stay protected from a second send.
- Request labels replace raw queue row IDs with “a row” or omit an ID-only bracket, including in sidebar rows, Needs titles opened from toasts and links, and Topology Recent. Request Details and **Copy request id** still give access to the original text and ID. Headlines preserve abbreviations such as “vs.”, “etc.” and “Inc.”
- Saving a rig spec keeps its graph preview on the Rig page when you switch tabs. The saved result appears while the preview loads, an older preview cannot replace a newer one, and the spec library refreshes after save.

- Idle refreshes no longer rewrite unchanged saved state or reload settings just because that state file changed. Unreadable settings show a warning, and later reads can recover without an unhandled failure. Refresh repeats a failed settings warning when you ask; a saved sidebar view that could not be loaded is reported separately.

- The Rig page keeps picking up settings-file changes after you switch tabs. A failed read shows a warning and the next file change can retry it.

- A settings save that needs checking starts that check from its own page, so switching or closing another tab cannot strand the check. Closing its Settings page cancels a check that has not started.

- Configuration keeps keys typed for the next setting while the previous save finishes, including Backspace. Cancelling the edit or a failed save clears those queued keys. If too much typing arrives, it asks you to edit or cancel before saving a partial value.
- Large Configuration pages open one category at a time, with up to 40 settings plus any rows you are editing or reviewing. Search narrows the list; counts explain what is hidden. Smaller pages stay expanded.

- Operator actions chosen from the palette continue after their lookup finishes.

- After a machine approval finishes, closing its Done dialog also continues the waiting action once. Closing it while approval is still running does not continue the action.
- Asking to focus the Rig sidebar or its machine offer now hands keyboard focus over from the sidebar's next draw, so another tab closing cannot drop the handoff. A closed sidebar does not take focus.
- Folder-watch retries and the waits for Attach, grid and TUI tabs no longer depend on whichever Herdr tab was active when their wait began.
- Closing the Rig sidebar while a local Attach viewer is starting no longer stalls its wait; the started viewer finishes opening and receives focus.
- Machine and connected-assistant read deadlines no longer depend on whichever Herdr tab was active when they began. Completed reads cancel their pending deadline.
- After you approve a machine, its waiting action resumes in the Rig sidebar's context and reports a warning if it fails. Closing the Rig sidebar during the approval check prevents the waiting action from starting.
- Closing a machine approval while it is busy no longer leaves later approvals stuck on Saving. A later check can start without restarting Herdr; closing still does not resume the cancelled action.
- Show in worker view now focuses the seat's tile in the rig grid it opens, instead of saying the tile isn't there yet.
- Rig pages avoid redrawing cached Graph and Health results when only unused observation clocks changed. Real state changes, errors and explicit refreshes still update the page.
- Pages and menus no longer send commands to a hidden Rig sidebar. Actions use their existing fallback or explain that the sidebar must be opened; dismissing or restoring an update leaves nothing queued while it is hidden.

- Hiding the Rig sidebar takes Attach directly through the page or menu, even while the hidden sidebar keeps running in the background.

- Attach works from the Rig page when the sidebar is closed, without first showing Herdr's raw “unknown command” error.

- Attach causes fewer redraws while idle. If the sidebar crashes, Attach may wait up to 75 seconds before checking the connection itself.
- System no longer shows a cached "ok" while its OpenRig is unavailable.
- After removing this computer from a connections list, add it back from Add a machine or System → Connections. Check its OpenRig home, then confirm the local connection; your other connections and tiles stay in place.
- When a connection id disappears after a rename or a move from a single address into a connections list, its worker views and Rig page histories move only when the recorded destination matches uniquely. Existing page ids keep following that id, including address edits; worker tiles stay with their destination. Unmatched pages explain why they cannot read or act. A rig whose state is not reported offers neither Pause nor Resume.
- With several OpenRigs, a page shows its own rig's seats, Health findings, machine and connection errors. A request id shared by several OpenRigs no longer picks the first one.

- Configuration category headers explain their expand/collapse action on hover; pinned categories explain why they stay open.
- The machine card's "Find where OpenRig runs", "Use <machine>" and "Not now" buttons now show a focus ring when you Tab to them. When herdrig can't read its approvals file, the sidebar names the file's real path.
- Tab no longer stops on the machine card itself, where Enter did nothing; it goes straight to the card's buttons.
- Tab and Enter reach the sidebar's copy-the-command and Start daemon buttons, and the startup banner's button.
- System › Connections calls the approval to open seats on a machine "Open seats" and says what will happen: Allowed, Asks the first time, Asks again next time, or Couldn't check. It no longer shows "Helper: Needs approval" when nothing is waiting.
- Tab and Enter reach the sidebar's Retry when OpenRig can't be reached or a refresh failed, including the Retry for a second machine that isn't answering.
- Tab and Enter reach machine offers, connection hints, error Details and Archived controls, including Details above a dialog's action buttons. Clicking these links keeps focus on the link, so the sidebar does not take keyboard focus back.
- Rig pages avoid repeatedly copying their navigation history while drawing, while actions continue to use the current connection.

- **See who is working on a handoff.** A Rig graph gives two gentle breaths when work starts or a working seat claims a new task, then keeps the line steady. A line to an idle seat is dashed, and one that needs you is red; hover a line to read its tasks. Opening or refreshing the graph does not replay a pulse. Reduced motion keeps every line steady.

## v0.5.4

Leave OpenRig's old strip and return to the Herdr layout you choose. The Rig page stays open and your seats keep running.

- **Leave OpenRig's old strip…** closes older worker views where possible and switches to the layout you choose, even when the strip is empty. Choosing Herdr's own layout leaves out the Rig sidebar. The Rig page stays open and seats keep running. Viewer-close and layout-switch results are reported separately. Closing a space does not remove the strip; Herdr's own layout palette can also switch away from it.
- Results say how many old views were confirmed closed and whether the layout switched. Duplicate view names are grouped, and a stopped OpenRig gives one short reason. If the Rig page closes before cleanup starts, it says nothing was closed.
- If no eligible layout is available, **Close the old views** can still close them through a supported OpenRig on this computer. The result explains that the strip stays until you choose a layout from Herdr's palette.
- Views confirmed closed or already gone are left out of later cleanup counts in this app session. When nothing needs closing, the result says so; it does not claim to have closed any views.

## v0.5.3

Worker views in Herdr's own tabs, separate page histories, and less idle work.

- **Worker views in Herdr's own tabs.** Worker view opens herdrig's pages as ordinary tabs, counted in the sidebar's Views badge; its tooltip explains the action and where tiles run. Older OpenRig views can be closed from System. Follow leaves idle tiles open unless you set a prune time.
- **Separate Rig tabs keep their own history,** so Back and Escape stay in the tab you use. Split Rig panes and older layouts retain their shared history.
- **The sidebar shows requests sooner and does less idle work.** It no longer waits for the whole Needs list before showing requests. Idle app CPU was about 72% lower in a software-rendered 33-space test; the measured setup and remaining banner limitation are below.
- **Clearer when something fails.** Refusals say when nothing was sent, errors use plain words, and Cancel keeps your reply draft.

### Updating from v0.5.2

- Updating asks for no new approval. Machines you've already approved keep their Attach approval.
- After switching from one OpenRig address to a connections list, close any open worker views and Rig pages, then reopen them from the sidebar. Existing tabs keep their old connection and may show an incorrect view count or unavailable status; Follow may stop updating them. Old Rig tabs without a connection also refuse Follow slice, Attach, Focus pane and Send/Queue until closed and reopened.

### All changes

- **Requests offer Approve only when the sender marked them as a decision** (`--human-intent decision`). Other requests, including ones sent without that flag, show Reply and Mark done…, and both send your words back to the asking seat. Approve on a marked decision now asks before it closes the request.
- Space opens the highlighted page in the page menu, as Enter does.
- Worker view and Reattach answer within about 15 seconds when Herdr or a machine stops answering, instead of waiting for every tile in turn.
- Space works again like Enter on the add-machine and machine-setup Copy buttons, the sidebar's machine search and offer, and the page menu's navigation, as it did in v0.5.2.
- Opening an existing rig space leaves it unchanged if its terminals change while OpenRig's address is being checked.
- When OpenRig records or retains a message without delivering it, the result says so and Send stays off; it no longer says "Nothing was sent."
- Spaces list drift: no change against Herdr 0.1.16.
- Worker-view waits and delayed refreshes no longer depend on another tab staying open. A machine lookup stays retryable until its probe starts.
- Visible Health changes still update immediately. Sample clocks do not trigger updates across the app, and hidden connections do no extra Health checks. Health's checked time and history refresh once a minute while shown.
- Open Rig pages reuse unchanged sidebar answers without repeated full-list reads. Graph edges, recent handoffs and other page-only details refresh once a minute while shown. If a sidebar stops answering, its last answer can be reused for up to 75 seconds before the page checks for itself. Saved worker layouts are checked again when they change or you choose Refresh.
- A seat's CONTEXT shows the Claude account it is set to launch with, when OpenRig reports one. This does not check who is signed in now.
- Worker view now opens herdrig's own pages in ordinary Herdr tabs. If you have older OpenRig worker views with a pill strip, use **Close OpenRig's old views** (System) to close them; your seats keep running.
- Opening a health finding that has disappeared now points to Health on the same OpenRig, rather than saying the request was already answered.
- Reply in your own words, Open seat and Open assistant page in Needs now work from the keyboard.
- Enter on a control now runs its action once, so Add a machine and other dialogs do not open twice. Connection dialogs keep Cancel or Close reachable while their configuration loads.
- Closing the old-view cleanup dialog no longer interrupts cleanup. The Rig sidebar and System report the result.
- Add a machine waits for its folder check before showing verification and choosing which field needs attention. Folder edits still check again after an earlier check completes, and asynchronous failures return keyboard focus to the right field.
- Live updates and reconnect attempts keep working when another Herdr tab is active. Closing or changing a connection prevents its delayed event refresh from starting new work.
- Refresh shows newly added projects without restarting Herdr. Your selected project stays selected; if the check fails, the last project list stays visible.
- Connected assistants remembers whether it is open, and dialogs keep keyboard focus after asynchronous checks. Settings can finish checking an uncertain save without depending on another tab.
- Repeated changes to the Rig page's Needs perspective, folds and last-seen state now save even when no sidebar is open.
- Rig page buttons and links explain what they do when you hover over them.
- Helper approval from another view resumes a waiting grid check automatically.
- Recovery warnings stay visible without repeated checks of unchanged grids. Unavailable connections retry less often, say why, and can still be retried at once.
- The sidebar avoids repeated checks and redraws when nothing has changed, including after you change OpenRig's settings. Real activity changes and connection errors still appear, and old notices and space information are cleared when they are no longer needed.
- In a software-rendered test with 33 spaces and 128 tabs, idle app CPU use across processor cores fell by about 72%, from 243–245% to 68–69%. This was two measured runs per build on Herdr 0.1.16; it is not a guarantee for every setup, and render-interrupt banners can still appear under load.
- Permission dialogs stop polling after they close, and the Spaces list checks less often while idle.
- Rig pages reuse unchanged data and draw batches of new answers together, reducing repeated reads and redraws.
- Separate Rig tabs keep their own page history, so Back and Escape stay in the tab you use. A tab split into several Rig panes still shares one history, as before; older layouts without native tabs also keep shared history.
- Pause and Archive refusals say "Nothing was sent" once when their connection disappears. A spec save that finishes after its editor closes still reports that it saved.
- **The sidebar shows your rigs and requests without waiting for OpenRig's whole Needs list.** On a large OpenRig that list can take several seconds; requests are now read on their own (quickly) at every refresh, and the rest of the list is read in the background, at most once at a time. When it's slow, Needs says how often it's read. The Rig page uses the sidebar's copy instead of reading it again.
- After a capability check fails, a connection keeps its last confirmed controls while its OpenRig version still matches, instead of offering unsupported actions again. Connections says when it is using that last answer.
- Error banners explain what went wrong, with the original message under Details. Status labels and counts use plain words, such as "needs attention", "1 seat" and "1 rig".
- A smaller installation includes only the code each mod needs, with its helpers, icons and release information.
- **In the narrow Rig view, the Usage section now follows the page filter.** Beside a grid (under about 660 px wide), a filter narrows the Usage cards as it does the wide table, and says when nothing matches. This was a known issue in v0.5.2.
- Health checks on this computer refuse an answer that redirects or does not confirm the requested address.
- **Open rig space goes into the space you already keep for the rig** (one named after it), instead of making a second, numbered one.
- Hover over the Needs read time or a connected assistant's queue icon to read its explanation. These tooltips now appear instead of filling Herdr's log with warnings.
- **With several OpenRigs, opening a rig's space from the sidebar opens that OpenRig's rig, even when two OpenRigs have a rig with the same id,** and a space another OpenRig on this computer made is no longer taken over when the two share a host name.
- **With several OpenRigs, archiving a rig no longer drops another OpenRig's same-named rig from the Rig page's back history.** Before, archiving `demo` on one machine also removed the pages of a `demo` on another.
- **With several OpenRigs, the Topology page you land on after archiving or deleting a rig, or after opening the Rig page with no page chosen, belongs to that rig's OpenRig.** Before, it named no OpenRig, so a link from it could open on the wrong one.
- **With several OpenRigs, each OpenRig's spaces show only its own pages:** opening another OpenRig's request goes to that OpenRig's space instead of changing a Rig page in another space, and an older Rig page in an OpenRig's space adopts that OpenRig instead of saying `"This page names no OpenRig"`.
- Interrupted spec Save and Copy & edit recover from temporary files left behind by a failed transfer. Fresh concurrent transfers are refused, and every write checks its intended text so two windows cannot mix their spec contents.
- Different non-loopback OpenRig addresses stay distinct, while equivalent spellings of one address still prevent duplicate connections.
- Capability checks refresh when OpenRig changes, keep each connection's answers separate, and retry when they fail.
- **Connections stays current.** System › Connections now follows the sidebar when an OpenRig stops answering and when it recovers.
- **System › Connections shows a change to a machine's helper approval at once.** Approving the Attach helper, or removing its approval, updates the Helper row right away; before, the row changed only after you edited the settings.
- Worker-view headers do less repeated work while idle; countdowns and new status still update.
- Cancel in a reply box now keeps what you typed; Discard draft throws it away.
- **When OpenRig refuses a send before it leaves, herdrig says "Nothing was sent." and lets you try again.** This covers Send, Queue, Reply, Launch, Archive, one-click actions and People actions: the machine is offline or not approved, OpenRig's settings changed meanwhile, or OpenRig's command reports that nothing ran. Your text and the confirm button stay. A request OpenRig refused outright no longer adds "It may still have arrived"; a dropped connection or a server error still does.
- After a People action, its page refreshes using that OpenRig's current connection settings.
- The Rig graph no longer shows extra pods named after parts of a seat's name during a refresh.
- **A rig's Graph keeps its legend in place.** The status line above the graph ("Last handoff … ago" or a seat's details) stays on one line and ends in "…" when it is long; it no longer pushes the legend onto a second line and flickers between the two layouts every second. The handoff's age now counts in seconds for the first minute, then in minutes, then in hours.
- **Retry after a failed Pause checks the seats again.** If the rig's seats changed since you reviewed them, nothing is sent; reopen Pause to review the new list.

## v0.5.2

Faster and steadier with several OpenRigs.

- **Faster.** The sidebar draws quicker with many spaces, System pages draw only their own card, and opening a rig space shows its first tile almost at once.
- **Steadier with several OpenRigs.** Dismissals, spinners, notices, approvals, palette lines and worker views stay with the OpenRig they belong to.
- **Easier to follow.** Expanded Topology headers stay pinned while you scroll their seats, and more of herdrig works from the keyboard.
- **Plain words when something goes wrong.** A timeout names the machine and how long it waited, and herdrig's own errors say what they are instead of "OpenRig isn't answering".

### Updating from v0.5.1

- Updating asks for no new approval. Machines you've already approved keep their Attach approval.

### All changes

- **A tab or link on a Rig page no longer opens a new "OpenRig" space or moves you to OpenRig's home space.** Switching a rig page's tabs (Table, Recent, Overview, Graph, Health), and choosing the same rig in the page's breadcrumb menu, stays on the page with no wait for the remote machine; a link to another rig that has its own space still takes you there. Only an explicit open (the sidebar, the palette, a menu, Open TUI or a request) can create the home space.
- **The sidebar no longer republishes unchanged update data every second,** which cuts idle work with several OpenRigs and many dismissed updates.
- **A refresh that finds nothing new no longer resends all of OpenRig's rigs, seats and requests to every view,** and the "Opening" lines are sent only when they change. Idle herdrig does much less work, most of all with several OpenRigs.
- **A rig space on a Herdr machine no longer flashes "Rebuilding …" in the sidebar on every refresh while nothing is being rebuilt.** The line shows when you open the space, after a restart, and when its grid really changes.
- **After Herdr restarts, a rig space on a Herdr machine keeps its grid instead of rebuilding it, and no longer checks the machine and shows "Rebuilding …" on every refresh while you look at it,** including a grid whose tiles came back as shells, which waits for you to review it. A grid that no longer matches the rig's seats is still rebuilt.
- **Delete rig… on an archived rig now deletes that rig instead of saying no rig was found.** Before, it could also delete an active rig with the same name. It now looks up an archived rig by its id, so an active rig of the same name, and its open pages, are left alone. An archived rig no longer offers **Archive**.
- **With several OpenRigs, the right-click menu on a rig or seat with many unavailable actions draws faster again,** after the New rig checks made it a little slower.
- **Opening a rig whose space check failed earlier now retries that space first.** When the machine answers again, herdrig takes you to the rig's own space; when it still fails, the Rig page opens in place with a clear note naming the reason, and no second space is built for that rig until you close the in-place page.
- **More of herdrig works from the keyboard.** Tab now reaches the Rig page tabs, the sidebar's offer to add a machine, Add a machine… and its machine list, and workflow links, and Enter or Space opens them.
- **The System health page's "N more findings" row and the Rig page's "Open the graph" link can be reached and used with the keyboard.** Tab to either, and Enter or Space acts; before, neither could take focus, so Tab skipped them and keys never reached them.
- **With several OpenRigs, New rig now creates the rig on the OpenRig you are looking at,** and its spec list and previews come from that OpenRig. Before, the + button and the dialog's list could use the first OpenRig, and a rig could be created on the wrong one. Whether `rig create`, archive and restore are offered also follows the OpenRig the action is for.
- **With more than one OpenRig, Rig page links, `Back`, and `Escape` keep each page on its own OpenRig:** seat links and **Send** / **Queue** on a pod page stay on that pod's OpenRig, opening the same section on two OpenRigs no longer overwrites the other's history, and a Rig tab in a Herdr machine's space keeps that machine's page when the machine runs one OpenRig (other Rig tabs, including those on this computer, still show the page opened last, on whichever OpenRig, and opening a request from the Rig sidebar can also move a hidden Rig page in another space to that request; nothing is sent to the wrong OpenRig), **Back** and **Escape** act on that OpenRig's history (including returning from a single request to its Needs list, from a System subpage to that OpenRig's System page, and from `rig.back` to that OpenRig's space), **Attach** re-checks whether a seat name is shared after looking up the local daemon address, and a skipped background sync for an unopened rig no longer clears a machine's disconnected warning early.
- **With several OpenRigs, a few more actions now act for the OpenRig they came from, not the one the sidebar happens to show.** Clicking a "seat ended" notice opens that OpenRig's Needs page; opening a request whose id exists on more than one OpenRig opens the one you are looking at (or says it is on more than one); and the menu's Restart TUI and the strip view's Open or switch to the Rig TUI use that OpenRig's TUI.
- **With several OpenRigs, Scopes project choices, workflow owner links, and deleted-rig space menus stay on their own OpenRig:** picking a Scopes project on one OpenRig no longer switches another OpenRig's Scopes page, sidebar, or palette (and ignores project ids no longer in that OpenRig's catalog), right-clicking a workflow or packet row in the sidebar opens the owner's seat on that OpenRig instead of another OpenRig with the same session name, and right-clicking a rig space whose rig is no longer listed opens that space's OpenRig page and operator instead of the first or shown OpenRig.
- **With several OpenRigs, a page keeps answering and refreshing on the OpenRig you acted on,** even if the page moves to another one while the answer is still coming back. A copied space or a same-named rig on another OpenRig is no longer taken for the one you meant, and *Attach* from a page with no Rig sidebar now works on the OpenRig that page shows.
- **When a check or command times out on a machine or on OpenRig, the notice explains what happened in plain words** (naming the machine, how long it waited, whether a save or copy may still have happened, and `hc machine ls` when a machine stopped answering) and keeps internal call details in Herdr's log instead of the toast.
- **Error messages say what happened and what to do, instead of naming herdrig's internals.** A failed request used to read "GET /api/slices → 404"; it now reads "OpenRig couldn't send the slice list (error 404)." A failed check on a machine used to read "Remote printenv failed."; it now reads "A check on box2 didn't work (printenv failed). Nothing was started." Errors OpenRig itself gives are still shown as OpenRig wrote them.
- **Add a machine** re-checks whether the screen was closed or settings changed while reading Herdr's machine list, checks `/healthz` by its exact path when probing a machine, no longer says `"Nothing was sent."` in **Replace viewer** after the older viewer was already stopped, and lets you dismiss a saved-aside settings draft with the keyboard (`Tab`, `Enter`, or `Space`).
- **System pages open faster.** Each System page now draws only its own card, and a long list of health findings shows the first 20 with a row to show the rest.
- **The Previous and Next links on paged Needs lists now work from the keyboard** with Tab, Enter, Space, and Left/Right arrow keys, keeping keyboard focus on the pager when reaching the first or last page.
- **Clicking an "N more" row in the Rig sidebar with no Herdr space open now opens the page,** instead of saying the OpenRig connection isn't set up any more. It affected a setup with one machine and no written address, such as `daemonMachine` alone, mostly right after Herdr started, and it included v0.5.1's "N more requests".
- **After you dismiss hundreds of updates, the Rig sidebar no longer stalls on each refresh.** Working out which updates to hide compared every dismissed update with every update; it now looks each one up once.
- **When the Rig sidebar closes during an action, it says so.** A button no longer spins for ever after a layout switch or reload mid-action; the status says the action may have finished, and an interrupted space build says it was cut short.
- **The Rig page stays quick for big rigs.** Working out a rig's working, needs-you and idle counts took time that grew with the square of its seats; a 100-seat rig's page now draws as fast as a small one's.
- **A quick second change on the Rig page is no longer lost** — a change to folds, row order, or what you last saw — when the tab closes right after it, or while the first save is still writing.
- **Rig page counts use one source per draw and mark retained data honestly when a refresh fails:** the Topology pulse strip, rig headers, pod rows, tabs, and section menu all count from the same per-connection read, and a pane whose refresh failed shows `stale · last updated N s ago` instead of presenting older counts as current.
- **Host rows in System › Overview, Connections, Usage, and the sidebar show legible host names at both sidebar and page widths:** OpenRig `host-xxxxxxxx` ids show in full instead of `"host…"`, longer host ids keep both their start and unique end, and narrow panes stack Usage rows instead of squeezing the Host column.
- **A slow Attach on another machine always ends with a message.** On a busy machine its 120-second give-up could be lost, leaving the Attach silent after the "Still working" notice.
- **Pointing at a row in Topology › All seats now shows its Attach and `⋯` buttons,** without needing to click the row first.
- **An expanded Topology section's header stays at the top of the sidebar while you scroll through its rows,** so you can still see which rig or pod you are in.
- **Starting Herdr on a configured machine's space no longer offers "Add <machine>…" while its OpenRig is still loading.** The sidebar follows that machine's connection as soon as `config.json` is read and shows its loading state until OpenRig answers.
- **The Rig sidebar draws faster with many Herdr spaces.** Each draw used to work through every space on every machine, once more for each OpenRig, before showing a row; it now reads only the space you are in, and works out the Spaces list's rig marks again only when spaces, terminals or OpenRig data change. The narrow sidebar does none of that work.
- **With several OpenRigs, dismissing an update on one no longer hides or restores updates on another,** even when two OpenRigs happen to use the same id. Updates you dismissed before upgrading stay dismissed on their own OpenRig.
- **With several OpenRigs, dismissing an update addressed to you on another OpenRig now also closes it there** after the 10-second Undo window, as it already did on your first OpenRig. Before, it could stay open in that OpenRig.
- Clicking or pressing Enter on **N more dismissed** in the sidebar opens that OpenRig's Needs page on its dismissed list.
- **Dismiss all** says how many it dismisses ("Dismiss all 300") on the Rig page's Updates tab too, as it does in the sidebar, and says **Dismiss** when there is only one, in the Updates header and its menu.
- **Opening a page for another OpenRig no longer shows a false "Nothing was opened" warning** when the page opened in its space.
- **With several OpenRigs, one-click button spinners and standalone Priority request rows stay separate per OpenRig:** finishing or refusing an action on one OpenRig no longer clears another OpenRig's busy spinner, and requests with the same id on two OpenRigs keep distinct rows in Priority view.
- **Updates on the Needs page keep their summary visible in a narrow split pane,** instead of squeezing the summary out behind "no action needed", and a row's menu now offers **Copy request id** so the id stays reachable when the inline button hides.
- **Closing a one-click dialog while it is still reading settings no longer runs the action behind your back,** and **Pause** and **Archive** re-check the rig's seats when you confirm so a seat that joined or left since the dialog opened is caught before anything stops.
- **A new Attach from a Rig page or a menu no longer fails with "Open the Rig sidebar to attach" while the sidebar is open but busy.** herdrig now waits up to 10 seconds for an open sidebar to take the request, and if it still doesn't, says the sidebar didn't answer in time.
- **A slow Attach on another machine now says what it is doing.** After 15 seconds it shows "Still working on <machine>: <step>". After 120 seconds it gives up, names the step it was on, and starts nothing more. If the new viewer was already being started, it says the viewer may still appear; if an older viewer was being replaced, it says that one may already be stopped.
- **The sidebar's Specs, Scopes and Terminals sections show 20 rows of each list, as Needs does.** A "N more" row opens the page with the whole list. With a few hundred specs open in the sidebar, every draw used to go through all of them.
- **Add a machine** warns when the typed **OpenRig home on this computer** folder doesn't exist on this computer yet or looks like the machine's own path.
- **After a restore, Resume says which seats didn't come back as they were:** a seat left attached, one missing its guidance, one skipped because it wasn't in the snapshot, or one that started fresh without its earlier conversation. A seat that needs attention without a prompt is labelled "needs attention", matching the reason shown under it.
- **Addresses are read without relying on a `URL` class in Herdr.** Older Herdr versions may not provide one; where it was missing, a second OpenRig's requests were refused as "built for a different OpenRig", the live event stream never connected, and Copy & edit of a folder could not prove its port. The check is exactly as strict as before: a user name, backslash, odd port or other scheme in an address still counts as a different OpenRig.
- **herdrig now refuses an OpenRig address it cannot read exactly (for example 127.1 or 0127.0.0.1).** Some of these spellings were read as a different machine, such as 0127.0.0.1 as 87.0.0.1. Write the address as http://127.0.0.1:<port>, a host name, or http://[::1]:<port>. A connection in the list with such an address is left out, and System › Connections says which one and why. If a config has only that one address, the Rig sidebar shows the sentence in place of the tree until the address is fixed.
- **A redirected or malformed OpenRig address is now refused, even with one connection set up.** The address has to keep the same origin and path, so a check can no longer end up at a different machine or a different API path.
- Retry in a followed OpenRig's section refreshes that connection's list, even if the sidebar has since moved to another OpenRig.
- **With several OpenRigs, worker views open through their own OpenRig,** not the first one in the list.
- With several OpenRigs, a spec page's save hint and a connection's "helper verified" note are about their own OpenRig, and a right-click menu that isn't for one OpenRig no longer shows another's **Follow** tick.
- **With several OpenRigs, the "Since you were away" summary and notification seen-state are kept per OpenRig:** ending a mode or clicking **Mark seen** on one OpenRig no longer shows or dismisses the summary on another, and every configured OpenRig saves its own notification seen-state in `state.json`.
- **An approval no longer changes which OpenRig it was for.** With several OpenRigs, the sidebar's Operator button or an Attach that asks for first-use approval now opens the operator or seat of the OpenRig it was clicked for, even if the sidebar has moved to another OpenRig by the time you approve.
- **A palette line acts for the page it was typed on.** If the Rig page changes while a typed line such as `launch` is being looked up, the line still acts on the page you typed it on, instead of refusing or mixing the two pages.
- **Closing the palette while Open operator or Open TUI is still running now says so.** The step may have half-started, so the notice names the tab to check.
- Pointing at a greyed-out item in a right-click menu no longer shifts the menu, so a click without moving the pointer can no longer run the item below it.
- **A problem in the needs notifications no longer reads as "OpenRig isn't answering".** If herdrig's notifications fail, the sidebar keeps showing OpenRig and tells you once that the notifications stopped working, as a herdrig error rather than a connection problem. Other errors in herdrig's own code while reading OpenRig are named too, instead of saying OpenRig can't be reached.
- **Typing a command like `:topology`, `:specs` (or a prefix such as `:sp`), `spec <name>`, `host <name>` or `back` in the Rig palette now shows what Enter will open** (including which OpenRig it acts on when several are set up) instead of saying "No matches".
- **In the Rig palette, `change-model` and `agent` distinguish same-named seats across rigs on one OpenRig, capability checks read the target OpenRig, and page commands stay on the palette's own OpenRig and tab:** completion rows name `<seat>@<rig>` (typed commands also accept `<seat>@<rig>`, session names, or `<rig>/<seat>` and refuse an ambiguous bare seat name instead of picking the first rig), `view-design` and command lookup check the target OpenRig's capabilities instead of the first connection's, and `open-page`, `all-seats`, `expand-all`, `collapse-all`, `back`, and `reply` open or stay on the palette's own OpenRig and tab instead of jumping to another OpenRig's last-opened page.
- **Commands that need the Rig sidebar now say so, instead of Herdr's raw "unknown command" toast.** With the Rig sidebar removed from your layout, a page command such as Open rig space reads "Open the Rig sidebar to open rig spaces. Nothing was opened."
- **Opening or changing a page over an open Rig page keeps you in that tab**, and a rig with no space opens its page there instead of jumping to the home space.
- **The optional Spaces list takes herdr-app v0.1.16's own list** (System → Layout). It now reads its saved state safely — a damaged saved value starts empty instead of failing — and a git check that isn't sure keeps its earlier answer.
- **In the optional Spaces list, reconnecting a rebuilt machine keeps only whether the old entry was removed in saved state, checks machine details before running `hc`, lets you click Connect again to retry if adding the new machine fails after removing the old one,** and shows "This machine isn't known any more" only on the clicked machine when Herdr restarted without a live machine record.
- **A Settings or Needs save that can't be written now says why** — the file kept changing, it is too large, the disk is full, the folder is read-only, or it is not writable — and it retries a write that lost a race up to three times from a fresh read, without ever printing the path.
- **Opening a rig space is much faster, stays responsive with hundreds of Herdr terminals, and shows live step progress.** `Open rig space` focuses the space and its `Seats` tab as soon as the first tile is ready (including before old panes close during a post-restart rebuild), confirms new panes directly instead of waiting on half-second terminal list polls between splits, checks remote tmux sessions in one pass, prepares a Herdr machine once per build instead of once per tile, skips background machine checks while an open grid is unchanged, indexes Herdr's terminals once per step so large workspaces don't interrupt the open, shows the current step in both the sidebar and the Rig page while building or rebuilding, and always shows a warning naming the step if an open is interrupted or fails.
- **When a rig space waits for helper approval on a Herdr machine, it says so plainly and continues as soon as you approve.** The approval dialog opens immediately as a modal without checking the machine a second time, both the Rig page and the sidebar keep `"Waiting for you to approve the helper on <machine>"` with **Approve helper…** steady on screen (without background rebuild checks replacing it between refreshes; in the sidebar it is also reachable with `Tab` + `Enter` / `Space`), and approving immediately continues opening the rig space without an extra **Done** click.
- **A Rig page count of seats waiting on you reads naturally:** "1 needs you", "0 need you", "7 need you", instead of "0 needs you" and "7 needs you".

### Known issues

- With a large OpenRig (dozens of requests and a few hundred updates), the Rig page and the sidebar can show "This view could not be re-rendered; showing the last version that worked", sometimes even when nothing is happening. On the Rig page it can stay up for several minutes; clicking a tab doesn't clear it, and a newly opened Rig page can show it too, with Topology still loading. It clears by itself after several minutes and can come back. When the sidebar is showing that large OpenRig, it can stay on its last working view most of the time, as in v0.5.1. With a smaller OpenRig selected in the sidebar, it rarely shows the banner. On the Rig page it's about as frequent as in v0.5.1, or a little more.
- **Some messages still show what the underlying tool said, word for word.** Where OpenRig or Herdr reports a failure, that text is kept as they wrote it, so it can name an API path or an internal command.
- **An OpenRig address with a path after the host is refused.** If your OpenRig sits behind a proxy at a path (for example `https://host/openrig`), herdrig refuses its calls with "unexpected OpenRig API path" and sends nothing. v0.5.1 accepted such an address. Addresses written by **Add a machine** have no path and aren't affected.
- **A Herdr machine whose layout changes during a check can keep a rig space's failure on screen.** If the machine's layout changes while a background refresh is checking a rig space, that failure is kept: later refreshes show it again instead of checking anew, until you open the rig space yourself.
- **In the narrow Rig view, the Usage section ignores the page filter.** Beside a grid (under about 660 px wide), Usage shows every row as a card, whatever filter you typed; the filter works in the wide view.

Tested with OpenRig 0.7.17 and 0.7.18, and herdr-app 0.1.16.

## v0.5.1

Fixes for v0.5.0.

- **The Rig sidebar and the Rig page cope much better with hundreds of requests or updates (see Known issues).** v0.5.0 could show "This view could not be re-rendered" for an OpenRig with a few hundred updates nobody had dismissed, for example on a machine added with Add a machine. The sidebar shows the first 20 requests, updates and dismissed updates. A "N more requests" or "N more updates" row opens that OpenRig's Needs page on the matching tab. The Needs page shows 50 at a time, with Previous and Next; its keys act only on the rows of the page shown, and changing page clears the selection. The Topology pages stay fast too.
- **The Rig page no longer goes blank ("This view could not be rendered: interrupted") when Herdr lists many terminals,** for example from several machines. Each seat used to search every terminal and pane on every draw; now they are looked up once per draw.
- **The Rig sidebar no longer freezes when Herdr lists many terminals** and the focused terminal isn't a seat's. Finding the focused seat searched every terminal and pane for each seat on every draw; now they are looked up once per draw.
- **The Rig sidebar no longer sticks with hundreds of open updates on another OpenRig.** Every draw of that OpenRig's view went through all of its requests and updates again, although it shows 20; it now does that once each time OpenRig is read.
- **The Rig sidebar no longer sticks with Topology open and hundreds of Herdr terminals.** It now reads Herdr's terminal lists once per draw and looks for helper terminals only for seats that have them. The sidebar lists show 20 rows each; the "N more" row opens the full list.
- **An Attach on another machine always says why it failed.** After one "OpenRig isn't answering" notice for a machine, later failed Attaches there showed nothing until Herdr restarted; now each one shows its notice, and a success there resets it.
- **The Rig page no longer copies all of OpenRig's data on every draw.** It reads it again only when the sidebar publishes new data, so pages stay quick with several hundred updates.
- **In the sidebar, Dismiss all says how many it dismisses** ("Dismiss all 300"), on the Updates header and in its right-click menu. It still dismisses every update, not only the ones shown.
- **With a machine pinned in the sidebar, a page you open from a row or its menu shows that machine's OpenRig,** not this computer's.
- **With several OpenRigs, a page that doesn't say which OpenRig it belongs to shows nothing and sends nothing.** It says "This page names no OpenRig, and several are set up" instead of quietly showing the first one. System and file pages aren't affected. Open the page again from a row in the Rig sidebar.
- **The summary notification for new requests opens the Needs page of the OpenRig it came from.**
- **When two OpenRigs share a seat name, an older Attach tab that does not say which OpenRig it belongs to is no longer reused or focused by mistake;** herdrig asks you to close it, then Attach again.
- **Clicking another space no longer folds the OpenRig sidebar.** It keeps its size and its open and closed sections on every space, and folds only when you fold its block yourself; that fold stays when you switch spaces or restart. If an earlier version left it folded to its header, it opens to its previous height once after updating.
- **A Rig page no longer stays on loading placeholders after an answer from OpenRig is lost,** for example when a connection drops mid-request. After 30 seconds it asks again, and whichever answer comes back first is shown; an older answer arriving after a newer one is ignored.
- **Herdrig has a logo.** The README now opens with it, in a light and a dark version, and the full kit is in `assets/logo` (SVG and PNG sizes, with its attribution).
- **RECIPE.md:** the sidebar block id is `rig-sidebar` (one place said `openrig-sidebar`, which the sidebar never finds), and "Fitting it into the layout" now names all five mods.

### Known issues

- With several hundred updates, changing page can rarely show the could-not-be-re-rendered banner for a few seconds. It clears by itself.

## v0.5.0

### Updating from v0.4.7

- When OpenRig stops answering after three failed or timed-out checks, Attach tiles clear their status dot instead of showing "Needs you" or raising a notice. The sidebar says OpenRig is not answering, and the seat status returns when it answers again. Checks are bounded, never overlap, and back off when OpenRig is slow. After updating, Attach again to each seat whose Attach tab was opened before the update and choose **Replace viewer**: it stops the old helper, closes its tab and starts the current one in its place. (Closing the old tabs and attaching again does the same.) The updated helper is approved once per configured Herdr machine; local Attach does not ask for approval. Until then, tabs left open keep the old helper and may still show a false "Needs you".

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
- **Copy & edit** of a built-in spec that has its own folder (such as `starter`) works on this computer for the OpenRig
  that uses this computer's default OpenRig home (`~/.openrig`): it copies the folder, points the copy's agents at the
  built-in's, and opens the copy renamed, as with one OpenRig. For another OpenRig on this computer it says why it can't
  copy there, and nothing is copied. On a machine, Copy & edit works as before.
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

Tested with OpenRig 0.7.14, 0.7.16 and 0.7.17, and herdr-app 0.1.16.

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
