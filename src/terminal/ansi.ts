const ANSI_SGR_PATTERN = "\\x1b\\[[0-9;]*m";
// OSC-8 hyperlinks: ESC ] 8 ; ; url ST ... ESC ] 8 ; ; ST
const OSC8_PATTERN = "\\x1b\\]8;;.*?\\x1b\\\\|\\x1b\\]8;;\\x1b\\\\";

const ANSI_REGEX = new RegExp(ANSI_SGR_PATTERN, "g");
const OSC8_REGEX = new RegExp(OSC8_PATTERN, "g");

export function stripAnsi(input: string): string {
  return input.replace(OSC8_REGEX, "").replace(ANSI_REGEX, "");
}

/**
 * Check if a character is a wide (full-width) character.
 * This includes CJK characters, some symbols, and emojis.
 */
function isWideChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  // CJK ranges and other full-width characters
  return (
    // CJK Unified Ideographs and extensions
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2ebef) ||
    (code >= 0x30000 && code <= 0x323af) ||
    // Hangul (Korean)
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3130 && code <= 0x318f) ||
    // Japanese Hiragana and Katakana
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x31f0 && code <= 0x31ff) ||
    // Full-width forms
    (code >= 0xff00 && code <= 0xffef) ||
    // CJK symbols and punctuation
    (code >= 0x3000 && code <= 0x303f) ||
    // Enclosed CJK letters
    (code >= 0x3200 && code <= 0x32ff) ||
    // CJK compatibility
    (code >= 0x3300 && code <= 0x33ff) ||
    // Bopomofo
    (code >= 0x3100 && code <= 0x312f)
  );
}

/**
 * Calculate the visible width of a string in terminal columns.
 * Accounts for ANSI codes (ignored) and wide characters (2 columns).
 */
export function visibleWidth(input: string): number {
  const stripped = stripAnsi(input);
  let width = 0;
  for (const char of stripped) {
    width += isWideChar(char) ? 2 : 1;
  }
  return width;
}
