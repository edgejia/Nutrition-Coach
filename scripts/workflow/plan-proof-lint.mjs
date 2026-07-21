#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const RULES = {
  PPL001: "OR search cannot prove an all-of requirement without an alternatives rationale",
  PPL002: "single-line or tail evidence cannot stand in for complete proof without a rationale",
  PPL003: "verification must use the closed read-only command model and must not mutate evidence",
  PPL004: "oversized inline evaluation must be extracted into a reviewed script",
  PPL005: "a pre-authored pass marker cannot prove the behavior that authored it",
  PPL006: "high-risk proof must execute a structured negative control or counterexample",
  PPL007: "cardinality proof uses an upper bound instead of exact completeness",
  PPL008: "plan contains no valid task-scoped verification or automated proof command",
};
const RISK_PATTERN = /\b(?:production|migration|migrate|restore|backup|database|storage|runtime|destructive|security|auth(?:entication|orization)?|permission|credential|cookie|session|upload|data (?:loss|integrity)|ruleset|branch protection|release gate|tunnel)\b/i;
const INERT_COMMANDS = new Set(["echo", "false", "printf", "true"]);
const READ_ONLY_NODE_CHECKERS = new Set([
  "scripts/workflow/plan-proof-lint.mjs",
  "scripts/workflow/state-check.mjs",
]);
const NEGATIVE_CONTROL_TEST_FILES = new Set([
  "tests/integration/production-recovery-rehearsal.test.ts",
  "tests/unit/plan-proof-lint.test.ts",
  "tests/integration/phase-126-proposal-negative-controls.test.ts",
  "tests/integration/phase-126-admission-negative-controls.test.ts",
  "tests/integration/phase-126-ai-boundary-negative-controls.test.ts",
  "tests/integration/phase-126-privacy-negative-controls.test.ts",
  "tests/integration/phase-127-meal-snapshot-negative-controls.test.ts",
  "tests/integration/phase-127-chat-lifecycle-negative-controls.test.ts",
  "tests/integration/phase-127-goal-patch-negative-controls.test.ts",
  "tests/integration/phase-127-history-bound-negative-controls.test.ts",
  "tests/integration/phase-127-startup-schema-negative-controls.test.ts",
  "tests/integration/phase-128-artifact-negative-controls.test.ts",
  "tests/integration/phase-128-sse-negative-controls.test.ts",
  "tests/integration/phase-128-policy-side-effect-negative-controls.test.ts",
  "tests/integration/phase-128-harness-lifecycle-negative-controls.test.ts",
  "tests/integration/phase-128-git-authority-negative-controls.test.ts",
  "tests/integration/phase-128-policy-taxonomy-negative-controls.test.ts",
  "tests/integration/phase-128-advisory-negative-controls.test.ts",
  "tests/integration/phase-128-readiness-audit-negative-controls.test.ts",
]);
const PHASE_126_NEGATIVE_CONTROL_BY_TASK = [
  {
    path: "tests/integration/phase-126-ai-boundary-negative-controls.test.ts",
    pattern: /\b(?:field-scoped|source evidence|affirmative intent|cross-field|incompatible units)\b/i,
  },
  {
    path: "tests/integration/phase-126-proposal-negative-controls.test.ts",
    pattern: /\b(?:proposal|transaction)\b/i,
  },
  {
    path: "tests/integration/phase-126-admission-negative-controls.test.ts",
    pattern: /\badmission\b/i,
  },
  {
    path: "tests/integration/phase-126-ai-boundary-negative-controls.test.ts",
    pattern: /\b(?:ai|safety|planning|late-frame)\b/i,
  },
  {
    path: "tests/integration/phase-126-privacy-negative-controls.test.ts",
    pattern: /\bprivacy\b/i,
  },
];
const PHASE_127_NEGATIVE_CONTROL_BY_TASK = [
  {
    path: "tests/integration/phase-127-meal-snapshot-negative-controls.test.ts",
    pattern: /\bmeal correction\b|\bmeal snapshot\b/i,
  },
  {
    path: "tests/integration/phase-127-chat-lifecycle-negative-controls.test.ts",
    pattern: /\bchat lifecycle\b|\bdisconnect\b|\bprovider-backed chat\b/i,
  },
  {
    path: "tests/integration/phase-127-goal-patch-negative-controls.test.ts",
    pattern: /\bgoal (?:patch|updates?)\b|\bsparse goal\b/i,
  },
  {
    path: "tests/integration/phase-127-history-bound-negative-controls.test.ts",
    pattern: /\btrend\b|\bhistory (?:route|bound|range)\b/i,
  },
  {
    path: "tests/integration/phase-127-startup-schema-negative-controls.test.ts",
    pattern: /\bstartup schema\b|\bschema (?:and|\/)\s*migration\b|\bmigration provenance\b/i,
  },
];
const PHASE_128_NEGATIVE_CONTROL_BY_TASK = [
  {
    path: "tests/integration/phase-128-readiness-audit-negative-controls.test.ts",
    pattern: /\b(?:readiness|finding map|PASS|NO-GO|disposition)\b/i,
  },
  {
    path: "tests/integration/phase-128-policy-taxonomy-negative-controls.test.ts",
    pattern: /\b(?:taxonomy|registry row|generated row|drift)\b/i,
  },
  {
    path: "tests/integration/phase-128-advisory-negative-controls.test.ts",
    pattern: /\b(?:advisory|scanner|410|incomplete|malformed)\b/i,
  },
  {
    path: "tests/integration/phase-128-harness-lifecycle-negative-controls.test.ts",
    pattern: /\b(?:harness lifecycle|lifecycle|boot|close|publication|cas|writer|artifact directories)\b/i,
  },
  {
    path: "tests/integration/phase-128-artifact-negative-controls.test.ts",
    pattern: /\b(?:artifact|sentinel|denylist)\b/i,
  },
  {
    path: "tests/integration/phase-128-sse-negative-controls.test.ts",
    pattern: /\b(?:sse|terminal|stream|close)\b/i,
  },
  {
    path: "tests/integration/phase-128-policy-side-effect-negative-controls.test.ts",
    pattern: /\b(?:policy|proposal|idempotent|side effect|mutation)\b/i,
  },
  {
    path: "tests/integration/phase-128-git-authority-negative-controls.test.ts",
    pattern: /\b(?:git|source bytes|authority|replace-ref)\b/i,
  },
];
const READ_ONLY_SIMPLE_COMMANDS = new Set([
  "[",
  "[[",
  "basename",
  "cat",
  "cmp",
  "cut",
  "diff",
  "dirname",
  "echo",
  "false",
  "grep",
  "head",
  "jq",
  "ls",
  "printf",
  "pwd",
  "readlink",
  "realpath",
  "rg",
  "sha256sum",
  "shasum",
  "sort",
  "stat",
  "tail",
  "test",
  "tr",
  "true",
  "uniq",
  "wc",
]);
const READ_ONLY_GIT_COMMANDS = new Set([
  "branch",
  "cat-file",
  "diff",
  "log",
  "ls-files",
  "ls-tree",
  "merge-base",
  "remote",
  "rev-parse",
  "show",
  "status",
  "symbolic-ref",
]);
const READ_ONLY_YARN_COMMANDS = new Set([
  "behavior-matrix:gen:check",
  "deps:audit",
  "matrix:check",
  "matrix:gen:check",
  "native:check",
  "policy-taxonomy:check",
  "policy-taxonomy:gen:check",
  "pr:policy",
  "test",
  "test:integration",
  "test:unit",
  "tsc",
  "workflow:plan-proof",
  "workflow:state-check",
]);
const SHELL_OPERATORS = ["<<<", ">>", "<<", "&&", "||", ">&", "<&", ";", "|", "&", ">", "<", "(", ")"];
const SEARCH_EXECUTABLE_OPTIONS = /^(?:--(?:hostname-bin|pre|pre-glob))(?:=|$)/;
const SEARCH_LONG_FLAGS = {
  rg: new Set([
    "binary", "case-sensitive", "column", "count", "count-matches", "crlf", "files",
    "files-with-matches", "files-without-match", "fixed-strings", "heading", "hidden",
    "ignore-case", "invert-match", "json", "line-number", "line-regexp", "mmap", "multiline",
    "multiline-dotall", "no-config", "no-filename", "no-heading", "no-ignore", "no-line-number",
    "no-mmap", "no-pcre2-unicode", "no-require-git", "no-unicode", "null", "only-matching",
    "pcre2", "quiet", "smart-case", "stats", "text", "type-list", "unicode", "vimgrep",
    "with-filename", "word-regexp",
  ]),
  grep: new Set([
    "basic-regexp", "binary-files-without-match", "byte-offset", "count", "extended-regexp",
    "files-with-matches", "files-without-match", "fixed-strings", "ignore-case", "invert-match",
    "line-buffered", "line-number", "line-regexp", "no-filename", "null", "null-data",
    "only-matching", "perl-regexp", "quiet", "recursive", "silent", "text", "with-filename",
    "word-regexp",
  ]),
};
const SEARCH_LONG_VALUE_OPTIONS = {
  rg: new Set([
    "after-context", "before-context", "color", "colors", "context", "context-separator", "encoding",
    "engine", "field-context-separator", "field-match-separator", "glob", "iglob", "max-columns",
    "max-count", "max-depth", "path-separator", "regexp", "replace", "sort", "sortr", "threads",
    "type", "type-not",
  ]),
  grep: new Set([
    "after-context", "before-context", "binary-files", "context", "directories", "exclude",
    "exclude-dir", "include", "label", "max-count", "regexp",
  ]),
};
const SEARCH_SHORT_VALUE_OPTIONS = {
  rg: new Set(["A", "B", "C", "e", "f", "g", "m", "r", "t", "T"]),
  grep: new Set(["A", "B", "C", "d", "e", "f", "m"]),
};
const SEARCH_SHORT_FLAGS = {
  rg: new Set(["0", "a", "b", "c", "F", "H", "i", "I", "l", "L", "n", "N", "o", "P", "q", "s", "S", "u", "U", "v", "w", "x", "z"]),
  grep: new Set(["a", "b", "c", "E", "F", "G", "h", "H", "i", "l", "L", "n", "o", "P", "q", "r", "R", "s", "v", "w", "x", "Z", "z"]),
};

