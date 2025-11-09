#!/usr/bin/env node
import fs from "fs";
import { execSync } from "child_process";
import prompts from "prompts";
import simpleGit from "simple-git";
import { Octokit } from "@octokit/rest";

const git = simpleGit();
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

function formatDate() {
  const now = new Date();
  return now.toLocaleDateString("en-GB").replace(/\//g, ".");
}

function groupCommits(commits) {
  const groups = {
    feat: [],
    fix: [],
    refactor: [],
    chore: [],
    patch: [],
    update: [],
    misc: [],
  };

  for (const { message, hash } of commits) {
    const typeMatch = message.match(/^(feat|fix|refactor|chore|patch|update)/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : "misc";
    const cleanMsg = message.replace(/^(feat|fix|refactor|chore|patch|update):?\s*/i, "");
    groups[type].push({ msg: cleanMsg, hash });
  }

  return groups;
}

function formatGroups(groups) {
  const headers = {
    feat: "✨ Features",
    fix: "🐛 Fixes",
    refactor: "🧠 Refactors",
    chore: "🧹 Chores",
    patch: "🔧 Patches",
    update: "🛠️ Updates",
    misc: "📝 Miscellaneous",
  };

  let output = "";
  for (const [type, commits] of Object.entries(groups)) {
    if (commits.length === 0) continue;
    output += `\n### ${headers[type]}\n\n`;
    output += commits
      .map(
        ({ msg, hash }) =>
          `- ${msg} ([${hash.slice(0, 7)}](https://github.com/jayantur13/tabsync-desktop/commit/${hash}))`
      )
      .join("\n");
    output += "\n";
  }
  return output;
}

async function generateChangelog() {
  const tags = await git.tags();
  const latestTag = tags.latest;

  const log = latestTag
    ? await git.log({ from: latestTag, to: "HEAD" })
    : await git.log();

  if (!log.all.length)
    return { content: "No new commits since last release.", isFirst: !latestTag };

  const grouped = groupCommits(log.all);
  const formatted = formatGroups(grouped);

  const date = formatDate();
  const header = `## ${pkg.version} – _${date}_\n`;

  const subheader = latestTag
    ? `### 🚀 Release\n`
    : `### 🏁 Initial Release\nThis is the first official release of TabSync Desktop.\n`;

  return {
    content: `${header}\n${subheader}${formatted}\n`,
    isFirst: !latestTag,
  };
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

  const { content, isFirst } = await generateChangelog();

  const changelogPath = "CHANGELOG.md";
  let previous = "";

  if (fs.existsSync(changelogPath) && !isFirst) {
    previous = fs.readFileSync(changelogPath, "utf8").trim();
  }

  const newContent = `# 🧾 Change Log\n\n${content}${previous ? "\n" + previous : ""}`;
  fs.writeFileSync(changelogPath, newContent.trim() + "\n");

  console.log("📝 CHANGELOG.md updated.");

  // Commit and push
  await git.add(["CHANGELOG.md", "package.json"]);
  await git.commit(`chore(release): ${pkg.version}`);
  await git.push();

  console.log("📤 Changes committed and pushed.");

  // Build the app
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
    body: content,
    draft: true,
  });

  console.log(`✅ Draft release created: ${release.data.html_url}`);
}

main().catch((err) => {
  console.error("❌ Release failed:", err);
  process.exit(1);
});
