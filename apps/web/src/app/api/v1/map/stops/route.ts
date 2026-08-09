import { proxyToApi } from '@/lib/api-proxy';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyToApi(`/api/v1/map/stops${url.search}`, { method: 'GET' });
}
