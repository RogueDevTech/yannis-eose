export interface Env {
  API_URL: string;
  // DEDUP_CACHE: KVNamespace;
  // ORDER_BUFFER: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        service: 'yannis-edge-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === '/submit' && request.method === 'POST') {
      // Order submission handler — will be implemented in Task 1.1
      return Response.json(
        { message: 'Order submission endpoint — not yet implemented' },
        { status: 501 },
      );
    }

    return Response.json({ error: 'Not Found' }, { status: 404 });
  },
};
