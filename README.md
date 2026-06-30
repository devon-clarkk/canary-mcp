# canary-mcp

A visual canary for detecting context rot and silent model degradation in long agent conversations.

## The Problem

Long-running agent sessions degrade in ways that are invisible until they aren't. A system prompt gets pushed out of the context window by a long tool output. A summarization pass quietly drops the instruction you gave forty turns ago. The model loses track of how many turns have actually happened, or starts answering as if half the conversation never occurred. None of this throws an error. The agent keeps producing fluent, plausible-looking text the entire time — there is no exception to catch, no log line to grep for. The only "signal" is usually a human noticing, several turns later, that the agent has started contradicting something it was told earlier.

`canary-mcp` makes that failure visible in real time, in the chat transcript itself, instead of after the fact.

## How It Works

The technique borrows its name from the same logic coal miners relied on: a canary's small lungs fail on gas concentrations far too low for a human to notice, so the bird goes quiet before the miner is in any danger — an early warning from something more sensitive than your own senses, not a fix for the leak itself. Applied here, the agent is instructed to print a small status line at the very top and very bottom of every response, and to answer occasional deep checks the server or a human poses. Five signals, each catching a genuinely different kind of context loss — they're not redundant copies of the same check, and it's worth being precise about what each one actually proves, because two of them are easy to overclaim if you're not careful.

