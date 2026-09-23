import { describe, expect, it } from 'vitest';
import {
  boardSharedEmail,
  escapeHtml,
  mentionEmail,
  plainMentions,
  verificationEmail,
} from './templates';

describe('email templates', () => {
  it('escapes user-controlled content in HTML', () => {
    const mail = boardSharedEmail({
      inviterName: '<script>x</script>',
      boardTitle: 'Plan "A" & B',
      role: 'EDITOR',
      url: 'https://app.test/boards/1?a=1&b=2',
      message: '<img src=x onerror=alert(1)>',
      existingUser: true,
    });
    expect(mail.html).not.toContain('<script>x</script>');
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.text).toContain('https://app.test/boards/1?a=1&b=2');
    expect(escapeHtml(`'"&<>`)).toBe('&#39;&quot;&amp;&lt;&gt;');
  });

  it('renders links and mentions', () => {
    const verify = verificationEmail({
      name: 'Ada',
      url: 'https://app.test/verify-email?token=abc',
    });
    expect(verify.subject).toBe('Verify your email for Inkflow');
    expect(verify.text).toContain('https://app.test/verify-email?token=abc');
    expect(plainMentions('Hi @[Bob Smith](u1)!')).toBe('Hi @Bob Smith!');
    expect(
      mentionEmail({ actorName: 'Ada', boardTitle: 'B', body: '@[Bob](u1) look', url: 'u' }).text,
    ).toContain('@Bob look');
  });
});
