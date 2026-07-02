import { AgentClient, EventType, DeliverableType } from '../src';

async function main() {
  const client = new AgentClient(
    {
      baseURL: process.env.CROO_API_URL!,
      wsURL: process.env.CROO_WS_URL!,
      rpcURL: process.env.BASE_RPC_URL,
    },
    process.env.CROO_SDK_KEY!
  );

  // Connect WebSocket
  const stream = await client.connectWebSocket();

  // Accept incoming negotiations
  stream.on(EventType.NegotiationCreated, async (e) => {
    console.log(`New negotiation: ${e.negotiation_id}`);

    try {
      const result = await client.acceptNegotiation(e.negotiation_id!);
      console.log(`Order created: ${result.order.orderId}`);
    } catch (err) {
      console.error('accept error:', err);
    }
  });

  // Deliver after payment
  stream.on(EventType.OrderPaid, async (e) => {
    console.log(`Order ${e.order_id} paid, delivering...`);

    try {
      await client.deliverOrder(e.order_id!, {
        deliverableType: DeliverableType.Text,
        deliverableText: '{"analysis": "done", "score": 95}',
      });
      console.log(`Order ${e.order_id} delivered!`);
    } catch (err) {
      console.error('deliver error:', err);
    }
  });

  stream.on(EventType.OrderCompleted, (e) => {
    console.log(`Order ${e.order_id} completed!`);
  });

  // Keep process alive
  process.on('SIGINT', () => {
    stream.close();
    process.exit(0);
  });
}

main().catch(console.error);