function decodeXmlEntities(line) {
  return line
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function visibleMarkdownLines(content) {
  const rawLines = content.split(/\r?\n/);
  const visible = [];
  let fence = null;
  let inHtmlComment = false;

  for (const rawLine of rawLines) {
    if (!inHtmlComment) {
      if (fence === null) {
        const openingFence = rawLine.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
        if (openingFence && (openingFence[1][0] !== "`" || !openingFence[2].includes("`"))) {
          fence = { character: openingFence[1][0], length: openingFence[1].length };
          visible.push("");
          continue;
        }
      } else {
        const closingFence = rawLine.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        if (
          closingFence &&
          closingFence[1][0] === fence.character &&
          closingFence[1].length >= fence.length
        ) {
          fence = null;
        }
        visible.push("");
        continue;
      }
    }

    let line = "";
    for (let index = 0; index < rawLine.length; index += 1) {
      if (inHtmlComment) {
        const close = rawLine.indexOf("-->", index);
        if (close === -1) {
          index = rawLine.length;
          break;
        }
        inHtmlComment = false;
        index = close + 2;
        continue;
      }
      if (rawLine.startsWith("<!--", index)) {
        inHtmlComment = true;
        index += 3;
        continue;
      }
      line += rawLine[index];
    }

    line = decodeXmlEntities(line);
    // Inline-code proof tags are prose/examples. Preserve other backticks so a
    // shell command substitution cannot disappear before safety analysis.
    line = line.replace(/(`+)((?:(?!\1)[\s\S])*?)\1/g, (value, _ticks, body) =>
      /<\/?(?:task|verify|automated)(?:\s|>)/i.test(body) ? "" : value,
    );
    visible.push(line);
  }
  return visible;
}

function annotationAllows(lines, lineIndex, name) {
  for (let index = Math.max(0, lineIndex - 3); index <= lineIndex; index += 1) {
    const match = lines[index].match(new RegExp(`proof-lint:\\s*${name}\\s+rationale=(.+)$`, "i"));
    if (match && match[1].trim().length >= 12) return true;
  }
  return false;
}

function parseProofTagStructure(lines) {
  const ranges = { task: [], verify: [], automated: [] };
  const stack = [];
  const pattern = /<(\/)?(task|verify|automated)(?:\s[^>]*)?>/gi;
  let absoluteOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    pattern.lastIndex = 0;
    for (const match of lines[index].matchAll(pattern)) {
      const tag = match[2].toLowerCase();
      const position = absoluteOffset + match.index;
      if (match[1] === undefined) {
        stack.push({ tag, start: index, startPosition: position });
        continue;
      }
      const opened = stack.pop();
      if (!opened || opened.tag !== tag) return { valid: false, ranges };
      ranges[tag].push({ ...opened, end: index, endPosition: position + match[0].length });
    }
    absoluteOffset += lines[index].length + 1;
  }
  if (stack.length > 0) return { valid: false, ranges };
  for (const values of Object.values(ranges)) {
    values.sort((left, right) => left.startPosition - right.startPosition || right.endPosition - left.endPosition);
  }
  return { valid: true, ranges };
}

function taskScopedVerificationRanges(structure) {
  if (!structure.valid) return [];
  const tasks = structure.ranges.task;
  const candidates = [
    ...structure.ranges.verify,
    ...structure.ranges.automated,
  ].filter((range) =>
    tasks.some((task) => task.startPosition <= range.startPosition && task.endPosition >= range.endPosition),
  );
  candidates.sort((left, right) => left.startPosition - right.startPosition || right.endPosition - left.endPosition);
  return candidates.filter(
    (range, index) =>
      !candidates.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.startPosition <= range.startPosition &&
          other.endPosition >= range.endPosition &&
          (other.startPosition < range.startPosition || other.endPosition > range.endPosition),
      ),
  );
}

function taskForRange(tasks, range) {
  return tasks
    .filter((task) => task.startPosition <= range.startPosition && task.endPosition >= range.endPosition)
    .sort(
      (left, right) =>
        (left.endPosition - left.startPosition) - (right.endPosition - right.startPosition),
    )[0] ?? null;
}

function addFinding(findings, seen, ruleId, line) {
  const key = `${ruleId}:${line}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ ruleId, line: line + 1, message: RULES[ruleId] });
}

function stripUnquotedComment(line) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && !single) {
      escaped = true;
      continue;
    }
    if (character === "'" && !double) single = !single;
    else if (character === '"' && !single) double = !double;
    else if (character === "#" && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function commandText(line) {
  return stripUnquotedComment(
    line.replace(/<\/?(?:verify|automated|task)(?:\s[^>]*)?>/gi, " "),
  ).trim();
}

function extractCommandSubstitutions(line) {
  const substitutions = [];
  let output = "";
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      output += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && !single) {
      output += character;
      escaped = true;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      output += character;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      output += character;
      continue;
    }
    if (!single && character === "$" && line[index + 1] === "(") {
      let depth = 1;
      let nestedSingle = false;
      let nestedDouble = false;
      let nestedEscaped = false;
      let end = index + 2;
      for (; end < line.length && depth > 0; end += 1) {
        const nested = line[end];
        if (nestedEscaped) {
          nestedEscaped = false;
          continue;
        }
        if (nested === "\\" && !nestedSingle) {
          nestedEscaped = true;
          continue;
        }
        if (nested === "'" && !nestedDouble) nestedSingle = !nestedSingle;
        else if (nested === '"' && !nestedSingle) nestedDouble = !nestedDouble;
        else if (!nestedSingle && !nestedDouble && nested === "(") depth += 1;
        else if (!nestedSingle && !nestedDouble && nested === ")") depth -= 1;
      }
      if (depth !== 0) return { valid: false, line, substitutions };
      substitutions.push(line.slice(index + 2, end - 1));
      output += " __PROOF_SUBSTITUTION__ ";
      index = end - 1;
      continue;
    }
    output += character;
  }
  return { valid: !single && !double && !escaped, line: output, substitutions };
}

