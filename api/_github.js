const OWNER = process.env.GITHUB_OWNER || 'sophieblousson';
const REPO = process.env.GITHUB_REPO || 'Glifing-BOT';
const WORKFLOW = 'glifing-bot.yml';

function githubHeaders() {
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'glifing-bot-vercel'
  };
}

module.exports = { OWNER, REPO, WORKFLOW, githubHeaders };
