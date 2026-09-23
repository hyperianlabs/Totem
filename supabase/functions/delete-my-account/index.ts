// Supabase Edge Function: delete-my-account
//
// Lets ANY logged-in user permanently delete their own account and personal
// data from within the app — a hard requirement for both the Apple App Store
// (Guideline 5.1.1(v)) and Google Play. This is separate from "delete the
// club": a coach/assistant who joined via invite code has no club to delete,
// but must still be able to delete their own login.
//
// Safety: authorization is derived from the caller's OWN JWT (never trusted
// from the body). Deleting a login needs the service-role key, which must
// never reach the browser — hence this function.
//
// Ownership rule (single-org model: a user belongs to exactly one org):
//   - Non-owner, or the SOLE remaining member: delete the caller's auth user.
//     The team_members row cascades away; if they were the last member, the
//     cleanup_orphaned_org trigger deletes the now-empty org and its data.
//   - Owner WITH other staff still on the club: blocked — they'd leave the
//     club with no owner. They must remove the other staff or delete the club
//     (which also removes their login) first.
//
// Deploy with:
//   supabase functions deploy delete-my-account
// (No new secrets — uses the service-role key available to every function.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header." }, 401);

    // Identify the caller strictly from their own verified JWT.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "Not authenticated." }, 401);
    const userId = userData.user.id;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // The caller's membership (single-org model → at most one row).
    const { data: membership } = await adminClient
      .from("team_members")
      .select("org_id, role")
      .eq("id", userId)
      .maybeSingle();

    if (membership?.org_id) {
      if (membership.role === "owner") {
        const { count } = await adminClient
          .from("team_members")
          .select("id", { count: "exact", head: true })
          .eq("org_id", membership.org_id)
          .neq("id", userId);
        if ((count || 0) > 0) {
          return jsonResponse({
            error: "owner_has_other_members",
            message:
              "You're the owner of a club that still has other staff. Remove the other staff first, or delete the whole club (which also deletes your account), before deleting just your account.",
          }, 409);
        }
        // Sole owner: delete the org explicitly so all its data (players,
        // fixtures, consent/transport records) is removed, not just the login.
        await adminClient.from("organizations").delete().eq("id", membership.org_id);
      }
      // Non-owner: their team_members row cascades when the auth user is deleted.
    }

    // Finally delete the caller's login. Cascades remove their profile,
    // platform_admins entry, and any remaining membership; the
    // cleanup_orphaned_org trigger removes a now-empty org.
    const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
    if (delErr) throw delErr;

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("delete-my-account error:", err);
    return jsonResponse({ error: "Could not delete your account. Please try again." }, 500);
  }
});
