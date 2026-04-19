export type AssistantMarkdownInline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string };

export type AssistantMarkdownBlock =
  | { type: "paragraph"; lines: AssistantMarkdownInline[][] }
  | { type: "list"; ordered: boolean; items: AssistantMarkdownInline[][][] };

function normalizeContent(content: string) {
  return content.replace(/\r\n/g, "\n");
}

function isOrderedListLine(line: string) {
  return /^\d+\.\s+/.test(line);
}

function isUnorderedListLine(line: string) {
  return /^[-*]\s+/.test(line);
}

function stripListMarker(line: string) {
  return line.replace(/^(?:\d+\.|[-*])\s+/, "");
}

export function parseAssistantMarkdownInline(text: string): AssistantMarkdownInline[] {
  const tokens: AssistantMarkdownInline[] = [];
  const pattern = /\*\*([^*\n]+)\*\*/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const fullMatch = match[0];
    const value = match[1];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      tokens.push({ type: "text", text: text.slice(lastIndex, index) });
    }

    if (value) {
      tokens.push({ type: "bold", text: value });
    } else {
      tokens.push({ type: "text", text: fullMatch });
    }

    lastIndex = index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ type: "text", text }];
}

function parseParagraphLines(lines: string[]) {
  return lines.map((line) => parseAssistantMarkdownInline(line));
}

export function parseAssistantMarkdown(content: string): AssistantMarkdownBlock[] {
  const normalized = normalizeContent(content);
  const lines = normalized.split("\n");
  const blocks: AssistantMarkdownBlock[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isOrderedListLine(trimmed) || isUnorderedListLine(trimmed)) {
      const ordered = isOrderedListLine(trimmed);
      const items: AssistantMarkdownInline[][][] = [];

      while (index < lines.length) {
        const candidate = lines[index].trim();
        if (!candidate) {
          break;
        }
        if (ordered ? !isOrderedListLine(candidate) : !isUnorderedListLine(candidate)) {
          break;
        }
        items.push([parseAssistantMarkdownInline(stripListMarker(candidate))]);
        index += 1;
      }

      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index];
      const candidateTrimmed = candidate.trim();
      if (!candidateTrimmed) {
        break;
      }
      if (isOrderedListLine(candidateTrimmed) || isUnorderedListLine(candidateTrimmed)) {
        break;
      }
      paragraphLines.push(candidate);
      index += 1;
    }

    blocks.push({ type: "paragraph", lines: parseParagraphLines(paragraphLines) });
  }

  return blocks;
}
