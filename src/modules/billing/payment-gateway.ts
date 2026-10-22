import { createHmac, timingSafeEqual } from 'crypto';

export interface GatewayOrder {
  orderId: string;
  keyId: string;
}

export interface GatewayEvent {
  type: 'paid' | 'failed' | 'ignored';
  orderId?: string;
  paymentId?: string;
  amountPaise?: number;
}

export interface PaymentGateway {
  readonly name: string;
  createOrder(input: { amountPaise: number; receipt: string }): Promise<GatewayOrder>;
  /** Returns null when the signature is invalid. */
  parseWebhook(rawBody: Buffer | string, signature?: string): GatewayEvent | null;
}

export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';

/**
 * Used until real gateway keys are configured. Orders are fake and nothing is charged;
 * in non-production the dev endpoint POST /billing/dev/confirm completes them so the
 * whole flow can be exercised without a gateway account.
 */
export class StubGateway implements PaymentGateway {
  readonly name = 'stub';

  async createOrder({ receipt }: { amountPaise: number; receipt: string }): Promise<GatewayOrder> {
    return { orderId: `stub_order_${receipt}`, keyId: 'stub' };
  }

  parseWebhook(): GatewayEvent | null {
    return null; // the stub has no webhook
  }
}

/**
 * Razorpay over its REST API (no SDK). Switched on only when RAZORPAY_KEY_ID,
 * RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are all set; otherwise StubGateway is used.
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay';

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  async createOrder({ amountPaise, receipt }: { amountPaise: number; receipt: string }): Promise<GatewayOrder> {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64'),
      },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
    });
    if (!res.ok) {
      throw new Error(`Razorpay order failed (${res.status})`);
    }
    const body = (await res.json()) as { id: string };
    return { orderId: body.id, keyId: this.keyId };
  }

  parseWebhook(rawBody: Buffer | string, signature?: string): GatewayEvent | null {
    if (!signature) return null;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const event = JSON.parse(rawBody.toString()) as {
      event: string;
      payload?: { payment?: { entity?: { id: string; order_id: string; amount: number } } };
    };
    const entity = event.payload?.payment?.entity;
    if (!entity) return { type: 'ignored' };
    const base = { orderId: entity.order_id, paymentId: entity.id, amountPaise: entity.amount };
    if (event.event === 'payment.captured' || event.event === 'order.paid') return { type: 'paid', ...base };
    if (event.event === 'payment.failed') return { type: 'failed', ...base };
    return { type: 'ignored' };
  }
}

export function createGatewayFromEnv(): PaymentGateway {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = process.env;
  if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && RAZORPAY_WEBHOOK_SECRET) {
    return new RazorpayGateway(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET);
  }
  return new StubGateway();
}
