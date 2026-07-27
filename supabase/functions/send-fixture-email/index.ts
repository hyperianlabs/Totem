// Supabase Edge Function: send-fixture-email
//
// Called from the app every time a fixture is booked or edited. Sends ONE
// email per coach (not per side — a head coach covering multiple sides of
// the same fixture gets a single email listing all of them, not several
// separate ones) containing the team sheet(s) they're responsible for,
// plus the fixture's date, time, and venue.
//
// Deploy with:
//   supabase functions deploy send-fixture-email
//
// Reuses the same secrets already set up for send-result-email — no new
// secrets needed if that's already working:
//   RESEND_API_KEY, RESEND_FROM_ADDRESS

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatDateLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function buildEmailHtml(payload: any): string {
  const dateLabel = formatDateLabel(payload.date);
  const sub = `vs ${payload.opponent}${dateLabel ? " · " + dateLabel : ""}${payload.time ? " · " + payload.time : ""}${payload.venue ? " · " + payload.venue : ""}`;

  const sidesHtml = (payload.sides || []).map((side: any) => {
    const rows = (side.rows || [])
      .map((r: any) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#5B6B63;font-size:11px;text-transform:uppercase;">${r.position}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;">${r.name}</td></tr>`)
      .join("");
    const benchLine = side.bench && side.bench.length ? `<p style="font-size:13px;color:#5B6B63;margin:10px 0 0;"><strong>Bench:</strong> ${side.bench.join(", ")}</p>` : "";
    return `
      <h3 style="margin:22px 0 8px;font-size:16px;">${side.sideLabel}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
      ${benchLine}
    `;
  }).join("");

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#14201A;max-width:520px;">
      <h2 style="margin:0 0 2px;">${payload.sportName}</h2>
      <p style="color:#5B6B63;font-size:13px;margin:0 0 8px;">${sub}</p>
      ${sidesHtml}
      <p style="color:#999;font-size:11px;margin-top:28px;">Sent automatically by Totem™ — you're receiving this as the coach for this team.</p>
    </div>
  `;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();

    if (!payload.coachEmail) {
      return new Response(JSON.stringify({ warning: "No coach email provided — nothing sent." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS") || "Totem <onboarding@resend.dev>";
    if (!resendApiKey) throw new Error("RESEND_API_KEY secret is not set.");

    const html = buildEmailHtml(payload);
    const sideLabels = (payload.sides || []).map((s: any) => s.sideLabel).join(", ");
    const subject = `${payload.sportName} vs ${payload.opponent} — ${sideLabels} team sheet`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [payload.coachEmail],
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      throw new Error(`Resend API error: ${resendRes.status} ${errText}`);
    }

    return new Response(JSON.stringify({ sent: true, to: payload.coachEmail }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
