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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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
