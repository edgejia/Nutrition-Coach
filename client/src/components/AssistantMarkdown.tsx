import { Fragment } from "react";
import { parseAssistantMarkdown, type AssistantMarkdownInline } from "../lib/assistant-markdown.js";

function renderInline(tokens: AssistantMarkdownInline[]) {
  return tokens.map((token, index) => {
    if (token.type === "bold") {
      return <strong key={`bold-${index}`}>{token.text}</strong>;
    }
    return <Fragment key={`text-${index}`}>{token.text}</Fragment>;
  });
}

export function AssistantMarkdown(props: { content: string }) {
  const blocks = parseAssistantMarkdown(props.content);

  return (
    <div className="assistant-markdown">
      {blocks.map((block, blockIndex) => {
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={`block-${blockIndex}`}>
              {block.items.map((itemLines, itemIndex) => (
                <li key={`item-${itemIndex}`}>
                  {itemLines.map((lineTokens, lineIndex) => (
                    <Fragment key={`line-${lineIndex}`}>
                      {lineIndex > 0 ? <br /> : null}
                      {renderInline(lineTokens)}
                    </Fragment>
                  ))}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <p key={`block-${blockIndex}`}>
            {block.lines.map((lineTokens, lineIndex) => (
              <Fragment key={`line-${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(lineTokens)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
