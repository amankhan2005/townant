// Legal documents. No approved Terms of use or Privacy notice exists yet (docs/REQUIREMENTS_TRACKER.md
// S-13 / W-18: requires counsel), so the app never shows invented legal text:
//  - When EXPO_PUBLIC_TERMS_URL / EXPO_PUBLIC_PRIVACY_URL point at the approved, published documents
//    (the same documents as the website's VITE_TERMS_URL / VITE_PRIVACY_URL), the screen links to them.
//  - Otherwise it shows the document's structure, clearly marked as awaiting legal review. Approved
//    text can be dropped into `body` (paragraphs, or `['list', ...items]` for a bulleted list) and the
//    screen formats it — no layout change needed.
const httpsUrl = (v) => (typeof v === 'string' && /^https:\/\/\S+$/.test(v.trim()) ? v.trim() : null);

export const LEGAL = {
  terms: {
    title: 'Terms & Conditions',
    url: httpsUrl(process.env.EXPO_PUBLIC_TERMS_URL),
    sections: ['About TownAnt', 'Your account', 'Booking with businesses', 'Payments', 'Cancellations and changes', 'Reviews', 'Acceptable use', 'Liability', 'Changes to these terms', 'Contact'].map((heading) => ({ heading, body: null })),
  },
  privacy: {
    title: 'Privacy Policy',
    url: httpsUrl(process.env.EXPO_PUBLIC_PRIVACY_URL),
    sections: ['Who we are', 'Information we collect', 'How we use information', 'Sharing with businesses', 'Your choices and rights', 'Retention', 'Security', 'Children', 'Changes to this notice', 'Contact'].map((heading) => ({ heading, body: null })),
  },
};