function splitShellSegments(line) {
  const segments = [];
  let buffer = "";
  let connector = null;
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      buffer += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && !single) {
      escaped = true;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      buffer += character;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      buffer += character;
      continue;
    }
    if (!single && !double) {
      const operator = SHELL_OPERATORS.find((candidate) => line.startsWith(candidate, index));
      if (operator && ["&&", "||", ";", "|", "&", "(", ")"].includes(operator)) {
        if (buffer.trim()) segments.push({ text: buffer.trim(), connector });
        buffer = "";
        connector = operator;
        index += operator.length - 1;
        continue;
      }
    }
    buffer += character;
  }
  if (buffer.trim()) segments.push({ text: buffer.trim(), connector });
  return { valid: !single && !double && !escaped, segments };
}

function shellWords(value) {
  const words = [];
  let word = "";
  let single = false;
  let double = false;
  let escaped = false;
  let active = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      word += character;
      active = true;
      escaped = false;
      continue;
    }
    if (character === "\\" && !single) {
      active = true;
      escaped = true;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      active = true;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      active = true;
      continue;
    }
    if (/\s/.test(character) && !single && !double) {
      if (active) words.push(word);
      word = "";
      active = false;
      continue;
    }
    word += character;
    active = true;
  }
  if (active) words.push(word);
  return { valid: !single && !double && !escaped, words };
}

