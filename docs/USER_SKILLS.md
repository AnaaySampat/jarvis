# English task guidance and user skills

Settings → Intelligence → Skills imports reusable English instructions from Markdown,
text or JSON. Imports are saved locally and start disabled. Review the instruction
preview, then turn on **Use this skill**. Removing an entry deletes its local copy.

```markdown
---
name: Research Helper
description: Compare reliable sources
keywords: research, sources
---
Prefer primary sources. State uncertainty and cite your sources.
```

JSON accepts `name`, optional `description`, optional string-array `keywords`, and
`content` (or `instructions`). Markdown supports the simple one-line metadata shown
above; `.txt` needs only the instructions. Language-specific matching is English only.

Enabled skills with keywords apply only when a keyword or phrase matches the request,
without matching fragments inside another English word. Without keywords, an enabled
skill applies as general guidance. There is no fallback to unrelated keyword skills.

- Up to 50 skills are stored in WebView local storage (`jarvis.user-skills.v1`).
- Each file is limited to 100,000 characters and each instruction body to 12,000.
- Up to three matching enabled skills enter a prompt, in library order, with 18,000
  instruction characters in total. The last body is shortened to fit that total.
- Skills are local to this Android installation. They are not synced to Windows or
  applied to incoming PC/WhatsApp commands or scoped specialist consultations.
- Skill changes save immediately; the regular **Save changes** button saves other settings.

The bundled `taskGuidance.ts` selects an English guide for coding, research, writing,
automation, voice, planning, security or general reasoning. This is provider-neutral
prompt guidance, not a new AI provider.

Imported instructions are reference text. They do not execute scripts, install
dependencies, register tools, grant permissions or replace action approvals. The
existing dispatcher, native operator and result verification remain authoritative.
Import only instructions you have reviewed; do not put API keys or other secrets in skills.

The parser, activation, keyword boundaries, storage validation and prompt budgets are
covered by `skillStore.test.ts`; `index.test.ts` checks local prompt integration and
exclusion from incoming PC requests.

This integration adapts [barjij71's skills work](https://github.com/barjij71/jarvis/tree/ed0f6b4640e7c02340b7f7f5d7d8f5c2a9508fc9),
with English-only intent matching, explicit activation and contextual selection fixes.
