import chalk from "chalk";
import { visibleWidth } from "./ansi.js";
import { stylePromptTitle } from "./prompt-style.js";

// Unicode box-drawing characters (same as @clack/prompts uses)
const isUnicodeSupported =
  process.platform !== "win32" ||
  !!process.env.CI ||
  !!process.env.WT_SESSION ||
  process.env.TERM_PROGRAM === "vscode" ||
  process.env.TERM === "xterm-256color" ||
  process.env.TERM === "alacritty";

const S_BAR = isUnicodeSupported ? "│" : "|";
const S_STEP_SUBMIT = isUnicodeSupported ? "◇" : "o";
const S_BAR_H = isUnicodeSupported ? "─" : "-";
const S_CORNER_TOP_RIGHT = isUnicodeSupported ? "╮" : "+";
const S_CONNECT_LEFT = isUnicodeSupported ? "├" : "+";
const S_CORNER_BOTTOM_RIGHT = isUnicodeSupported ? "╯" : "+";

function splitLongWord(word: string, maxLen: number): string[] {
  if (maxLen <= 0) {
    return [word];
  }
  const chars = Array.from(word);
  const parts: string[] = [];
  let currentPart = "";
  let currentWidth = 0;

  for (const char of chars) {
    const charWidth = visibleWidth(char);
    if (currentWidth + charWidth > maxLen && currentPart) {
      parts.push(currentPart);
      currentPart = char;
      currentWidth = charWidth;
    } else {
      currentPart += char;
      currentWidth += charWidth;
    }
  }
  if (currentPart) parts.push(currentPart);
  return parts.length > 0 ? parts : [word];
}

function wrapLine(line: string, maxWidth: number): string[] {
  if (line.trim().length === 0) {
    return [line];
  }
  const match = line.match(/^(\s*)([-*\u2022]\s+)?(.*)$/);
  const indent = match?.[1] ?? "";
  const bullet = match?.[2] ?? "";
  const content = match?.[3] ?? "";
  const firstPrefix = `${indent}${bullet}`;
  const nextPrefix = `${indent}${bullet ? " ".repeat(visibleWidth(bullet)) : ""}`;
  const firstWidth = Math.max(10, maxWidth - visibleWidth(firstPrefix));
  const nextWidth = Math.max(10, maxWidth - visibleWidth(nextPrefix));

  const words = content.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let prefix = firstPrefix;
  let available = firstWidth;

  for (const word of words) {
    if (!current) {
      if (visibleWidth(word) > available) {
        const parts = splitLongWord(word, available);
        const first = parts.shift() ?? "";
        lines.push(prefix + first);
        prefix = nextPrefix;
        available = nextWidth;
        for (const part of parts) {
          lines.push(prefix + part);
        }
        continue;
      }
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (visibleWidth(candidate) <= available) {
      current = candidate;
      continue;
    }

    lines.push(prefix + current);
    prefix = nextPrefix;
    available = nextWidth;

    if (visibleWidth(word) > available) {
      const parts = splitLongWord(word, available);
      const first = parts.shift() ?? "";
      lines.push(prefix + first);
      for (const part of parts) {
        lines.push(prefix + part);
      }
      current = "";
      continue;
    }
    current = word;
  }

  if (current || words.length === 0) {
    lines.push(prefix + current);
  }

  return lines;
}

export function wrapNoteMessage(
  message: string,
  options: { maxWidth?: number; columns?: number } = {},
): string {
  const columns = options.columns ?? process.stdout.columns ?? 80;
  const maxWidth = options.maxWidth ?? Math.max(40, Math.min(88, columns - 10));
  return message
    .split("\n")
    .flatMap((line) => wrapLine(line, maxWidth))
    .join("\n");
}

/**
 * Render a note box with proper handling of wide characters.
 * This is a replacement for @clack/prompts note() that correctly
 * calculates width for CJK and other wide characters.
 */
export function note(message: string, title?: string) {
  const wrappedMessage = wrapNoteMessage(message);
  const lines = wrappedMessage.split("\n");
  const styledTitle = stylePromptTitle(title) ?? "";
  const titleWidth = visibleWidth(title ?? "");

  // Calculate the maximum width needed for the box
  const maxLineWidth = Math.max(...lines.map((line) => visibleWidth(line)), titleWidth);
  const boxWidth = maxLineWidth + 2; // +2 for padding on each side

  // Build the box
  const output: string[] = [];

  // Empty line before
  output.push(chalk.gray(S_BAR));

  // Title line with top border
  const titlePadding = Math.max(boxWidth - titleWidth - 1, 1);
  output.push(
    `${chalk.green(S_STEP_SUBMIT)}  ${styledTitle} ${chalk.gray(S_BAR_H.repeat(titlePadding) + S_CORNER_TOP_RIGHT)}`,
  );

  // Content lines
  for (const line of lines) {
    const lineWidth = visibleWidth(line);
    const padding = boxWidth - lineWidth;
    output.push(
      `${chalk.gray(S_BAR)}  ${chalk.dim(line)}${" ".repeat(padding)}${chalk.gray(S_BAR)}`,
    );
  }

  // Bottom border
  output.push(chalk.gray(S_CONNECT_LEFT + S_BAR_H.repeat(boxWidth + 2) + S_CORNER_BOTTOM_RIGHT));

  process.stdout.write(output.join("\n") + "\n");
}
