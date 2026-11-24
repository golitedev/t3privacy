import { expect, it } from "@effect/vitest";
import { ServerNpmReleaseError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as NpmRelease from "./npmRelease.ts";

const version = "0.1.11";
const manifest = { version, t3code: { databaseMigration: 134 } };
const makeService = (respond: (url: string) => { status: number; body: unknown }) =>
  NpmRelease.make().pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        const { status, body } = respond(request.url);
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status })),
        );
      }),
    ),
  );

it.effect.each(["latest", version])(
  "resolves %s from this fork and caches compatibility metadata",
  (spec) =>
    Effect.gen(function* () {
      const urls: string[] = [];
      const service = yield* makeService((url) => {
        urls.push(url);
        return { status: 200, body: manifest };
      });
      const expected = { version, databaseMigration: 134 };
      expect(yield* service.get({ spec })).toEqual(expected);
      expect(yield* service.get({ spec })).toEqual(expected);
      expect(urls).toEqual([
        spec === "latest"
          ? "https://github.com/golitedev/t3privacy/releases/latest/download/release.json"
          : `https://github.com/golitedev/t3privacy/releases/download/v${version}/release.json`,
      ]);
      yield* TestClock.adjust("1 minute");
      expect(yield* service.get({ spec })).toEqual(expected);
      expect(urls).toHaveLength(2);
    }),
);

it.effect("pages past stable releases to resolve a published nightly", () =>
  Effect.gen(function* () {
    const nightly = "0.1.12-nightly.20261124.4";
    const urls: string[] = [];
    const service = yield* makeService((url) => {
      urls.push(url);
      if (new URL(url).searchParams.get("page") === "1")
        return {
          status: 200,
          body: Array.from({ length: 100 }, () => ({ tag_name: "v0.1.11", draft: false })),
        };
      if (new URL(url).searchParams.get("page") === "2")
        return { status: 200, body: [{ tag_name: `v${nightly}`, draft: false }] };
      return { status: 200, body: { ...manifest, version: nightly } };
    });
    expect(yield* service.get({ spec: "nightly" })).toEqual({
      version: nightly,
      databaseMigration: 134,
    });
    expect(urls).toEqual([
      "https://api.github.com/repos/golitedev/t3privacy/releases?per_page=100&page=1",
      "https://api.github.com/repos/golitedev/t3privacy/releases?per_page=100&page=2",
      `https://github.com/golitedev/t3privacy/releases/download/v${nightly}/release.json`,
    ]);
  }),
);

it.effect.each(["latest", version, "nightly"])("returns null for unpublished %s", (spec) =>
  Effect.gen(function* () {
    const service = yield* makeService(() => ({ status: 404, body: {} }));
    expect(yield* service.get({ spec })).toBeNull();
  }),
);

it.effect.each([
  { version: "0.1.10", t3code: { databaseMigration: 134 } },
  { version, t3code: { databaseMigration: -1 } },
  { version },
])("rejects mismatched versions and missing or invalid migration metadata: %j", (body) =>
  Effect.gen(function* () {
    const service = yield* makeService(() => ({ status: 200, body }));
    const result = yield* Effect.result(service.get({ spec: version }));
    expect(Result.isFailure(result)).toBe(true);
  }),
);

it.effect("does not offer a nightly as stable", () =>
  Effect.gen(function* () {
    const service = yield* makeService(() => ({
      status: 200,
      body: { ...manifest, version: "0.1.12-nightly.20261124.4" },
    }));
    const result = yield* Effect.result(service.get({ spec: "latest" }));
    expect(Result.isFailure(result)).toBe(true);
  }),
);

it.effect("reports network failures without falling back to upstream or npm", () =>
  Effect.gen(function* () {
    const service = yield* makeService(() => ({ status: 503, body: {} }));
    const result = yield* Effect.result(service.get({ spec: version }));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ServerNpmReleaseError);
  }),
);

it.effect.each(["--registry=https://example.com", "../other", "other-package@latest", "*", ""])(
  "rejects invalid release input %s before making a request",
  (spec) =>
    Effect.gen(function* () {
      const service = yield* makeService(() => {
        throw new Error("Must not request invalid specs");
      });
      const result = yield* Effect.result(service.get({ spec }));
      expect(Result.isFailure(result)).toBe(true);
    }),
);
