// Supabase Edge Function: consent-response
//
// Public, no login required — the guardian's browser talks to this when
// they open the emailed consent/indemnity link. Same security model as
// transport-response: the consent_records table has no direct public
// access at all; every read/write here is a service-role lookup scoped
// to an exact, unguessable token match.
//
// Two actions, both POST with a JSON body:
//   { action: "get", token }
//     -> returns the player/org context to render the form
//   { action: "submit", token, signatureName, relationship }
//     -> records the signature, and emails whoever's listed as
//        notify_email on that record (best-effort — a failed
//        notification email never blocks the guardian's own submission
//        from succeeding)
//
// Deploy with: supabase functions deploy consent-response --no-verify-jwt
// (No new secrets — uses the service role key already available to every
// Edge Function, plus your existing RESEND_API_KEY / RESEND_FROM_ADDRESS
// for the coach notification.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function notifyCoach(record: any) {
  if (!record.notify_email) return;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS") || "Totem <onboarding@resend.dev>";
  if (!resendApiKey) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [record.notify_email],
        subject: `Consent & indemnity signed — ${record.player_name}`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;color:#14201A;max-width:480px;">
            <p style="color:#5B6B63;font-size:12px;margin:0 0 14px;">${String(record.org_name || "").replace(/</g, "&lt;")}</p>
            <h2 style="margin:0 0 10px;">Consent & indemnity signed</h2>
            <p style="font-size:14px;line-height:1.6;">
              ${String(record.player_name).replace(/</g, "&lt;")}'s guardian has signed the POPIA consent and transport indemnity.
            </p>
            <p style="font-size:13px;color:#5B6B63;">Signed by: ${String(record.signature_name || "").replace(/</g, "&lt;")} (${String(record.relationship || "").replace(/</g, "&lt;")})</p>
          </div>
        `,
      }),
    });
  } catch (_err) {
    // Best-effort only — never block the guardian's submission over this.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, token, signatureName, relationship } = await req.json();

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get") {
      const { data, error } = await adminClient
        .from("consent_records")
        .select("player_name, sport_name, org_name, signed, signature_name, relationship, signed_at")
        .eq("token", token)
        .maybeSingle();

      if (error || !data) {
        return new Response(JSON.stringify({ error: "This link isn't valid — check you copied the whole link, or ask your club for a fresh one." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "submit") {
      if (!signatureName || !relationship) {
        return new Response(JSON.stringify({ error: "Name and relationship are required." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await adminClient
        .from("consent_records")
        .update({
          signed: true,
          signature_name: signatureName,
          relationship,
          signed_at: new Date().toISOString(),
        })
        .eq("token", token)
        .select("player_name, org_name, notify_email, signature_name, relationship")
        .maybeSingle();

      if (error || !data) {
        return new Response(JSON.stringify({ error: "This link isn't valid — check you copied the whole link, or ask your club for a fresh one." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await notifyCoach(data);

      return new Response(JSON.stringify({ ok: true, playerName: data.player_name }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("consent-response error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
