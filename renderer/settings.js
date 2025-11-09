const portInput = document.getElementById("port");
const autoLaunchInput = document.getElementById("autoLaunch");
const minimizeToTrayInput = document.getElementById("minimizeToTray");
const saveBtn = document.getElementById("save");

window.tabsync.getConfig().then((cfg) => {
  portInput.value = cfg.port;
  autoLaunchInput.checked = cfg.autoLaunch;
  minimizeToTrayInput.checked = cfg.minimizeToTray;
});

autoLaunchInput.addEventListener("change", async () => {
  const enabled = autoLaunchInput.checked;
  await window.tabsync.toggleAutoLaunch(enabled);
});

saveBtn.addEventListener("click", async () => {
  const cfg = {
    port: parseInt(portInput.value, 10),
    autoLaunch: autoLaunchInput.checked,
    minimizeToTray: minimizeToTrayInput.checked,
  };
  await window.tabsync.saveConfig(cfg);
  alert("✅ Settings saved. Restart required to apply changes.");
});
