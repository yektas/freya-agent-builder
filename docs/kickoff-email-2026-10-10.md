# Post-kickoff email — October 10, 2026

Source: organizer email pasted by Sercan in this chat on October 10, 2026. This is an evidence summary, not a separately fetched email. No credentials were supplied in the message.

## Resources and setup

- [Hackathon page](https://www.freyavoice.ai/hackathon): task, scoring, rules, and timeline. See the [tab-by-tab review](hackathon-website-2026-10-10.md).
- [Starter kit v3](https://www.freyavoice.ai/hackathon/build-the-builder-v3.zip): briefs, docs, 13 practice customers, an example agent, and an example builder. Read `README.md` first for the ten-minute start. The filename and README header identify the kit version; organizers will email if it changes. See the [actual package review](starter-kit-v3-2026-10-10.md).
- [Freya staging dashboard](https://staging-app.freyavoice.ai): create a workspace API key under **API keys**, then set `FREYA_API_KEY` in `env.sh`. Keep the actual key local and out of Git.
- Bank tool API: described in the kit's `tools/openapi.json`; used by the phone agent during a call. Choose a secret team key of at least 16 characters and reuse the same key every time. This is separate from the Freya API key.
- The workspace already contains **Freya Bank Collections Base**, with a practice customer in its test variables so chat can start immediately. The kit's `examples/base-agent.json` contains the same agent.
- [Kickoff recording](https://fathom.video/share/SCFTpw9gPFqxxEqk49PbM3HFjSros35m).
- [Background benchmark paper](https://arxiv.org/pdf/2609.04611). The email calls this inspiration for the format; it does not make the paper the competition contract.

## Timeline

The email specifies Sunday without a calendar date. In this October 10 kickoff context, Sunday is **October 11, 2026**. Istanbul is UTC+3.

| Milestone          | UTC               | Europe/Istanbul   |
| ------------------ | ----------------- | ----------------- |
| Hidden briefs open | October 11, 17:00 | October 11, 20:00 |
| Submissions close  | October 11, 20:00 | October 11, 23:00 |

This leaves three hours between hidden-brief release and the submission deadline. Organizers will send submission steps before hidden briefs open; the email itself does not define those steps.

## Operating rules confirmed by this email

- Solo participants or teams of two are allowed.
- Only one practice simulation may run at a time per workspace.
- Any builder tooling is allowed, including Claude Code, Codex, or custom code.
- Preserve the builder's trace: organizers request it with the submission.
- Questions can be sent by replying to the organizer email. No reply has been sent as part of this research.

## Scope of this evidence

The email alone does not specify scoring weights, final evaluation restrictions, exact builder input/output, or the final submission mechanism. Consult the website and versioned package reviews for those details. Recording and paper links are retained as supplied resources; their contents are not asserted here.
