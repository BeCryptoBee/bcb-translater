export interface Env {
  QUOTA_KV: KVNamespace;
  GEMINI_API_KEY: string;
  GROQ_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/process') {
      return new Response('Not found', { status: 404 });
    }
    return new Response(JSON.stringify({ error: 'not_implemented' }), {
      status: 501,
      headers: { 'content-type': 'application/json' },
    });
  },
} satisfies ExportedHandler<Env>;
