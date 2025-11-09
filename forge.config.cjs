const MakerSquirrel = require("@electron-forge/maker-squirrel").default;
const MakerAppImage = require("@pengx17/electron-forge-maker-appimage").default;
const MakerZip = require("@electron-forge/maker-zip").default;
const MakerDeb = require("@electron-forge/maker-deb").default;
const MakerRpm = require("@electron-forge/maker-rpm").default;
const PluginAutoUnpackNatives =
  require("@electron-forge/plugin-auto-unpack-natives").default;
const PluginFuses = require("@electron-forge/plugin-fuses").default;
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const PublisherGithub = require("@electron-forge/publisher-github").default;
const path = require("path");

const isMaking =
  process.env.NODE_ENV === "production" || process.argv.includes("make");

const plugins = [new PluginAutoUnpackNatives()];

if (isMaking) {
  plugins.push(
    new PluginFuses({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
    })
  );
}

module.exports = {
  packagerConfig: {
    executableName: "tabsync-desktop",
    asar: true,
    asarUnpack: [
      "server/**", // ✅ Unpack entire server folder
      "server/node_modules/**", // ✅ Unpack its dependencies
    ],
    extraResource: [
      "server", // ✅ Copy server folder as-is
    ],
    icon: path.resolve(__dirname, "icons/icon"),
    ignore: [/^\/(dist|out|node_modules\/\.cache)/],
    files: [
      "**/*",
      "server/**", // ✅ Explicitly include
      "!out/**",
      "!dist/**",
      "!node_modules/.cache/**",
    ],
  },
  rebuildConfig: {},
  extraResource: [],
  makers: [
    new MakerSquirrel({
      authors: "Jayant Navrange",
      description: "TabSync Electron app for syncing browser tabs.",
      name: "tabsync",
      setupIcon: path.resolve(__dirname, "icons/icon.ico"),
    }),
    new MakerAppImage({
      name: "tabsync",
      platforms: ["linux"],
      config: { template: "assets/AppRunTemplate.sh" },
    }),
    new MakerZip({ platforms: ["linux", "darwin", "win32"] }),
    new MakerDeb({
      options: {
        maintainer: "Jayant Navrange",
        homepage: "https://github.com/jayantur13/tabsync-desktop",
        categories: ["Utility"],
        icon: path.resolve(__dirname, "icons/icon.png"),
      },
    }),
    new MakerRpm({
      options: {
        homepage: "https://github.com/jayantur13/tabsync-desktop",
      },
    }),
  ],
  plugins,
  publishers: [
    new PublisherGithub({
      repository: {
        owner: "jayantur13",
        name: "tabsync-desktop",
      },
      prerelease: false,
      draft: true,
    }),
  ],
};