function parseCommands(line, lineIndex) {
  const extracted = extractCommandSubstitutions(line);
  if (!extracted.valid) return { valid: false, commands: [] };
  if (extracted.substitutions.length > 0) return { valid: false, commands: [] };
  const commands = [];
  const split = splitShellSegments(extracted.line);
  if (!split.valid) return { valid: false, commands: [] };
  for (const segment of split.segments) {
    if (segment.connector === "(" || segment.connector === ")" || segment.connector === "&") {
      return { valid: false, commands: [] };
    }
    const parsed = shellWords(segment.text);
    if (!parsed.valid) return { valid: false, commands: [] };
    const words = [...parsed.words];
    while (words[0] === "!") words.shift();
    const assignments = [];
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) assignments.push(words.shift());
    if (
      assignments.some((assignment) =>
        /^(?:PATH|HOME|NODE_OPTIONS|BASH_ENV|ENV|SHELLOPTS|CDPATH|GLOBIGNORE|GIT_[A-Za-z0-9_]*|YARN_[A-Za-z0-9_]*|NPM_[A-Za-z0-9_]*|npm_[A-Za-z0-9_]*|LD_[A-Za-z0-9_]*|DYLD_[A-Za-z0-9_]*|PYTHON[A-Za-z0-9_]*|RUBY[A-Za-z0-9_]*|PERL[A-Za-z0-9_]*)=/i.test(
          assignment,
        ),
      ) ||
      (words.length > 0 && assignments.some((assignment) => assignment !== "TZ=Asia/Taipei"))
    ) {
      return { valid: false, commands: [] };
    }
    if (words.length === 0 || words.includes("__PROOF_SUBSTITUTION__")) return { valid: false, commands: [] };
    commands.push({ name: words[0], args: words.slice(1), connector: segment.connector, line: lineIndex });
  }
  return { valid: true, commands };
}

function hasUnsafeOutputRedirection(line) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && !single) {
      escaped = true;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      continue;
    }
    if (character !== ">" || single || double || line[index + 1] === "(") continue;
    let cursor = index + 1;
    if (line[cursor] === ">" || line[cursor] === "|") cursor += 1;
    while (/\s/.test(line[cursor] ?? "")) cursor += 1;
    if (line[cursor] === "&" && /[0-9-]/.test(line[cursor + 1] ?? "")) continue;
    let quote = null;
    if (line[cursor] === "'" || line[cursor] === '"') quote = line[cursor++];
    let target = "";
    while (cursor < line.length) {
      if (quote !== null) {
        if (line[cursor] === quote) break;
      } else if (/\s|[;&|()<>]/.test(line[cursor])) {
        break;
      }
      target += line[cursor++];
    }
    if (target !== "/dev/null") return true;
  }
  return false;
}

function hasUnsupportedShellEvaluation(line) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && !single) {
      escaped = true;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      continue;
    }
    if (character === "`" && !single) return true;
    if (!single && !double && (character === "<" || character === ">") && line[index + 1] === "(") return true;
  }
  return false;
}

function hasUnsupportedShellExpansion(line) {
  let single = false;
  let double = false;
  let escaped = false;
  let unquoted = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && !single) {
      escaped = true;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      continue;
    }
    if (single) continue;
    unquoted += character;
    if (character === "$" && /[A-Za-z0-9_{('"?$!#*@-]/.test(line[index + 1] ?? "")) return true;
    if (character === "*" || character === "?" || character === "[") return true;
  }
  return /\{[^{}\s]*(?:,|\.\.)[^{}\s]*\}/.test(unquoted);
}

function hasUnquotedShellOr(line) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length - 1; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && !single) {
      escaped = true;
      continue;
    }
    if (character === "'" && !double) single = !single;
    else if (character === '"' && !single) double = !double;
    else if (!single && !double && character === "|" && line[index + 1] === "|") return true;
  }
  return false;
}

