const functions = require("firebase-functions");
const admin = require("firebase-admin");
const stripe = require("stripe");

admin.initializeApp();
const db = admin.firestore();

/**
 * stripeWebhook
 *
 * Handles verified Stripe webhooks:
 * - checkout.session.completed — premium unlock (mode payment) OR subscription waitlist (mode subscription)
 * - payment_intent.succeeded — performance_test bookings (bookPerformanceTest.html)
 * - invoice.payment_succeeded / invoice.payment_failed — subscription billing (waitlist)
 * - customer.subscription.deleted — subscription cancelled (waitlist)
 *
 * Register all handled event types on this endpoint in the Stripe Dashboard.
 */

async function handleSubscriptionCheckoutCompleted(session) {
  const waitlistDocId = session.client_reference_id;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!waitlistDocId || !subscriptionId) {
    console.warn(
      "Subscription checkout missing client_reference_id or subscription:",
      session.id
    );
    return;
  }
  const stripeEmail = session.customer_details?.email || null;
  await db.collection("subscriptionWaitlist").doc(waitlistDocId).update({
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: session.customer || null,
    subscriptionStatus: "trialing",
    stripeEmail: stripeEmail,
    stripeCheckoutSessionId: session.id,
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`Waitlist ${waitlistDocId} subscription recorded (${subscriptionId})`);
}

async function findWaitlistDocByStripeSubscriptionId(subscriptionId) {
  const snap = await db
    .collection("subscriptionWaitlist")
    .where("stripeSubscriptionId", "==", subscriptionId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0];
}

async function handleInvoicePaymentSucceeded(invoice) {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
  if (!subId) return;
  // Skip $0 invoices (e.g. trial line items) — first real charge has amount_paid > 0
  if (!invoice.amount_paid || invoice.amount_paid <= 0) {
    console.log("Skipping zero-amount invoice for subscription", subId);
    return;
  }
  const doc = await findWaitlistDocByStripeSubscriptionId(subId);
  if (!doc) {
    console.log("No waitlist doc for subscription invoice:", subId);
    return;
  }
  await doc.ref.update({
    subscriptionStatus: "active",
    firstChargedAt: admin.firestore.FieldValue.serverTimestamp(),
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("Waitlist marked active after payment:", subId);
}

async function handleInvoicePaymentFailed(invoice) {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
  if (!subId) return;
  const doc = await findWaitlistDocByStripeSubscriptionId(subId);
  if (!doc) return;
  await doc.ref.update({
    subscriptionStatus: "past_due",
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("Waitlist marked past_due:", subId);
}

async function handleSubscriptionDeleted(subscription) {
  const subId = subscription.id;
  if (!subId) return;
  const doc = await findWaitlistDocByStripeSubscriptionId(subId);
  if (!doc) return;
  await doc.ref.update({
    subscriptionStatus: "cancelled",
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("Waitlist marked cancelled:", subId);
}

async function handlePremiumPaymentCheckoutCompleted(session) {
  const playerDocId = session.client_reference_id;
  const customerEmail = session.customer_details?.email || null;
  const amountPaid = session.amount_total ? session.amount_total / 100 : null;

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
      throw err;
    }
  } else {
    console.log("Guest purchase (no playerDocId) — email:", customerEmail);
  }
}

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
      req.rawBody, // raw buffer — required for signature verification
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

  if (event.type === "invoice.payment_succeeded") {
    try {
      await handleInvoicePaymentSucceeded(event.data.object);
    } catch (err) {
      console.error("handleInvoicePaymentSucceeded failed:", err);
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "invoice.payment_failed") {
    try {
      await handleInvoicePaymentFailed(event.data.object);
    } catch (err) {
      console.error("handleInvoicePaymentFailed failed:", err);
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "customer.subscription.deleted") {
    try {
      await handleSubscriptionDeleted(event.data.object);
    } catch (err) {
      console.error("handleSubscriptionDeleted failed:", err);
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (
      session.mode === "subscription" &&
      session.client_reference_id &&
      session.subscription
    ) {
      try {
        await handleSubscriptionCheckoutCompleted(session);
      } catch (err) {
        console.error("handleSubscriptionCheckoutCompleted failed:", err);
        return res.status(500).send("Failed to update subscription waitlist");
      }
      return res.status(200).json({ received: true });
    }

    // One-time premium purchase (Payment Link / createPremiumCheckoutSession)
    if (session.mode === "payment") {
      try {
        await handlePremiumPaymentCheckoutCompleted(session);
      } catch (err) {
        console.error("handlePremiumPaymentCheckoutCompleted failed:", err);
        const playerDocId = session.client_reference_id;
        if (playerDocId) {
          return res.status(500).send("Failed to unlock premium");
        }
      }
      return res.status(200).json({ received: true });
    }

    console.log(
      "checkout.session.completed ignored (mode:",
      session.mode,
      ")"
    );
    return res.status(200).json({ received: true });
  }

  return res.status(200).send("Ignored event type");
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

/**
 * createPremiumCheckoutSession
 *
 * Creates a Stripe Checkout Session (one-time payment) with client_reference_id = player
 * Firestore doc ID. Webhook checkout.session.completed unlocks premium (see stripeWebhook).
 *
 * Configure optional price override (cents):
 *   firebase functions:config:set premium.amount_cents="3000"
 * Public site URL for success/cancel redirects:
 *   firebase functions:config:set site.public_url="https://yourdomain.com"
 */
exports.createPremiumCheckoutSession = functions.https.onRequest(
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

    const playerDocId =
      body && body.playerDocId ? String(body.playerDocId).trim() : "";
    if (!playerDocId) {
      return res.status(400).json({ error: "playerDocId required" });
    }

    let siteUrl =
      (functions.config().site && functions.config().site.public_url) ||
      "https://kickai-69dd0.web.app";
    siteUrl = siteUrl.replace(/\/$/, "");

    const amountCents = Number(
      functions.config().premium?.amount_cents || 3000
    );

    const stripeClient = stripe(functions.config().stripe.secret_key);

    const successUrl = `${siteUrl}/profile.html?userType=player&player=${encodeURIComponent(
      playerDocId
    )}&premiumCheckout=success`;
    const cancelUrl = `${siteUrl}/profile.html?userType=player&player=${encodeURIComponent(
      playerDocId
    )}&premiumCheckout=cancelled`;

    try {
      const session = await stripeClient.checkout.sessions.create({
        mode: "payment",
        client_reference_id: playerDocId,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "PoseTek Premium Access",
                description:
                  "Full premium analysis features for your athlete profile",
              },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      return res.status(200).json({ url: session.url });
    } catch (err) {
      console.error("createPremiumCheckoutSession failed:", err);
      return res.status(500).json({
        error: "Could not start checkout. Please try again later.",
      });
    }
  }
);
