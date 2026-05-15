import enforceEffectNamespace from "./rules/enforce-effect-namespace.mjs";

export default {
  meta: {
    name: "example",
  },
  rules: {
    "enforce-effect-namespace": enforceEffectNamespace,
  },
};
