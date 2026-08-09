const DEFAULT_API_BASE_URL = 'http://localhost:3001';

export function getApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export async function proxyToApi(path: string, init?: RequestInit): Promise<Response> {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

  try {
    const upstream = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        ...(upstream.headers.get('location')
          ? { location: upstream.headers.get('location')! }
          : {}),
        ...(upstream.headers.get('x-request-id')
          ? { 'x-request-id': upstream.headers.get('x-request-id')! }
          : {}),
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The search API is temporarily unavailable',
          requestId: crypto.randomUUID(),
        },
      },
      { status: 503 },
    );
  }
}