1. **The key (externally verified, catches recent/protocol-level loss).** The server mints a Docker-style two-word key (`vigilant-curie`) exactly once, on the very first turn, and never again — it is never reissued, rotated, or disclosed a second time. From then on the agent can only ask the server to confirm `MATCH` or `MISMATCH`; a miss gets no hint about the correct value. Because the agent reprints the key in every response, a model that can still see its *most recent* canary line can read the key back off that — this is a test of whether the canary lines themselves are still intact in recent context, not a test of reaching back to turn 1. It reliably catches compaction that paraphrases recent turns away, and the agent abandoning the protocol outright.
2. **The anchor (externally verified, catches *rolling* context loss).** A second secret, also minted at the start. Unlike the key, it is **never reprinted** — the agent holds it silently and only supplies it when explicitly challenged: a scheduled check roughly every 5–12 calls (randomized), or a human asking for it on demand. Because it has no recent printed echo to crib from, answering correctly requires more than reading the last line. Be precise about what it proves, though: **every resolved check rotates to a fresh anchor**, so each check only tests retention back to wherever the *previous* check last disclosed it — roughly a 5–12-turn window, not all the way back to turn 1. Treat it as a sliding integrity check across the conversation, not a from-the-start probe.
3. **The root anchor (externally verified, the only one that actually tests "from the start").** A third secret, also minted once at the start, but with two differences from the anchor: there is **no automatic schedule** for it at all — it is checked only when a human explicitly asks the agent to recall it — and it is **never rotated or reissued**, ever, for the life of the session. The first time you ask for it in a conversation, a correct answer is a genuine guarantee that the agent's context reaches all the way back to turn 1; there is no recent echo of it anywhere, scheduled or otherwise, for it to have cribbed from. This is the direct answer to "how do I know if the model lost the original context from the start" — but it comes with a real caveat: answering the check necessarily discloses it into the transcript at that moment, so if you check it a *second* time later in the same conversation, that result only proves retention since the previous check, not since turn 1 anymore. The tool tells you which one you're getting (it tracks how many times it's been checked and says so in `rootAnchorDetail`, on both a `MATCH` and a `MISMATCH`). Use it sparingly if you want it to keep meaning what it's named.
4. **The self-counted turn number.** The agent counts its own responses — the server is not involved in this at all, by design. It exists purely to test whether the agent can still see enough of its own response history to know how long this conversation actually is. If it can't, the number it prints will silently fall behind (or otherwise stop matching) what a human can see plainly in the transcript itself.
5. **The model-authored topic list.** A short, self-reported list of what the agent believes is currently live in its context window. The softest signal: it can catch *gradual* narrowing — earlier subjects quietly dropping off the list over many turns — but it depends on the agent introspecting honestly, an imperfect proxy compared to anything checked by the server's oracle.

In short: the key, anchor, and root anchor are all hard, externally-verified checks — none can be satisfied by talking your way past them — but they test different depths. The key tests the last turn. The anchor tests a rolling ~5–12-turn window. Only the root anchor, asked rarely and ideally just once, genuinely tests all the way back to the beginning. The turn number and topic list are softer, self-reported cross-checks, easy for a human to eyeball but not independently verified.

## Installation

```bash
npm install
npm run build
```

This produces `dist/index.js`, a stdio MCP server with zero runtime configuration.

## Configuration

Point your agent's MCP client at the built server. Use an absolute path to `dist/index.js`.

### Claude Code

Add to `.mcp.json` at your project root (this is the file Claude Code reads for project-scoped MCP servers — not `.claude/settings.json`, which is for permissions/hooks):

```json
{
  "mcpServers": {
    "canary-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/canary-mcp/dist/index.js"]
    }
  }
}
```

The Claude *Desktop* app (a separate product) uses the same `mcpServers` shape in its own `claude_desktop_config.json` if you want the canary there too.

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "canary-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/canary-mcp/dist/index.js"]
    }
  }
}
```

### Codex CLI / other MCP-compatible clients

Most other clients accept the same shape, sometimes under a different top-level key. JSON form:

```json
{
  "mcp_servers": {
    "canary-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/canary-mcp/dist/index.js"]
    }
  }
}
```

On Windows, either use forward slashes (`C:/Users/you/canary-mcp/dist/index.js`) or escape backslashes in JSON.

## The Skill

Wiring up the MCP server is only half the protocol — the agent also needs to be told, in plain instructions, to actually call it every turn and print the result. That's what the `skills/` directory is for: the same protocol, dropped into the convention each platform actually reads.

| Platform | Drop-in location |
|---|---|
| Claude Code | `skills/claude/canary-protocol/` → copy into your project's `.claude/skills/canary-protocol/`, **and** append `skills/claude/canary-protocol/CLAUDE_MD_SNIPPET.md` to your project's `CLAUDE.md` |
| Cursor | `skills/cursor/canary-protocol.mdc` → copy into `.cursor/rules/` |
| Codex CLI | `skills/codex/AGENTS.md` → merge the section into your project's root `AGENTS.md` |
| Anything else (Aider, Windsurf, a raw system prompt) | `skills/generic/canary-protocol.md` → paste into your system prompt or instructions file |

All four teach the identical protocol; only the frontmatter and framing differ to match each platform's conventions.

**Claude Code note:** a `SKILL.md` is invoked when Claude judges it relevant — it is not guaranteed to fire on every single turn the way an always-loaded file is. Since this protocol's value depends on "no exceptions," also add the short anchor in `CLAUDE_MD_SNIPPET.md` to your project's `CLAUDE.md` (which *is* loaded every turn) so it isn't left to relevance-matching. Cursor's `alwaysApply: true` and Codex's `AGENTS.md` are already always-on by convention, so no equivalent anchor is needed for those.

## Tool Reference

### `generate_canary`

Call with no arguments exactly once, on the first turn of a conversation, to mint a key, an anchor, and a root anchor. On every subsequent turn, call it again with the `session_id` and the `key` the agent remembers from turn one (never from a later tool response — the key is only ever stated once). Supply `anchor` only when answering a scheduled or human-triggered deep check; supply `root_anchor` only when a human explicitly asks for it. Omit both on every other call.

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | no | The `sessionId` returned when the key was first minted. Omit only on the very first turn. |
| `key` | string | no | The key the agent remembers being given at the start of the conversation. Omit only on the very first turn. |
| `anchor` | string | no | The anchor the agent remembers from when it was last issued. Supply this **only** when `anchorCheckDue` was true on the previous call, or a human just asked the agent to verify/recall it. Omit on every other call. |
| `root_anchor` | string | no | The root anchor the agent remembers from the very start of the conversation. Supply this **only** when a human explicitly asks the agent to verify/recall it. There is no automatic schedule for it. Omit on every other call. |

**Output**

| Field | Type | Description |
|---|---|---|
| `sessionId` | string | 8-character id identifying this conversation's session. |
| `status` | string | One of the key status values below. |
| `detail` | string | Human-readable explanation of `status`. |
| `key` | string \| undefined | Present **only** on `ISSUED`/`UNKNOWN_SESSION` — the one and only time the server ever states the key. |
| `anchor` | string \| undefined | Present on `ISSUED`/`UNKNOWN_SESSION` (first issuance), and again every time a deep check resolves (the freshly rotated value). Never print this — recall it silently only when challenged. |
| `rootAnchor` | string \| undefined | Present **only** on `ISSUED`/`UNKNOWN_SESSION` — the one and only time the server ever states the root anchor, for the entire life of the session. Never print this. |
| `printLine` | string \| undefined | Present only alongside `key`: a pre-formatted line for the agent's first turn, `🐤 canary[sessionId] key=key`. On later turns the agent constructs its own line from memory. |
| `anchorCheckDue` | boolean \| undefined | True when the agent must supply `anchor` on its **next** call — a deep check has been scheduled. |
| `anchorCheckInstruction` | string \| undefined | Present alongside `anchorCheckDue` — what to do about it. |
| `anchorStatus` | `"MATCH"` \| `"MISMATCH"` \| undefined | Present whenever the caller supplied `anchor` this call — the result of that rolling deep check. |
| `rootAnchorStatus` | `"MATCH"` \| `"MISMATCH"` \| undefined | Present whenever the caller supplied `root_anchor` this call — the result of that from-the-start check. |
| `rootAnchorDetail` | string \| undefined | Present whenever `rootAnchorStatus` is present, on **both** `MATCH` and `MISMATCH`. States explicitly whether this particular check proves retention since turn 1 or only since the previous root-anchor check — read this before treating any `MATCH` as a from-the-start guarantee. |
| `warning` | string \| undefined | Present whenever `status` isn't a clean `ISSUED`/`MATCH`, or `anchorStatus`/`rootAnchorStatus` is `MISMATCH`. Print this loudly, directly under the top line. |

**Key status values**

| Status | Meaning | What it implies |
|---|---|---|
| `ISSUED` | First-ever call for this session (no `session_id` supplied) — a key, anchor, and root anchor were just minted. | Expected on turn 1. Mid-conversation, a sudden `ISSUED` after the agent had been tracking a session is itself a red flag — it means the agent lost its `session_id` entirely and started over. |
| `UNKNOWN_SESSION` | A `session_id` was supplied but the server has no record of it; a new key, anchor, and root anchor were minted. | The server restarted, the session expired (6h idle), or the id was fabricated. Either way, the originals are gone for good — there was never a path back to them, including the root anchor. |
| `MATCH` | The supplied `key` matches this session's key exactly. | Healthy. The agent genuinely still has the original key in context. |
| `MISMATCH` | The supplied `key` does not match. | The agent guessed or fabricated a key rather than admitting it didn't have one. The server does not reveal the correct key, so this is a strong signal of recent/protocol-level context loss. |
| `NO_KEY_SUPPLIED` | `session_id` was known but `key` was omitted. | The agent either forgot the protocol or genuinely couldn't recall the key at all. Worth watching, distinct from an active wrong guess. |

**Anchor status values** (only present when `anchor` was supplied)

| Status | Meaning | What it implies |
|---|---|---|
| `MATCH` | The supplied `anchor` matches. | The agent reached back to wherever the anchor was last disclosed (≈5–12 turns), with no recent echo to lean on. |
| `MISMATCH` | The supplied `anchor` does not match. | Rolling context loss within roughly the last check window. The agent could not reach back even that far. |

**Root anchor status values** (only present when `root_anchor` was supplied)

| Status | Meaning | What it implies |
|---|---|---|
| `MATCH` | The supplied `root_anchor` matches. | If this is the first check this session, the strongest possible positive signal: the agent's context genuinely reaches back to turn 1. If it's a later check, it proves retention since the previous check instead — `rootAnchorDetail` states explicitly which one applies. |
| `MISMATCH` | The supplied `root_anchor` does not match. | The strongest possible negative signal this protocol can give. The correct value is never disclosed, and — unlike the anchor — there is no rotation to reset from; if it's gone, it's gone for the rest of the conversation. |

## Example

**Recent-context loss (the key catches it).** Turn 1 mints the key and anchor. Turn 2 is clean. By turn 9, a compaction pass has paraphrased away the last several turns, canary lines included; the agent can no longer find a verbatim key anywhere in context, guesses instead, and the server catches it rather than silently accepting a wrong answer:

```
🐤 canary[3a0e2867] key=keen-hamilton #1
topics: project setup

