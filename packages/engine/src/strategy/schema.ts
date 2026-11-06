import { z } from 'zod';
import { BET_TYPES } from '../bets.ts';

/** A dollar amount: a literal number or an expression string (e.g. "2u", "unit * level"). */
export const AmountSchema = z.union([z.number(), z.string().min(1)]);
export type Amount = z.infer<typeof AmountSchema>;

export const BetTypeSchema = z.enum(BET_TYPES as [string, ...string[]]);
export const OddsBaseSchema = z.enum(['pass', 'come', 'dontPass', 'dontCome']);
export const GroupSchema = z.enum(['all', 'inside', 'outside', 'across', 'props', 'removable', 'contracts', 'box']);
export const NumberGroupSchema = z.enum(['inside', 'outside', 'across']);
export const RoundingSchema = z.enum(['up', 'down', 'nearest', 'none']);

export const SelectorObjectSchema = z
  .object({
    type: z.union([BetTypeSchema, z.array(BetTypeSchema)]).optional(),
    number: z.number().int().optional(),
    numbers: z.union([z.array(z.number().int()), NumberGroupSchema]).optional(),
    on: OddsBaseSchema.optional(),
    group: GroupSchema.optional(),
    tag: z.string().optional(),
  })
  .strict();

/**
 * Selectors pick bets on the table. Either an object or a shorthand string:
 *   "all" | "inside" | "place" | "place:6" | "odds:come" | "odds:come:6" | "hardway:8"
 */
export const SelectorSchema = z.union([z.string().min(1), SelectorObjectSchema]);
export type SelectorInput = z.infer<typeof SelectorSchema>;

const base = { description: z.string().optional() };

export const BetActionSchema = z
  .object({
    ...base,
    action: z.literal('bet'),
    type: BetTypeSchema,
    number: z.number().int().optional(),
    /** Several numbers at once: [6, 8] or "inside" / "outside" / "across". */
    numbers: z.union([z.array(z.number().int()), NumberGroupSchema]).optional(),
    /** Skip the current point when betting several numbers. */
    skipPoint: z.boolean().optional(),
    on: OddsBaseSchema.optional(),
    hop: z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6)]).optional(),
    amount: AmountSchema.optional(),
    /** Odds only: multiple of the flat bet. */
    multiple: AmountSchema.optional(),
    /** Odds only: take or lay the table maximum. */
    max: z.boolean().optional(),
    /** ensure = place only if not already up (default); add = stack on top; set = press/regress to this exact amount. */
    mode: z.enum(['ensure', 'add', 'set']).optional(),
    working: z.boolean().optional(),
    rounding: RoundingSchema.optional(),
    /** Never let the bet exceed this amount (useful with mode "add"). */
    maxAmount: AmountSchema.optional(),
    tag: z.string().optional(),
  })
  .strict();

export const PressActionSchema = z
  .object({
    ...base,
    action: z.literal('press'),
    target: SelectorSchema,
    /** "winnings" (default) uses the payout of the bet that just won; "half" half of it; "full" doubles the bet; or an amount. */
    by: z.union([z.enum(['winnings', 'half', 'full']), AmountSchema]).optional(),
    max: AmountSchema.optional(),
    rounding: RoundingSchema.optional(),
  })
  .strict();

export const RegressActionSchema = z
  .object({
    ...base,
    action: z.literal('regress'),
    target: SelectorSchema,
    to: AmountSchema,
    rounding: RoundingSchema.optional(),
  })
  .strict();

export const TakeDownActionSchema = z
  .object({ ...base, action: z.literal('takeDown'), target: SelectorSchema })
  .strict();

export const SetWorkingActionSchema = z
  .object({ ...base, action: z.literal('setWorking'), target: SelectorSchema, working: z.boolean().nullable() })
  .strict();

export const SetActionSchema = z
  .object({ ...base, action: z.literal('set'), var: z.string().min(1), value: z.union([AmountSchema, z.boolean()]) })
  .strict();

export const IncrementActionSchema = z
  .object({ ...base, action: z.literal('increment'), var: z.string().min(1), by: AmountSchema.optional() })
  .strict();

export const SitOutActionSchema = z
  .object({
    ...base,
    action: z.literal('sitOut'),
    until: z.enum(['nextShooter', 'pointEstablished', 'pointOff', 'rolls']),
    rolls: z.number().int().min(1).optional(),
  })
  .strict();

