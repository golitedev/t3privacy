# Privacy and diagnostics

This fork does not collect product analytics or send crash reports, traces, metrics, or
diagnostic logs. Diagnostics remain available on the device that wrote them. Existing
telemetry environment variables and saved exporter URLs cannot start an exporter.

The server uses the model catalog bundled with the build. It does not refresh the catalog
from upstream at runtime. Desktop and mobile builds do not check upstream for updates
automatically.

A provider, integration, browser preview, or command can still contact services you use.
Those services have their own network activity and privacy settings.
