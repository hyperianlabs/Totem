// Supabase Edge Function: delete-org-users
//
// Called right before an organization is actually deleted (by its own
// owner, or by a Platform Admin) — cleans up the underlying logins for
// that club's staff, so their email addresses are genuinely free to
// register again afterward, rather than being silently "stuck" tied to
// an orphaned account with no club.
//
// Deliberately careful about one thing: if a staff member also belongs
// to a DIFFERENT club, their login is left alone — only their membership
// in the club being deleted goes away (via the normal cascade delete that
// follows this), not their access to anywhere else. Only people whose
// *only* club was this one get their actual login removed.
//
// This can't be done safely from the app itself — deleting a login is a
// privileged operation that needs the service role key, never exposed to
// the browser. Authorization is checked here using the calling user's own
// JWT before anything is deleted, so this can only ever be used by that
// club's own owner, or a Platform Admin — never anyone else.
//
// ---------------------------------------------------------------------
// SETUP: supabase functions deploy delete-org-users
// (No new secrets needed — uses the standard Supabase service role key
// that's automatically available to every Edge Function.)
// ---------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { org_id } = await req.json();
    if (!org_id) {
      return new Response(JSON.stringify({ error: "org_id is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A client scoped to the CALLING user's own JWT — respects RLS, so
    // this only tells us true if the caller is genuinely that org's
    // owner, or a platform admin. Never trust the client to self-report.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const [{ data: isOwner }, { data: isAdmin }] = await Promise.all([
      callerClient.rpc("is_org_owner", { check_org_id: org_id }),
      callerClient.rpc("is_platform_admin"),
    ]);

    if (!isOwner && !isAdmin) {
      return new Response(JSON.stringify({ error: "Not authorized to delete this club." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // From here on, use the service role client — needed to actually
    // delete logins, and to reliably read every affected staff member
    // regardless of RLS.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: members, error: membersError } = await adminClient
      .from("team_members")
      .select("id, email")
      .eq("org_id", org_id);

    if (membersError) throw membersError;

    const results: { email: string; deleted: boolean; reason?: string }[] = [];

    for (const member of members || []) {
      const { data: otherMemberships } = await adminClient
        .from("team_members")
        .select("org_id")
        .eq("id", member.id)
        .neq("org_id", org_id);

      if (otherMemberships && otherMemberships.length > 0) {
        results.push({ email: member.email, deleted: false, reason: "belongs to another club too" });
        continue;
      }

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(member.id);
      if (deleteError) {
        results.push({ email: member.email, deleted: false, reason: deleteError.message });
      } else {
        results.push({ email: member.email, deleted: true });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("delete-org-users error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
