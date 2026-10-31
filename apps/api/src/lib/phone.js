import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { badRequest } from './errors.js';

// Normalizes an international phone number to E.164. A default country lets users type national format.
export function normalizePhone(raw, defaultCountry) {
  const parsed = parsePhoneNumberFromString(String(raw ?? ''), defaultCountry || undefined);
  if (!parsed || !parsed.isValid()) throw badRequest('Enter a valid mobile number including the country code.');
  const type = parsed.getType();
  // Landlines cannot receive WhatsApp messages; unknown types are allowed because metadata is incomplete for some regions.
  if (type && !['MOBILE', 'FIXED_LINE_OR_MOBILE', 'PERSONAL_NUMBER', 'VOIP'].includes(type)) {
    throw badRequest('Enter a mobile number that can receive WhatsApp messages.');
  }
  return parsed.number;
}
