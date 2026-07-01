export type DeckplateBrief = {
  id: string;
  kind: 'quote' | 'history';
  text: string;
  attribution: string;
  sourceTitle: string;
  sourceUrl: string;
  category: string;
};

export const deckplateBriefs: DeckplateBrief[] = [
  {
    id: 'chaplain-corps-1775',
    kind: 'history',
    text: 'The Continental Congress authorized Navy chaplains in November 1775, placing ministry support near the beginning of American sea service.',
    attribution: 'U.S. Navy Chaplain Corps',
    sourceTitle: 'U.S. Navy Chaplain Corps History',
    sourceUrl: 'https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2169232/chaplain-corps/',
    category: 'Chaplain Corps',
  },
  {
    id: 'navy-birthday-1775',
    kind: 'history',
    text: 'The U.S. Navy traces its birthday to 13 October 1775, when Congress authorized vessels for the defense of the colonies.',
    attribution: 'Naval History and Heritage Command',
    sourceTitle: 'Navy Birthday',
    sourceUrl: 'https://www.history.navy.mil/browse-by-topic/commemorations-toolkits/navy-birthday.html',
    category: 'Navy History',
  },
  {
    id: 'marine-corps-1775',
    kind: 'history',
    text: 'The Marine Corps traces its founding to 10 November 1775, when the Second Continental Congress authorized two battalions of Marines.',
    attribution: 'United States Marine Corps',
    sourceTitle: 'Marine Corps History',
    sourceUrl: 'https://www.marines.mil/USMC-History/',
    category: 'Marine Corps History',
  },
  {
    id: 'uss-constitution',
    kind: 'history',
    text: 'USS Constitution, launched in 1797, remains a commissioned U.S. Navy warship and a living link to the early Navy.',
    attribution: 'Naval History and Heritage Command',
    sourceTitle: 'USS Constitution',
    sourceUrl: 'https://www.history.navy.mil/content/history/nhhc/browse-by-topic/ships/uss-constitution-americas-ship-of-state.html',
    category: 'Navy History',
  },
  {
    id: 'pearl-harbor-remembrance',
    kind: 'history',
    text: 'National Pearl Harbor Remembrance Day honors those killed or wounded during the attack on Pearl Harbor on 7 December 1941.',
    attribution: 'National Archives',
    sourceTitle: 'Pearl Harbor',
    sourceUrl: 'https://www.archives.gov/research/military/ww2/pearl-harbor',
    category: 'Remembrance',
  },
  {
    id: 'navy-nurse-corps',
    kind: 'history',
    text: 'Congress established the Navy Nurse Corps in 1908, expanding professional medical care across naval service.',
    attribution: 'Naval History and Heritage Command',
    sourceTitle: 'Navy Nurse Corps',
    sourceUrl: 'https://www.history.navy.mil/browse-by-topic/communities/navy-medicine/nurse-corps.html',
    category: 'Navy Medicine',
  },
  {
    id: 'seabees',
    kind: 'history',
    text: 'The Seabees were established during World War II to combine construction skill with military readiness in forward areas.',
    attribution: 'Naval History and Heritage Command',
    sourceTitle: 'Seabees',
    sourceUrl: 'https://www.history.navy.mil/browse-by-topic/communities/seabees.html',
    category: 'Navy Communities',
  },
  {
    id: 'naval-academy-1845',
    kind: 'history',
    text: 'The U.S. Naval Academy opened at Annapolis in 1845 to provide formal education for future naval officers.',
    attribution: 'United States Naval Academy',
    sourceTitle: 'History of USNA',
    sourceUrl: 'https://www.usna.edu/USNAHistory/',
    category: 'Education',
  },
  {
    id: 'iwo-jima',
    kind: 'history',
    text: 'The Battle of Iwo Jima in 1945 remains a defining Marine Corps campaign in the Pacific War.',
    attribution: 'National Museum of the Marine Corps',
    sourceTitle: 'Iwo Jima',
    sourceUrl: 'https://www.usmcmuseum.com/battle-of-iwo-jima.html',
    category: 'Marine Corps History',
  },
  {
    id: 'montford-point',
    kind: 'history',
    text: 'Montford Point Marines helped integrate the Marine Corps after serving during an era of segregated training.',
    attribution: 'National Museum of the Marine Corps',
    sourceTitle: 'Montford Point Marines',
    sourceUrl: 'https://www.usmcmuseum.com/montford-point-marines.html',
    category: 'Marine Corps History',
  },
  {
    id: 'women-in-navy',
    kind: 'history',
    text: 'Women have served the Navy in multiple capacities across war and peace, including the Navy Nurse Corps, WAVES, and today’s fleet.',
    attribution: 'Naval History and Heritage Command',
    sourceTitle: 'Women in the U.S. Navy',
    sourceUrl: 'https://www.history.navy.mil/browse-by-topic/diversity/women-in-the-navy.html',
    category: 'Service',
  },
  {
    id: 'navy-medicine',
    kind: 'history',
    text: 'Navy Medicine supports Sailors, Marines, and families through operational medicine, clinical care, research, and readiness.',
    attribution: 'U.S. Navy Bureau of Medicine and Surgery',
    sourceTitle: 'Navy Medicine',
    sourceUrl: 'https://www.med.navy.mil/',
    category: 'Navy Medicine',
  },
  {
    id: 'naval-history-command',
    kind: 'history',
    text: 'Naval History and Heritage Command preserves Navy records, artifacts, and histories for the fleet and the public.',
    attribution: 'Naval History and Heritage Command',
    sourceTitle: 'About NHHC',
    sourceUrl: 'https://www.history.navy.mil/about-us.html',
    category: 'History',
  },
  {
    id: 'marine-corps-values',
    kind: 'history',
    text: 'Honor, courage, and commitment are the Marine Corps core values used to frame conduct and professional identity.',
    attribution: 'United States Marine Corps',
    sourceTitle: 'Marine Corps Values',
    sourceUrl: 'https://www.marines.com/life-as-a-marine/standards/values.html',
    category: 'Professional Identity',
  },
];

export function briefForDate(teamMemberId: string, date = new Date()) {
  const localDate = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const seed = `${teamMemberId}:${localDate}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return deckplateBriefs[hash % deckplateBriefs.length];
}
