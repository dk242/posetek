/**
 * Premium unlock: confirm price, then open Stripe Payment Link with client_reference_id
 * so checkout.session.completed can unlock the player (see functions/index.js stripeWebhook).
 *
 * Dashboard: Payment Link — append ?client_reference_id=… is supported by Stripe.
 * https://stripe.com/docs/payment-links/customize#customize-checkout-with-url-parameters
 */
(function (global) {
  /** Your live Payment Link (test mode has a different buy.stripe.com URL). */
  var STRIPE_PREMIUM_PAYMENT_LINK =
    'https://buy.stripe.com/4gMaEWgQBcjMeqv9EX9Ve01';

  var CONFIRM_MSG =
    'Premium access is $30. Would you like to be redirected to Stripe to unlock access?';

  function paymentLinkUrlForPlayer(playerDocId) {
    var base = STRIPE_PREMIUM_PAYMENT_LINK.replace(/\/$/, '');
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    return (
      base +
      sep +
      'client_reference_id=' +
      encodeURIComponent(String(playerDocId))
    );
  }

  function bindUnlockButton(el, playerDocId) {
    if (!el || !playerDocId) return;
    el.setAttribute('href', '#');
    el.setAttribute('role', 'button');
    el.addEventListener('click', function (e) {
      e.preventDefault();
      if (!global.confirm(CONFIRM_MSG)) return;
      startPremiumCheckout(playerDocId);
    });
  }

  function startPremiumCheckout(playerDocId) {
    if (!playerDocId) return;
    global.location.href = paymentLinkUrlForPlayer(playerDocId);
  }

  global.PoseTekPremiumCheckout = {
    bindUnlockButton: bindUnlockButton,
    startCheckout: startPremiumCheckout,
    /** Exposed for testing or custom redirects */
    paymentLinkUrlForPlayer: paymentLinkUrlForPlayer,
  };
})(typeof window !== 'undefined' ? window : this);
