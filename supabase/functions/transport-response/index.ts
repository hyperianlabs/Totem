// Supabase Edge Function: transport-response
//
// Public, no login required — this is what the guardian's browser talks
// to when they tap the link in a transport request email. It's the ONLY
// way to read or write a transport_responses row from outside your club's
// own staff, and it enforces that by requiring an exact token match,
// looked up here using the service role key (the table itself has no
// policy allowing direct public access at all — see
// migration-transport-responses.sql for the full reasoning).
//
// Two actions, both POST with a JSON body:
//   { action: "get", token }             -> returns the fixture/player
//                                            context to show on the page
//   { action: "submit", token, choice }  -> records "own" or "bus"
//
// Deploy with: supabase functions deploy transport-response --no-verify-jwt
// (No new secrets — uses the standard service role key already available
// to every Edge Function.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, token, choice } = await req.json();

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get") {
      const { data, error } = await adminClient
        .from("transport_responses")
        .select("player_name, sport_name, opponent, fixture_date, fixture_time, venue, choice, responded_at")
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
      if (choice !== "own" && choice !== "bus" && choice !== "unavailable") {
        return new Response(JSON.stringify({ error: "Invalid choice." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await adminClient
        .from("transport_responses")
        .update({ choice, responded_at: new Date().toISOString() })
        .eq("token", token)
        .select("player_name")
        .maybeSingle();

      if (error || !data) {
        return new Response(JSON.stringify({ error: "This link isn't valid — check you copied the whole link, or ask your club for a fresh one." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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
    console.error("transport-response error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
