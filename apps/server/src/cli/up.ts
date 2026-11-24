import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/cli";

import * as BootService from "../cloud/bootService.ts";
import * as ServerConfig from "../config.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import * as CliService from "./service.ts";

const encodeStatus = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const upCommand = Command.make("up", {
  ...projectLocationFlags,
  lan: Flag.Boolean("lan").pipe(
    Flag.optional,
    Flag.withDescription("Allow paired devices on the LAN to connect."),
  ),
}).pipe(
  Command.withDescription("Install or start the background service."),
  Command.withHandler(
    Effect.fn("cli.up")(function* (flags) {
      const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
      const status = yield* Effect.gen(function* () {
        if (Option.isSome(flags.lan)) {
          yield* CliService.writeServiceEnv(config.baseDir, {
            T3CODE_LAN: String(flags.lan.value),
          });
        }
        const service = yield* CliService.reconcileService();
        if (!service.changed) yield* (yield* BootService.BootService).restart;
        return service;
      }).pipe(Effect.provide(Layer.mergeAll(CliService.layer(config), ServerConfig.layer(config))));
      yield* Console.log(
        status.changed ? CliService.formatServiceChange(status) : "Service started.",
      );
      yield* Console.log("Run t3 pair to connect a device.");
    }),
  ),
);

export const statusCommand = Command.make("status", {
  ...projectLocationFlags,
  json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
}).pipe(
  Command.withDescription("Show the background service and LAN access settings."),
  Command.withHandler(
    Effect.fn("cli.status")(function* (flags) {
      const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel, {
        quietLogs: flags.json,
      });
      const service = yield* BootService.BootService.pipe(
        Effect.flatMap((service) => service.status),
        Effect.provide(CliService.layer(config)),
      );
      const { entries } = yield* CliService.readServiceEnv(config.baseDir);
      const lan = yield* Config.Boolean("T3CODE_LAN")
        .pipe(Config.option)
        .parse(ConfigProvider.fromEnv({ env: entries }));
      const enabled = Option.getOrElse(lan, () => service.installed && !service.otherBaseDir);
      if (flags.json) {
        const json = yield* encodeStatus({ service, lan: { enabled } });
        yield* Console.log(json);
      } else {
        yield* Console.log(
          `Background service: ${service.installed ? "installed" : "not installed"}`,
        );
        yield* Console.log(`LAN access: ${enabled ? "enabled" : "disabled"}`);
      }
    }),
  ),
);
