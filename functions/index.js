const functions = require("firebase-functions");
const admin = require("firebase-admin");
const stripe = require("stripe");

admin.initializeApp();
const db = admin.firestore();

/**
 * stripeWebhook
 *
 * Handles verified Stripe webhooks:
 * - checkout.session.completed — premium unlock + premiumPurchases (existing flow)
 * - payment_intent.succeeded — when metadata.booking_type === performance_test,
 *   writes to performanceTestBookings (Payment Element on bookPerformanceTest.html)
 *
 * Add both event types to this endpoint in the Stripe Dashboard.
 */
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const stripeClient = stripe(functions.config().stripe.secret_key);
  const webhookSecret = functions.config().stripe.webhook_secret;

  // Verify the event came from Stripe
  let event;
  try {
    event = stripeClient.webhooks.constructEvent(
      req.rawBody,          // raw buffer — required for signature verification
      req.headers["stripe-signature"],
      webhookSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    if (pi.metadata && pi.metadata.booking_type === "performance_test") {
      try {
        await db.collection("performanceTestBookings").add({
          fullName: pi.metadata.fullName || null,
          email: pi.metadata.email || null,
          appointmentDate: pi.metadata.appointmentDate || null,
          timeSlot: pi.metadata.timeSlot || null,
          stripePaymentIntentId: pi.id,
          amountPaid: pi.amount_received ? pi.amount_received / 100 : null,
          currency: pi.currency || "usd",
          bookedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log("Performance test booking recorded:", pi.id);
      } catch (err) {
        console.error("Failed to record performance test booking:", err);
      }
    }
    return res.status(200).json({ received: true });
  }

  // Only handle successful checkout completions for premium flow
  if (event.type !== "checkout.session.completed") {
    return res.status(200).send("Ignored event type");
  }

  const session = event.data.object;

  // client_reference_id is set to the player's Firestore doc ID
  // before redirecting to Stripe (see premiumInfo.html)
  const playerDocId = session.client_reference_id;
  const customerEmail = session.customer_details?.email || null;
  const amountPaid = session.amount_total ? session.amount_total / 100 : null;

  // Write purchase record regardless of whether we have a playerDocId
  const purchaseData = {
    stripeSessionId: session.id,
    playerDocId: playerDocId || null,
    customerEmail: customerEmail,
    amountPaid: amountPaid,
    currency: session.currency || "usd",
    purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await db.collection("premiumPurchases").add(purchaseData);
    console.log("Purchase record written:", session.id);
  } catch (err) {
    console.error("Failed to write purchase record:", err);
  }

  // If we have a playerDocId, unlock their premium content
  if (playerDocId) {
    try {
      await db.collection("players").doc(playerDocId).update({
        premium_content_locked: false,
        premiumPurchasedAt: admin.firestore.FieldValue.serverTimestamp(),
        premiumStripeSessionId: session.id,
      });
      console.log(`Unlocked premium for player: ${playerDocId}`);
    } catch (err) {
      console.error(`Failed to unlock premium for player ${playerDocId}:`, err);
      return res.status(500).send("Failed to unlock premium");
    }
  } else {
    // Guest purchase — no player doc to update
    // A coach can manually unlock the player later or match by email
    console.log("Guest purchase (no playerDocId) — email:", customerEmail);
  }

  return res.status(200).json({ received: true });
});

/**
 * createPerformanceTestPaymentIntent
 *
 * HTTPS endpoint (CORS-enabled) that creates a Stripe PaymentIntent for the
 * performance-test booking page. The client mounts Stripe Payment Element with
 * the returned clientSecret — card data never touches PoseTek servers.
 *
 * Configure amount (cents): firebase functions:config:set performance_test.amount_cents="5000"
 */
exports.createPerformanceTestPaymentIntent = functions.https.onRequest(
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
    }

    const { fullName, email, appointmentDate, timeSlot } = body || {};
    if (!fullName || !email || !appointmentDate || !timeSlot) {
      return res.status(400).json({
        error: "Missing required fields: fullName, email, appointmentDate, timeSlot",
      });
    }

    const stripeClient = stripe(functions.config().stripe.secret_key);
    const amountCents = Number(
      functions.config().performance_test?.amount_cents || 5000
    );

    try {
      const paymentIntent = await stripeClient.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        receipt_email: String(email).trim(),
        metadata: {
          booking_type: "performance_test",
          fullName: String(fullName).trim().slice(0, 200),
          email: String(email).trim().slice(0, 200),
          appointmentDate: String(appointmentDate).slice(0, 50),
          timeSlot: String(timeSlot).slice(0, 50),
        },
      });

      return res.status(200).json({
        clientSecret: paymentIntent.client_secret,
        amountCents: amountCents,
      });
    } catch (err) {
      console.error("createPerformanceTestPaymentIntent failed:", err);
      return res.status(500).json({
        error: "Could not start payment. Please try again later.",
      });
    }
  }
);
