// Conservative second boundary around English family copy. A rejected detail is omitted,
// never rewritten into a harmless-sounding euphemism. Medication status has its own typed path.
const privateDetail = /\b(medic\w*|pills?|dos(?:e|es|age)|health\w*|bmi|weight|diagnos\w*|symptom\w*|disease\w*|illness|cancer|blood|doctor\w*|hospital\w*|surgery|therap\w*|depress\w*|anxi\w*|lonel\w*|comfort\w*|wellbeing|religio\w*|church|prayer|modesty|modest|politic\w*|military|weapons?|war|president|election|sex\w*|adult.only|legal\w*|lawsuit\w*|money|bank\w*|debt\w*|financ\w*|charit\w*|donat\w*|transfer\w*|fees?|prices?|free|payment\w*|conflict\w*|argument\w*|address\w*|appointment\w*|secret\w*)\b/i;
const thirdParty = /\b(grandson|granddaughter|neighbor|neighbour|daughter|son|wife|husband)\b/i;
// Details need no named people or places. Keep common sentence starts and generic TV/English references.
const permittedCapitals = new Set(['I','She','He','Her','His','They','Their','The','A','An','It','Had','Made','Cooked','Watched','Discussed','Asked','Talked','Mentioned','Enjoyed','Listened','Planned','Finished','Read','Shared','Showed','Requested','TV','English','MyFriend','Later','Also','After','Before','During']);
function hasNamedDetail(text: string): boolean {
  return [...text.matchAll(/\b\p{Lu}\p{L}*/gu)].some(match=>!permittedCapitals.has(match[0]));
}
export function detailIsShareable(text: string): boolean {
  return text.length > 0 && text.length <= 160 && !privateDetail.test(text) && !thirdParty.test(text) && !hasNamedDetail(text) &&
    !/[\n\r]|https?:|@|\d{4,}|\b(call back|call.*later|subscri\w*|DigiPřítel)\b/i.test(text);
}
export function bodyHasPrivateDetails(text: string): boolean {
  // Generic medication self-report wording is allowed only by the caller's typed status.
  return privateDetail.test(text.replace(/\b(medication|medications|medicine|medicines|reminder|reminders)\b/gi, '')) || thirdParty.test(text) || hasNamedDetail(text);
}

// Names in evidence can be removed safely; sexual/religious/private financial
// content cannot become a shareable activity merely by euphemising its wording.
export function evidenceHasPrivateContext(text: string, source = text): boolean {
  const sexual = /\b(sex\w*|erotic|genital|nudity|swingers?|adult.only)\b/i;
  return sexual.test(text) ||
    (sexual.test(source) && /\b(clubs?|rooms?|membership|social rules|consent|dress codes?|technical setup)\b/i.test(text)) ||
    /\b(religio\w*|prayer|modesty|bank\w*|wire transfer\w*|account balance|personal (?:income|debt|finances)|diagnos\w*|symptom\w*|personal BMI)\b/i.test(text);
}
