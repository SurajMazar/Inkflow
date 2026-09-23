/** Transactional email templates (HTML + plain text). All interpolated values are escaped. */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Replaces `@[Name](id)` mention tokens with `@Name` for display. */
export function plainMentions(body: string): string {
  return body.replace(/@\[([^\]]{1,80})\]\([A-Za-z0-9_-]{1,64}\)/g, '@$1');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

interface LayoutInput {
  preheader: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  quote?: string;
  footnote?: string;
}

function layout(input: LayoutInput): { html: string; text: string } {
  const paragraphs = input.paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`)
    .join('');
  const quote = input.quote
    ? `<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #6741d9;background:#f5f3ff;color:#333">${escapeHtml(input.quote)}</blockquote>`
    : '';
  const action = input.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:12px 20px;background:#6741d9;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(input.action.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#666;word-break:break-all">${escapeHtml(input.action.url)}</p>`
    : '';
  const footnote = input.footnote
    ? `<p style="margin:24px 0 0;font-size:12px;color:#888">${escapeHtml(input.footnote)}</p>`
    : '';
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e1e1e">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;padding:32px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 24px;font-weight:700;font-size:18px;color:#6741d9">Inkflow</p>
<h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(input.heading)}</h1>
${paragraphs}${quote}${action}${footnote}
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    input.heading,
    '',
    ...input.paragraphs.flatMap((p) => [p, '']),
    ...(input.quote ? [`> ${input.quote}`, ''] : []),
    ...(input.action ? [`${input.action.label}: ${input.action.url}`, ''] : []),
    ...(input.footnote ? [input.footnote] : []),
  ].join('\n');
  return { html, text };
}

export function verificationEmail(input: { name: string; url: string }): RenderedEmail {
  return {
    subject: 'Verify your email for Inkflow',
    ...layout({
      preheader: 'Confirm your email address to start using Inkflow.',
      heading: 'Confirm your email address',
      paragraphs: [
        `Hi ${input.name},`,
        'Please confirm your email address to finish setting up your Inkflow account.',
      ],
      action: { label: 'Verify email', url: input.url },
      footnote:
        'This link expires in 24 hours. If you did not create an account, you can ignore this email.',
    }),
  };
}

export function passwordResetEmail(input: { name: string; url: string }): RenderedEmail {
  return {
    subject: 'Reset your Inkflow password',
    ...layout({
      preheader: 'Use this link to choose a new password.',
      heading: 'Reset your password',
      paragraphs: [
        `Hi ${input.name},`,
        'We received a request to reset the password of your Inkflow account.',
      ],
      action: { label: 'Choose a new password', url: input.url },
      footnote:
        'This link expires in 1 hour and can be used once. If you did not request a password reset, you can ignore this email — your password stays unchanged.',
    }),
  };
}

export function workspaceInviteEmail(input: {
  inviterName: string;
  workspaceName: string;
  url: string;
  existingUser: boolean;
}): RenderedEmail {
  return {
    subject: `${input.inviterName} invited you to ${input.workspaceName} on Inkflow`,
    ...layout({
      preheader: `Join ${input.workspaceName} on Inkflow.`,
      heading: `Join ${input.workspaceName}`,
      paragraphs: input.existingUser
        ? [`${input.inviterName} added you to the workspace “${input.workspaceName}”.`]
        : [
            `${input.inviterName} invited you to collaborate in the workspace “${input.workspaceName}” on Inkflow.`,
          ],
      action: {
        label: input.existingUser ? 'Open workspace' : 'Accept invitation',
        url: input.url,
      },
      footnote: input.existingUser ? undefined : 'This invitation expires in 7 days.',
    }),
  };
}

export function boardSharedEmail(input: {
  inviterName: string;
  boardTitle: string;
  role: string;
  url: string;
  message?: string | null;
  existingUser: boolean;
}): RenderedEmail {
  return {
    subject: `${input.inviterName} shared “${truncate(input.boardTitle, 80)}” with you`,
    ...layout({
      preheader: `You can now ${input.role === 'VIEWER' ? 'view' : 'edit'} “${input.boardTitle}”.`,
      heading: 'A board was shared with you',
      paragraphs: [
        `${input.inviterName} gave you ${input.role.toLowerCase()} access to the board “${input.boardTitle}”.`,
        ...(input.existingUser
          ? []
          : ['Create an Inkflow account with this email address to open it.']),
      ],
      quote: input.message ?? undefined,
      action: { label: input.existingUser ? 'Open board' : 'Create account', url: input.url },
    }),
  };
}

export function mentionEmail(input: {
  actorName: string;
  boardTitle: string;
  body: string;
  url: string;
}): RenderedEmail {
  return {
    subject: `${input.actorName} mentioned you on “${truncate(input.boardTitle, 80)}”`,
    ...layout({
      preheader: truncate(plainMentions(input.body), 120),
      heading: `${input.actorName} mentioned you`,
      paragraphs: [`On the board “${input.boardTitle}”:`],
      quote: truncate(plainMentions(input.body), 1000),
      action: { label: 'View comment', url: input.url },
    }),
  };
}

export function commentEmail(input: {
  actorName: string;
  boardTitle: string;
  body: string;
  url: string;
  kind: 'comment' | 'reply' | 'resolved';
}): RenderedEmail {
  const verb =
    input.kind === 'comment'
      ? 'commented on'
      : input.kind === 'reply'
        ? 'replied on'
        : 'resolved a comment on';
  return {
    subject: `${input.actorName} ${verb} “${truncate(input.boardTitle, 80)}”`,
    ...layout({
      preheader: truncate(plainMentions(input.body), 120),
      heading: `${input.actorName} ${verb} a board`,
      paragraphs: [`Board: “${input.boardTitle}”`],
      quote: truncate(plainMentions(input.body), 1000),
      action: { label: 'Open board', url: input.url },
    }),
  };
}
