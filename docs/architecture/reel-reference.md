# Visual reference: the FounderOS reel Noe wants to match

Source: brodyautomates' Instagram reel (Oct 2026) showing his live
FounderOS ("glados.com / GLADOS"). Claude watched it frame by frame on
Oct 3. Every screen in it already exists in this fork; what's missing is
real data and the always-on agent host. Use this as the target look and
priority order when the dashboard specs reach the UI.

| Reel screen | Route / component | What it needs to look like the reel |
|---|---|---|
| Radial "brain" ring of nodes (clients, leads, skills) | `/brain`, `BrainViz` | Real workspace data feeding the rings |
| Integration card grid with Connect buttons | `/integrations` | M4 connect flows per workspace |
| Unified inbox: Email, Slack, WhatsApp, Meetings with counts and unread bars | `/comms` | Per-workspace inboxes (IMAP app passwords) |
| Red globe, "N active campaigns", leads by city | `/adpilot`, `components/adpilot/Globe.tsx` | Meta + Google Ads collectors; un-park AdPilot when ads data exists |
| System map with "Ask …" chat bar | `/blueprint` | Rename the assistant to nosterOS; fix host blurb |
| Agent team with avatars, active/open tasks/cost | `/org`, `/agents` | Paperclip connected; nosterOS agent names |
| Finances: income by category, monthly bars | `/finances` | Stripe collector per workspace |
| Workflow builder; each step assigned a roster agent | `/workflows`, `WorkflowBuilder.tsx` | Keep as is |
| Deal pipeline ("Deal Journeys"), deal volume | `/brand-deals` | **Keep, don't cut**: repurpose as nosterMarketing client deals (proposal → won), not sponsorships. Supersedes checklist item "Remove Brand Deals". |
| Lead table: Save now / Journeys / Archive, stage, days quiet | `/funnel` | Real leads (Lead Search + outreach) |
| Agent performance with per-run bars | `/agents` | Real runs from Paperclip/collectors |
| Mac mini on the desk | n/a | An always-on host for agents. For nosterOS: the Railway service plus Paperclip (local PC first, cloud later) |

Look and feel to keep: dark theme, green accents, dense data cards,
everything labeled with real counts. Rebrand the name and the assistant
("GLADOS" → nosterOS), not the style.
