import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root } from "mdast";

/** npm-style @scope/name mentions, not emails. */
const MENTION = /@[A-Za-z0-9][\w-]*\/[A-Za-z0-9][\w.-]*[A-Za-z0-9]/g;

export function remarkMentions() {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        MENTION,
        (value: string) => ({
          type: "emphasis",
          data: {
            hName: "span",
            hProperties: { className: ["md-chip", "is-mention"] },
          },
          children: [{ type: "text", value }],
        }),
      ],
    ]);
  };
}
