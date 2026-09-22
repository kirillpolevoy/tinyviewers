// One error type for the whole pipeline, carrying a machine-readable `code` alongside the sentence
// a person reads. The job row stores both: `error_code` is what the web branches on, `error` is what
// it shows. Anything thrown that is NOT a PipelineError is a bug, and the job records it as
// `internal` with a generic message rather than leaking a stack or an API response.

export class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
  }
}

export const fail = (code, message) => new PipelineError(code, message);

/**
 * What a failed call to somebody else's API is allowed to say about itself.
 *
 * An upstream error body is the one thing in this pipeline that can contain the film's dialogue: we
 * send subtitle lines to Jev and to Anthropic, and a 400 from either happily quotes the request
 * back. That body used to be pasted into the thrown message and then written to the platform log by
 * the catch in run.js, which put a stretch of a copyrighted track into a log nobody audits.
 *
 * So the body is read (a response has to be drained) and dropped. Four fields survive — the
 * service, the HTTP status, the upstream request id, and a short code we choose — and those four
 * are the only thing anything downstream is ever given. `status: null` means no response arrived at
 * all: a timeout, an abort, a socket error.
 */
export class UpstreamError extends Error {
  constructor({ service, status = null, requestId = null, code = 'upstream_failed' }) {
    super(`${service} ${status === null ? 'did not answer' : `answered ${status}`} (${code})`);
    this.name = 'UpstreamError';
    this.service = service;
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}

/** The request id every one of these services returns under one name or another. */
export const requestIdOf = (headers) => headers?.get?.('request-id')
  ?? headers?.get?.('x-request-id')
  ?? headers?.get?.('cf-ray')
  ?? null;

/**
 * The only shape an error from this pipeline may be logged in.
 *
 * Nothing here is taken from an upstream body, and for anything that is not one of our own two
 * error types not even the message is kept: a stray `Error` can have been constructed from a
 * response somewhere we did not think of.
 */
export function errorSummary(err) {
  if (err instanceof PipelineError) return { kind: 'pipeline', code: err.code };
  if (err instanceof UpstreamError) {
    return { kind: 'upstream', service: err.service, status: err.status, request_id: err.requestId, code: err.code };
  }
  return { kind: 'internal', name: err?.name ?? 'Error' };
}
