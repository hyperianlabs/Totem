// Supabase Edge Function: send-consent-request-email
//
// Sends a guardian the link to sign the POPIA consent + transport
// indemnity form — triggered automatically when a new player is added,
// or in bulk from Club Settings for existing players.
//
// Deploy with: supabase functions deploy send-consent-request-email
// (No new secrets — reuses your existing RESEND_API_KEY / RESEND_FROM_ADDRESS.)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "https://totem.hyperianlabs.com";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { recipients, orgName } = await req.json();
    // recipients: [{ email, token, playerName }]

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return new Response(JSON.stringify({ error: "No recipients provided." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS") || "Totem <onboarding@resend.dev>";
    if (!resendApiKey) throw new Error("RESEND_API_KEY secret is not set.");

    const results: { email: string; sent: boolean; error?: string }[] = [];

    for (const r of recipients) {
      if (!r.email || !r.token) continue;
      const link = `${SITE_URL}/consent-response.html?token=${r.token}`;
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#14201A;max-width:480px;">
          ${orgName ? `<p style="color:#5B6B63;font-size:12px;margin:0 0 14px;">${String(orgName).replace(/</g, "&lt;")}</p>` : ""}
          <h2 style="margin:0 0 10px;">Consent & indemnity — ${r.playerName ? String(r.playerName).replace(/</g, "&lt;") : "your child"}</h2>
          <p style="font-size:14px;line-height:1.6;">
            To register ${r.playerName ? String(r.playerName).replace(/</g, "&lt;") : "your child"} as a player, we need your consent to process their information (POPIA), and your agreement to our transport indemnity for away fixtures.
          </p>
          <p style="font-size:14px;line-height:1.6;">It takes about a minute — no login needed, just read the two short sections and sign electronically.</p>
          <p style="margin:24px 0;">
            <a href="${link}" style="background:#1F5C43;color:#fff;padding:12px 22px;border-radius:7px;text-decoration:none;font-weight:700;display:inline-block;">Review & sign</a>
          </p>
          <p style="font-size:11px;color:#999;word-break:break-all;">If the button doesn't work, copy and paste this link: ${link}</p>
        </div>
      `;

      try {
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [r.email],
            subject: `Action needed: consent & indemnity for ${r.playerName || "your child"}`,
            html,
          }),
        });
        if (!resendRes.ok) {
          const errText = await resendRes.text();
          results.push({ email: r.email, sent: false, error: errText });
        } else {
          results.push({ email: r.email, sent: true });
        }
      } catch (err) {
        results.push({ email: r.email, sent: false, error: String(err) });
      }
    }

    const sentCount = results.filter((r) => r.sent).length;
    return new Response(JSON.stringify({ ok: true, sentCount, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-consent-request-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
