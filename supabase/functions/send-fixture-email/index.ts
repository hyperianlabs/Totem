// Supabase Edge Function: send-fixture-email
//
// Called from the app every time a fixture is booked or edited. Sends ONE
// email per coach (not per side — a head coach covering multiple sides of
// the same fixture gets a single email listing all of them, not several
// separate ones) containing the team sheet(s) they're responsible for,
// plus the fixture's date, time, and venue.
//
// SECURITY: the caller is authenticated from their own JWT before anything is
// sent, so only a logged-in Totem staff member can trigger a send (not any
// holder of the public anon key). All caller-supplied values are HTML-escaped
// into the email body.
//
// Deploy with:
//   supabase functions deploy send-fixture-email
//
// Reuses the same secrets already set up for send-result-email — no new
// secrets needed if that's already working:
//   RESEND_API_KEY, RESEND_FROM_ADDRESS

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

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

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

function formatDateLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function buildEmailHtml(payload: any): string {
  const dateLabel = formatDateLabel(payload.date);
  const sub = `vs ${esc(payload.opponent)}${dateLabel ? " · " + dateLabel : ""}${payload.time ? " · " + esc(payload.time) : ""}${payload.venue ? " · " + esc(payload.venue) : ""}`;

  const sidesHtml = (payload.sides || []).map((side: any) => {
    const rows = (side.rows || [])
      .map((r: any) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#5B6B63;font-size:11px;text-transform:uppercase;">${esc(r.position)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;">${esc(r.name)}</td></tr>`)
      .join("");
    const benchLine = side.bench && side.bench.length ? `<p style="font-size:13px;color:#5B6B63;margin:10px 0 0;"><strong>Bench:</strong> ${side.bench.map((b: unknown) => esc(b)).join(", ")}</p>` : "";
    return `
      <h3 style="margin:22px 0 8px;font-size:16px;">${esc(side.sideLabel)}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
      ${benchLine}
    `;
  }).join("");

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#14201A;max-width:520px;">
      <h2 style="margin:0 0 2px;">${esc(payload.sportName)}</h2>
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
    const auth = await requireOrgMember(req);
    if ("error" in auth) return auth.error;

    const payload = await req.json();

    if (!payload.coachEmail) {
      return jsonResponse({ warning: "No coach email provided — nothing sent." });
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

    return jsonResponse({ sent: true, to: payload.coachEmail });
  } catch (err) {
    console.error("send-fixture-email error:", err);
    return jsonResponse({ error: "Failed to send fixture email." }, 500);
  }
});
