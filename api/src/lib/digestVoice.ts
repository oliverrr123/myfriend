import { relationshipLabel } from './dailyDigestPolicy';

export function digestVoice(relationship: unknown) {
  const label = relationshipLabel(relationship);
  const female = relationship === 'grandmother' || relationship === 'mom';
  const male = relationship === 'grandfather' || relationship === 'dad';
  return { label, subject: female ? 'she' : male ? 'he' : 'they',
    object: female ? 'her' : male ? 'him' : 'them',
    possessive: female ? 'her' : male ? 'his' : 'their' };
}

export function digestClosing(relationship: unknown, eventIds: string[], answered: boolean) {
  const { object } = digestVoice(relationship);
  const options = [
    'Have a lovely evening!',
    'Enjoy the rest of your evening!',
    'Wishing you a peaceful evening.',
    'Hope you have a nice evening!',
    'Take care, and have a lovely evening!',
    ...(answered ? [`If you get a chance, give ${object} a call too.`, `Maybe take a moment to say hello to ${object} this week.`] : []),
  ];
  // Varies across digests, but retries of the same digest retain the same closing.
  const hash = [...eventIds].sort().join('|').split('').reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return options[hash % options.length];
}
