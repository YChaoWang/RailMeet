export type RoutingErrorCode =
  | 'INVALID_REQUEST'
  | 'TIMEOUT'
  | 'NETWORK_FAILURE'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_REQUEST_FAILED'
  | 'PROVIDER_CONTRACT_FAILURE'
  | 'SHUTDOWN';

export type RoutingErrorClass =
  | 'permanent'
  | 'transient'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'provider_contract'
  | 'shutdown';

export class RoutingError extends Error {
  readonly code: RoutingErrorCode;
  readonly classification: RoutingErrorClass;
  readonly httpStatus: number | undefined;

  constructor(
    code: RoutingErrorCode,
    classification: RoutingErrorClass,
    message: string,
    options?: { readonly cause?: unknown; readonly httpStatus?: number },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'RoutingError';
    this.code = code;
    this.classification = classification;
    this.httpStatus = options?.httpStatus;
  }
}
