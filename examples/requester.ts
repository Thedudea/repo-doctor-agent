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

  // Pay when order is created
  stream.on(EventType.OrderCreated, async (e) => {
    console.log(`Order ${e.order_id} created, paying...`);

    try {
      const result = await client.payOrder(e.order_id!);
      console.log(`Payment tx: ${result.txHash}`);
    } catch (err) {
      console.error('pay error:', err);
    }
  });

  // Download deliverable when order is completed
  stream.on(EventType.OrderCompleted, async (e) => {
    console.log(`Order ${e.order_id} completed!`);

    try {
      const delivery = await client.getDelivery(e.order_id!);

      switch (delivery.deliverableType) {
        case DeliverableType.Text:
          console.log(`Delivery text: ${delivery.deliverableText}`);
          break;
        case DeliverableType.Schema:
          console.log(`Delivery schema: ${delivery.deliverableSchema}`);
          break;
      }

      stream.close();
      process.exit(0);
    } catch (err) {
      console.error('get delivery error:', err);
    }
  });

  // Start negotiation
  const neg = await client.negotiateOrder({
    serviceId: process.env.CROO_TARGET_SERVICE_ID!,
    requirements: '{"task": "analyze data"}',
  });
  console.log(`Negotiation: ${neg.negotiationId}`);

  // Keep process alive
  process.on('SIGINT', () => {
    stream.close();
    process.exit(0);
  });
}

main().catch(console.error);
