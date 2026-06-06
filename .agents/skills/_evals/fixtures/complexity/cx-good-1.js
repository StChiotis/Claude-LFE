// Small, single-purpose helpers for order categorization.
const TIERS = [
  { min: 1000, tier: 'vip' },
  { min: 100, tier: 'standard' },
  { min: 0, tier: 'small' },
];

export function valueTier(total) {
  return (TIERS.find((t) => total >= t.min) ?? TIERS[TIERS.length - 1]).tier;
}

export function categorize(order) {
  if (!order || order.status !== 'paid') {
    return order?.status === 'pending' ? 'hold' : 'unknown';
  }
  return `${order.region.toLowerCase()}-${valueTier(order.total)}`;
}
