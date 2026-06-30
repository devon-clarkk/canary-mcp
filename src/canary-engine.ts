import { randomBytes } from "node:crypto";
import { randomTag } from "./wordlist.js";

export type CanaryStatus =
  | "ISSUED"
  | "UNKNOWN_SESSION"
  | "MATCH"
  | "MISMATCH"
  | "NO_KEY_SUPPLIED";

export type AnchorStatus = "MATCH" | "MISMATCH";

export interface CheckParams {
  sessionId?: string;
  key?: string;
  /** Only supplied when answering a scheduled or human-triggered deep check. */
  anchor?: string;
  /** Only supplied when a human has explicitly asked the agent to recall it. */
  rootAnchor?: string;
}

export interface CheckResult {
  sessionId: string;
  status: CanaryStatus;
  detail: string;
  /** Only present on ISSUED/UNKNOWN_SESSION — the one and only time the server states the key. */
  key?: string;
  /** Present on ISSUED/UNKNOWN_SESSION (first issuance) and again each time an anchor check resolves
   *  (rotation). Never print this value — only recall it silently when later asked to supply it. */
  anchor?: string;
  /** Present ONLY on ISSUED/UNKNOWN_SESSION — the one and only time the server ever states this value,
   *  for the lifetime of the session. Never print it, never restate it unprompted; recall it silently
   *  only if a human explicitly asks for it later. */
  rootAnchor?: string;
  /** Only present alongside key — convenience line for the model's very first turn. */
  printLine?: string;
  /** True when the caller should supply `anchor` on its NEXT call (scheduled deep check). */
  anchorCheckDue?: boolean;
  anchorCheckInstruction?: string;
  /** Present whenever the caller supplied `anchor` this call. */
  anchorStatus?: AnchorStatus;
  /** Present whenever the caller supplied `root_anchor` this call. Never auto-scheduled — only ever
   *  present in response to a human-initiated request, and the server never reissues this value. */
  rootAnchorStatus?: AnchorStatus;
  /** Present whenever rootAnchorStatus is present. Explains whether this check (MATCH or MISMATCH)
   *  proves retention since turn 1, or only since the previous root_anchor check — read this before
   *  treating a MATCH as a from-the-start guarantee. */
  rootAnchorDetail?: string;
  /** Present whenever status isn't a clean ISSUED/MATCH, or an anchor/root-anchor check failed. */
  warning?: string;
}

interface ChainState {
  sessionId: string;
  key: string;
  anchor: string;
  anchorPending: boolean;
  callsUntilAnchorCheck: number;
  rootAnchor: string;
  rootAnchorChecks: number;
  createdAt: number;
  lastSeenAt: number;
}

const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const ANCHOR_CHECK_MIN_CALLS = 5;
const ANCHOR_CHECK_MAX_CALLS = 12;

function randomAnchorWindow(): number {
  const span = ANCHOR_CHECK_MAX_CALLS - ANCHOR_CHECK_MIN_CALLS + 1;
  return ANCHOR_CHECK_MIN_CALLS + Math.floor(Math.random() * span);
}

const ANCHOR_CHECK_INSTRUCTION =
  "On your NEXT call to this tool, also supply the `anchor` field with the value you were given when it was " +
  "last issued — recalled from memory only, since it has not been restated anywhere since. Do not print it " +
  "in your response, and do not guess if you can't recall it; omitting it is more honest than fabricating one.";

/**
 * In-memory registry of canary sessions.
 *
 * Each session carries two independent secrets:
 *  - `key`: issued once, fixed for the life of the session, reprinted in every response. Because it's
 *    reprinted, recalling it only ever requires reaching back as far as the model's own previous turn —
 *    it tests whether the protocol/canary lines themselves are still intact in recent context (catches
 *    compaction that strips recent turns, or the agent abandoning the protocol).
 *  - `anchor`: issued once, NEVER reprinted by the model, and checked only sparsely (a random 5-12 calls
 *    after the last check, or whenever a human asks for it on demand). Because it has no recent echo to
 *    crib from, producing it correctly is a genuine test of reaching back to wherever it was last
 *    disclosed — a needle-in-the-haystack probe, not a recency check. It rotates to a fresh value every
 *    time a check resolves (match or mismatch), so each round tests fresh ground.
 *
 * Nothing here is persisted to disk: a process restart losing all sessions is treated as a feature (the
 * restart itself becomes a visible UNKNOWN_SESSION event) rather than a bug to work around with a database.
 */
export class CanaryRegistry {
  private readonly chains = new Map<string, ChainState>();

  check(params: CheckParams): CheckResult {
    this.sweepExpired();

    const { sessionId, key, anchor, rootAnchor } = params;

    if (!sessionId) {
      return this.mint(
        "ISSUED",
        "First call for this conversation — key, anchor, and root_anchor minted. The key is reprinted every turn. " +
          "The anchor must never be repeated until explicitly asked for. The root_anchor must never be repeated " +
          "either, and is only ever asked for when a human directly requests it — there is no automatic schedule " +
          "for it, unlike the anchor.",
      );
    }

    const chain = this.chains.get(sessionId);
    if (!chain) {
      return this.mint(
        "UNKNOWN_SESSION",
        `Supplied session_id "${sessionId}" was not recognized (server restart, expiry after 6h idle, or a fabricated id). A new key, anchor, and root_anchor have been minted.`,
      );
    }

    chain.lastSeenAt = Date.now();

    let result: CheckResult;
    if (!key) {
      result = this.buildResult(chain, "NO_KEY_SUPPLIED", "No key was supplied even though this session is known. The caller should have recalled the key it was given at the start of this conversation.");
    } else if (key === chain.key) {
      result = this.buildResult(chain, "MATCH", "Confirmed — the supplied key matches this session's key.");
    } else {
      result = this.buildResult(
        chain,
        "MISMATCH",
        "The supplied key does not match this session's key. The correct key is not disclosed here, by design — recall has to come from the model's own context, not the server.",
      );
    }

    this.applyAnchorCheck(chain, anchor, result);
    this.applyRootAnchorCheck(chain, rootAnchor, result);

    return result;
  }

