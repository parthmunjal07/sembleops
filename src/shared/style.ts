// Output style rules: no em dashes or emoji anywhere the
// product speaks. Prompts instruct the models; this is the enforcement layer
// for anything an LLM returns or a template composes.

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{2713}\u{2714}\u{25B6}\u{2192}]/gu;

export function sanitizeOutput(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ") // em/en dash to a comma pause
    .replace(EMOJI, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([,.!?])/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
