import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as NpmRelease from "./npmRelease.ts";

const version = "0.1.13-privacy.1";
const release = { version, t3code: { databaseMigration: 42 } };

it.effect("looks up the fork's current and exact releases and caches the migration metadata", () =>
  Effect.gen(function* () {
    const urls: string[] = [];
    const http = HttpClient.make((request) => {
      urls.push(request.url);
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(release)));
    });
    const service = yield* NpmRelease.make().pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    );
    const expected = { version, databaseMigration: 42 };

    expect(yield* service.get({ spec: "latest" })).toEqual(expected);
    expect(yield* service.get({ spec: "latest" })).toEqual(expected);
    expect(yield* service.get({ spec: version })).toEqual(expected);
    expect(yield* service.get({ spec: "nightly" })).toBeNull();
    expect(urls).toEqual([
      "https://github.com/golitedev/t3privacy/releases/latest/download/release.json",
      "https://github.com/golitedev/t3privacy/releases/download/v0.1.13-privacy.1/release.json",
    ]);
  }),
);

it.effect("returns no release when the fork has no matching asset", () =>
  Effect.gen(function* () {
    const http = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
    );
    const service = yield* NpmRelease.make().pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    );
    expect(yield* service.get({ spec: "0.1.13" })).toBeNull();
  }),
);

it.effect("rejects metadata for a different version", () =>
  Effect.gen(function* () {
    const http = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(release))),
    );
    const service = yield* NpmRelease.make().pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    );
    const error = yield* Effect.flip(service.get({ spec: "0.1.13-privacy.2" }));
    expect(error.reason).toContain("unexpected version");
  }),
);
