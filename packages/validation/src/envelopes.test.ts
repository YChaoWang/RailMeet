import { describe, expect, it } from 'vitest';

import { apiErrorEnvelopeSchema, successEnvelopeSchema } from './envelopes.js';
import { z } from 'zod';

describe('API envelopes', () => {
  const exampleSuccess = successEnvelopeSchema(
    z
      .object({
        searchId: z.string().min(1),
        status: z.literal('queued'),
      })
      .strict(),
  );

  it('accepts a valid success envelope', () => {
    const result = exampleSuccess.safeParse({
      data: { searchId: 'search_123', status: 'queued' },
      meta: { requestId: 'req_abc' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid error envelope', () => {
    const result = apiErrorEnvelopeSchema.safeParse({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: [{ path: 'participants', message: 'At least 2 participants are required' }],
        requestId: 'req_abc',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects error envelopes that include unsafe or unexpected fields', () => {
    const withStack = apiErrorEnvelopeSchema.safeParse({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected failure',
        stack: 'Error: boom\n    at secret.ts:1:1',
      },
    });
    const withSql = apiErrorEnvelopeSchema.safeParse({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected failure',
        sql: 'SELECT * FROM users',
      },
    });
    const unknownTopLevel = apiErrorEnvelopeSchema.safeParse({
      error: {
        code: 'NOT_FOUND',
        message: 'Search not found',
      },
      debug: { providerResponse: { raw: true } },
    });

    expect(withStack.success).toBe(false);
    expect(withSql.success).toBe(false);
    expect(unknownTopLevel.success).toBe(false);
  });

  it('rejects success envelopes with unknown keys', () => {
    const result = exampleSuccess.safeParse({
      data: { searchId: 'search_123', status: 'queued' },
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});
