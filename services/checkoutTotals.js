const Subscription = require('../models/Subscription');

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const baseDeliveryFee = () => roundMoney(Number(process.env.DELIVERY_FEE) || 8);
const freeDeliveryThreshold = () => roundMoney(Number(process.env.SUBSCRIPTION_FREE_DELIVERY_THRESHOLD) || 150);

const computeTotals = async (userId, discountSummary) => {
  const itemsTotal = roundMoney(Number(discountSummary?.finalTotal) || 0);
  const subscription = await Subscription.getByUser(userId);

  let deliveryFee = baseDeliveryFee();
  let freeDeliveryReason = null;

  if (subscription?.is_active) {
    if (!subscription.first_delivery_used) {
      deliveryFee = 0;
      freeDeliveryReason = 'New subscriber free delivery';
    } else if (itemsTotal >= freeDeliveryThreshold()) {
      deliveryFee = 0;
      freeDeliveryReason = `Free delivery for orders $${freeDeliveryThreshold().toFixed(2)}+ after discounts`;
    }
  }

  const finalTotal = roundMoney(itemsTotal + deliveryFee);

  return {
    itemsTotal,
    deliveryFee,
    finalTotal,
    subscription,
    freeDeliveryReason,
    baseDeliveryFee: baseDeliveryFee(),
    freeDeliveryThreshold: freeDeliveryThreshold()
  };
};

module.exports = {
  computeTotals
};
