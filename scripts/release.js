#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import prompts from "prompts";
import simpleGit from "simple-git";
import { Octokit } from "@octokit/rest";

const git = simpleGit();
const changelogPath = "CHANGELOG.md";

async function uploadBinaries(octokit, releaseId) {
  const distDir = "out/make";
  if (!fs.existsSync(distDir)) return;

  const binaryExts = [".appimage", ".deb", ".rpm", "releases"];

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
  console.log("🚀 TabSync Release Helper (Copy Local Notes Mode)");

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

  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

  // 2. Read and Parse the local CHANGELOG.md
  if (!fs.existsSync(changelogPath)) {
    throw new Error("❌ CHANGELOG.md not found! Please create it and add your release notes.");
  }

  const changelogContent = fs.readFileSync(changelogPath, "utf8");

  // Extract everything between the main header/title and the END marker
  const releaseNotesMatch = changelogContent.split("")[0];
  // Strip off the main document title "# 🧾 ChangeLog" so it doesn't clutter the GitHub release page
  const formattedReleaseBody = releaseNotesMatch.replace(/# 🧾 ChangeLog/i, "").trim();

  if (!formattedReleaseBody) {
    throw new Error("❌ Could not extract new release notes. Make sure '' is present in your file.");
  }

  // 3. Commit and Push core repo files (including your manually edited changelog)
  await git.add(["CHANGELOG.md", "package.json"]);
  await git.commit(`chore(release): ${pkg.version}`);
  await git.push();

  // 4. Handle Tags safely
  const tag = `v${pkg.version}`;
  const localTags = await git.tags();
  if (localTags.all.includes(tag)) {
    await git.tag(["-f", tag]);
  } else {
    await git.addTag(tag);
  }
  await git.push(["-f", "origin", tag]);
  console.log("📤 Commits and version tags pushed to GitHub.");

  // 5. Compile Linux locally
  console.log("🏗️ Compiling local Linux assets...");
  execSync("npm run make:linux", { stdio: "inherit" });

  // 6. Create GitHub Release Draft using your exact copied notes
  if (!process.env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN in environment.");
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  console.log("🚀 Creating GitHub Draft Release...");
  const release = await octokit.repos.createRelease({
    owner: "jayantur13",
    repo: "tabsync-desktop",
    tag_name: tag,
    name: `${tag}`,
    body: formattedReleaseBody,
    draft: true, // Creates the draft framework first
  });

  console.log(`✅ Draft release created: ${release.data.html_url}`);

  // 7. Upload Linux binaries to this specific draft
  await uploadBinaries(octokit, release.data.id);
  console.log("✅ Local Linux assets uploaded to draft.");

  // 8. ✨ PUSH THE TAG LAST ✨
  // Moving this here ensures GitHub Actions doesn't start until the draft completely exists
  console.log("🏷️ Registering and pushing version tags to GitHub...");
  const localTags = await git.tags();
  if (localTags.all.includes(tag)) {
    await git.tag(["-f", tag]);
  } else {
    await git.addTag(tag);
  }

  // This push acts as the final trigger for your Windows cloud workflow
  await git.push(["-f", "origin", tag]);
  console.log("📤 Version tags pushed. GitHub Actions will now compile Windows assets.");

  console.log("\n🎉 Local release process completed successfully! Check GitHub for the cloud build status.");
}

main().catch((err) => {
  console.error("❌ Release failed:", err);
  process.exit(1);
});