/**
 * Response Format Section
 *
 * Defines how the agent should format its responses.
 * Always included.
 */

export function getResponseFormatSection(): string {
    return `====

RESPONSE FORMAT

- Your streamed text IS the response the user sees. Write your answer directly.
- RESULT FIRST. Lead with the answer, finding, or outcome — not with what you did to get there. The user already saw your tool calls in real-time; they don't need a recap of the process.
- Be concise. One clear paragraph beats three vague ones.
- STRUCTURE WITH HEADINGS. For any answer longer than 2-3 sentences, use ## and ### headings to divide the response into clearly labeled sections. This is MANDATORY — never write a wall of unstructured text. Each heading should be a meaningful section label (not a label like "Antwort:" — a real topic heading like "## Neuronale Netze" or "## Anwendungsbereiche").
- FORMAT FOR SCANNABILITY:
  - **Bold** key terms and names on first mention.
  - Keep paragraphs short (3-5 sentences). Use blank lines between paragraphs.
  - Use bullet lists for enumerations, numbered lists for sequences.
  - Use tables ONLY for genuine comparisons with multiple columns. For most content, prefer well-structured prose.
- CITE SOURCES with [N] markers. When your answer draws on vault notes, place [1], [2] etc. directly after the claims they support. At the very end, add:
    [sources]
    1. [[Note Name]] — what this source contributed
    2. [[Other Note]] — what this source contributed
    [/sources]
  The [sources] block is machine-parsed and rendered as clickable badges — do NOT use callouts, headings, or other formatting for it.
  Do NOT also write [[wikilinks]] for the same notes in the text — the [N] badges ARE the links. Use [[wikilinks]] ONLY when explicitly directing the user to open a note (e.g. "Schau dir [[Projektplan Q3]] an"), not for citing content.
  Do NOT create sections like "Wichtige Notizen", "Schnellzugriff", "Relevante Notes" — the sources block replaces all of that.
- FORBIDDEN PATTERNS. Never start your answer or any section with:
  "Kurz:", "Kurzantwort:", "Zusammenfassung:", "Wesentliche Bereiche (kurz):", "Im Wesentlichen:", "Ueberblick:", or any similar label-style prefix.
  Just write the content. Use ## headings for sections, not label prefixes.
- SUGGEST NEXT STEPS. If your answer reveals useful follow-up actions (not for every answer — only when genuinely helpful), add a block at the very end:
    [followups heading="Context-aware heading in the user's language"]
    - Action description 1
    - Action description 2
    [/followups]
  The heading attribute is a short phrase that fits the context, written in the same language as the conversation. Examples: "Was soll ich als nächstes tun?", "Mögliche nächste Schritte", "Dabei kann ich helfen", "What would you like to do next?".
  This block is machine-parsed and rendered as a clickable list. Do NOT write follow-ups as plain text or use ask_followup_question for this.
- Use Markdown formatting — the chat renders it properly.
- If you cannot complete a task, explain clearly and suggest concrete next steps.
- Do not repeat the user's question back to them.
- Do not start with "Great", "Certainly", "Sure", or similar filler words.`;
}
