import type { ServerDirectEndpoint } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  formatHostForUrl,
  isTailnetHost,
  isWildcardHost,
} from "@t3tools/shared/hostClassification";

import * as ServerConfig from "../config.ts";
import {
  isLoopbackHost,
  isPrivateNetworkAddress,
  isVirtualInterface,
  WINDOWS_HOST_ADAPTER_MAC,
} from "../startupAccess.ts";

type NetworkInterfacesMap = ReturnType<typeof NodeOS.networkInterfaces>;

export class DirectEndpoints extends Context.Service<
  DirectEndpoints,
  {
    readonly resolveAvailable: () => Effect.Effect<ReadonlyArray<ServerDirectEndpoint>>;
    readonly resolve: () => Effect.Effect<ReadonlyArray<ServerDirectEndpoint>>;
  }
>()("t3/environment/DirectEndpoints") {}

// Credentials travel over HTTP; public IPs leak them and hostnames can resolve differently per client.
const isAdvertisableAddress = (address: string): boolean =>
  NodeNet.isIPv4(address) && !address.startsWith("127.") && isPrivateNetworkAddress(address);

// macOS utun names need Tailscale's IPv6 range to identify them; WARP shares its IPv4 range.
const isTailscaleInterface = (
  name: string,
  entries: ReadonlyArray<NodeOS.NetworkInterfaceInfo>,
): boolean =>
  /^tailscale/i.test(name) ||
  entries.some((entry) => entry.family === "IPv6" && isTailnetHost(entry.address));

export function resolveBoundEndpoints(input: {
  readonly platform: NodeJS.Platform;
  readonly host: string | undefined;
  readonly port: number;
  readonly interfaces: NetworkInterfacesMap;
  /** A cloud VM's private network is its provider's, which no client shares. */
  readonly onCloudVm?: boolean;
}): ReadonlyArray<ServerDirectEndpoint> {
  if (isLoopbackHost(input.host)) return [];
  const tailscaleAddresses = new Set(
    Object.entries(input.interfaces).flatMap(([name, entries = []]) =>
      isTailscaleInterface(name, entries) ? entries.map((entry) => entry.address) : [],
    ),
  );
  const addresses = isWildcardHost(input.host)
    ? Object.entries(input.interfaces)
        .flatMap(([name, entries]) =>
          isVirtualInterface(name, input.platform) ? [] : (entries ?? []),
        )
        .filter(
          (entry) =>
            !entry.internal &&
            entry.family === "IPv4" &&
            isAdvertisableAddress(entry.address) &&
            !(input.platform === "win32" && WINDOWS_HOST_ADAPTER_MAC.test(entry.mac)),
        )
        .map((entry) => entry.address)
    : [input.host!].filter(
        (address) =>
          isAdvertisableAddress(address) || (NodeNet.isIPv6(address) && isPrivateNetworkAddress(address)),
      );
  return [...new Set(addresses)]
    .filter((address) => !input.onCloudVm && !tailscaleAddresses.has(address))
    .map((address) => ({
      kind: "lan",
      httpBaseUrl: `http://${formatHostForUrl(address)}:${input.port}/`,
    }));
}

export const layer = Layer.effect(
  DirectEndpoints,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const platform = yield* HostProcess.Platform;
    const resolve = Effect.sync(() =>
      resolveBoundEndpoints({
        platform,
        host: config.host,
        port: config.port,
        interfaces: NodeOS.networkInterfaces(),
      }),
    );
    return DirectEndpoints.of({ resolveAvailable: () => resolve, resolve: () => resolve });
  }),
);