export const WalkAwayActionSchema = z
  .object({ ...base, action: z.literal('walkAway'), mode: z.enum(['takeDown', 'rideOut']).optional() })
  .strict();

export const LogActionSchema = z.object({ ...base, action: z.literal('log'), message: z.string() }).strict();

export const ActionSchema = z.discriminatedUnion('action', [
  BetActionSchema,
  PressActionSchema,
  RegressActionSchema,
  TakeDownActionSchema,
  SetWorkingActionSchema,
  SetActionSchema,
  IncrementActionSchema,
  SitOutActionSchema,
  WalkAwayActionSchema,
  LogActionSchema,
]);
export type Action = z.infer<typeof ActionSchema>;

/**
 * Event triggers:
 *   sessionStart, newShooter, roll, comeOut (point is off now), pointOn (point is on now),
 *   pointEstablished, pointMade, sevenOut, natural, craps,
 *   betWon[:type[:number]], betLost[:type[:number]], betPushed, betMoved[:type[:number]], betReturned
 */
export const TriggerSchema = z.string().min(1);

export const RuleSchema = z
  .object({
    id: z.string().optional(),
    description: z.string().optional(),
    on: z.union([TriggerSchema, z.array(TriggerSchema)]).optional(),
    when: z.string().optional(),
    do: z.array(ActionSchema).min(1),
    /** Fire at most once per shooter, point cycle, session, or decision point. */
    once: z.enum(['shooter', 'point', 'session', 'roll']).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type Rule = z.infer<typeof RuleSchema>;

export const TableOverridesSchema = z
  .object({
    minBet: z.number().optional(),
    maxBet: z.number().optional(),
    enforceMinimums: z.boolean().optional(),
    oddsPolicy: z.union([z.enum(['1x', '2x', '3x', '3-4-5x', '5x', '10x', '20x', '100x']), z.record(z.string(), z.number())]).optional(),
    fieldPays: z.object({ two: z.number(), twelve: z.number() }).partial().optional(),
    dontBar: z.union([z.literal(2), z.literal(12)]).optional(),
    placeWorkingOnComeOut: z.boolean().optional(),
    buyWorkingOnComeOut: z.boolean().optional(),
    hardwaysWorkingOnComeOut: z.boolean().optional(),
    comeOddsWorkingOnComeOut: z.boolean().optional(),
    layWorkingOnComeOut: z.boolean().optional(),
    dontComeOddsWorkingOnComeOut: z.boolean().optional(),
    buyVig: z.enum(['on-win', 'up-front']).optional(),
    layVig: z.enum(['on-win', 'up-front']).optional(),
    vigRate: z.number().optional(),
    vigMinimum: z.number().optional(),
    payoutRounding: z.enum(['floor', 'exact']).optional(),
    allowPutBets: z.boolean().optional(),
  })
  .strict();

export const ExitSchema = z
  .object({
    stopLoss: z.number().optional(),
    winGoal: z.number().optional(),
    maxShooters: z.number().int().optional(),
    maxRolls: z.number().int().optional(),
    exitMode: z.enum(['takeDown', 'rideOut']).optional(),
  })
  .strict();

export const SourceSchema = z
  .object({
    type: z.enum(['youtube', 'url', 'manual', 'ported', 'classic']),
    url: z.string().optional(),
    videoId: z.string().optional(),
    title: z.string().optional(),
    channel: z.string().optional(),
    importedAt: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const StrategyDocSchema = z
  .object({
    version: z.literal(1),
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be a lowercase slug'),
    name: z.string().min(1),
    description: z.string().optional(),
    author: z.string().optional(),
    tags: z.array(z.string()).optional(),
    source: SourceSchema.optional(),
    /** Base betting unit; "1u" in expressions. */
    unit: z.number().positive().optional(),
    /** Suggested buy-in. */
    bankroll: z.number().positive().optional(),
    table: TableOverridesSchema.optional(),
    exit: ExitSchema.optional(),
    variables: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    /** Default rounding of bet amounts to casino increments ($6 on 6/8, etc). */
    rounding: RoundingSchema.optional(),
    rules: z.array(RuleSchema).min(1),
    /** Importer notes: ambiguities, assumptions, things the video left unsaid. */
    notes: z.string().optional(),
  })
  .strict();
export type StrategyDoc = z.infer<typeof StrategyDocSchema>;

export const STRATEGY_JSON_SCHEMA = z.toJSONSchema(StrategyDocSchema, { target: 'draft-7' });
