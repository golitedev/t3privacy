import { expect, it } from "@effect/vitest";
import { upsertServiceEnv } from "./service.ts";

it("rewrites only the named service.env keys and keeps the user's lines", () => {
  const before = ["# my settings", "T3CODE_PORT=4000", "export T3CODE_LAN=0", "T3CODE_LAN=1", ""];
  expect(upsertServiceEnv(before.join("\n"), { T3CODE_LAN: "true", T3CODE_HOST: undefined })).toBe(
    ["# my settings", "T3CODE_PORT=4000", "T3CODE_LAN=true", ""].join("\n"),
  );
  expect(upsertServiceEnv("", { T3CODE_LAN: "false" })).toBe("T3CODE_LAN=false\n");
  expect(
    upsertServiceEnv('T3CODE_LAN="a\nb"\nCUSTOM="x\nT3CODE_LAN=y"\nT3CODE_LAN=true\n', {
      T3CODE_LAN: "false",
    }),
  ).toBe('T3CODE_LAN=false\nCUSTOM="x\nT3CODE_LAN=y"\n');
  expect(
    upsertServiceEnv('T3CODE_LAN=\u00a0"unused\nCUSTOM=keep\nEND="\nT3CODE_LAN=true\n', {
      T3CODE_LAN: "false",
    }),
  ).toBe('T3CODE_LAN=false\nCUSTOM=keep\nEND="\n');
  const long = `CUSTOM="${"\n".repeat(130_000)}"\n`;
  expect(upsertServiceEnv(`${long}T3CODE_LAN=true\n`, { T3CODE_LAN: "false" })).toBe(
    `${long}T3CODE_LAN=false\n`,
  );
});
