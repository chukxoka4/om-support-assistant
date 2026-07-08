# Session History (provenance)

A map of the Claude Code sessions that built this repo, so a future owner knows
*where* a decision came from and can find the raw transcript if needed. The
transcripts live under
`~/.claude/projects/-Users-nwachukwuokafor-Projects-om-support-assistant/*.jsonl`
on the machine they were recorded on — they do **not** travel with the git
repo. This file is the durable summary; the docs are the durable content.

> If you're reading this on a fresh account/machine, the `.jsonl` transcripts
> almost certainly aren't here. That's expected — everything of lasting value
> was lifted into the `docs/` files. This table is a "where did X come from"
> index, not a promise the transcripts exist.

---

## Sessions

| Session id | Dates | What happened | Lands in |
|---|---|---|---|
| `26b01c45…` | 2026-04-24 → 30 | **Foundational build.** Codebase audit ("previous AI made a mess"), product understanding, AI-Adoption-Rubric skill creation, the whole bug plan (A1–E4) + feature plan (F1–F8), the docs sweep, then shipping: A1–A3, B1, C1–C2, D1–D3, F1 (suggestions strip), F2 (Intercom client + chip), the Audit tab + weekly report generator, windowId fix, Library & Learning re-layout. | Docs 00–07, DECISIONS D1–D25, OPEN-THREADS OT-1–13, INTEGRATIONS, ARCHITECTURE, CONVENTIONS |
| `c88ab193…` | 2026-05-08 | **Report & Suggestions v2** (9 commits) + the AI-Adoption-Rubric **Slack soft-launch** thread + the "Claude Design" exploration. | [08-REPORT-SUGGESTIONS-V2.md](08-REPORT-SUGGESTIONS-V2.md), DECISIONS D26–D33, [09-STRATEGY-AND-LAUNCH.md](09-STRATEGY-AND-LAUNCH.md), OPEN-THREADS OT-14–15 |
| `bffe5eb8…` | 2026-07-07 → 08 | **Documentation catch-up** (this pass). Mined the two prior transcripts for anything not already in markdown and wrote it up — created docs 08, 09, this file; extended DECISIONS + OPEN-THREADS + INDEX. Motivated by a possible migration to an Enterprise Claude account. | This file + the 2026-07-08 doc additions |

---

## Timeline of shipped work (git, newest last within each session)

**Session `26b01c45…` (Apr 24–30):** foundational commits from
`ee9771c` (icons + product docs) through `9e57edd` (docs sweep) and
`ca48a8f` (Library & Learning re-layout). The bulk of the product.

**Session `c88ab193…` (May 8):** `38803be` → `06997f7`. See the commit table
in [08-REPORT-SUGGESTIONS-V2.md](08-REPORT-SUGGESTIONS-V2.md).

To regenerate the exact list: `git log --oneline --date=short`.

---

## Why this file exists

The user explicitly flagged the migration risk: *"I may be upgraded to
Enterprise Claude and I need to ensure I carry all relevant context stored and
mapped out. Your memory index is not the answer — complete md files are the
way."* The `docs/` tree is that durable artefact. This file is the index that
ties each doc back to the conversation it came from, so provenance survives even
when the transcripts don't.
