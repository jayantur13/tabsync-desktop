#!/usr/bin/env node
import fs from "fs";
import { execSync } from "child_process";
import prompts from "prompts";
import simpleGit from "simple-git";
import { Octokit } from "@octokit/rest";

const git = simpleGit();
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

async function generateChangelog() {
  const log = await git.log({ from: (await git.tags()).latest, to: "HEAD" });
  if (!log.all.length) return "No new commits since last release.";

  const formatted = log.all
    .map(({ message, hash }) => {
      const typeMatch = message.match(
        /^(feat|fix|chore|patch|update|refactor)/i
      );
      const type = typeMatch ? typeMatch[0].toUpperCase() : "Update";
      const cleanMsg = message.replace(
        /^(feat|fix|chore|patch|update|refactor)\:?\s*/i,
        ""
      );
      return `- **${type}:** ${cleanMsg} ([${hash.slice(0, 7)}](https://github.com/jayantur13/tabsync-desktop/commit/${hash}))`;
    })
    .join("\n");

  const now = new Date();
  const date = now.toLocaleDateString("en-GB").replace(/\//g, ".");

  return `# 🧾 Change Log

## ${pkg.version} – _${date}_

### 🚀 Release

${formatted}\n`;
}

async function main() {
  console.log("🚀 TabSync Release Helper");

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

  if (bump !== "none")
    execSync(`npm version ${bump} --no-git-tag-version`, { stdio: "inherit" });

  const changelog = await generateChangelog();
  fs.writeFileSync("CHANGELOG.md", changelog);

  console.log("📝 CHANGELOG.md generated.");

  // Commit changelog and version bump
  await git.add(["CHANGELOG.md", "package.json"]);
  await git.commit(`chore(release): ${pkg.version}`);
  await git.push();

  console.log("📤 Changes committed and pushed.");

  // Run build
  console.log("🏗️ Building app...");
  execSync("npm run make:all", { stdio: "inherit" });

  // Create GitHub draft release
  if (!process.env.GITHUB_TOKEN)
    throw new Error("Missing GITHUB_TOKEN in environment.");
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const tag = `v${pkg.version}`;

  const release = await octokit.repos.createRelease({
    owner: "jayantur13",
    repo: "tabsync-desktop",
    tag_name: tag,
    name: `TabSync ${tag}`,
    body: changelog,
    draft: true,
  });

  console.log(`✅ Draft release created: ${release.data.html_url}`);
}

main().catch((err) => {
  console.error("❌ Release failed:", err);
  process.exit(1);
});
