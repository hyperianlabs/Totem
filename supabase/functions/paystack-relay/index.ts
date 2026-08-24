// Supabase Edge Function: paystack-relay
//
// WHY THIS EXISTS: Totem and Vinora share the same live Paystack account
// (same secret/public keys), but Paystack's dashboard only accepts ONE
// webhook URL per account. This function is what that single URL points
// to — it forwards the exact raw request to both apps' real webhook
// handlers unmodified, so each can independently verify the Paystack
// HMAC signature against the raw bytes it receives (per the same
// raw-body rule documented in paystack-webhook/index.ts: hash the exact
// bytes as they arrived, never decode-then-reencode first).
//
// This function does NOT verify the signature itself and does NOT touch
// organizations data — it's a dumb, fast fan-out. Each downstream
// function remains the actual source of truth and security boundary.
//
// SETUP:
// 1. Deploy: supabase functions deploy paystack-relay --no-verify-jwt
// 2. In Paystack Dashboard → Settings → API Configuration - Live Mode →
//    Live Webhook URL, set it to this function's URL:
//      https://tiieaubyrjcsgiaegikb.supabase.co/functions/v1/paystack-relay
//    (replacing whatever single app's URL was there before).

const TARGETS = [
  "https://tiieaubyrjcsgiaegikb.supabase.co/functions/v1/paystack-webhook", // Totem
  "https://vinora.hyperianlabs.com/api/public/webhooks/paystack", // Vinora
];

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Read the exact raw bytes once, then forward that same ArrayBuffer to
  // every target — no JSON parse/stringify round trip that could shift a
  // single byte and break signature verification downstream.
  const bodyBuffer = await req.arrayBuffer();
  const signature = req.headers.get("x-paystack-signature") || "";
  const contentType = req.headers.get("content-type") || "application/json";

  const results = await Promise.allSettled(
    TARGETS.map((url) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": contentType,
          "x-paystack-signature": signature,
        },
        body: bodyBuffer,
      })
    )
  );

  let failures = 0;
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      failures++;
      console.error(`Relay to ${TARGETS[i]} failed to send:`, result.reason);
    } else if (!result.value.ok) {
      failures++;
      console.error(`Relay to ${TARGETS[i]} responded with status ${result.value.status}`);
    }
  });

  if (failures > 0) {
    // ANY target failing — not just all of them — has to fail the whole
    // response, so Paystack's own retry mechanism kicks in. This keeps
    // each app's original reliability guarantee: before this relay
    // existed, Paystack retried directly against a failing endpoint;
    // silently returning 200 here because the OTHER app happened to
    // succeed would let that guarantee quietly break for whichever one
    // failed. A retry means the succeeding app may occasionally receive
    // the same event twice, but updating an org's plan/status from the
    // same event twice is harmless — same computed tier, same org_id,
    // same result either time.
    return new Response(`${failures}/${TARGETS.length} relay targets failed`, { status: 502 });
  }

  return new Response("ok", { status: 200 });
});
