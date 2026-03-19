# Branch / agent logos

Place logo images here for each branch or agent. The app resolves them via `lib/branch-logos.ts`.

- **htg.png** – default / Honest to Goodness (used when no agent-specific logo is set)
- Add more files (e.g. `other-branch.png`) and map them in `lib/branch-logos.ts` (`LOGO_BY_AGENT_ID`).

Logos are shown as round profile pictures in the chat header and next to assistant messages. Use square or round images; they are displayed with `rounded-full` and object-cover.
