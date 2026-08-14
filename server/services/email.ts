import { Resend } from 'resend';

export interface EmailAdapter {
  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>;
}

export function createResendEmailAdapter(apiKey: string, fromEmail: string): EmailAdapter {
  const resend = new Resend(apiKey);

  return {
    async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
      await resend.emails.send({
        from: fromEmail,
        to,
        subject: '비밀번호 재설정 안내',
        html: `<p>아래 링크를 눌러 비밀번호를 재설정하세요. 이 링크는 30분간 유효합니다.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
      });
    },
  };
}

export function createFakeEmailAdapter(): EmailAdapter & { sentEmails: Array<{ to: string; resetUrl: string }> } {
  const sentEmails: Array<{ to: string; resetUrl: string }> = [];
  return {
    sentEmails,
    async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
      sentEmails.push({ to, resetUrl });
    },
  };
}