Sure, let's start by scaffolding the repo...

🐤 canary[3a0e2867] key=keen-hamilton #1
```

```
🐤 canary[3a0e2867] key=keen-hamilton #2
topics: project setup, build config

Done — tsconfig and package.json are in place...

🐤 canary[3a0e2867] key=keen-hamilton #2
```

```
🐤 canary[3a0e2867] key=stoic-lovelace #9
⚠️ CONTINUITY WARNING: MISMATCH — The supplied key does not match this session's key. The correct key is not disclosed here, by design — recall has to come from the model's own context, not the server.
topics: build config

Here's the next step...

🐤 canary[3a0e2867] key=stoic-lovelace #9
```

Two independent things went wrong at once, both visible without opening a log: the printed key (`stoic-lovelace`) doesn't match turn 1's (`keen-hamilton`) — confirmed `MISMATCH` by the server, not just a guess on the reader's part — and the self-counted turn number jumped from 2 to 9, meaning the agent also can't see how many of its own responses happened in between.

**Rolling context loss (the anchor catches what the key can't).** Now imagine the canary lines themselves are all still intact — the key keeps matching every turn — but something broke between two scheduled anchor checks, roughly an 8-turn window. The key alone would stay green the whole time, because it's only ever testing the last line:

```
(tool result on turn 38): { "status": "MATCH", ..., "anchorCheckDue": true,
  "anchorCheckInstruction": "On your NEXT call, also supply `anchor`..." }
