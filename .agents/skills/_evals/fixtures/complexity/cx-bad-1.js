// Categorize an order by status, region, and value.
export function categorize(order) {
  if (order) {
    if (order.status === 'paid') {
      if (order.region === 'EU') {
        if (order.total > 1000) {
          if (order.items && order.items.length > 5) {
            return 'eu-vip-bulk';
          } else {
            return 'eu-vip';
          }
        } else if (order.total > 100) {
          return 'eu-standard';
        } else {
          return 'eu-small';
        }
      } else if (order.region === 'US') {
        if (order.total > 1000) {
          return 'us-vip';
        } else {
          return 'us-standard';
        }
      }
    } else if (order.status === 'pending') {
      return 'hold';
    }
  }
  return 'unknown';
}
