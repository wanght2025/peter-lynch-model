const AH_PAIRS: Record<string, string> = {
  '002594': '01211',
  '01211': '002594',
  '600941': '00941',
  '00941': '600941',
  '601988': '03988',
  '03988': '601988',
};

export function ahPairCode(code: string) {
  return AH_PAIRS[code];
}
