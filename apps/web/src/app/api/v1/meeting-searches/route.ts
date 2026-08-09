import { proxyToApi } from '@/lib/api-proxy';

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  return proxyToApi('/api/v1/meeting-searches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
