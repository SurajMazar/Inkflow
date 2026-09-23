import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppConfig } from '../config/app-config';
import type { RenderedEmail } from './templates';

export interface OutgoingEmail extends RenderedEmail {
  to: string;
  /** Primary link of the email; logged when no SMTP server is configured. */
  link?: string;
}

/** Sends transactional email via SMTP; logs subject + link when SMTP is not configured. */
@Injectable()
export class MailService implements OnApplicationShutdown {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(config: AppConfig) {
    const env = config.env;
    this.from = env.MAIL_FROM;
    this.transport = env.SMTP_HOST
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } } : {}),
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        })
      : null;
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  /** Sends an email. Never throws: delivery problems must not fail the triggering request. */
  async send(email: OutgoingEmail): Promise<boolean> {
    if (!this.transport) {
      this.logger.log(
        `[mail disabled] to=${email.to} subject="${email.subject}"${email.link ? ` link=${email.link}` : ''}`,
      );
      return false;
    }
    try {
      await this.transport.sendMail({
        from: this.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send "${email.subject}" to ${email.to}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Fire-and-forget variant for notifications. */
  sendInBackground(email: OutgoingEmail): void {
    void this.send(email);
  }

  onApplicationShutdown(): void {
    this.transport?.close();
  }
}