function consumeSafeNodePrefixOption(args, index) {
  const argument = args[index];
  if (argument === "--enable-source-maps" || argument === "--no-warnings") return index + 1;
  if (argument === "--import") return args[index + 1] === "tsx" ? index + 2 : -1;
  if (argument === "--import=tsx") return index + 1;
  return -1;
}

function isApprovedTestPath(value) {
  return (
    /^tests\/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]s)$/.test(value) &&
    !value.split("/").includes("..")
  );
}

function isReadOnlyNodeTest(args) {
  const testPaths = [];
  let sawTest = false;
  let sawPath = false;
  for (let index = 0; index < args.length;) {
    const argument = args[index];
    const nextIndex = sawPath ? -1 : consumeSafeNodePrefixOption(args, index);
    if (nextIndex !== -1) {
      index = nextIndex;
      continue;
    }
    if (argument === "--test") {
      if (sawTest || sawPath) return false;
      sawTest = true;
      index += 1;
      continue;
    }
    if (/^--test-(?:concurrency|timeout)=\d+$/.test(argument)) {
      if (!sawTest || sawPath) return false;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) return false;
    if (!sawTest) return false;
    testPaths.push(argument);
    sawPath = true;
    index += 1;
  }
  return sawTest && testPaths.length > 0 && testPaths.every(isApprovedTestPath);
}

function isSafeRelativeCheckerValue(value) {
  return /^[A-Za-z0-9_./:@,+-]+$/.test(value) && !path.posix.isAbsolute(value) && !value.split("/").includes("..");
}

function isReadOnlyNodeChecker(args) {
  let index = 0;
  while (index < args.length) {
    const nextIndex = consumeSafeNodePrefixOption(args, index);
    if (nextIndex === -1) break;
    index = nextIndex;
  }
  const script = args[index];
  if (
    !script ||
    !READ_ONLY_NODE_CHECKERS.has(script)
  ) {
    return false;
  }
  const checkerArgs = args.slice(index + 1);
  if (script === "scripts/workflow/plan-proof-lint.mjs") {
    const match = checkerArgs.length === 1 ? checkerArgs[0].match(/^--plan=(.+)$/) : null;
    return match !== null && isSafeRelativeCheckerValue(match[1]);
  }
  return checkerArgs.length === 1 && checkerArgs[0] === "--project-root=.";
}

function isReadOnlyNode(args) {
  if (hasRiskyWriteOption(args)) return false;
  return args.includes("--test") ? isReadOnlyNodeTest(args) : isReadOnlyNodeChecker(args);
}

function isReadOnlyGit(args) {
  const subcommandIndex = args.findIndex((arg) => !arg.startsWith("-"));
  if (subcommandIndex === -1) return false;
  const globalOptions = args.slice(0, subcommandIndex);
  if (
    globalOptions.some((arg) => !["--no-optional-locks", "--no-replace-objects"].includes(arg)) ||
    new Set(globalOptions).size !== globalOptions.length
  ) {
    return false;
  }
  const subcommand = args[subcommandIndex];
  if (!READ_ONLY_GIT_COMMANDS.has(subcommand)) return false;
  if (subcommand === "status" && !globalOptions.includes("--no-optional-locks")) return false;
  const rest = args.slice(subcommandIndex + 1);
  if (rest.some((arg) => /^--(?:output|exec|ext-diff|textconv|filters)(?:=|$)/.test(arg))) return false;
  if (subcommand === "remote") {
    if (rest.length === 0 || rest.every((arg) => arg === "-v" || arg === "--verbose")) return true;
    if (rest[0] !== "get-url") return false;
    const values = rest.slice(1).filter((arg) => arg !== "--all" && arg !== "--push");
    return values.length === 1 && !values[0].startsWith("-");
  }
  if (subcommand === "symbolic-ref") {
    if (rest.some((arg) => arg === "--delete" || arg === "-d")) return false;
    const names = rest.filter((arg) => !arg.startsWith("-"));
    return names.length === 1;
  }
  if (subcommand === "branch") {
    if (rest.length === 1 && rest[0] === "--show-current") return true;
    if (!rest.includes("--list") && !rest.includes("-l")) return false;
    return !rest.some((arg) =>
      /^(?:-d|-D|-m|-M|-c|-C|-f|--delete|--move|--copy|--force|--edit-description|--set-upstream-to|--unset-upstream)(?:=|$)/.test(arg),
    );
  }
  return true;
}

function hasRiskyWriteOption(args) {
  return args.some((arg) =>
    /^(?:-o(?:.+)?$|--(?:output|write|fix|refresh|update|generateTrace|incremental|tsBuildInfoFile|test-reporter-destination|test-update-snapshots)(?:=|$))/.test(arg),
  );
}

