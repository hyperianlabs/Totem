// Supabase Edge Function: send-result-email
//
// Called from the app right after a fixture result is saved. Looks up the
// staff emails FOR THE CALLER'S OWN ORGANISATION from team_members, adds the
// relevant coach's email if one is set, and sends a result summary via Resend.
//
// SECURITY: the caller is authenticated from their own JWT (never trusted from
// the request body), and recipients are scoped to that caller's org_id. This
// prevents (a) any anon-key holder triggering sends and (b) one club's action
// broadcasting to — or disclosing — every other club's staff emails.
//
// Deploy with:
//   supabase functions deploy send-result-email
//
// Required secrets (set once with `supabase secrets set KEY=value`):
//   RESEND_API_KEY       — from resend.com (free tier is enough for a club)
//   RESEND_FROM_ADDRESS  — e.g. "Totem <results@yourclub.com>" (must be a
//                           domain you've verified in Resend, or use their
//                           shared onboarding@resend.dev sender for testing)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY — already set
//                           automatically by Supabase for every Edge Function.

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

// HTML-escape any value interpolated into an email body (player/opponent/venue
// names can contain <, >, &, quotes, or attacker-supplied markup).
function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

// Authenticate the caller from their JWT and return their org_id. The gateway's
// verify_jwt accepts the public anon key, so we must additionally confirm a real
// user session here — getUser() returns null for an anon-key-only caller.
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
  const heading = `${esc(payload.sportName)} — ${esc(payload.ageGroupLabel)}`;
  const sub = `vs ${esc(payload.opponent)}${dateLabel ? " · " + dateLabel : ""}${payload.venue ? " · " + esc(payload.venue) : ""}`;

  let body = "";
  if (payload.entries && payload.entries.length) {
    // individual sport: list of athlete/event/time/place
    const rows = payload.entries
      .map((en: any) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(en.name)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(en.event)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(en.time)}${en.place ? " · " + esc(en.place) + getOrdinalSuffix(Number(en.place)) : ""}</td></tr>`)
      .join("");
    body = `<table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>`;
  } else {
    // team sport: score + outcome + scorers
    const outcomeColor = payload.outcome === "WON" ? "#1F5C43" : payload.outcome === "LOST" ? "#C1542E" : "#B9840F";
    body = `
      <p style="font-size:20px;font-weight:700;margin:0 0 6px;">
        <span style="color:${outcomeColor};">${esc(payload.outcome)}</span>
        &nbsp;${esc(payload.scoreLine)}
      </p>
      ${payload.scorers && payload.scorers.length ? `<p style="font-size:14px;color:#5B6B63;margin:0;"><strong>Scorers:</strong> ${payload.scorers.map((s: unknown) => esc(s)).join(", ")}</p>` : ""}
    `;
  }

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#14201A;max-width:520px;">
      <h2 style="margin:0 0 2px;">${heading}</h2>
      <p style="color:#5B6B63;font-size:13px;margin:0 0 18px;">${sub}</p>
      ${body}
      <p style="color:#999;font-size:11px;margin-top:28px;">Sent automatically by Totem™.</p>
    </div>
  `;
}

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await requireOrgMember(req);
    if ("error" in auth) return auth.error;

    const payload = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Gather recipients: every staff member's email IN THE CALLER'S OWN ORG +
    // the specific coach's email if one was captured for this age group.
    const { data: members, error: membersError } = await supabaseAdmin
      .from("team_members")
      .select("email")
      .eq("org_id", auth.orgId);
    if (membersError) throw membersError;

    const recipients = new Set<string>();
    (members || []).forEach((m: any) => { if (m.email) recipients.add(m.email); });
    if (payload.coachEmail) recipients.add(payload.coachEmail);

    if (recipients.size === 0) {
      return jsonResponse({ warning: "No recipients found — is team_members populated?" });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS") || "Totem <onboarding@resend.dev>";
    if (!resendApiKey) throw new Error("RESEND_API_KEY secret is not set.");

    const html = buildEmailHtml(payload);
    const subject = `${payload.sportName} ${payload.ageGroupLabel} vs ${payload.opponent}${payload.scoreLine ? " — " + payload.scoreLine : ""}`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [...recipients],
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      throw new Error(`Resend API error: ${resendRes.status} ${errText}`);
    }

    // Return only a count — never the recipient list (that would disclose staff
    // emails back to the caller).
    return jsonResponse({ sent: true, count: recipients.size });
  } catch (err) {
    console.error("send-result-email error:", err);
    return jsonResponse({ error: "Failed to send result email." }, 500);
  }
});
