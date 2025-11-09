<p align="center">
  <img src="/icons/icon.png" width="80" />
  <h2 align="center">TabSync</h2>
  <p align="center">
  <b>TabSync</b> is an electron-based desktop app which lets you instantly share open browser tabs between your desktop and mobile — all over your local Wi-Fi, without the cloud.
  </p>
</p>

## Alternate to desktop app:

- Install the [tabsync-cli](https://www.npmjs.com/package/tabsync-cli) [tabsync-cli-source](https://github.com/jayantur13/tabsync-cli)

## Chrome/Edge [extension](https://github.com/jayantur13/tabsync-extension) is required to communicate data

---

## Quick Start

Once started, the app will:

- Detect your local IP address
- Launch a lightweight Express + WebSocket server
- Shows status - Connecting, Connected, Disconnected 
- Shows server address ip:port for web

---

## What It Does

- The server (server.js) keeps track of all connected devices and their open tabs.
- Each device (desktop or mobile) connects via WebSocket and automatically syncs tab URLs.
- When a device goes offline for more than 5 minutes, it’s cleaned up automatically and disappears from the screen (refresh needed).
- You can also add URLs manually using the input box on the web page.

---

## App Options

- Settings
  - Port Settings
  - env loading (separate)
  - Auto launch app on startup

---

## Web Interface/App

Open your browser at:

```bash
http://<your-local-ip>:port
```

You’ll see:

- A list of devices connected to your TabSync session
- Their open tabs as clickable links
- A field to add new URLs to sync instantly

The UI updates in real time whenever devices connect, disconnect (requires refresh), or share new tabs.

---

## How It Works

- server.js → Express + WebSocket server handling connections and sync
- index.html → Frontend UI that receives live updates and renders devices/tabs
- CLI script → Spawns the server, detects IP, and shows QR code for easy connection

---

## Auto Cleanup

Inactive devices (no activity for 5 minutes) are automatically removed, and all clients update instantly — refresh required.

---

## Changelog

For all the important changelog vist [Changelog](https://github.com/jayantur13/tabsync-desktop/blob/main/Changelog.md)

## Contributing

Contributions are always welcome!

See [Contributing](https://github.com/jayantur13/tabsync-desktop/blob/main/CONTRIBUTING.md) for ways to get started.

Please adhere to this project's [Code Of Conduct](https://github.com/jayantur13/tabsync-desktop/blob/main/CODE_OF_CONDUCT.md).

## Support

Support the developers for this project to live long.For issues, open a new issue or use discussion.

## License

This project is licensed under the [MIT License](https://github.com/jayantur13/tabsync-desktop/blob/main/LICENSE)
