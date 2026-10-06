# M12: Outreach drafts, approval, sending, and reply tracking

Status: ready after M11 has real staging numbers
Review by Claude: yes (sends real messages, legal requirements, deliverability)

## Goal
Turn hot leads into email drafts that a human approves, send them safely from
the workspace's own mailbox on a separate sending domain, follow up at most
twice, stop on reply or unsubscribe, and feed outcomes back into scoring.
Later, owner/admin can approve a **template + rule** so matching drafts send
without per-message clicks, still inside daily caps.

## Hard rules (from AGENTS.md, restated)
- Nothing reaches a real person without an approval record: either a
  per-message approval or an active approved rule. Both are stored with user,
  timestamp, and the exact template version.
- `OMEGA_OUTBOUND_DISABLED=1` (staging) blocks every send in this spec.
- First real send from production needs Noe's explicit yes in chat, recorded in the Report.

## Decisions already made
1. **Sending channel v1:** the workspace's verified SMTP/IMAP email connection
   (M6f atomic email form). Gmail/Microsoft API sending comes later, after
   Google OAuth verification for the send scope. The UI warns if the sending
   address's domain equals the main website domain and recommends a
   separate domain (e.g. `getnostercodes.com`) with SPF, DKIM, and DMARC.
   Show a DNS checklist that checks those records with DNS lookups
   (read-only) and marks each ✓/✕.
2. **Compliance block (CAN-SPAM), enforced in code, not editable away:**
   - Footer with business name and the plan's `senderIdentity.mailingAddress`.
     No mailing address → sending is disabled with a clear message.
   - Unsubscribe link (signed token, works without sign-in, one click,
     confirms on a page) + `List-Unsubscribe` and
     `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. Opt-outs are
     honored immediately (suppression) and the page states it.
   - Subject lines must not be blank or contain "Re:"/"Fwd:" unless it is a real reply.
   - "From" name = a real person or the business; reply-to = the sending mailbox.
3. **Drafts:** template (per angle) + lead facts + opener from M11. Templates
   are owner/admin-edited with versioning (`outreach_templates`). Merge fields
   limited to a fixed set (`{first_name|"there"}`, `{business_name}`, `{city}`,
   `{opener}`, `{sender_name}`). Unknown merge fields block saving. Plain text
   plus a minimal HTML version; no tracking pixels and no link rewriting in v1.
4. **Approval queue** at `/leads/outreach`: list of drafts with the lead's
   score reasons and fact sources; actions Approve, Edit then approve, Skip,
   Not a fit. Bulk approve up to 25 at a time with a confirm step showing the count.
5. **Auto-send rules (later toggle, default off):** owner/admin can approve a
   rule = template version + minimum score + targets + daily cap. A changed
   template version deactivates the rule until re-approved. Every message sent
   under a rule stores `approval_kind=rule` and the rule ID.
6. **Caps and pacing:** per mailbox max 20 sends/day for the first 2 weeks,
   then up to 40/day (owner/admin can lower, never raise past 50 in v1); random
   2–6 minute spacing; only Mon–Fri 8 AM–5 PM in the lead's timezone (use the
   lead's city). Follow-ups: at most 2, at +3 and +7 business days, only if no
   reply, no bounce, no unsubscribe.
7. **Reply and bounce tracking:** poll the mailbox via the existing IMAP
   connector every 15 minutes during sending days. Match by `Message-ID` /
   `In-Reply-To`. Reply → stop sequence, mark lead "Replied", move to Funnel
   "Conversation". Bounce (DSN) → hard bounce suppresses the address (and
   `global_suppression`); 3 hard bounces in a day pauses the mailbox and alerts.
   Auto-replies (out-of-office) don't stop the sequence but delay it.
8. **Feedback loop:** outcomes (`replied`, `positive`, `meeting`, `won`,
   `not_interested`, `bounced`, `unsubscribed`) recorded per lead; `/leads`
   shows reply rate by signal and angle. v1 only reports. It does not
   auto-change weights. A "Suggest weight changes" button shows proposed
   changes for owner/admin to accept into preferences.
9. **Audit:** `outreach_messages` table stores rendered subject/body hash,
   recipient, approval record, send result, provider message ID, and timestamps.
   Bodies retained 90 days, then only the hash and metadata.

## Do
Templates + merge engine → compliance block + unsubscribe endpoint →
approval queue → SMTP send path behind all guards → pacing/caps → IMAP reply
and bounce matching → follow-ups → outcomes UI → rules toggle (off) → DNS checklist.

## Tests (minimum)
- No send without approval record; rule approval invalidated by template change.
- Missing mailing address blocks sending; footer and headers always present.
- Unsubscribe token: signed, single purpose, works signed-out, suppresses
  immediately, and a forged token fails.
- Suppressed/global-suppressed recipients never send; follow-ups stop on reply/unsubscribe/bounce.
- Daily cap and time window enforced across concurrent ticks.
- `OMEGA_OUTBOUND_DISABLED=1` blocks every path.
- Merge fields: unknown field blocks save; missing first name falls back.
- Reply matching via `In-Reply-To`; OOO detection delays instead of stopping.

## Stop rules
- First production send, buying a sending domain, DNS changes, raising caps
  above v1 limits: Noe only.
- Any wording change to the compliance footer or unsubscribe page is legal
  text: draft it, mark it for Noe's approval in the Report.

## Don't
- No open/click tracking, no purchased lists, no sending to personal
  addresses not published by the business, no SMS or DMs in v1.

## Done when
- typecheck, tests (minus the Windows baseline), build pass.
- On staging: drafts generated, approvals recorded, sends blocked by the
  outbound flag with a clear message; a local SMTP test server (e.g. a
  Mailpit fixture in tests) receives correct messages with headers and footer.
- Production: with Noe's yes, 5 approved emails sent from the nosterCodes
  sending domain, and replies/bounces tracked. Record results below.

## Report (Astra fills this in)
- Status:
- Commits:
- Typecheck / tests / build:
- Legal text needing Noe's approval:
- First production send (date, count, Noe approval quote):
- What changed beyond the spec, and why:
- Questions or blockers for Claude:
