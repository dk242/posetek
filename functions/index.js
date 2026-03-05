const functions = require("firebase-functions");
const admin = require("firebase-admin");
const stripe = require("stripe");

admin.initializeApp();
const db = admin.firestore();

/**
 * stripeWebhook
 *
 * Listens for Stripe checkout.session.completed events.
 * When a payment is confirmed, it:
 *   1. Verifies the request is genuinely from Stripe (signature check)
 *   2. Reads the playerDocId from client_reference_id
 *   3. Sets premium_content_locked: false on the player's Firestore doc
 *   4. Writes a record to the premiumPurchases collection
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

  // Only handle successful checkout completions
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
