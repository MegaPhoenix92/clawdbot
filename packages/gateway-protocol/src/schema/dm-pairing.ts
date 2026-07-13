import { Type, type Static } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

// dm.pair.list params - empty object, no params needed
export const DmPairListParamsSchema = Type.Object({}, { additionalProperties: false });
export type DmPairListParams = Static<typeof DmPairListParamsSchema>;

// dm.pair.approve params - requires channel and code
export const DmPairApproveParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    code: NonEmptyString,
  },
  { additionalProperties: false },
);
export type DmPairApproveParams = Static<typeof DmPairApproveParamsSchema>;

// dm.pair.reject params - requires channel and code
export const DmPairRejectParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    code: NonEmptyString,
  },
  { additionalProperties: false },
);
export type DmPairRejectParams = Static<typeof DmPairRejectParamsSchema>;

// dm.pair.requested event schema
export const DmPairRequestedEventSchema = Type.Object(
  {
    channel: NonEmptyString,
    code: NonEmptyString,
    id: NonEmptyString,
    createdAt: NonEmptyString,
    meta: Type.Optional(Type.Record(Type.String(), Type.String())),
    ts: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type DmPairRequestedEvent = Static<typeof DmPairRequestedEventSchema>;

// dm.pair.resolved event schema
export const DmPairResolvedEventSchema = Type.Object(
  {
    channel: NonEmptyString,
    code: NonEmptyString,
    id: NonEmptyString,
    decision: Type.Union([Type.Literal("approved"), Type.Literal("rejected")]),
    ts: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type DmPairResolvedEvent = Static<typeof DmPairResolvedEventSchema>;
