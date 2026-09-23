// Supabase Edge Function: send-season-summary-email
//
// Sends a season summary to every relevant guardian and coach at once —
// unlike WhatsApp (which needs each contact sent individually, a real
// platform limitation, not a shortcut), email genuinely can be sent to
// everyone in one action, since it goes through this server rather than
// the coach's own phone.
//
// Deploy with: supabase functions deploy send-season-summary-email
// (No new secrets — reuses your existing RESEND_API_KEY / RESEND_FROM_ADDRESS.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Authenticate the caller from their JWT before sending anything. The gateway's
// verify_jwt accepts the public anon key, so we confirm a real user session here
// — otherwise this function is an open, Totem-branded email relay.
async function requireOrgMember(
  req: Request
): Promise<{ orgId: string } | { error: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: jsonResponse({ error: "Missing Authorization header." }, 401) };

  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return { error: jsonResponse({ error: "Not authenticated." }, 401) };

  const { data: membership } = await callerClient
    .from("team_members")
    .select("org_id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!membership?.org_id) return { error: jsonResponse({ error: "Not a member of any organisation." }, 403) };
  return { orgId: membership.org_id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await requireOrgMember(req);
    if ("error" in auth) return auth.error;

    const { recipients, subject, message, orgName } = await req.json();

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return new Response(JSON.stringify({ error: "No recipients provided." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS") || "Totem <onboarding@resend.dev>";
    if (!resendApiKey) throw new Error("RESEND_API_KEY secret is not set.");

    // Plain text -> simple HTML (preserve line breaks, keep it readable).
    const htmlBody = String(message || "")
      .split("\n")
      .map((line: string) => line.length ? `<p style="margin:0 0 8px;">${line.replace(/</g, "&lt;")}</p>` : "<br>")
      .join("");

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#14201A;max-width:480px;">
        ${orgName ? `<p style="color:#5B6B63;font-size:12px;margin:0 0 14px;">${String(orgName).replace(/</g, "&lt;")}</p>` : ""}
        ${htmlBody}
        <p style="font-size:11px;color:#999;margin-top:24px;">Sent via Totem™.</p>
      </div>
    `;

    // Sent individually (not one email with everyone in "to"), so no
    // recipient can see anyone else's address.
    const results: { email: string; sent: boolean; error?: string }[] = [];
    for (const email of recipients) {
      try {
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [email],
            subject: subject || "Season summary",
            html,
          }),
        });
        if (!resendRes.ok) {
          const errText = await resendRes.text();
          results.push({ email, sent: false, error: errText });
        } else {
          results.push({ email, sent: true });
        }
      } catch (err) {
        results.push({ email, sent: false, error: String(err) });
      }
    }

    const sentCount = results.filter((r) => r.sent).length;
    return new Response(JSON.stringify({ ok: true, sentCount, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-season-summary-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
