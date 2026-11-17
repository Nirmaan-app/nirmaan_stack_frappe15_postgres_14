// An oxlint JS plugin for the one ADR-0049 check oxlint has no built-in rule for (ticket #1699). ESLint bans
// `.json()` calls with `no-restricted-syntax` and the selector
// `CallExpression[callee.type='MemberExpression'][callee.property.name='json']`; this rule reports the same nodes.
const JSON_MESSAGE =
  "Use parseJson() from '@/lib/parseJson' (it returns `unknown`); for a fetch response, parseJson(await response.text()) (ADR-0049).";

export default {
  meta: { name: "nirmaan" },
  rules: {
    "no-json-call": {
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type === "MemberExpression" && callee.property.name === "json") {
              context.report({ node, message: JSON_MESSAGE });
            }
          },
        };
      },
    },
  },
};
