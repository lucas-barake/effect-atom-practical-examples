const importSources = /^(?:effect(?:\/|$)|@effect\/)/;

const toPascalCase = (value) =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

const namespaceFromSource = (source) => {
  if (source === "effect") {
    return "Effect";
  }

  if (source.startsWith("effect/")) {
    return toPascalCase(source.slice("effect/".length)) || "Effect";
  }

  if (source.startsWith("@effect/")) {
    return toPascalCase(source.slice("@effect/".length)) || "Effect";
  }

  return "Effect";
};

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce namespace imports for Effect modules instead of named imports",
    },
    fixable: "code",
  },
  create(context) {
    const namedImports = new Map();

    function checkIdentifier(node) {
      const localName = node.name;
      if (!namedImports.has(localName)) return;

      const { importedName, namespaceName } = namedImports.get(localName);
      const parent = node.parent;
      if (!parent) return;

      if (parent.type === "ImportSpecifier") return;

      if (
        parent.type === "Property" &&
        parent.key === node &&
        !parent.shorthand
      ) {
        return;
      }

      if (parent.type === "MemberExpression") {
        if (parent.property === node && parent.object !== node) {
          return;
        }
      }

      context.report({
        node,
        message: `Use '${namespaceName}.${importedName}' instead of '${localName}'`,
        fix: (fixer) =>
          fixer.replaceTextRange(node.range, `${namespaceName}.${importedName}`),
      });
    }

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== "string" || !importSources.test(node.source.value)) {
          return;
        }

        const namedSpecifiers = [];
        let namespaceSpecifier;

        for (const spec of node.specifiers) {
          if (spec.type === "ImportSpecifier") {
            namedSpecifiers.push(spec);
          } else if (spec.type === "ImportNamespaceSpecifier") {
            namespaceSpecifier = spec;
          }
        }

        if (namedSpecifiers.length === 0) {
          return;
        }

        const namespaceName = namespaceSpecifier?.local.name ?? namespaceFromSource(node.source.value);

        for (const spec of namedSpecifiers) {
          if (spec.imported.type === "Identifier") {
            namedImports.set(spec.local.name, {
              importedName: spec.imported.name,
              namespaceName,
            });
          }
        }

        context.report({
          node,
          message: `Use namespace import (import * as ${namespaceName} from "${node.source.value}") instead of named imports from "${node.source.value}"`,
          fix(fixer) {
            return fixer.replaceTextRange(
              node.range,
              `import * as ${namespaceName} from "${node.source.value}";`,
            );
          },
        });
      },

      Identifier(node) {
        checkIdentifier(node);
      },
    };
  },
};

export default rule;
