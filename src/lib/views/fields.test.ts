import type { TagFieldSchema } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import { resolveViewFields, singleQueryTag } from "./fields";
import type { ViewDef } from "./schema";

// Tag-schema-driven configurable fields resolution (view-experience wave, Part
// B) — the pure "which fields does this view show?" decision, testable without
// a network fetch.

function def(
  partial: Partial<Pick<ViewDef, "query" | "fields">>,
): Pick<ViewDef, "query" | "fields"> {
  return { query: partial.query ?? {}, fields: partial.fields };
}

const projectSchema: Record<string, TagFieldSchema> = {
  status: { type: "string", enum: ["active", "done"] },
  priority: { type: "number" },
  due: { type: "date" },
};

describe("singleQueryTag", () => {
  it("returns the tag when the query filters by exactly one", () => {
    expect(singleQueryTag({ tag: "project" })).toBe("project");
    expect(singleQueryTag({ tag: ["project"] })).toBe("project");
  });
  it("returns null for zero or many tags", () => {
    expect(singleQueryTag({})).toBeNull();
    expect(singleQueryTag(null)).toBeNull();
    expect(singleQueryTag({ tag: ["project", "urgent"] })).toBeNull();
  });
});

describe("resolveViewFields", () => {
  it("defaults to the primary tag's schema fields, in schema order", () => {
    const fields = resolveViewFields(def({ query: { tag: "project" } }), projectSchema);
    expect(fields.map((f) => f.name)).toEqual(["status", "priority", "due"]);
    expect(fields[0].schema.enum).toEqual(["active", "done"]);
    expect(fields[1].schema.type).toBe("number");
  });

  it("the `fields` override wins over the schema default, in the override's order", () => {
    const fields = resolveViewFields(
      def({ query: { tag: "project" }, fields: ["priority", "status"] }),
      projectSchema,
    );
    expect(fields.map((f) => f.name)).toEqual(["priority", "status"]);
    // Each override field is typed from the schema when the schema declares it.
    expect(fields[0].schema.type).toBe("number");
    expect(fields[1].schema.enum).toEqual(["active", "done"]);
  });

  it("an override field the schema doesn't declare degrades to a string field", () => {
    const fields = resolveViewFields(
      def({ query: { tag: "project" }, fields: ["owner"] }),
      projectSchema,
    );
    expect(fields).toEqual([{ name: "owner", schema: { type: "string" } }]);
  });

  it("the override applies even with no single tag (types default to string)", () => {
    const fields = resolveViewFields(def({ query: { tag: ["a", "b"] }, fields: ["status"] }), null);
    expect(fields).toEqual([{ name: "status", schema: { type: "string" } }]);
  });

  it("resolves to [] when there's no single tag and no override", () => {
    expect(resolveViewFields(def({ query: { tag: ["a", "b"] } }), projectSchema)).toEqual([]);
    expect(resolveViewFields(def({ query: {} }), projectSchema)).toEqual([]);
  });

  it("resolves to [] when the single tag has no schema yet", () => {
    expect(resolveViewFields(def({ query: { tag: "project" } }), null)).toEqual([]);
  });
});
