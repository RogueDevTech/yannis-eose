import type postgres from 'postgres';
import { getHttpRequestDbTimingStore } from '../common/http-request-timing';

function addDbMs(ms: number): void {
  const store = getHttpRequestDbTimingStore();
  if (store) store.dbMs += ms;
}

function trackPromise<T>(p: PromiseLike<T>): Promise<T> {
  const store = getHttpRequestDbTimingStore();
  if (!store) return Promise.resolve(p) as Promise<T>;
  const t0 = performance.now();
  return Promise.resolve(p).finally(() => {
    addDbMs(performance.now() - t0);
  }) as Promise<T>;
}

/**
 * postgres.js `unsafe` sometimes returns a thenable directly, sometimes a builder with `.values()`.
 * Accumulate wall time for the underlying query into the current HTTP request ALS store (if any).
 */
function wrapUnsafeResult(result: unknown): unknown {
  const store = getHttpRequestDbTimingStore();
  if (!store) return result;

  if (
    result !== null &&
    typeof result === 'object' &&
    typeof (result as { values?: () => PromiseLike<unknown> }).values === 'function'
  ) {
    const obj = result as { values: () => PromiseLike<unknown> };
    const origValues = obj.values.bind(obj) as () => PromiseLike<unknown>;
    return new Proxy(obj as object, {
      get(target, prop, receiver) {
        if (prop === 'values') {
          return () => {
            const t0 = performance.now();
            const out = origValues();
            return Promise.resolve(out).finally(() => {
              addDbMs(performance.now() - t0);
            });
          };
        }
        const v: unknown = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }

  return trackPromise(Promise.resolve(result as PromiseLike<unknown>));
}

type Sql = postgres.Sql;

/**
 * Wraps the postgres.js client so awaited query time is summed into `httpRequestTimingAls` for the request.
 * When no ALS store is active, returns values unchanged (no extra Promise wrapping).
 */
export function wrapPostgresClientForDbTiming(client: Sql): Sql {
  const handler: ProxyHandler<Sql> = {
    apply(target, thisArg, args: unknown[]) {
      const result = Reflect.apply(
        target as unknown as (...args: unknown[]) => unknown,
        thisArg,
        args as never[],
      );
      if (!getHttpRequestDbTimingStore()) return result;
      return wrapUnsafeResult(result);
    },
    get(target, prop, receiver) {
      if (prop === 'unsafe') {
        return (query: string, params: unknown[]) => {
          const result = target.unsafe(query, params as never);
          return wrapUnsafeResult(result);
        };
      }
      if (prop === 'begin') {
        return (arg1: unknown, arg2?: unknown) => {
          const run = (tx: Sql): unknown => {
            const wrappedTx = wrapPostgresClientForDbTiming(tx);
            if (typeof arg1 === 'function') {
              return (arg1 as (s: Sql) => unknown)(wrappedTx);
            }
            return (arg2 as (s: Sql) => unknown)(wrappedTx);
          };
          if (typeof arg1 === 'function') {
            return target.begin(run as never);
          }
          return target.begin(arg1 as string, run as never);
        };
      }
      if (prop === 'savepoint') {
        const savepointFn: unknown = Reflect.get(target, 'savepoint', receiver);
        if (typeof savepointFn !== 'function') {
          return savepointFn;
        }
        return (arg1: unknown, arg2?: unknown) => {
          const run = (tx: Sql): unknown => {
            const wrappedTx = wrapPostgresClientForDbTiming(tx);
            if (typeof arg1 === 'function') {
              return (arg1 as (s: Sql) => unknown)(wrappedTx);
            }
            return (arg2 as (s: Sql) => unknown)(wrappedTx);
          };
          if (typeof arg1 === 'function') {
            return (savepointFn as (cb: unknown) => unknown).call(target, run);
          }
          return (savepointFn as (name: string, cb: unknown) => unknown).call(target, arg1 as string, run);
        };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return value;
    },
  };

  return new Proxy(client, handler) as unknown as Sql;
}
