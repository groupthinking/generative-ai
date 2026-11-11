"use strict";
const { z } = require("zod");
function zodToJsonSchema(schema, options = {}) {
  if (options.$refStrategy !== undefined && options.$refStrategy !== "none") {
    throw new Error("The Genkit migration supports only its existing inline-schema strategy");
  }
  return z.toJSONSchema(schema, {
    target: "draft-7", io: "input", reused: "inline",
    override({ zodSchema, jsonSchema }) {
      const def = zodSchema._zod.def;
      // Zod 3 carried descriptions through optional/nullable/readonly wrappers.
      let described = zodSchema;
      while (described && jsonSchema.description === undefined) {
        if (described.description !== undefined) jsonSchema.description = described.description;
        described = described._zod.def.innerType;
      }
      if (def.type === "readonly") delete jsonSchema.readOnly;
    },
    unrepresentable({ zodSchema }) {
      const def = zodSchema._zod.def;
      // Preserve the existing CLI JSON representations, without a catch-all {} fallback.
      if (def.type === "bigint") return { type: "integer", format: "int64" };
      if (def.type === "set") {
        let array = z.array(def.valueType);
        for (const check of def.checks || []) {
          const constraint = check._zod.def;
          if (constraint.check === "min_size") array = array.min(constraint.minimum);
          if (constraint.check === "max_size") array = array.max(constraint.maximum);
          if (constraint.check === "size_equals") array = array.length(constraint.size);
        }
        const converted = zodToJsonSchema(array);
        delete converted.$schema;
        return { ...converted, uniqueItems: true };
      }
      return "throw";
    },
  });
}
module.exports = zodToJsonSchema;
module.exports.default = zodToJsonSchema;
module.exports.zodToJsonSchema = zodToJsonSchema;
Object.defineProperty(module.exports, "__esModule", { value: true });
