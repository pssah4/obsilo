/**
 * safeRegex — ReDoS-safe regex construction
 *
 * Creates a RegExp from a user/LLM-supplied pattern string, falling back to
 * a literal (escaped) match when the pattern is too complex, too long, or
 * syntactically invalid.
 *
 * Extracted from SearchFilesTool (K-2 / S-02) so every call-site that builds
 * a RegExp from untrusted input can reuse the same protection.
 */

/** Escape all regex metacharacters so the string matches literally. */
function literalEscape(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detects catastrophic backtracking constructs:
 *  - (…)+ / (…)*   — group followed by quantifier
 *  - […]**         — char-class with double quantifier
 *  - (a|b|…)+      — alternation inside quantified group
 */
const REDOS_PATTERNS = /(\(.*\))[+*]{1,}|(\[.*\])[+*]{2,}|(\w+\|)+\w+[+*]/;

/** Max pattern length before treating as literal. */
const MAX_PATTERN_LENGTH = 500;

/**
 * Build a safe RegExp.  Returns a literal-match regex when the input looks
 * like it could trigger catastrophic backtracking or exceeds length limits.
 *
 * @param pattern  Raw pattern string (may come from LLM, frontmatter, user input)
 * @param flags    Optional regex flags (e.g. 'gi')
 */
export function safeRegex(pattern: string, flags?: string): RegExp {
    const isComplex =
        pattern.length > MAX_PATTERN_LENGTH ||
        // Nested quantifiers, possessive constructs, high repetition counts
        /(\(\?[=!<]|(\+|\*|\?)(\+|\?)|\{\d{3,}\})/.test(pattern) ||
        REDOS_PATTERNS.test(pattern);

    if (isComplex) {
        return new RegExp(literalEscape(pattern), flags);
    }

    try {
        return new RegExp(pattern, flags);
    } catch {
        return new RegExp(literalEscape(pattern), flags);
    }
}
