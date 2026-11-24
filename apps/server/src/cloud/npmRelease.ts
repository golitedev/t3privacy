import {
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
  type ServerNpmRelease,
} from "@t3tools/contracts";
import {
  CLI_RELEASES_PAGE_URL,
  cliReleaseAssetUrl,
  cliReleaseChannelOf,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
} from "@t3tools/shared/cliRelease";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/http";

const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/));
const Manifest = Schema.Struct({
  version: Version,
  t3code: Schema.Struct({ databaseMigration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
});
const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest));
const decodeReleases = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ tag_name: Schema.String, draft: Schema.Boolean })),
  ),
);
const decodeInput = Schema.decodeUnknownEffect(ServerNpmReleaseInput);

// Retain the RPC service name for client compatibility; fork releases do not depend on npm.
export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("t3/cloud/npmRelease") {}

export const make = Effect.fn("NpmRelease.make")(function* () {
  const http = yield* HttpClient.HttpClient;
  const cache = yield* Cache.make({
    capacity: 32,
    timeToLive: Duration.minutes(1),
    lookup: Effect.fn("NpmRelease.lookup")(
      function* (spec: string) {
        let version = spec;
        if (spec === "nightly") {
          for (let page = 1; ; page++) {
            const response = yield* http.get(cliReleaseIndexPageUrl(page));
            if (response.status === 404) return null;
            if (response.status !== 200)
              return yield* new ServerNpmReleaseError({ reason: "Release index unavailable." });
            const releases = yield* decodeReleases(yield* response.text);
            const found = newestCliReleaseVersion(releases, "nightly");
            if (found !== undefined) {
              version = found;
              break;
            }
            if (releases.length < 100) return null;
          }
        }
        const url =
          spec === "latest"
            ? `${CLI_RELEASES_PAGE_URL}/latest/download/release.json`
            : cliReleaseAssetUrl(version, "release.json");
        const response = yield* http.get(url);
        if (response.status === 404) return null;
        if (response.status !== 200)
          return yield* new ServerNpmReleaseError({ reason: "Release metadata unavailable." });
        const manifest = Option.getOrUndefined(decodeManifest(yield* response.text));
        if (
          manifest === undefined ||
          (spec === "latest"
            ? cliReleaseChannelOf(manifest.version) !== "stable"
            : manifest.version !== version)
        ) {
          return yield* new ServerNpmReleaseError({ reason: "Invalid fork release metadata." });
        }
        return { version: manifest.version, databaseMigration: manifest.t3code.databaseMigration };
      },
      Effect.timeout(Duration.seconds(15)),
      Effect.mapError(
        () =>
          new ServerNpmReleaseError({
            reason: "Could not read fork release metadata from GitHub.",
          }),
      ),
    ),
  });
  return NpmRelease.of({
    get: Effect.fn("NpmRelease.get")(function* (input) {
      const { spec } = yield* decodeInput(input).pipe(
        Effect.mapError(
          () => new ServerNpmReleaseError({ reason: "Invalid release version or track." }),
        ),
      );
      return yield* Cache.get(cache, spec);
    }),
  });
});

export const layer = Layer.effect(NpmRelease, make()).pipe(Layer.provide(FetchHttpClient.layer));
