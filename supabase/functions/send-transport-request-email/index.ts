// Supabase Edge Function: send-transport-request-email
//
// Called automatically when an away fixture is booked (or edited) —
// emails each relevant guardian a unique link to the public
// transport-response page, where they tap "Own transport" or "Bus"
// without needing to log in.
//
// Deploy with: supabase functions deploy send-transport-request-email
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
    const { recipients, sportName, opponent, date, time, venue, orgName } = await req.json();
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

    const dateLabel = date
      ? new Date(date + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : "";

    const results: { email: string; sent: boolean; error?: string }[] = [];

    for (const r of recipients) {
      if (!r.email || !r.token) continue;
      const link = `${SITE_URL}/transport-response.html?token=${r.token}`;
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#14201A;max-width:480px;">
          ${orgName ? `<p style="color:#5B6B63;font-size:12px;margin:0 0 14px;">${String(orgName).replace(/</g, "&lt;")}</p>` : ""}
          <h2 style="margin:0 0 4px;">Away game — transport needed</h2>
          <p style="font-size:14px;line-height:1.6;">
            ${r.playerName ? String(r.playerName).replace(/</g, "&lt;") : "Your child"} has been selected for
            ${sportName ? " " + String(sportName).replace(/</g, "&lt;") : ""} vs ${opponent ? String(opponent).replace(/</g, "&lt;") : "the opponent"}
            ${dateLabel ? " on " + dateLabel : ""}${time ? " at " + time : ""}${venue ? " — away at " + String(venue).replace(/</g, "&lt;") : ""}.
          </p>
          <p style="font-size:14px;line-height:1.6;">Please let us know how they'll be getting there — it only takes one tap, no login needed.</p>
          <p style="margin:24px 0;">
            <a href="${link}" style="background:#1F5C43;color:#fff;padding:12px 22px;border-radius:7px;text-decoration:none;font-weight:700;display:inline-block;">Confirm transport</a>
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
            subject: `Transport needed — ${sportName || "match"} vs ${opponent || "away game"}`,
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
    console.error("send-transport-request-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
