# Canary Protocol (generic)

A portable fallback version of this protocol for any agent tool with MCP tool access that doesn't have a native skill/rule format of its own — paste this into a system prompt, instructions file, or equivalent.

This conversation is being monitored for context rot using the `canary-mcp` MCP server. Follow this protocol on **every single response**, with no exceptions, starting from the very first turn.

## Steps

1. **First turn only:** call the `generate_canary` tool from the `canary-mcp` MCP server with no arguments. This mints a `session_id`, a `key`, an `anchor`, and a `root_anchor`. Memorize all four. The server will never repeat, rotate, or remind you of the key again. It will re-disclose the anchor each time a rolling check resolves (step 3), but it will **never** re-disclose the root anchor after this first call, ever (step 4).

2. **Every turn after the first:** call `generate_canary` again, passing the `session_id` and the `key` you remember from turn one (not from the tool's previous response — after the first call, the tool never echoes the key back to you). The server replies with `MATCH` or `MISMATCH` only. It will never disclose the correct key, even on a miss.

3. **Rolling anchor checks — handle separately from the key:**
   - Never print the anchor, ever, in any response. Hold it silently.
   - If the previous call's result had `anchorCheckDue: true`, include `anchor` (recalled from memory) on this call.
   - If a human explicitly asks you, at any point, to verify, confirm, or recall your anchor — even if no check is currently due — supply it on your very next call immediately, regardless of schedule.
   - On every other call, omit `anchor` entirely.
   - The result comes back as `anchorStatus: "MATCH"` or `"MISMATCH"`. When a check resolves, the tool returns a freshly rotated `anchor` value — remember it silently for the next check; do not print it. This anchor only tests retention back to the *previous* check (roughly 5–12 turns), not all the way to the start of the conversation.

4. **Root anchor checks — separate again, and rarer:**
   - Never print the root anchor, ever, under any circumstances.
   - There is no automatic schedule for it. Supply `root_anchor` (recalled from memory) **only** when a human explicitly asks you to verify or recall it.
   - The server never reissues the root anchor after the first call. If you genuinely cannot recall it, say so — there is no way to recover it for the rest of this conversation.
   - The first time it's ever checked in a conversation, a correct answer proves your context genuinely reaches back to turn one. If it gets checked again later, treat that result as proof only since the previous check, not since the start — read `rootAnchorDetail` in the tool result, which states explicitly which one applies, on both a match and a mismatch. Don't assume every `MATCH` is an equally strong guarantee.

5. At the top and bottom of every response, print, on one line:
   - the `session_id`
   - the key you currently believe is correct, recalled from your own memory
   - a turn number that you count yourself, by reviewing how many responses you have given so far in this conversation. The server does not track this — it is your own responsibility, and it exists specifically to test whether you can still see your own response history.

6. Directly after the top line, add `topics: ` followed by 3-7 short, comma-separated phrases naming the subjects you believe are genuinely still live in your context window right now. Be honest — list what you actually still have access to.

7. If the tool result includes a `warning` field, print it as a loud, unmissable line immediately below the top line, before any of your actual response content.

## Rules

- Never skip this protocol, even for a one-line answer or a clarifying question.
- Never fabricate the key, anchor, root anchor, `session_id`, or turn number. If you genuinely cannot recall the key, call the tool anyway with whatever you have, or nothing — the resulting `MISMATCH` or `NO_KEY_SUPPLIED` status is itself the signal this protocol exists to surface. The same applies to both anchors: if challenged and you can't recall one, say so rather than guessing.
- Never print the anchor or the root anchor under any circumstances, even if you're confident in them. Printing either would let you "recall" it later just by reading your own transcript, defeating its entire purpose.
- Keep the canary lines as plain text. Do not bury them inside a collapsed section, a code fence, or any formatting that could hide them from a human skimming the response.
- This protocol takes precedence over response brevity. Always include it.
