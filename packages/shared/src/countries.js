// ISO 3166-1 alpha-2 codes. Display names come from Intl.DisplayNames where available.
export const COUNTRY_CODES = Object.freeze(
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '),
);

let names;
export function countryName(code) {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

// US first (primary market), then alphabetical by name.
export function countryOptions() {
  const rest = COUNTRY_CODES.filter((c) => c !== 'US')
    .map((code) => ({ value: code, label: countryName(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: 'US', label: countryName('US') }, ...rest];
}
