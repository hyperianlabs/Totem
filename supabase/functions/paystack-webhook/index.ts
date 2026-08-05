// Supabase Edge Function: paystack-webhook
//
// Keeps organizations.plan / plan_status in sync with what's actually
// happening in Paystack. This REPLACES the earlier stripe-webhook function —
// Stripe doesn't directly support businesses registered in South Africa, but
// Paystack (also Stripe-owned, but a genuinely separate product/API/webhook
// format) is properly licensed and built for exactly this. Once this is
// live and working, the old stripe-webhook function can be left undeployed
// or removed — it won't do anything useful here.
//
// ---------------------------------------------------------------------
// SETUP:
//
// 1. Create a Paystack account (paystack.com) with your real South African
//    business/bank details.
//
// 2. In Paystack Dashboard → Payments → Plans, create FIVE plans, one per
//    tier. Amounts are in CENTS (smallest currency unit) — R49 = 4900,
//    R99 = 9900, R149 = 14900, R199 = 19900, R349 = 34900. Interval:
//    monthly. Note each plan's "plan_code" (starts PLN_) once created.
//
//    VAT: Paystack doesn't have an automatic exclusive-tax-calculation
//    feature the way Stripe Tax does, as far as documented — worth
//    confirming directly with Paystack support/docs, and with an
//    accountant, how they expect you to handle VAT on these plan amounts
//    (commonly: bake VAT into the plan amount itself, since Paystack has
//    no built-in "add tax at checkout" step to rely on).
//
// 3. Set up a checkout flow that initializes a transaction against the
//    right plan for each tier (Paystack Inline JS, or a hosted Payment
//    Page per plan) — whichever you use, pass the organization's id in
//    the `metadata` field when initializing the transaction, e.g.:
//      metadata: { org_id: "<the organization's id>" }
//    This is how this function knows which club just paid — without it,
//    there's no way to connect a Paystack customer back to a Totem org.
//
// 4. Deploy this function:
//      supabase functions deploy paystack-webhook --no-verify-jwt
//    (Paystack calls this directly, not through your app's logged-in
//    users — the signature check below is what secures this endpoint.)
//
// 5. In Paystack Dashboard → Settings → API Keys & Webhooks, set the
//    webhook URL to:
//      https://YOUR-PROJECT-REF.supabase.co/functions/v1/paystack-webhook
//
// 6. Set your secrets:
//      supabase secrets set PAYSTACK_SECRET_KEY=sk_...
// ---------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Map your actual Paystack plan_code(s) to Totem's internal plan name here —
// filled in from your live Paystack Plans (verified distinct, no duplicates).
const PLAN_CODE_TO_TIER: Record<string, string> = {
  "PLN_62t31ifd00ppww1": "tier1", // Starter, R49  — 1 sport, 4 coaches
  "PLN_7ccas4gzjd8okmu": "tier2", // Growth, R99  — 2 sports, 6 coaches
  "PLN_cazjw6w97mv7125": "tier3", // Club, R149 — 3 sports, 8 coaches
  "PLN_q883p3s2fuegu4a": "tier4", // Multi-Sport, R199 — 4 sports, 10 coaches
  "PLN_nke2jp6w1zbk3zu": "tier5", // Unlimited, R349
};

