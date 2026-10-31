import { requestJson } from './http.js';

// Sends an OTP using an approved WhatsApp "authentication" template. Such templates take the
// code as the body parameter and again for the copy-code/one-tap URL button.
export function createMetaWhatsApp({ accessToken, phoneNumberId, template, language, apiVersion }) {
  return {
    name: 'meta-whatsapp',
    async sendOtp({ to, code }) {
      const json = await requestJson('meta-whatsapp', `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: template,
            language: { code: language },
            components: [
              { type: 'body', parameters: [{ type: 'text', text: code }] },
              { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
            ],
          },
        },
      });
      return { id: json.messages?.[0]?.id };
    },
  };
}
