// Ignores the results of requests that are no longer the latest one.
// The queries themselves are not cancelled: a stale result is simply not written to the state.

export interface RequestGate {
  begin: () => number;
  isCurrent: (token: number) => boolean;
  invalidate: () => void;
}

export function createRequestGate(): RequestGate {
  let latest = 0;
  return {
    begin: () => {
      latest += 1;
      return latest;
    },
    isCurrent: (token) => token === latest,
    // Makes every request started so far stale, e.g. when the month changes or the component unmounts.
    invalidate: () => {
      latest += 1;
    },
  };
}

export interface LatestHandlers<T> {
  onResult: (value: T) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
}

// Runs one request. Only the latest request may write its result, its error, or end the loading state.
export async function runLatest<T>(
  gate: RequestGate,
  work: () => Promise<T>,
  handlers: LatestHandlers<T>
): Promise<void> {
  const token = gate.begin();
  try {
    const value = await work();
    if (gate.isCurrent(token)) handlers.onResult(value);
  } catch (error) {
    if (gate.isCurrent(token)) handlers.onError(error);
  } finally {
    if (gate.isCurrent(token)) handlers.onSettled();
  }
}
