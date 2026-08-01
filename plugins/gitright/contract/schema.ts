/**
 * A minimal schema builder with no dependencies.
 *
 * A shape is written once as a tree of nodes. Every node answers the three
 * questions the seam asks of it: which JSON Schema to advertise to the host,
 * whether a received value satisfies the shape, and which nullable fields the
 * host may have omitted from the value.
 */

export type JsonSchema = Record<string, unknown>;

export type SchemaNode = {
  /** Accepts null. Null restoration is derived from this flag. */
  readonly nullable: boolean;
  /** Pins a value (const or enum), so it can select a branch of a union. */
  readonly discriminating: boolean;
  toJsonSchema(): JsonSchema;
  check(value: unknown): boolean;
  restore(value: unknown): unknown;
  /** The value does not contradict this node's pinned fields. */
  matches(value: unknown): boolean;
};

type NodeParts = {
  nullable?: boolean;
  discriminating?: boolean;
  toJsonSchema: () => JsonSchema;
  check: (value: unknown) => boolean;
  restore?: (value: unknown) => unknown;
  matches?: (value: unknown) => boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function node(parts: NodeParts): SchemaNode {
  return {
    nullable: parts.nullable ?? false,
    discriminating: parts.discriminating ?? false,
    toJsonSchema: parts.toJsonSchema,
    check: parts.check,
    restore: parts.restore ?? ((value) => value),
    matches: parts.matches ?? (() => true),
  };
}

export function str(options: { pattern?: string } = {}): SchemaNode {
  const pattern = options.pattern === undefined ? null : new RegExp(options.pattern);
  return node({
    toJsonSchema: () =>
      options.pattern === undefined
        ? { type: "string" }
        : { type: "string", pattern: options.pattern },
    check: (value) => typeof value === "string" && (pattern === null || pattern.test(value)),
  });
}

export function int(options: { minimum?: number; maximum?: number } = {}): SchemaNode {
  return node({
    toJsonSchema: () => ({ type: "integer", ...options }),
    check: (value) =>
      Number.isSafeInteger(value) &&
      (options.minimum === undefined || (value as number) >= options.minimum) &&
      (options.maximum === undefined || (value as number) <= options.maximum),
  });
}

export function num(options: { minimum?: number; maximum?: number } = {}): SchemaNode {
  return node({
    toJsonSchema: () => ({ type: "number", ...options }),
    check: (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      (options.minimum === undefined || value >= options.minimum) &&
      (options.maximum === undefined || value <= options.maximum),
  });
}

export function bool(): SchemaNode {
  return node({
    toJsonSchema: () => ({ type: "boolean" }),
    check: (value) => typeof value === "boolean",
  });
}

export function constant(pinned: string | number | boolean): SchemaNode {
  return node({
    discriminating: true,
    toJsonSchema: () => ({ const: pinned }),
    check: (value) => Object.is(value, pinned),
    matches: (value) => Object.is(value, pinned),
  });
}

export function stringEnum(values: readonly string[]): SchemaNode {
  return node({
    discriminating: true,
    toJsonSchema: () => ({ type: "string", enum: [...values] }),
    check: (value) => typeof value === "string" && values.includes(value),
    matches: (value) => typeof value === "string" && values.includes(value),
  });
}

/**
 * A bound the seam advertises but does not enforce on receipt.
 *
 * The widget falls back only for a payload it cannot render, so a value that
 * overruns an advertised bound still reaches the view. `shown` is what the
 * host is told to expect; `accepted` is what the widget tolerates.
 */
export function advertised(shown: SchemaNode, accepted: SchemaNode): SchemaNode {
  return {
    nullable: accepted.nullable,
    discriminating: accepted.discriminating,
    toJsonSchema: shown.toJsonSchema,
    check: accepted.check,
    restore: accepted.restore,
    matches: accepted.matches,
  };
}

export function nullable(inner: SchemaNode): SchemaNode {
  return node({
    nullable: true,
    toJsonSchema: () => ({ anyOf: [inner.toJsonSchema(), { type: "null" }] }),
    check: (value) => value === null || inner.check(value),
    restore: (value) => (value === null ? null : inner.restore(value)),
    matches: (value) => value === null || inner.matches(value),
  });
}

export function array(items: SchemaNode): SchemaNode {
  return node({
    toJsonSchema: () => ({ type: "array", items: items.toJsonSchema() }),
    check: (value) => Array.isArray(value) && value.every((entry) => items.check(entry)),
    matches: (value) => Array.isArray(value),
    restore: (value) => {
      if (!Array.isArray(value)) return value;
      let changed = false;
      const restored = value.map((entry) => {
        const next = items.restore(entry);
        changed ||= next !== entry;
        return next;
      });
      return changed ? restored : value;
    },
  });
}

export type ObjectOptions = {
  /** Declared but not required; every other property is required. */
  optional?: readonly string[];
  /**
   * A semantic invariant the shape carries beyond JSON Schema — a derivation
   * between fields, or a bound the advertised schema cannot express. Applied
   * by `check` only, so it never reaches the advertised JSON Schema.
   */
  refine?: (value: Record<string, unknown>) => boolean;
};

export function object(
  properties: Record<string, SchemaNode>,
  options: ObjectOptions = {},
): SchemaNode {
  const entries = Object.entries(properties);
  const optional = new Set(options.optional ?? []);
  const required = entries.map(([key]) => key).filter((key) => !optional.has(key));
  const pinned = entries.filter(([, property]) => property.discriminating);
  const refine = options.refine;

  return node({
    toJsonSchema: () => ({
      type: "object",
      properties: Object.fromEntries(
        entries.map(([key, property]) => [key, property.toJsonSchema()]),
      ),
      required,
      additionalProperties: false,
    }),
    // Undeclared fields are advertised as rejected but tolerated on receipt: a
    // host that adds a field must not cost the widget a payload it can render.
    check: (value) => {
      if (!isRecord(value)) return false;
      if (required.some((key) => !(key in value))) return false;
      if (entries.some(([key, property]) => key in value && !property.check(value[key]))) {
        return false;
      }
      return refine === undefined || refine(value);
    },
    // A branch is selected on the pinned fields the value actually carries.
    // Fields the host omitted stay open, but a value that pins nothing this
    // shape recognizes is not this shape.
    matches: (value) =>
      isRecord(value) &&
      pinned.every(([key, property]) => !(key in value) || property.matches(value[key])) &&
      (pinned.length === 0 || pinned.some(([key]) => key in value)),
    restore: (value) => {
      if (!isRecord(value)) return value;
      let changed = false;
      const restored: Record<string, unknown> = { ...value };
      for (const [key, property] of entries) {
        if (!(key in value)) {
          if (!property.nullable) continue;
          restored[key] = null;
          changed = true;
          continue;
        }
        const next = property.restore(value[key]);
        if (next === value[key]) continue;
        restored[key] = next;
        changed = true;
      }
      return changed ? restored : value;
    },
  });
}

export function union(branches: readonly SchemaNode[]): SchemaNode {
  return node({
    toJsonSchema: () => ({
      type: "object",
      oneOf: branches.map((branch) => branch.toJsonSchema()),
    }),
    check: (value) => branches.some((branch) => branch.check(value)),
    matches: (value) => branches.some((branch) => branch.matches(value)),
    restore: (value) => {
      const branch = branches.find((candidate) => candidate.matches(value));
      return branch === undefined ? value : branch.restore(value);
    },
  });
}