function isReadOnlyCommand(command) {
  if (READ_ONLY_SIMPLE_COMMANDS.has(command.name)) {
    if (command.name === "rg" || command.name === "grep") return searchMetadata(command)?.safe === true;
    if ((command.name === "sort" || command.name === "diff") && hasRiskyWriteOption(command.args)) return false;
    if (command.name === "sort" && command.args.some((arg) => arg === "--compress-program" || arg.startsWith("--compress-program="))) return false;
    return true;
  }
  if (command.name === "node") return isReadOnlyNode(command.args);
  if (command.name === "yarn") {
    const subcommand = command.args[0];
    if (!READ_ONLY_YARN_COMMANDS.has(subcommand) || hasRiskyWriteOption(command.args)) return false;
    const rest = command.args.slice(1);
    if (subcommand === "tsc") return rest.length === 1 && rest[0] === "--noEmit";
    if (subcommand === "workflow:plan-proof") {
      const match = rest.length === 1 ? rest[0].match(/^--plan=(.+)$/) : null;
      return match !== null && isSafeRelativeCheckerValue(match[1]);
    }
    return rest.length === 0;
  }
  if (command.name === "git") return isReadOnlyGit(command.args);
  if (command.name === "find") {
    return !command.args.some((arg) => /^-(?:delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/.test(arg));
  }
  if (command.name === "sed") {
    return false;
  }
  if (command.name === "tee") {
    return command.args.length > 0 && command.args.every((arg) => arg === "/dev/null" || arg.startsWith("-"));
  }
  return false;
}

function isVerificationMutation(line, parsed) {
  const normalized = line.trim();
  if (
    hasUnsafeOutputRedirection(normalized) ||
    hasUnsupportedShellEvaluation(normalized) ||
    hasUnsupportedShellExpansion(normalized)
  ) return true;
  if (/\b(?:apply_patch|rm\s+-|mv\s+|cp\s+|mkdir\s+|touch\s+|git\s+(?:commit|push|tag|merge|checkout|switch|reset|clean)|sed\s+-i)\b/.test(normalized)) return true;
  if (/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rename|unlink|rmSync|mkdirSync)\s*\(/.test(normalized)) return true;
  if (/\bharness\b.*\b(?:refresh|regenerate|write)\b/i.test(normalized)) return true;
  if (!parsed.valid || parsed.commands.length === 0) return normalized.length > 0;
  return parsed.commands.some((command) => !isReadOnlyCommand(command));
}

function patternHasAlternation(pattern, mode) {
  if (mode === "fixed") return false;
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] !== "|") continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && pattern[cursor] === "\\"; cursor -= 1) backslashes += 1;
    const escaped = backslashes % 2 === 1;
    if ((mode === "basic" && escaped) || (mode !== "basic" && !escaped)) return true;
  }
  return false;
}

function safeSearchPath(value) {
  return !path.posix.isAbsolute(value) && !value.split("/").includes("..") && !/[\u0000-\u001f]/.test(value);
}

function searchMetadata(command) {
  if (command.name !== "rg" && command.name !== "grep") return null;
  const args = command.args;
  const patterns = [];
  const paths = [];
  let mode = command.name === "rg" ? "extended" : "basic";
  let repeatedExpressions = 0;
  let patternFile = false;
  let filesMode = false;
  let optionsEnded = false;

  const recordMode = (option) => {
    if (option === "F" || option === "fixed-strings") mode = "fixed";
    else if (option === "G" || option === "basic-regexp") mode = "basic";
    else if (["E", "P", "extended-regexp", "perl-regexp", "pcre2"].includes(option)) mode = "extended";
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!optionsEnded && argument === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && SEARCH_EXECUTABLE_OPTIONS.test(argument)) return { safe: false, alternation: false };
    if (!optionsEnded && argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals === -1 ? undefined : equals);
      const inlineValue = equals === -1 ? null : argument.slice(equals + 1);
      if (name === "file") {
        const value = inlineValue ?? args[++index];
        if (!value || !safeSearchPath(value)) return { safe: false, alternation: false };
        patternFile = true;
        continue;
      }
      if (name === "regexp") {
        const value = inlineValue ?? args[++index];
        if (value === undefined) return { safe: false, alternation: false };
        patterns.push(value);
        repeatedExpressions += 1;
        continue;
      }
      if (SEARCH_LONG_FLAGS[command.name].has(name)) {
        if (inlineValue !== null) return { safe: false, alternation: false };
        recordMode(name);
        if (name === "files" || name === "type-list") filesMode = true;
        continue;
      }
      if (SEARCH_LONG_VALUE_OPTIONS[command.name].has(name)) {
        const value = inlineValue ?? args[++index];
        if (value === undefined) return { safe: false, alternation: false };
        recordMode(name);
        continue;
      }
      return { safe: false, alternation: false };
    }
    if (!optionsEnded && argument.startsWith("-") && argument !== "-") {
      for (let position = 1; position < argument.length; position += 1) {
        const option = argument[position];
        recordMode(option);
        if (SEARCH_SHORT_VALUE_OPTIONS[command.name].has(option)) {
          const attached = argument.slice(position + 1);
          const value = attached || args[++index];
          if (value === undefined) return { safe: false, alternation: false };
          if (option === "e") {
            patterns.push(value);
            repeatedExpressions += 1;
          } else if (option === "f") {
            if (!safeSearchPath(value)) return { safe: false, alternation: false };
            patternFile = true;
          }
          position = argument.length;
          continue;
        }
        if (!SEARCH_SHORT_FLAGS[command.name].has(option)) return { safe: false, alternation: false };
      }
      continue;
    }
    if (!filesMode && patterns.length === 0 && repeatedExpressions === 0 && !patternFile) patterns.push(argument);
    else paths.push(argument);
  }

  return {
    safe: paths.every(safeSearchPath) && (filesMode || patternFile || patterns.length > 0),
    alternation: patternFile || repeatedExpressions >= 2 || patterns.some((pattern) => patternHasAlternation(pattern, mode)),
  };
}

