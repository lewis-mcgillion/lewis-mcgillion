import { execSync } from "node:child_process";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Interactive readline helper
// ---------------------------------------------------------------------------
const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function run(cmd: string, silent = false): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: silent ? "pipe" : "inherit" }).trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Main bootstrap flow
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════╗
║      🚀 Career Achievements Tracker — Bootstrap     ║
╚══════════════════════════════════════════════════════╝
`);

  // Check prerequisites
  console.log("Checking prerequisites...\n");
  const ghVersion = run("gh --version", true);
  if (!ghVersion) {
    console.error("❌ GitHub CLI (gh) is required. Install: https://cli.github.com/");
    process.exit(1);
  }
  console.log(`✓ GitHub CLI: ${ghVersion.split("\n")[0]}`);

  const authStatus = run("gh auth status 2>&1", true);
  if (!authStatus.includes("Logged in")) {
    console.error("❌ Not authenticated with GitHub CLI. Run: gh auth login");
    process.exit(1);
  }
  console.log("✓ GitHub CLI authenticated\n");

  // Gather info
  const username = await ask("GitHub username", run("gh api user --jq .login", true));
  const profileRepo = `${username}/${username}`;

  console.log(`\nProfile repo: ${profileRepo}`);

  // Check profile repo exists
  const repoCheck = run(`gh repo view ${profileRepo} --json name 2>&1`, true);
  if (!repoCheck.includes(username)) {
    console.error(`❌ Profile repo ${profileRepo} not found. Create it on GitHub first.`);
    process.exit(1);
  }
  console.log(`✓ Profile repo exists\n`);

  // Repos to track
  console.log("Enter the org/repo names you want to track (comma-separated):");
  console.log("Example: github/github,github/copilot-api,github/copilot-experiences");
  const reposInput = await ask("Repos");
  const repos = reposInput.split(",").map((r) => r.trim()).filter(Boolean);

  if (repos.length === 0) {
    console.error("❌ At least one repo is required.");
    process.exit(1);
  }
  console.log(`✓ Tracking ${repos.length} repos\n`);

  // PAT
  console.log("You need a Personal Access Token (PAT) with these scopes:");
  console.log("  - repo (full access to private repos)");
  console.log("  - read:org (read org membership)");
  console.log("\nIf your repos are in an org with SSO, authorize the PAT for SSO.");
  console.log("Create one at: https://github.com/settings/tokens\n");
  const pat = await ask("Enter your PAT (input hidden in logs)");

  if (!pat) {
    console.error("❌ PAT is required.");
    process.exit(1);
  }

  // Validate PAT
  console.log("\nValidating PAT...");
  try {
    const result = run(`gh api -H "Authorization: token ${pat}" user --jq .login 2>&1`, true);
    if (result !== username) {
      console.warn(`⚠ PAT authenticated as "${result}" (expected "${username}")`);
    } else {
      console.log(`✓ PAT valid for ${username}`);
    }
  } catch {
    console.error("❌ PAT validation failed. Check the token and try again.");
    process.exit(1);
  }

  // Create private career-data repo
  console.log("\n--- Creating private career-data repo ---\n");
  const careerDataRepo = `${username}/career-data`;
  const existingRepo = run(`gh repo view ${careerDataRepo} --json name 2>&1`, true);
  if (existingRepo.includes("career-data")) {
    console.log(`✓ ${careerDataRepo} already exists`);
  } else {
    run(`gh repo create ${careerDataRepo} --private --description "Private raw data store for career achievements tracker" --clone=false`);
    console.log(`✓ Created ${careerDataRepo}`);

    // Initialize with README
    run(`gh api repos/${careerDataRepo}/contents/README.md -X PUT -f message="Initial commit" -f content="$(echo '# Career Data (Private)\n\nPrivate raw data for the Career Achievements Tracker.' | base64)" 2>&1`, true);
  }

  // Set secrets on the profile repo
  console.log("\n--- Configuring GitHub Actions secrets ---\n");

  // Set PAT secret
  run(`echo "${pat}" | gh secret set CAREER_DATA_PAT --repo ${profileRepo}`);
  console.log("✓ Set CAREER_DATA_PAT secret");

  // Set repo secrets
  for (let i = 0; i < repos.length; i++) {
    const secretName = `REPO_${i + 1}`;
    run(`echo "${repos[i]}" | gh secret set ${secretName} --repo ${profileRepo}`);
    console.log(`✓ Set ${secretName} = ${repos[i]}`);
  }

  // Clear unused repo slots (up to 10)
  for (let i = repos.length; i < 10; i++) {
    run(`gh secret delete REPO_${i + 1} --repo ${profileRepo} 2>/dev/null`, true);
  }

  // Create achievements directory if not exists
  console.log("\n--- Setting up achievements directory ---\n");
  const achievementsCheck = run(`gh api repos/${profileRepo}/contents/achievements 2>&1`, true);
  if (achievementsCheck.includes("Not Found")) {
    console.log("achievements/ directory will be created on first workflow run");
  } else {
    console.log("✓ achievements/ directory exists");
  }

  // Create copilot label if not exists
  console.log("\n--- Ensuring 'copilot' label exists ---\n");
  run(`gh label create copilot --repo ${profileRepo} --description "Copilot coding agent tasks" --color 8957e5 --force`);
  console.log("✓ 'copilot' label ready");

  // Summary
  console.log(`
╔══════════════════════════════════════════════════════╗
║                   ✅ Setup Complete!                  ║
╚══════════════════════════════════════════════════════╝

  Profile repo:  ${profileRepo}
  Data repo:     ${careerDataRepo} (private)
  Tracking:      ${repos.join(", ")}
  Cron:          1st of every month at midnight UTC

  Next steps:
  1. Copy the workflow files and scripts to your profile repo
     (if not already there)
  2. Run the backfill:
     gh workflow run fetch-activity.yml \\
       --repo ${profileRepo} \\
       -f start_date=2025-01-01 \\
       -f end_date=$(date '+%Y-%m-%d')
  3. After fetch completes, trigger the summary:
     gh workflow run generate-summary.yml \\
       --repo ${profileRepo} \\
       -f months="2025-01,2025-02,..."
`);

  rl.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  rl.close();
  process.exit(1);
});
