import type { FastifyInstance } from "fastify";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import {
  type ProposalActionRequestAction,
  type ProposalActionRequestKind,
  type createProposalActionService,
} from "../services/proposal-actions.js";

interface Deps {
  proposalActionService: ReturnType<typeof createProposalActionService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

const PROPOSAL_ACTION_BODY_KEYS = ["action", "kind", "proposalId"] as const;
const PROPOSAL_ACTION_KINDS = ["goal", "meal_numeric", "meal_estimate", "meal_delete"] as const;
const PROPOSAL_ACTIONS = ["approve", "reject"] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function parseProposalActionBody(
  body: unknown,
): { proposalId: string; kind: ProposalActionRequestKind; action: ProposalActionRequestAction } | { error: string } {
  if (!isPlainRecord(body)) {
    return { error: "Request body must be an object" };
  }
  const keys = Object.keys(body);
  const hasOnlyExpectedKeys = keys.every((key) => PROPOSAL_ACTION_BODY_KEYS.includes(key as typeof PROPOSAL_ACTION_BODY_KEYS[number]));
  if (!hasOnlyExpectedKeys || keys.length !== PROPOSAL_ACTION_BODY_KEYS.length) {
    return { error: "Request body must include only proposalId, kind, and action" };
  }
  const proposalId = body.proposalId;
  if (typeof proposalId !== "string" || !proposalId.trim()) {
    return { error: "proposalId is required" };
  }
  if (!isOneOf(body.kind, PROPOSAL_ACTION_KINDS)) {
    return { error: "kind is invalid" };
  }
  if (!isOneOf(body.action, PROPOSAL_ACTIONS)) {
    return { error: "action is invalid" };
  }
  return {
    proposalId: proposalId.trim(),
    kind: body.kind,
    action: body.action,
  };
}

export function registerProposalActionRoutes(app: FastifyInstance, deps: Deps) {
  const { proposalActionService, deviceService, guestSessionService } = deps;

  app.post("/api/proposals/actions", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    const parsed = parseProposalActionBody(request.body);
    if ("error" in parsed) {
      return reply.code(400).send({ error: parsed.error });
    }

    return proposalActionService.handleAction({
      deviceId: session.deviceId,
      proposalId: parsed.proposalId,
      kind: parsed.kind,
      action: parsed.action,
    });
  });
}
