# Connect devices over your LAN

Keep the host and client on the same local network. Use the web app served by your own
host, or build and install the desktop or mobile client from this fork.

## Command-line host

Start the server in the project directory.

```bash
t3 serve --lan
```

Open the printed pairing URL from the other device or scan the QR code in the mobile
app. Run `t3 pair` on the host to generate a fresh pairing code. If you run the background
service, use `t3 up --lan` to allow LAN access and `t3 up --no-lan` to turn it off.

## Desktop host

Open **Settings → Sharing & access** on the host. Enable **Network access** and create a
pairing link. In the client, open **Environments** and add the link or its LAN address and
pairing code. Revoke codes and paired devices from **Sharing & access**.

Access uses loopback or a private LAN IP address. For an existing environment that used
T3 Connect, Tailscale, or an SSH-managed route, add a new pairing link for its LAN address.
Direct LAN HTTP is unencrypted, so pair on a network you trust.
