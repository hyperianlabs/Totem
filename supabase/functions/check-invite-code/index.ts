// Supabase Edge Function: check-invite-code
//
// Public, no login required — this is what the "Join an existing club"
// signup step calls to preview a club's name before someone commits to
// joining it. The invite code itself is the front door to becoming staff
// on a real club (and getting access to its players'/minors' data), so
// this can't be a plain, unthrottled RPC: a scripted client could
// otherwise hammer it to enumerate club names or eventually land a valid
// code. This function is the only path in — the underlying
// get_org_name_for_invite_code() RPC has anon/authenticated execute
// revoked (see migration 20260804151407), so this service-role lookup is
// the sole way to resolve a code.
//
// Rate limit: 15 attempts per IP per 10 minutes. Attempts are logged in
// invite_code_attempts and pruned of anything older than a day on every
// call, so the table never grows unbounded.
//
// Deploy with: supabase functions deploy check-invite-code --no-verify-jwt
// (No new secrets — uses the standard service role key already available
// to every Edge Function.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(supabaseUrl, serviceRoleKey);

const MAX_ATTEMPTS = 15;
const WINDOW_MINUTES = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "unknown";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return new Response(JSON.stringify({ error: "Missing invite code." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip = clientIp(req);
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

    // Prune anything older than a day — keeps the table from growing
    // unbounded without needing a separate cron job for it.
    await adminClient
      .from("invite_code_attempts")
      .delete()
      .lt("attempted_at", new Date(Date.now() - 86_400_000).toISOString());

    const { count } = await adminClient
      .from("invite_code_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("attempted_at", windowStart);

    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return new Response(JSON.stringify({ error: "Too many attempts — please wait a few minutes and try again." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await adminClient.from("invite_code_attempts").insert({ ip });

    const { data } = await adminClient
      .from("organizations")
      .select("name")
      .eq("invite_code", code)
      .maybeSingle();

    return new Response(JSON.stringify({ ok: true, name: data?.name || null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("check-invite-code error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
