// Email notification utilities. Wraps AWS SES with safe defaults +
// a dev fallback that just console.logs when SES credentials aren't
// configured (so local dev doesn't try to send mail).
//
// Env vars required for real sending:
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
//   AWS_REGION              (defaults to us-east-1)
//   SES_FROM_EMAIL          (defaults to terry.tao@max-robotics.com —
//                            must be a verified SES identity)
//
// If any of the AWS_* vars are missing, sendEmail() no-ops to a
// console.log — letting the rest of the app run in dev / CI without
// triggering AWS bill or auth errors. Returns { ok: true, dev: true }
// in that mode so callers can tell.

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const FROM_EMAIL =
  process.env.SES_FROM_EMAIL ?? "terry.tao@max-robotics.com";
const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";

let cachedClient: SESClient | null = null;
function client(): SESClient | null {
  if (cachedClient) return cachedClient;
  // Only attempt to construct an SES client when we have credentials
  // — the SDK happily constructs without them but throws at send time
  // with a less-obvious error. Better to bail early in dev.
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return null;
  }
  cachedClient = new SESClient({ region: AWS_REGION });
  return cachedClient;
}

export type EmailResult =
  | { ok: true; messageId: string }
  | { ok: true; dev: true } // logged-but-not-sent, env not configured
  | { ok: false; error: string };

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}): Promise<EmailResult> {
  const ses = client();
  if (!ses) {
    console.log(
      `[email/dev] would send to=${opts.to} subject="${opts.subject}"`,
    );
    return { ok: true, dev: true };
  }
  try {
    const res = await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [opts.to] },
        ReplyToAddresses: opts.replyTo ? [opts.replyTo] : undefined,
        Message: {
          Subject: { Data: opts.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: opts.text, Charset: "UTF-8" },
            ...(opts.html
              ? { Html: { Data: opts.html, Charset: "UTF-8" } }
              : {}),
          },
        },
      }),
    );
    return { ok: true, messageId: res.MessageId ?? "" };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "send failed" };
  }
}

// ── Match notifications ────────────────────────────────────────────
// Sent after matchPosition() inserts/updates Match rows. Two emails
// per match:
//   • candidate → "you matched this position"
//   • PI       → "new candidate match for your position"
// Both are short, fact-only — no salesy filler. Each carries a deep
// link back to the talent surface.

export async function sendMatchNotification(opts: {
  candidate: { email: string; name: string };
  pi: { email: string; name: string };
  positionTitle: string;
  positionInstitution: string;
  positionId: string;
  candidateId: string;
  score: number;
  reasons: string[];
}): Promise<{ candidate: EmailResult; pi: EmailResult }> {
  const baseUrl = "https://www.max-papers.com";
  const positionUrl = `${baseUrl}/talent/positions/${opts.positionId}`;
  const candidateUrl = `${baseUrl}/talent/profile/${opts.candidateId}`;

  const reasonsText =
    opts.reasons.length > 0
      ? "\nMatch reasons:\n" + opts.reasons.map((r) => `  • ${r}`).join("\n")
      : "";

  // Candidate-facing
  const candidateRes = await sendEmail({
    to: opts.candidate.email,
    subject: `New match: ${opts.positionTitle} at ${opts.positionInstitution}`,
    text:
      `Hi ${opts.candidate.name},\n\n` +
      `You matched a position on maxpaper:\n\n` +
      `  ${opts.positionTitle}\n` +
      `  ${opts.positionInstitution}\n` +
      `  Match score: ${opts.score}/100${reasonsText}\n\n` +
      `View and apply:\n${positionUrl}\n\n` +
      `— maxpaper talent`,
  });

  // PI-facing
  const piRes = await sendEmail({
    to: opts.pi.email,
    subject: `New candidate match: ${opts.candidate.name} (score ${opts.score})`,
    text:
      `Hi ${opts.pi.name},\n\n` +
      `A researcher matched your open position:\n\n` +
      `  ${opts.candidate.name}\n` +
      `  Match score: ${opts.score}/100${reasonsText}\n\n` +
      `Profile:\n${candidateUrl}\n\n` +
      `Position:\n${positionUrl}\n\n` +
      `— maxpaper talent`,
  });

  return { candidate: candidateRes, pi: piRes };
}
