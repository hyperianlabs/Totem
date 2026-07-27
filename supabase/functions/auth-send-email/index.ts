// Supabase Edge Function: auth-send-email
//
// This is a "Send Email" Auth Hook — Supabase calls this function instead
// of using its own built-in email sender for every auth email (signup
// confirmation, password reset, magic link, email change). Totem-branded
// HTML is built here and sent via the same Resend account already used
// for result and fixture-booking emails.
//
// ---------------------------------------------------------------------
// SETUP:
//
// 1. Deploy this function (note --no-verify-jwt — this runs BEFORE a
//    user has a session, so it can't require one):
//      supabase functions deploy auth-send-email --no-verify-jwt
//
// 2. In Supabase Dashboard → Authentication → Hooks, find "Send Email",
//    switch it on, choose "HTTPS" as the hook type, and point it at:
//      https://YOUR-PROJECT-REF.supabase.co/functions/v1/auth-send-email
//    Supabase will generate a secret for you automatically at this step
//    — copy it (starts with "v1,whsec_").
//
// 3. Set that secret, plus your existing Resend secrets (reused, no need
//    to set them again if send-result-email already has them):
//      supabase secrets set SEND_EMAIL_HOOK_SECRET=v1,whsec_...
//
// 4. Test it: trigger a real signup or "forgot password" and confirm a
//    Totem-branded email arrives instead of Supabase's default one.
// ---------------------------------------------------------------------

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const hookSecretRaw = Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "";
const hookSecret = hookSecretRaw.replace("v1,whsec_", "");
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS") || "Totem <onboarding@resend.dev>";

interface EmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
}

function buildVerifyUrl(emailData: EmailData, tokenHash: string, actionType: string): string {
  const params = new URLSearchParams({
    token: tokenHash,
    type: actionType,
    redirect_to: emailData.redirect_to || emailData.site_url,
  });
  return `${supabaseUrl}/auth/v1/verify?${params.toString()}`;
}

function buildEmailContent(actionType: string, verifyUrl: string, userEmail: string): { subject: string; html: string } {
  const logoUrl = "https://totem.hyperianlabs.com/totem-logo.png";
  const wrap = (heading: string, body: string, buttonLabel: string) => `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#14201A;max-width:480px;">
      <img src="${logoUrl}" alt="Totem" width="140" style="width:140px; height:auto; display:block; margin:0 0 8px;">
      <p style="color:#5B6B63;font-size:13px;margin:0 0 20px;">Build your team, block by block.</p>
      <h3 style="margin:0 0 10px;">${heading}</h3>
      <p style="font-size:14px;line-height:1.6;">${body}</p>
      <p style="margin:24px 0;">
        <a href="${verifyUrl}" style="background:#1F5C43;color:#fff;padding:12px 22px;border-radius:7px;text-decoration:none;font-weight:700;display:inline-block;">${buttonLabel}</a>
      </p>
      <p style="font-size:11px;color:#999;word-break:break-all;">If the button doesn't work, copy and paste this link: ${verifyUrl}</p>
      <p style="font-size:11px;color:#999;margin-top:24px;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;

  switch (actionType) {
    case "signup":
      return {
        subject: "Confirm your email for Totem",
        html: wrap(
          "Confirm your email address",
          `Follow the link below to confirm ${userEmail} and finish setting up your Totem account.`,
          "Confirm email address"
        ),
      };
    case "recovery":
      return {
        subject: "Reset your Totem password",
        html: wrap(
          "Reset your password",
          "Someone (hopefully you) requested a password reset for your Totem account. Follow the link below to choose a new password.",
          "Reset password"
        ),
      };
    case "magiclink":
      return {
        subject: "Your Totem login link",
        html: wrap(
          "Log in to Totem",
          "Follow the link below to log in — no password needed.",
          "Log in"
        ),
      };
    case "email_change":
      return {
        subject: "Confirm your new email for Totem",
        html: wrap(
          "Confirm your new email address",
          "Follow the link below to confirm this is your new email address for your Totem account.",
          "Confirm new email"
        ),
      };
    case "invite":
      return {
        subject: "You've been invited to Totem",
        html: wrap(
          "You've been invited",
          "Follow the link below to accept your invitation and set up your account.",
          "Accept invitation"
        ),
      };
    default:
      return {
        subject: "Totem — action required",
        html: wrap("Confirm this action", "Follow the link below to continue.", "Continue"),
      };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("not allowed", { status: 400 });
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  try {
    const wh = new Webhook(hookSecret);
    const { user, email_data } = wh.verify(payload, headers) as {
      user: { email: string };
      email_data: EmailData;
    };

    const actionType = email_data.email_action_type;
    const tokenHash = actionType === "email_change" && email_data.token_hash_new
      ? email_data.token_hash_new
      : email_data.token_hash;

    const verifyUrl = buildVerifyUrl(email_data, tokenHash, actionType);
    const { subject, html } = buildEmailContent(actionType, verifyUrl, user.email);

    if (!resendApiKey) throw new Error("RESEND_API_KEY secret is not set.");

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [user.email],
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      throw new Error(`Resend API error: ${resendRes.status} ${errText}`);
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auth-send-email error:", err);
    // Per Supabase's Auth Hooks spec, a non-2xx response here means the
    // triggering auth action (signup, password reset, etc.) is blocked
    // entirely — so a real failure here should surface loudly, not fail
    // silently, since it means someone is stuck unable to sign up or log in.
    return new Response(
      JSON.stringify({
        error: {
          http_code: 500,
          message: "Failed to send email: " + String(err),
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