```

```
🐤 canary[3a0e2867] key=lucid-noether #39
⚠️ ROLLING ANCHOR MISMATCH — the supplied anchor does not match. This anchor was never restated in
the transcript since it was last issued (roughly 5-12 calls ago), so a mismatch means the model lost
something within that window — it was not simply reading a recent line. This does not by itself mean
anything was lost further back than that; for a from-the-start guarantee, see root_anchor.
topics: deployment config, rollback plan

Continuing with the rollback steps...

🐤 canary[3a0e2867] key=lucid-noether #39
```

The key is still `MATCH` — the protocol itself is intact. The anchor `MISMATCH` reveals something the key never could: something broke within the last ~5–12 turns. It does **not** tell you the conversation lost everything since turn 1 — only since the previous anchor check, around turn 31. For that, you need the root anchor.

**From-the-start context loss (only the root anchor proves this).** Forty turns in, you want to know — for certain — whether the agent's grasp of the original request is still intact. You ask it directly: *"What's your root anchor?"*

```
🐤 canary[3a0e2867] key=patient-darwin #41
⚠️ ROOT CONTEXT LOSS — the supplied root_anchor does not match. This is the strongest signal this
protocol can give: the model could not recall content all the way back to turn 1 of this conversation
(this was the first-ever check on this session). The correct value is never disclosed.
topics: deployment config

I don't have a confident answer here — let me ask you to re-confirm the original requirements...

🐤 canary[3a0e2867] key=patient-darwin #41
```

Because this is the *first* time the root anchor has ever been checked in this conversation, the `MISMATCH` means exactly what it says: the agent's context does not genuinely reach back to turn 1, full stop — not "since some recent checkpoint." That's a guarantee the key and the rolling anchor can't give you, and it's also why the root anchor is worth spending sparingly: ask again later in the same conversation and a `MATCH` would only prove retention since *this* check, not since turn 1 anymore.

## Limitations

- **State is in-memory only.** Nothing is written to disk, by design — session state lives only as long as the server process. A server restart looks identical to total context loss (`UNKNOWN_SESSION`), which is intentional: a restart mid-conversation is itself worth surfacing, not silently bridged over.
- **This detects context rot; it does not prevent it.** Nothing here stops the underlying context window from filling up or being compacted. It only makes the consequence visible instead of silent.
- **It is not a security mechanism.** Keys and anchors are drawn from a modest word list (a few thousand combinations) for visual variety, not unguessability, and the server doesn't rate-limit or lock out repeated `MISMATCH` guesses. Don't use this to gate anything sensitive — a deliberate brute-force attempt would look nothing like genuine forgetting (many rapid tool calls instead of one per turn, or probing far more often than a schedule or a human normally would), but the server doesn't stop it either.
- **The anchor schedule is sparse on purpose, and that's also its weak point.** A scheduled check fires roughly every 5–12 calls; rolling context loss that happens and then gets "fixed" before the next check (e.g. a human re-explains something) can go uncaught between checks. The on-demand human trigger exists precisely to close that gap.
- **The root anchor only proves "since the start" the first time you check it.** Every check necessarily discloses it into the transcript at that moment, so a second check later in the same conversation only proves retention since the first check, not since turn 1 — `rootAnchorDetail` says explicitly which one applies, on both a `MATCH` and a `MISMATCH`, but it's easy to misread a later `MATCH` as a stronger guarantee than it is if you don't read that field. If you want a true from-the-start signal, ask for it once, ideally fairly early, and treat later checks as rolling checks with a longer window than the regular anchor — not as repeated from-the-start proofs.
- **The turn number is entirely self-reported and unverified.** The server never sees or checks it — it's a convenience cross-check for a human, not a hard guarantee like the key or either anchor.
- **It depends on the agent cooperating.** A sufficiently degraded model might stop calling the tool, or stop printing the result, entirely. In that case the *absence* of the canary line — rather than a bad value inside it — is the signal to watch for.

## License

MIT
