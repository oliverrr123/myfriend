export const SAFE_TOPICS = ["gardening", "cooking", "books", "music", "television", "sports", "crafts", "pets", "weather", "history", "everyday technology", "science", "philosophy", "current events", "practical questions", "service setup"] as const;
export type SafeTopic = typeof SAFE_TOPICS[number];
export type DigestKind = "conversation" | "medication" | "water" | "reminder";
export type DigestEvent = {
    call_id: string;
    kind: DigestKind;
    answered: boolean;
    summary: string | null;
    ended_at: string;
    available_at: string;
};
export type SafeDigestEvent = Omit<DigestEvent, "summary"> & {
    topics: SafeTopic[];
    details?: string[];
    reminder_type?: 'medication' | 'water' | 'general' | 'none';
    medication_report?: 'reported_taken' | 'planned' | 'not_confirmed';
};
export function relationshipLabel(value: unknown): string {
    const labels: Record<string, string> = { grandmother: 'grandma', grandfather: 'grandpa', mom: 'mom', dad: 'dad', partner: 'partner' };
    return typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : 'loved one';
}
export function validTopics(value: unknown): SafeTopic[] {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.filter((x): x is SafeTopic => typeof x === "string" && (SAFE_TOPICS as readonly string[]).includes(x)))].slice(0, 2);
}
export function renderDailyDigest(events: SafeDigestEvent[]): string | null {
    if (!events.length)
        return null;
    const unique = [...new Map(events.map(e => [e.call_id, e])).values()];
    const chats = unique.filter(e => e.kind === "conversation" && e.answered).length;
    const reminders = unique.filter(e => e.kind !== "conversation" && e.answered).length;
    const unanswered = unique.filter(e => !e.answered).length;
    const topics = validTopics(unique.filter(e => e.answered && e.kind === "conversation").flatMap(e => e.topics));
    const lines: string[] = [];
    if (chats)
        lines.push(`Your loved one had ${chats === 1 ? "a chat" : `${chats} chats`} with MyFriend.`);
    if (topics.length)
        lines.push(`The conversation covered ${topics.join(" and ")}.`);
    if (reminders)
        lines.push(`${reminders === 1 ? "One reminder call was" : `${reminders} reminder calls were`} answered.`);
    if (unanswered)
        lines.push(`An answer wasn't confirmed for ${unanswered === 1 ? "one call" : `${unanswered} calls`}.`);
    return `MyFriend daily update\n\n${lines.join(" ")}`;
}
function parts(date: Date, timezone: string) {
    return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
}
function local20(day: string, timezone: string) {
    const desired = Date.parse(`${day}T20:00:00Z`);
    let utc = desired;
    for (let i = 0; i < 4; i++) {
        const p = parts(new Date(utc), timezone);
        const actual = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
        utc += desired - actual;
    }
    return new Date(utc);
}
function shiftDay(day: string, delta: number) { return new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86400000).toISOString().slice(0, 10); }
export function digestWindow(now: Date, timezone: string) {
    const p = parts(now, timezone);
    let day = `${p.year}-${p.month}-${p.day}`;
    if (Number(p.hour) < 20)
        day = shiftDay(day, -1);
    return { localDate: day, start: local20(shiftDay(day, -1), timezone).toISOString(), end: local20(day, timezone).toISOString() };
}
export function eventInWindow(event: Pick<DigestEvent, "ended_at" | "available_at">, window: {
    start: string;
    end: string;
}) {
    // A late final transcript belongs to the next digest, never a partial earlier one.
    const available = Math.max(Date.parse(event.ended_at), Date.parse(event.available_at));
    return available >= Date.parse(window.start) && available < Date.parse(window.end);
}
