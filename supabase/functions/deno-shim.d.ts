// ---------------------------------------------------------------------------
// Minimal Deno runtime declarations.
//
// The Edge Functions only use `Deno.env.get` and `Deno.serve`, so we declare
// exactly that: it lets `tsc` check the backend locally without Deno installed,
// and the real runtime types are a superset of this.
// ---------------------------------------------------------------------------

declare namespace Deno {
  const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
  };

  function serve(
    handler: (request: Request) => Response | Promise<Response>
  ): void;

  function exit(code?: number): never;
}

declare var EdgeRuntime:
  | {
      waitUntil?: (promise: Promise<unknown>) => void;
    }
  | undefined;
