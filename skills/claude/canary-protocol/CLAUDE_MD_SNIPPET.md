Append this to your project's root `CLAUDE.md` (the file Claude Code always loads, every turn — unlike a skill, which is invoked only when the model judges it relevant). Without this anchor, the `canary-protocol` skill may not reliably fire on every single response, undermining the "no exceptions" guarantee the protocol depends on.

```markdown
## Canary Protocol

Always follow the `canary-protocol` skill for every single response in this conversation,
with no exceptions: call `generate_canary` and print the canary lines at the top and
bottom of every response, starting from the very first turn.
```
