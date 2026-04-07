## Hi there 👋

I'm Lewis, a Software Engineer at GitHub working on [Copilot Spaces](https://docs.github.com/en/copilot/how-tos/provide-context/use-copilot-spaces/create-and-use-copilot-spaces)

### 🏆 Career Achievements Tracker

This repo includes an automated system that tracks my GitHub contributions and generates monthly achievement summaries — powered by GitHub Actions and the Copilot coding agent.

- 📊 **[Achievement Summaries](./achievements/SUMMARY.md)** — Monthly highlights of my work
- 🔧 **[Setup Guide](./SETUP.md)** — Want your own? Follow the guide to set it up

#### How it works

1. A monthly cron job fetches my GitHub activity (issues, PRs, reviews, comments) from tracked repos
2. Raw data is stored privately in a separate repo
3. A Copilot coding agent analyzes the data and generates sanitized achievement summaries
4. Summaries are committed here as polished markdown — perfect for performance reviews

> **Want to set this up for yourself?** Check out [SETUP.md](./SETUP.md) for a step-by-step guide and automated bootstrap script.

<!--
**lewis-mcgillion/lewis-mcgillion** is a ✨ _special_ ✨ repository because its `README.md` (this file) appears on your GitHub profile.
-->
