#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import prompts from "prompts";
import simpleGit from "simple-git";
import { Octokit } from "@octokit/rest";

const git = simpleGit();
const changelogPath = "CHANGELOG.md";

function formatDate() {
  const now = new Date();
  return now.toLocaleDateString("en-GB").replace(/\//g, ".");
}

async function uploadBinaries(octokit, releaseId) {
  const distDir = "out/make";
  if (!fs.existsSync(distDir)) return;

  const binaryExts = [".appimage", ".deb", ".rpm", "RELEASES"];
  
  function walk(dir) {
    let results = [];
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      if (fs.statSync(full).isDirectory()) results = results.concat(walk(full));
      else results.push(full);
    }
    return results;
  }

  const binaries = walk(distDir).filter((f) =>
    binaryExts.some((ext) => f.toLowerCase().endsWith(ext))
  );

  for (const filePath of binaries) {
    const fileName = path.basename(filePath);
    console.log(`⬆️ Uploading Linux asset: ${fileName}`);
    try {
      const data = fs.readFileSync(filePath);
      await octokit.repos.uploadReleaseAsset({
        owner: "jayantur13",
        repo: "tabsync-desktop",
        release_id: releaseId,
        name: fileName,
        data,
        headers: { "content-length": data.length, "content-type": "application/octet-stream" },
      });
    } catch (err) {
      console.error(`❌ Failed to upload ${fileName}:`, err.message);
    }
  }
}

async function main() {
  console.log("🚀 TabSync Release Helper (Developer Written)");

  // 1. Version Bump Selection
  const { bump } = await prompts({
    type: "select",
    name: "bump",
    message: "Select version bump type:",
    choices: [
      { title: "None (use existing)", value: "none" },
      { title: "Patch", value: "patch" },
      { title: "Minor", value: "minor" },
      { title: "Major", value: "major" },
    ],
  });

  if (bump !== "none") {
    execSync(`npm version ${bump} --no-git-tag-version`, { stdio: "inherit" });
  }

  // Refresh package metadata reference post-bump
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const versionHeader = `## ${pkg.version} – _${formatDate()}_\n`;

  // 2. Prep Custom Entry File Writing
  let existingContent = "";
  if (fs.existsSync(changelogPath)) {
    existingContent = fs.readFileSync(changelogPath, "utf8").replace(/^# 🧾 ChangeLog\s*/i, "");
  }

  // Template stub we inject to help write notes quickly
  const editTemplate = `${versionHeader}\n### 🚀 Changes\n- Add your notes here...\n\n\n${existingContent}`;
  fs.writeFileSync(changelogPath, editTemplate);

  // 3. Open your terminal environment's preferred text editor automatically
  console.log("📝 Opening CHANGELOG.md for your notes...");
  const editor = process.env.EDITOR || "code --wait" || "nano"; 
  // Note: if you use VS Code globally, 'code --wait' is ideal. If on basic linux servers, falls back to nano.
  execSync(`${editor} ${changelogPath}`, { stdio: "inherit" });

  // 4. Capture what the developer just finished writing
  const finalChangelog = fs.readFileSync(changelogPath, "utf8");
  
  // Isolate just the new text block to use as the GitHub Release description body
  const rawReleaseBody = finalChangelog.split("")[0];
  const formattedReleaseBody = rawReleaseBody.replace(versionHeader, "").trim();

  // Add clean main structure title to the top of file
  if (!finalChangelog.startsWith("# 🧾 ChangeLog")) {
    fs.writeFileSync(changelogPath, `# 🧾 ChangeLog\n\n${finalChangelog.replace(/^# 🧾 ChangeLog\s*/i, "").trim()}\n`);
  }

  // 5. Commit and Push core repo files
  await git.add(["CHANGELOG.md", "package.json"]);
  await git.commit(`chore(release): ${pkg.version}`);
  await git.push();

  // 6. Push Safe Dynamic Git Tags to trigger the Windows Build Pipeline in GitHub Actions
  const tag = `v${pkg.version}`;
  const localTags = await git.tags();
  if (localTags.all.includes(tag)) {
    await git.tag(["-f", tag]);
  } else {
    await git.addTag(tag);
  }
  await git.push(["-f", "origin", tag]);
  console.log("📤 Core commits and version tags pushed.");

  // 7. Compile Linux locally (Windows compiled dynamically via GitHub Actions runner workflow instead)
  console.log("🏗️ Compiling local Linux assets...");
  execSync("npm run make:linux", { stdio: "inherit" });

  // 8. Create GitHub Release Draft mapping your direct text input
  if (!process.env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN in environment.");
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const release = await octokit.repos.createRelease({
    owner: "jayantur13",
    repo: "tabsync-desktop",
    tag_name: tag,
    name: `${tag}`,
    body: formattedReleaseBody, // Exact developer words map here perfectly
    draft: true,
  });

  console.log(`✅ Draft release created: ${release.data.html_url}`);
  await uploadBinaries(octokit, release.data.id);
  console.log("\n🎉 Release process completed successfully!");
}

main().catch((err) => {
  console.error("❌ Release failed:", err);
  process.exit(1);
});