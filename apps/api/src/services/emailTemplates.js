import { getEnv } from '../config/env.js';

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Every interpolated value is escaped; vendor- or customer-supplied text cannot inject markup.
function layout({ heading, paragraphs, cta, footnote }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55;color:#263445">${escapeHtml(p)}</p>`).join('');
  const button = cta
    ? `<p style="margin:22px 0"><a href="${escapeHtml(cta.url)}" style="background:#147D73;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#F5F7FA;font-family:Inter,Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td><div style="font-weight:800;font-size:20px;color:#14243A;margin-bottom:18px">Town<span style="color:#147D73">Ant</span></div>
<h1 style="font-size:20px;color:#14243A;margin:0 0 14px">${escapeHtml(heading)}</h1>${body}${button}
${footnote ? `<p style="margin:18px 0 0;font-size:12px;color:#6b7785">${escapeHtml(footnote)}</p>` : ''}
</td></tr></table><p style="font-size:12px;color:#6b7785">TownAnt · Find local. Book confidently.</p></td></tr></table></body></html>`;
  const text = [heading, '', ...paragraphs, ...(cta ? ['', `${cta.label}: ${cta.url}`] : []), ...(footnote ? ['', footnote] : [])].join('\n');
  return { html, text };
}

const url = (path) => new URL(path, getEnv().APP_BASE_URL).toString();

export const templates = {
  otp_code: ({ code, minutes }) => ({
    subject: `${code} is your TownAnt verification code`,
    ...layout({
      heading: 'Your verification code',
      paragraphs: [`Enter this code to continue: ${code}`, `It expires in ${minutes} minutes and can be used once.`],
      footnote: "If you didn't request this code, you can ignore this email. TownAnt will never ask you to share it.",
    }),
  }),
  staff_invite: ({ token, companyName }) => ({
    subject: `Set up your TownAnt for Business account`,
    ...layout({
      heading: `Welcome to TownAnt for Business`,
      paragraphs: [`Your business ${companyName} has been approved. Use the secure link below to set your password and finish your profile.`],
      cta: { label: 'Set up my account', url: url(`/business/setup?token=${encodeURIComponent(token)}`) },
      footnote: 'This link expires in 72 hours and works once. TownAnt never emails passwords.',
    }),
  }),
  staff_added: ({ companyName }) => ({
    subject: `You now have access to ${companyName} on TownAnt`,
    ...layout({
      heading: 'New business added to your account',
      paragraphs: [`You can now manage ${companyName} in TownAnt for Business using your existing sign-in.`],
      cta: { label: 'Open TownAnt for Business', url: url('/business') },
    }),
  }),
  // Super Admins reset from the admin console; vendor staff from TownAnt for Business.
  password_reset: ({ token, area = 'business' }) => ({
    subject: area === 'admin' ? 'Reset your TownAnt Admin password' : 'Reset your TownAnt for Business password',
    ...layout({
      heading: 'Reset your password',
      paragraphs: ['Use the secure link below to choose a new password. All existing sessions will be signed out.'],
      cta: { label: 'Choose a new password', url: url(`/${area === 'admin' ? 'admin' : 'business'}/reset-password?token=${encodeURIComponent(token)}`) },
      footnote: "This link expires in 1 hour. If you didn't ask to reset your password, ignore this email.",
    }),
  }),
  application_received: ({ businessName }) => ({
    subject: 'We received your TownAnt vendor application',
    ...layout({
      heading: 'Application received',
      paragraphs: [`Thanks for applying to list ${businessName} on TownAnt. Our team will review it and email you with the outcome.`],
    }),
  }),
  application_decision: ({ businessName, status, reason }) => {
    const copy = {
      approved: ['Your application was approved', `${businessName} is approved. You will receive a separate email with secure setup instructions.`],
      rejected: ['Update on your application', `We are unable to approve ${businessName} at this time.`],
      info_requested: ['We need a little more information', `To continue reviewing ${businessName}, please reply to this email or submit a new application with the details below.`],
    }[status];
    return {
      subject: copy[0],
      ...layout({ heading: copy[0], paragraphs: [copy[1], ...(reason ? [`Note from the TownAnt team: ${reason}`] : [])] }),
    };
  },
  notification: ({ title, body, link }) => ({
    subject: title,
    ...layout({ heading: title, paragraphs: body ? [body] : [], cta: link ? { label: 'View details', url: url(link) } : undefined }),
  }),
};

export function renderEmail(template, payload) {
  const fn = templates[template];
  if (!fn) throw new Error(`Unknown email template ${template}`);
  return fn(payload);
}
