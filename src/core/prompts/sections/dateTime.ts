/**
 * Date/Time Header Section
 *
 * Placed at the very top of the system prompt so the model always uses
 * the correct date. Uses the system clock with en-US locale for
 * unambiguous LLM interpretation.
 */

export function getDateTimeSection(includeTime?: boolean): string {
    if (!includeTime) return '';

    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const isoDate = now.toISOString().slice(0, 10);
    const humanDate = new Intl.DateTimeFormat('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
    }).format(now);
    const humanTime = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short', hour12: false, timeZone: tz,
    }).format(now);

    return (
        `TODAY IS: ${humanDate} (${isoDate}), local time ${humanTime} [${tz}]\n` +
        `IMPORTANT: Always use the date above (${isoDate}) for any notes, frontmatter dates, or timestamps you create. ` +
        `Do not infer or guess a different date.\n\n====\n\n`
    );
}
