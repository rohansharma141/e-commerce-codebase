import type { Order } from './order.dto';

export const ORDERS_EVENTS = {
  Created: 'orders.created',
} as const;

export type OrdersEventName = (typeof ORDERS_EVENTS)[keyof typeof ORDERS_EVENTS];

export interface OrderCreatedPayload {
  readonly order: Order;
}
