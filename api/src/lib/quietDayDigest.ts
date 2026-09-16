import { digestVoice } from './digestVoice';
import type { ApprovedDigestMessage } from './dailyDigestWriter';

export function parseCallChoice(body: Record<string, unknown>, now = new Date()) {
  if (body.allow_calls != null && typeof body.allow_calls !== 'boolean') return null;
  if (body.allow_reports != null && typeof body.allow_reports !== 'boolean') return null;
  const status = body.call_status ?? (typeof body.allow_calls === 'boolean' ? body.allow_calls ? 'accepted' : 'declined' : null);
  if (status !== null && !['accepted', 'declined', 'paused'].includes(String(status))) return null;
  if (typeof body.allow_calls === 'boolean' && status !== (body.allow_calls ? 'accepted' : 'declined') && !(status === 'paused' && !body.allow_calls)) return null;
  const reports = typeof body.allow_reports === 'boolean' ? body.allow_reports : null;
  if (status === null && reports === null) return null;
  let pauseUntil: string | null = null;
  if (body.pause_until != null && body.pause_until !== '') {
    if (status !== 'paused' || typeof body.pause_until !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.pause_until)) return null;
    const stamp = Date.parse(body.pause_until);
    if (!Number.isFinite(stamp) || stamp <= now.getTime()) return null;
    pauseUntil = new Date(stamp).toISOString();
  }
  return { status: status as 'accepted' | 'declined' | 'paused' | null, reports, pauseUntil };
}

export type QuietContext = { kind: 'off_day' | 'declined' | 'paused'; version: string; status: string; weekdays?: number[]; pause_until?: string | null; timezone?: string };
export function quietDayMessage(context: QuietContext | null | undefined, relationship: unknown): ApprovedDigestMessage | null {
  if (!context?.version) return null;
  const { label, subject } = digestVoice(relationship);
  let text: string;
  if (context.kind === 'declined') {
    text = `Your ${label} asked me not to make friendly calls, so I’m respecting ${subject === 'she' ? 'her' : subject === 'he' ? 'his' : 'their'} choice.`;
  } else if (context.kind === 'paused') {
    let until = '';
    if (context.pause_until) {
      try {
        if (!context.timezone) return null;
        const date = new Intl.DateTimeFormat('en-US', { timeZone: context.timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(context.pause_until));
        until = ` until ${date}`;
      } catch { return null; }
    }
    text = `Your ${label} asked to pause friendly calls${until}, so I’m respecting ${subject === 'she' ? 'her' : subject === 'he' ? 'his' : 'their'} choice.`;
  } else if (context.kind === 'off_day') {
    const days = [...new Set(context.weekdays ?? [])].sort((a,b)=>a-b);
    if (!days.length || days.some(d=>!Number.isInteger(d)||d<0||d>6)) return null;
    const names = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
    const when = days.join(',') === '1,2,3,4,5' ? 'weekdays' : days.map(d=>names[d]).join(', ').replace(/, ([^,]+)$/, ' and $1');
    const prefers = subject === 'they' ? 'They prefer' : subject === 'she' ? 'She prefers' : 'He prefers';
    text = `No friendly call was scheduled with your ${label} during this update’s time window. ${prefers} calls on ${when}.`;
  } else return null;
  return text as ApprovedDigestMessage;
}
