import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";
import "./runtime";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("web runtime privacy", () => {
  it.each([false, true])(
    "never exports traces when a legacy desktop policy returns %s",
    async (enabled) => {
      vi.resetModules();
      vi.stubEnv("VITE_RELAY_OTLP_TRACES_URL", "https://telemetry.example.test/v1/traces");
      vi.stubEnv("VITE_RELAY_OTLP_TRACES_DATASET", "relay-test");
      vi.stubEnv("VITE_RELAY_OTLP_TRACES_TOKEN", "test-token");
      vi.stubGlobal("window", { desktopBridge: { getRelayTelemetryEnabled: () => enabled } });
      const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
      vi.stubGlobal("fetch", fetchFn);
      const { runtime } = await import("./runtime");
      const { setDelegate } = await import("../observability/clientTracer");
      const spans: Array<string> = [];
      try {
        setDelegate(
          Tracer.make({
            span(options) {
              spans.push(options.name);
              return new Tracer.NativeSpan(options);
            },
          }),
        );
        await runtime.runPromise(Effect.void.pipe(Effect.withSpan("local.work")));
        expect(spans).toEqual(["local.work"]);
      } finally {
        setDelegate(null);
        await runtime.dispose();
      }
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );
});
