import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  dialog,
  shell,
  screen
} from "electron";
import electronSquirrelStartup from "electron-squirrel-startup";

// 🧩 Handle Squirrel.Windows startup events (must run before everything else)
if (electronSquirrelStartup) {
  app.quit();
}

app.setAppUserModelId("com.squirrel.TabSync.TabSync");

import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import updaterPkg from "electron-updater";
const { autoUpdater } = updaterPkg;
import Store from "electron-store";
import AutoLaunch from "auto-launch";
import dotenv from "dotenv";
import { fork } from "child_process";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 🧩 Load .env if present
dotenv.config({ path: path.join(__dirname, ".env") });

let mainWindow;
let tray;
let serverProcess;
let isQuitting = false;

// Persistent config with defaults + .env overrides
const store = new Store({
  defaults: {
    port: process.env.TABSYNC_PORT || 3210,
    autoLaunch: process.env.TABSYNC_AUTO_LAUNCH === "true",
    minimizeToTray: process.env.TABSYNC_MINIMIZE_TO_TRAY !== "false",
  },
});

const appLauncher = new AutoLaunch({
  name: "TabSync",
  path: app.getPath("exe"),
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

function startServer(cfg) {
  return new Promise((resolve, reject) => {
    let serverPath;
    if (app.isPackaged) {
      serverPath = path.join(process.resourcesPath, "server", "server.js");
    } else {
      serverPath = path.join(__dirname, "server", "server.js");
    }

    if (!fs.existsSync(serverPath)) {
      console.error("❌ Server file missing:", serverPath);
      return reject(new Error("Server file not found"));
    }

    const env = { ...process.env, TABSYNC_IP: getLocalIP() };
    if (cfg.port) env.TABSYNC_PORT = cfg.port;
    env.TABSYNC_NO_QR = cfg.showQR ? "0" : "1";

    console.log("🚀 Starting TabSync server (in-app)...");
    console.log("🛠 Using:", serverPath);

    const options = {
      env,
      stdio: ["inherit", "pipe", "pipe", "ipc"],
    };

    serverProcess = fork(serverPath, [], options);

    let ready = false;
    let timeout = setTimeout(() => {
      if (!ready) {
        reject(new Error("Server did not start in time"));
        serverProcess.kill();
      }
    }, 20000);

    serverProcess.stdout.on("data", (data) => {
      const line = data.toString().trim();
      console.log(line);
      if (line.includes("SERVER_READY")) {
        ready = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.stderr.on("data", (data) => console.error(data.toString()));
    serverProcess.on("error", reject);
    serverProcess.on("exit", (code) => {
      if (!isQuitting && code !== 0) {
        console.error(`❌ Server crashed with code ${code}`);
      }
    });
  });
}

function createMainWindow(cfg) {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    icon: path.join(__dirname, "icons", "icon.png"),

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

 mainWindow.once("ready-to-show", () => {
  // prevent off-screen launch
  try {
    const [x, y] = mainWindow.getPosition();
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    if (x < 0 || y < 0 || x > width || y > height) mainWindow.center();
  } catch {}

  mainWindow.show();
  mainWindow.focus();
});


  mainWindow.on("close", (event) => {
    if (!isQuitting && store.get("minimizeToTray")) {
      event.preventDefault();
      mainWindow.hide();
      tray.displayBalloon?.({
        title: "TabSync",
        content: "Still running in background (tray).",
      });
    } else {
      if (serverProcess) serverProcess.kill();
      mainWindow = null;
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, "icons", "tray.png"));
  const contextMenu = Menu.buildFromTemplate([
    { label: "Open TabSync", click: () => mainWindow.show() },
    { label: "Settings", click: openSettings },
    { type: "separator" },
    {
      label: "Check for Updates",
      click: () => autoUpdater.checkForUpdatesAndNotify(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
    ,
  ]);
  tray.setToolTip("TabSync is running");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => mainWindow.show());
}

function openSettings() {
  const win = new BrowserWindow({
    width: 420,
    height: 400,
    resizable: false,
    title: "TabSync Settings",
    icon: path.join(__dirname, "icons", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "settings.html"));
}

/* IPC */
ipcMain.handle("get-config", () => store.store);

ipcMain.handle("save-config", async (event, newCfg) => {
  store.set(newCfg);
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["Restart Now", "Later"],
    message: "Settings saved. Restart TabSync to apply changes.",
  });
  if (result.response === 0) restartApp();
});

ipcMain.handle("toggle-auto-launch", async (event, enable) => {
  try {
    if (enable) await appLauncher.enable();
    else await appLauncher.disable();
    store.set("autoLaunch", enable);
    return true;
  } catch (err) {
    console.error("Auto-launch error:", err);
    return false;
  }
});

ipcMain.on("open-external", (event, url) => {
  console.log("🌐 Opening external:", url);
  shell.openExternal(url);
});

function restartApp() {
  app.relaunch();
  app.exit(0);
}

app.whenReady().then(async () => {
  const cfg = store.store;

  // Ensure window shows on first launch or after install
  if (!cfg.hasLaunchedBefore) {
    store.set("hasLaunchedBefore", true);
    cfg.minimizeToTray = false; // force visible
  }

  const enabled = await appLauncher.isEnabled();
  if (cfg.autoLaunch && !enabled) await appLauncher.enable();
  if (!cfg.autoLaunch && enabled) await appLauncher.disable();

  await startServer(cfg);
  createMainWindow(cfg);
  createTray();

  // Explicitly ensure window shows
  autoUpdater.checkForUpdatesAndNotify();
});

app.on("before-quit", () => {
  isQuitting = true;
});