  private applyAnchorCheck(chain: ChainState, anchor: string | undefined, result: CheckResult): void {
    if (anchor) {
      const anchorMatch = anchor === chain.anchor;
      result.anchorStatus = anchorMatch ? "MATCH" : "MISMATCH";
      if (!anchorMatch) {
        const rollingWarning =
          "⚠️ ROLLING ANCHOR MISMATCH — the supplied anchor does not match. This anchor was never restated in " +
          "the transcript since it was last issued (roughly 5-12 calls ago), so a mismatch means the model lost " +
          "something within that window — it was not simply reading a recent line. This does not by itself mean " +
          "anything was lost further back than that; for a from-the-start guarantee, see root_anchor.";
        result.warning = result.warning ? `${result.warning}\n${rollingWarning}` : rollingWarning;
      }
      // Resolved (match or mismatch) — rotate to a fresh anchor and reschedule the next check.
      chain.anchor = randomTag();
      chain.anchorPending = false;
      chain.callsUntilAnchorCheck = randomAnchorWindow();
      result.anchor = chain.anchor;
      return;
    }

    if (chain.anchorPending) {
      // Already flagged due on a previous call and still hasn't been answered — keep asking.
      result.anchorCheckDue = true;
      result.anchorCheckInstruction = ANCHOR_CHECK_INSTRUCTION;
      return;
    }

    chain.callsUntilAnchorCheck -= 1;
    if (chain.callsUntilAnchorCheck <= 0) {
      chain.anchorPending = true;
      result.anchorCheckDue = true;
      result.anchorCheckInstruction = ANCHOR_CHECK_INSTRUCTION;
    }
  }

  /**
   * root_anchor is never scheduled by the server — it's validated only when the caller supplies it,
   * which should only happen because a human asked for it directly. Unlike `anchor`, it is never
   * rotated or reissued after the initial mint: the server has nothing further to say about it once
   * minted. The first-ever check on a session's root_anchor is a genuine turn-1-to-now test; if a
   * human checks it more than once in the same conversation, later checks only prove retention since
   * the previous check, because answering it necessarily re-discloses it into recent context — the
   * detail message says so explicitly so that guarantee is never overstated.
   */
  private applyRootAnchorCheck(chain: ChainState, rootAnchor: string | undefined, result: CheckResult): void {
    if (!rootAnchor) {
      return;
    }

    chain.rootAnchorChecks += 1;
    const isFirstCheck = chain.rootAnchorChecks === 1;
    const match = rootAnchor === chain.rootAnchor;
    result.rootAnchorStatus = match ? "MATCH" : "MISMATCH";

    if (match) {
      result.rootAnchorDetail = isFirstCheck
        ? "Confirmed — this is the first-ever root_anchor check on this session, so this proves the model's context genuinely reaches back to turn 1."
        : `Confirmed — but this is check #${chain.rootAnchorChecks} on this session, so it only proves retention since the previous check, not since turn 1 (answering a check necessarily re-discloses the value into recent context).`;
    } else {
      const scope = isFirstCheck
        ? "all the way back to turn 1 of this conversation (this was the first-ever check on this session)"
        : `back to its most recent disclosure (check #${chain.rootAnchorChecks} on this session) — not necessarily all the way to turn 1`;
      result.rootAnchorDetail = `Not confirmed — the supplied root_anchor does not match. The correct value is never disclosed.`;
      const rootWarning =
        `⚠️ ROOT CONTEXT LOSS — the supplied root_anchor does not match. This is the strongest signal this ` +
        `protocol can give: the model could not recall content ${scope}.`;
      result.warning = result.warning ? `${result.warning}\n${rootWarning}` : rootWarning;
    }
  }

  private mint(status: "ISSUED" | "UNKNOWN_SESSION", detail: string): CheckResult {
    const sessionId = randomBytes(4).toString("hex");
    const key = randomTag();
    const anchor = randomTag();
    const rootAnchor = randomTag();
    const now = Date.now();
    this.chains.set(sessionId, {
      sessionId,
      key,
      anchor,
      anchorPending: false,
      callsUntilAnchorCheck: randomAnchorWindow(),
      rootAnchor,
      rootAnchorChecks: 0,
      createdAt: now,
      lastSeenAt: now,
    });

    const result: CheckResult = {
      sessionId,
      status,
      detail,
      key,
      anchor,
      rootAnchor,
      printLine: `🐤 canary[${sessionId}] key=${key}`,
    };
    if (status === "UNKNOWN_SESSION") {
      result.warning = `⚠️ CONTINUITY WARNING: ${status} — ${detail}`;
    }
    return result;
  }

  private buildResult(chain: ChainState, status: CanaryStatus, detail: string): CheckResult {
    const result: CheckResult = { sessionId: chain.sessionId, status, detail };
    if (status !== "MATCH") {
      result.warning = `⚠️ CONTINUITY WARNING: ${status} — ${detail}`;
    }
    return result;
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [sessionId, chain] of this.chains) {
      if (now - chain.lastSeenAt > TTL_MS) {
        this.chains.delete(sessionId);
      }
    }
  }
}