function unsafeAllOfSearches(commands) {
  const searches = commands.map((command) => ({ command, metadata: searchMetadata(command) })).filter((entry) => entry.metadata !== null);
  const unsafeLines = new Set(searches.filter((entry) => entry.metadata.alternation).map((entry) => entry.command.line));
  for (const command of commands) {
    if (command.connector === "||") unsafeLines.add(command.line);
  }
  for (let index = 1; index < searches.length; index += 1) {
    const current = searches[index].command;
    const previous = searches[index - 1].command;
    if (current.line === previous.line && current.connector !== "&&") {
      unsafeLines.add(previous.line);
      unsafeLines.add(current.line);
    }
  }
  return unsafeLines;
}

function isOversizedInlineEval(lines, range, lineIndex) {
  const line = lines[lineIndex];
  if (!/\bnode\b.*(?:--eval|-e\s|--input-type=module)/.test(line)) return false;
  if (line.length > 240 || /<<[-~]?['"]?[A-Z][A-Z0-9_]*['"]?/.test(line)) return true;
  const blockLength = lines.slice(range.start, range.end + 1).join("\n").length;
  return blockLength > 1200;
}

function isUpperBoundCardinality(line) {
  const cardinality = "(?:wc\\s+-l|\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?|[A-Za-z_$][\\w$]*\\.(?:length|size)|[A-Za-z_$][\\w$]*count)";
  const bound = "(?:\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?|\\d+)";
  return new RegExp(
    `(?:${cardinality}["']?[^\\n]{0,120}(?:<=|<|-le\\b|-lt\\b)\\s*["']?${bound}|${bound}["']?\\s*(?:>=|>|-ge\\b|-gt\\b)[^\\n]{0,120}${cardinality})`,
    "i",
  ).test(line);
}

function isSingleLineOrTailProof(line) {
  return /\btail(?:\s|$)/.test(line) || /\bhead\s+(?:-1\b|-n\s*1\b|--lines(?:=|\s+)1\b)/.test(line) || /\bsed\s+-n\s+['"]?\$p/.test(line);
}

function requiredPhase126NegativeControlPath(taskText, isPhase126Plan) {
  const description = taskText.split(/<verify\b|<automated\b/i, 1)[0];
  if (!isPhase126Plan || /\b(?:registry|plan-proof)\b/i.test(description)) return undefined;
  return PHASE_126_NEGATIVE_CONTROL_BY_TASK.find(({ pattern }) => pattern.test(description))?.path;
}

function requiredPhase127NegativeControlPath(taskText, isPhase127Plan) {
  const description = taskText.split(/<verify\b|<automated\b/i, 1)[0];
  if (!isPhase127Plan || /\b(?:registry|plan-proof)\b/i.test(description)) return undefined;
  return PHASE_127_NEGATIVE_CONTROL_BY_TASK.find(({ pattern }) => pattern.test(description))?.path;
}

function requiredPhase128NegativeControlPath(taskText, isPhase128Plan) {
  const description = taskText.match(/<name>([\s\S]*?)<\/name>/i)?.[1]?.trim() ?? taskText;
  const preVerificationText = taskText.split(/<verify\b|<automated\b/i, 1)[0];
  if (!isPhase128Plan || /\b(?:registry|plan-proof)\b/i.test(preVerificationText)) return undefined;
  return PHASE_128_NEGATIVE_CONTROL_BY_TASK.find(({ pattern }) => pattern.test(description))?.path;
}

function executesStructuredNegativeControl(line, parsed, requiredPath) {
  if (!parsed?.valid || parsed.commands.length === 0) return false;
  return parsed.commands.some((command) => {
    if (command.name !== "node" || !isReadOnlyCommand(command) || !command.args.includes("--test")) return false;
    if (command.args.some((argument) => /^--test-(?:name|skip)-pattern(?:=|$)/.test(argument))) return false;
    if (requiredPath !== undefined) return command.args.includes(requiredPath);
    return command.args.some((argument) => NEGATIVE_CONTROL_TEST_FILES.has(argument));
  });
}

export function lintPlanProof(content) {
  const lines = visibleMarkdownLines(content);
  const structure = parseProofTagStructure(lines);
  const tasks = structure.ranges.task;
  const ranges = taskScopedVerificationRanges(structure);
  const findings = [];
  const seen = new Set();
  const actionableTasks = new Set();
  const tasksWithCommands = new Set();
  const negativeControlTasks = new Set();
  const negativeControlWaiverTasks = new Set();
  const isPhase126Plan = lines.some((line) => /^\s*phase:\s*126\s*$/i.test(line));
  const isPhase127Plan = lines.some((line) => /^\s*phase:\s*127\s*$/i.test(line));
  const isPhase128Plan = lines.some((line) => /^\s*phase:\s*128\s*$/i.test(line));

  for (const range of ranges) {
    const parsedByLine = new Map();
    const allCommands = [];
    const commandLines = [];
    for (let index = range.start; index <= range.end; index += 1) {
      const line = commandText(lines[index]);
      if (!line) continue;
      commandLines.push({ index, line });
      const parsed = parseCommands(line, index);
      parsedByLine.set(index, parsed);
      allCommands.push(...parsed.commands);
    }
    if (commandLines.length === 0) continue;
    const unsafeSearchLines = unsafeAllOfSearches(allCommands);

    for (const { index, line } of commandLines) {
      const parsed = parsedByLine.get(index);
      if ((unsafeSearchLines.has(index) || hasUnquotedShellOr(line)) && !annotationAllows(lines, index, "allow-or")) {
        addFinding(findings, seen, "PPL001", index);
      }
      if (isSingleLineOrTailProof(line) && !annotationAllows(lines, index, "allow-single-line")) {
        addFinding(findings, seen, "PPL002", index);
      }
      if (isVerificationMutation(line, parsed) && !annotationAllows(lines, index, "allow-verify-mutation")) {
        addFinding(findings, seen, "PPL003", index);
      }
      if (isOversizedInlineEval(lines, range, index) && !annotationAllows(lines, index, "allow-inline-eval")) {
        addFinding(findings, seen, "PPL004", index);
      }
      if (/(?:\brg\b|\bgrep\b).*\b(?:result|status|verdict)?\s*:?\s*pass(?:ed)?\b/i.test(line) && !annotationAllows(lines, index, "allow-pass-marker")) {
        addFinding(findings, seen, "PPL005", index);
      }
      if (isUpperBoundCardinality(line)) {
        addFinding(findings, seen, "PPL007", index);
      }
    }

    const block = commandLines.map(({ line }) => line).join("\n");
    if (/(?:echo|printf|writeFile|appendFile|tee)[\s\S]{0,200}\bpass(?:ed)?\b/i.test(block) && /(?:\brg\b|\bgrep\b)[\s\S]{0,200}\bpass(?:ed)?\b/i.test(block)) {
      const search = commandLines.find(({ line }) => /(?:\brg\b|\bgrep\b).*\bpass(?:ed)?\b/i.test(line));
      if (search && !annotationAllows(lines, search.index, "allow-pass-marker")) {
        addFinding(findings, seen, "PPL005", search.index);
      }
    }

    const task = taskForRange(tasks, range);
    if (task) tasksWithCommands.add(task.startPosition);
    const requiredNegativeControlPath = task
      ? requiredPhase126NegativeControlPath(lines.slice(task.start, task.end + 1).join("\n"), isPhase126Plan)
        ?? requiredPhase127NegativeControlPath(lines.slice(task.start, task.end + 1).join("\n"), isPhase127Plan)
        ?? requiredPhase128NegativeControlPath(lines.slice(task.start, task.end + 1).join("\n"), isPhase128Plan)
      : undefined;
    const hasNegativeControl = commandLines.some(({ index, line }) =>
      executesStructuredNegativeControl(line, parsedByLine.get(index), requiredNegativeControlPath),
    );
    if (task && hasNegativeControl) negativeControlTasks.add(task.startPosition);
    if (task && annotationAllows(lines, range.start, "allow-no-negative-control")) {
      negativeControlWaiverTasks.add(task.startPosition);
    }
    const hasActionableProof = commandLines.some(({ index, line }) => {
      const parsed = parsedByLine.get(index);
      return (
        parsed?.valid &&
        !isVerificationMutation(line, parsed) &&
        parsed.commands.some((command) => !INERT_COMMANDS.has(command.name) && isReadOnlyCommand(command))
      );
    });
    if (task && hasActionableProof) actionableTasks.add(task.startPosition);
  }

  if (!structure.valid || tasks.length === 0) {
    addFinding(findings, seen, "PPL008", 0);
  } else {
    for (const task of tasks) {
      if (!actionableTasks.has(task.startPosition)) addFinding(findings, seen, "PPL008", task.start);
      const taskText = lines.slice(task.start, task.end + 1).join("\n");
      if (
        RISK_PATTERN.test(taskText) &&
        tasksWithCommands.has(task.startPosition) &&
        !negativeControlTasks.has(task.startPosition) &&
        !negativeControlWaiverTasks.has(task.startPosition) &&
        !annotationAllows(lines, task.start, "allow-no-negative-control")
      ) {
        addFinding(findings, seen, "PPL006", task.start);
      }
    }
  }
  findings.sort((left, right) => left.line - right.line || left.ruleId.localeCompare(right.ruleId, "en"));
  return {
    schemaVersion: 1,
    kind: "plan_proof_lint",
    status: findings.length === 0 ? "pass" : "fail",
    findings,
  };
}

export function lintPlanFile(planPath) {
  const content = fs.readFileSync(planPath, "utf8");
  return lintPlanProof(content);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const args = process.argv.slice(2);
  const planArg = args.find((arg) => arg.startsWith("--plan="));
  if (!planArg || args.length !== 1) {
    process.stderr.write('{"schemaVersion":1,"kind":"plan_proof_lint_error","code":"usage_error"}\n');
    process.exit(2);
  }
  try {
    const result = lintPlanFile(planArg.slice("--plan=".length));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "pass" ? 0 : 1;
  } catch {
    process.stderr.write('{"schemaVersion":1,"kind":"plan_proof_lint_error","code":"plan_read_failed"}\n');
    process.exitCode = 2;
  }
}