async function verifySignature(bodyBuffer: ArrayBuffer, signature: string | null): Promise<boolean> {
  // TEMPORARY DEBUG LOGGING — safe to leave the key length/prefix visible
  // (not the full secret), remove once signature verification is confirmed
  // working correctly.
  console.log("DEBUG: PAYSTACK_SECRET_KEY length =", PAYSTACK_SECRET_KEY.length);
  console.log("DEBUG: PAYSTACK_SECRET_KEY starts with =", PAYSTACK_SECRET_KEY.slice(0, 8));
  console.log("DEBUG: received x-paystack-signature =", signature);
  console.log("DEBUG: raw byte length =", bodyBuffer.byteLength);

  if (!signature || !PAYSTACK_SECRET_KEY) {
    console.log("DEBUG: missing signature or missing key — returning false early");
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  // Hash the RAW BYTES exactly as they arrived over the wire — no decode
  // to a string and back first. Paystack support flagged this specific
  // decode/re-encode round trip as a possible source of a byte-level
  // mismatch that wouldn't necessarily show up as a simple length
  // difference, since string .length and byte length aren't always the
  // same measurement.
  const mac = await crypto.subtle.sign("HMAC", key, bodyBuffer);
  const computed = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  console.log("DEBUG: computed signature (raw bytes) =", computed);
  console.log("DEBUG: raw-bytes match? =", computed === signature);

  console.log("DEBUG: signatures match? =", computed === signature);
  return computed === signature;
}

Deno.serve(async (req: Request) => {
  const signature = req.headers.get("x-paystack-signature");
  const bodyBuffer = await req.arrayBuffer();

  // TEMPORARY DEBUG — checking whether the body itself might differ from
  // what Paystack actually hashed, since the key has now been ruled out.
  console.log("DEBUG: content-type header =", req.headers.get("content-type"));
  console.log("DEBUG: content-length header =", req.headers.get("content-length"));

  if (!(await verifySignature(bodyBuffer, signature))) {
    console.error("Paystack webhook signature verification failed.");
    return new Response("Invalid signature", { status: 400 });
  }

  // Only decode to a string now, after the signature check has already
  // passed against the untouched raw bytes.
  const body = new TextDecoder("utf-8").decode(bodyBuffer);
  console.log("DEBUG: body length (decoded string) =", body.length);
  console.log("DEBUG: body first 100 chars =", body.slice(0, 100));
  console.log("DEBUG: body last 50 chars =", body.slice(-50));

  let event: any;
  try {
    event = JSON.parse(body);
  } catch (err) {
    return new Response("Invalid payload", { status: 400 });
  }

  try {
    const eventType = event.event as string;
    const data = event.data || {};

    switch (eventType) {
      // Fires on the initial successful payment for a new subscription
      // (and for one-off charges, which this integration doesn't use).
      case "charge.success":
      case "subscription.create": {
        const orgId = data.metadata?.org_id || data.customer?.metadata?.org_id;
        const planCode = data.plan?.plan_code || data.plan_object?.plan_code || data.plan;
        const tier = planCode && PLAN_CODE_TO_TIER[planCode] ? PLAN_CODE_TO_TIER[planCode] : null;

        if (!orgId) {
          console.warn(`${eventType} with no org_id in metadata — can't link to an org.`);
          break;
        }
        if (!tier) {
          console.warn(`Plan code ${planCode} isn't mapped in PLAN_CODE_TO_TIER — plan tier not updated for this event.`);
        }

        const update: Record<string, unknown> = {
          payment_customer_id: data.customer?.customer_code || null,
          payment_subscription_id: data.subscription_code || data.subscription?.subscription_code || null,
          plan_status: "active",
        };
        if (tier) update.plan = tier;

        // Founding Schools Programme: "no fee increases, ever" — the first
        // time a founding school successfully pays, permanently record
        // which Paystack plan_code (i.e. price point) they paid against,
        // so they can always be resubscribed on that same plan later even
        // after public pricing changes and new, pricier Paystack plans get
        // created for everyone else. Set-once — never overwritten.
        if (planCode) {
          const { data: org } = await supabaseAdmin
            .from("organizations")
            .select("is_founding_school, founder_locked_plan_code")
            .eq("id", orgId)
            .single();
          if (org?.is_founding_school && !org.founder_locked_plan_code) {
            update.founder_locked_plan_code = planCode;
          }
        }

        await supabaseAdmin.from("organizations").update(update).eq("id", orgId);
        break;
      }

      // Subscription won't renew on the next payment date (cancellation
      // requested, but still active until period end) — just flag status,
      // don't drop the plan yet.
      case "subscription.not_renew": {
        const subCode = data.subscription_code;
        if (subCode) {
          await supabaseAdmin
            .from("organizations")
            .update({ plan_status: "past_due" })
            .eq("payment_subscription_id", subCode);
        }
        break;
      }

      // Subscription has actually ended (either after non-renewal, or
      // cancelled directly) — drop back to the free plan.
      case "subscription.disable": {
        const subCode = data.subscription_code;
        if (subCode) {
          await supabaseAdmin
            .from("organizations")
            .update({ plan: "free", plan_status: "active" })
            .eq("payment_subscription_id", subCode);
        }
        break;
      }

      default:
        // ignore anything else (e.g. subscription.expiring_cards)
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error handling Paystack webhook event:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
