import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  MenuItem,
  ipcMain,
  dialog,
  shell,
  screen
} from "electron";

app.setAppUserModelId("com.jayantur13.tabsync-desktop");

import path, { format } from "path";
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
let checkUpdateMenuItem;
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
    } catch { }

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
      id: "check-update", // Added an ID so we can look it up later
      label: "Check for Updates",
      click: () => {
        autoUpdater.checkForUpdatesAndNotify();
        if (checkUpdateMenuItem) {
          checkUpdateMenuItem.label = "Checking...";
          tray.setContextMenu(contextMenu);
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  checkUpdateMenuItem = contextMenu.getMenuItemById("check-update");
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
  // 1. Get the current menu AFTER the app is ready
  const currentMenu = Menu.getApplicationMenu();

  if (currentMenu) {
    // 2. Create your custom menu item
    const myCustomMenu = new MenuItem({
      label: 'TabSync',
      submenu: [{
        label: 'Settings', click: () => {
          openSettings();
        }
      }]
    });

    // 3. Append and reset
    currentMenu.append(myCustomMenu);
    Menu.setApplicationMenu(currentMenu);
  }
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

/* ==========================================
      ELECTRON UPDATER EVENT LISTENERS
   ========================================== */

autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  if (checkUpdateMenuItem) {
    checkUpdateMenuItem.label = "Update found! Downloading...";
    tray.setContextMenu(Menu.getApplicationMenu() || tray.getContextMenu());
  }

  //  Pop a native system notification bubble
  tray.displayBalloon?.({
    title: "TabSync Update",
    content: `Version ${info.version} is available and downloading!`,
  });

  // Tell your UI window that an update started downloading
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'downloading', percent: 0 });
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  console.log(`Download progress: ${percent}%`);

  // Update Tray context menu label reactively
  if (checkUpdateMenuItem) {
    checkUpdateMenuItem.label = `Downloading Update (${percent}%)`;
    // Re-set context menu to trigger a visual layout redraw in Windows taskbar
    const currentMenu = tray.getContextMenu();
    if (currentMenu) tray.setContextMenu(currentMenu);
  }

  // Pass raw numeric progress to your HTML UI
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'downloading', percent });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  if (checkUpdateMenuItem) {
    checkUpdateMenuItem.label = "Update Ready (Restart App)";
    const currentMenu = tray.getContextMenu();
    if (currentMenu) tray.setContextMenu(currentMenu);
  }

  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'ready' });
  }

  // Ask the user to restart immediately or defer
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: `Version ${info.version} has downloaded. Would you like to restart TabSync to install it now?`,
    buttons: ['Restart Now', 'Later']
  }).then((result) => {
    if (result.response === 0) {
      isQuitting = true; // prevent minimize-to-tray loop interception
      autoUpdater.quitAndInstall();
    }
  });
});

autoUpdater.on('error', (err) => {
  console.error('Updater error:', err);
  if (checkUpdateMenuItem) {
    checkUpdateMenuItem.label = "Check for Updates";
    const currentMenu = tray.getContextMenu();
    if (currentMenu) tray.setContextMenu(currentMenu);
  }
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'error', message: err.message });
});