import { Service } from 'typedi';
import { Resend } from 'resend';
import { config } from '../config';
import logger from '../utils/logger';

@Service()
export class EmailService {
  private resend: Resend;

  constructor() {
    this.resend = new Resend(config.resend.apiKey);
  }

  async sendOtp(email: string, otp: string): Promise<void> {
    await this.send({
      to: email,
      subject: 'Your PhotoGigs OTP',
      html: `
        <h2>Verify your email</h2>
        <p>Your one-time password is: <strong style="font-size:24px">${otp}</strong></p>
        <p>This OTP expires in 10 minutes.</p>
      `,
    });
  }

  async sendApprovalEmail(email: string, firstName: string): Promise<void> {
    await this.send({
      to: email,
      subject: 'Your PhotoGigs account has been approved!',
      html: `
        <h2>Welcome to PhotoGigs, ${firstName}!</h2>
        <p>Your account has been verified and approved. You can now post jobs and submit proposals.</p>
        <a href="${config.frontendUrl}/dashboard">Go to Dashboard</a>
      `,
    });
  }

  async sendRejectionEmail(email: string, firstName: string): Promise<void> {
    await this.send({
      to: email,
      subject: 'PhotoGigs – Account Verification Update',
      html: `
        <h2>Hi ${firstName},</h2>
        <p>We were unable to verify your ID document. Please re-upload a valid government-issued ID.</p>
        <a href="${config.frontendUrl}/upload-id">Re-upload ID</a>
      `,
    });
  }

  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    await this.send({
      to: email,
      subject: 'PhotoGigs – Password Reset OTP',
      html: `
        <h2>Reset your password</h2>
        <p>Your OTP is: <strong style="font-size:24px">${otp}</strong></p>
        <p>Expires in 10 minutes. If you did not request this, ignore this email.</p>
      `,
    });
  }

  async sendProposalAccepted(
    email: string,
    firstName: string,
    jobTitle: string
  ): Promise<void> {
    await this.send({
      to: email,
      subject: `Your proposal was accepted – ${jobTitle}`,
      html: `<p>Hi ${firstName}, your proposal for <strong>${jobTitle}</strong> was accepted. Log in to get started.</p>`,
    });
  }

  private async send(opts: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    try {
      await this.resend.emails.send({
        from: config.resend.from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
    } catch (err) {
      // Email failure must never crash the main flow – log and continue
      logger.error('Email send failed', { to: opts.to, subject: opts.subject, err });
    }
  }
}
