import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CanaryRegistry } from "./canary-engine.js";

const registry = new CanaryRegistry();

const server = new McpServer({
  name: "canary-mcp",
  version: "0.1.0",
});

server.registerTool(
  "generate_canary",
  {
    title: "Generate Canary",
    description:
      "Call with no arguments exactly once, on the very first turn of this conversation, to mint a session_id, a key, an " +
      "anchor, and a root_anchor. The key is conversation-wide and permanent: issued ONCE, never reissued or disclosed " +
      "again — memorize it, print it at the top and bottom of every response from then on, and pass it back on every call. " +
      "A MISMATCH never reveals the correct key. The anchor and root_anchor are SEPARATE secrets: never print either one, " +
      "never restate either unprompted. Most calls should omit both. Supply `anchor` only when (a) this tool's previous " +
      "result had anchorCheckDue=true, in which case include it on your very next call, or (b) a human explicitly asks you " +
      "to verify/recall your anchor, in which case supply it immediately even if no check was flagged due — answering an " +
      "anchor check rotates it to a fresh value, returned silently for you to remember. Supply `root_anchor` ONLY when a " +
      "human explicitly asks you to verify/recall it specifically — there is no automatic schedule for it, ever, and the " +
      "server never reissues it after the first mint, so if you lose it there is no way to recover it for the rest of this " +
      "conversation. Recall the anchor and root_anchor only from your own memory of when each was last issued — never from " +
      "anything you printed, since you should never have printed either. When rootAnchorStatus is present, also read " +
      "rootAnchorDetail: it tells you whether THIS check proves retention back to turn 1, or only back to the previous " +
      "root_anchor check — checking it more than once per conversation weakens what a MATCH actually proves, so don't " +
      "treat every MATCH as an equally strong guarantee. Also print a turn number you count yourself at the top and bottom " +
      "of every response (the server does not track turns — that is your own responsibility, a separate check on whether " +
      "you can still see your own response history). If the result includes a warning field, print it loudly beneath the " +
      "top line, before your answer.",
    inputSchema: {
      session_id: z
        .string()
        .optional()
        .describe("The session_id returned when the key was first minted, if you still have it. Omit only on the very first turn."),
      key: z
        .string()
        .optional()
        .describe("The key you remember being given at the start of this conversation. Omit only on the very first turn."),
      anchor: z
        .string()
        .optional()
        .describe("Only supply this when answering a deep check: either anchorCheckDue was true on your previous call, or a human just asked you to verify/recall it. Omit on all other calls."),
      root_anchor: z
        .string()
        .optional()
        .describe("Only supply this when a human explicitly asks you to verify or recall it. Never auto-scheduled. Omit on all other calls."),
    },
  },
  async ({ session_id, key, anchor, root_anchor }) => {
    const result = registry.check({ sessionId: session_id, key, anchor, rootAnchor: root_anchor });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error in canary-mcp:", error);
  process.exit(1);
});
