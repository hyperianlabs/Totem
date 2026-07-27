// Supabase Edge Function: check-inactive-accounts
//
// Runs on a daily schedule (via pg_cron, set up in migration-inactive-accounts.sql)
// — not triggered by any user action. Three passes each run:
//
//   1. Reset — any club that was warned but has since had real activity
//      (a save more recent than the warning) gets its warning cleared.
//   2. Warn — any club inactive for 365+ days with no warning sent yet
//      gets a warning email to its owner(s), and the warning timestamp
//      is recorded.
//   3. Flag — any club that was warned 30+ days ago and *still* has no
//      activity since gets flagged for removal and a final-notice email.
//      This NEVER deletes anything automatically — flagged clubs just
//      show up clearly in the app's Platform Admin panel for a human
//      to review and actually delete.
//
// ---------------------------------------------------------------------
// SETUP:
//   supabase functions deploy check-inactive-accounts --no-verify-jwt
//   supabase secrets set CRON_SECRET=<a long random string you make up>
// (RESEND_API_KEY / RESEND_FROM_ADDRESS are already set from the
// result-notification function — reused here, no need to set again.)
// Then see migration-inactive-accounts.sql for scheduling this to
// actually run automatically.
// ---------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const WARNING_AFTER_DAYS = 365;
const REMOVAL_GRACE_DAYS = 30;

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function sendEmail(to: string[], subject: string, html: string) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS") || "Totem <onboarding@resend.dev>";
  if (!resendApiKey || to.length === 0) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromAddress, to, subject, html }),
  });
}

async function ownerEmailsFor(orgId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("team_members")
    .select("email")
    .eq("org_id", orgId)
    .eq("role", "owner");
  return (data || []).map((o: any) => o.email).filter(Boolean);
}

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const warningCutoff = new Date(now.getTime() - WARNING_AFTER_DAYS * 86400000);
  const graceCutoff = new Date(now.getTime() - REMOVAL_GRACE_DAYS * 86400000);
  const results = { reset: 0, warned: 0, flagged: 0 };

  try {
    // ---------- Pass 1: reset clubs that came back after being warned ----------
    const { data: warnedOrgs } = await supabaseAdmin
      .from("organizations")
      .select("id, inactivity_warning_sent_at, org_state(updated_at)")
      .not("inactivity_warning_sent_at", "is", null);

    for (const org of warnedOrgs || []) {
      const stateUpdatedAt = (org as any).org_state?.updated_at;
      if (stateUpdatedAt && new Date(stateUpdatedAt) > new Date(org.inactivity_warning_sent_at as string)) {
        await supabaseAdmin.from("organizations").update({ inactivity_warning_sent_at: null, flagged_for_removal: false }).eq("id", org.id);
        results.reset++;
      }
    }

    // ---------- Pass 2: warn clubs inactive 365+ days, not yet warned ----------
    const { data: unwarnedOrgs } = await supabaseAdmin
      .from("organizations")
      .select("id, name, org_state(updated_at)")
      .is("inactivity_warning_sent_at", null);

    for (const org of unwarnedOrgs || []) {
      const stateUpdatedAt = (org as any).org_state?.updated_at;
      if (!stateUpdatedAt || new Date(stateUpdatedAt) > warningCutoff) continue;

      const emails = await ownerEmailsFor(org.id);
      if (emails.length === 0) continue;

      await sendEmail(
        emails,
        `Is ${org.name} still using Totem?`,
        `<div style="font-family:Arial,sans-serif;max-width:520px;">
          <h2>We haven't seen any activity from ${org.name} in a while</h2>
          <p>To keep things tidy, accounts with no activity for over a year get scheduled for removal.</p>
          <p><strong>If you're still using Totem, no action is needed</strong> — just log in and make any change (add a player, update a fixture, capture a result) within the next 30 days, and this warning clears automatically.</p>
          <p>If there's no activity in that time, your account will be flagged for review before anything is removed — a real person checks before any data is deleted.</p>
        </div>`
      );
      await supabaseAdmin.from("organizations").update({ inactivity_warning_sent_at: now.toISOString() }).eq("id", org.id);
      results.warned++;
    }

    // ---------- Pass 3: flag clubs whose grace period has passed ----------
    const { data: gracePeriodOrgs } = await supabaseAdmin
      .from("organizations")
      .select("id, name")
      .not("inactivity_warning_sent_at", "is", null)
      .eq("flagged_for_removal", false)
      .lt("inactivity_warning_sent_at", graceCutoff.toISOString());

    for (const org of gracePeriodOrgs || []) {
      await supabaseAdmin.from("organizations").update({ flagged_for_removal: true }).eq("id", org.id);

      const emails = await ownerEmailsFor(org.id);
      await sendEmail(
        emails,
        `Final notice: ${org.name} is scheduled for review`,
        `<div style="font-family:Arial,sans-serif;max-width:520px;">
          <h2>${org.name} has been flagged for removal</h2>
          <p>We warned you 30 days ago about inactivity, and haven't seen any activity since. Your account is now flagged for review.</p>
          <p>If you're still using Totem, log in and make any change right away to stop this.</p>
        </div>`
      );
      results.flagged++;
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("check-inactive-accounts error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
