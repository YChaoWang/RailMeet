import { proxyToApi } from '@/lib/api-proxy';

type RouteContext = { params: Promise<{ searchId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { searchId } = await context.params;
  return proxyToApi(`/api/v1/meeting-searches/${encodeURIComponent(searchId)}/results`);
}
