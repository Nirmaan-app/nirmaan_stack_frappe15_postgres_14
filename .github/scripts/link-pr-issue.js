const LABEL = 'auto-tracked';
const MAX_BODY = 60000;

const marker = (number) => `Opened by the bot for PR #${number} `;

async function linkedIssues(github, owner, repo, number) {
  const { repository } = await github.graphql(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) { closingIssuesReferences(first: 5) { nodes { number } } }
      }
    }`,
    { owner, repo, number },
  );
  return repository.pullRequest.closingIssuesReferences.nodes.map((n) => n.number);
}

async function ensureLabel(github, owner, repo) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name: LABEL });
  } catch (e) {
    if (e.status !== 404) throw e;
    await github.rest.issues.createLabel({
      owner, repo, name: LABEL, color: 'c5def5',
      description: 'Issue opened by the bot for a PR that named none',
    });
  }
}

async function earlierBotIssue(github, owner, repo, number) {
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner, repo, labels: LABEL, state: 'open', per_page: 100,
  });
  const found = issues.find((i) => !i.pull_request && (i.body || '').startsWith(marker(number)));
  return found && found.number;
}

async function currentBody(github, owner, repo, number) {
  const { data } = await github.rest.pulls.get({ owner, repo, pull_number: number });
  return data.body || '';
}

async function linkPrIssue({ github, context, core }) {
  const pr = context.payload.pull_request;
  const { owner, repo } = context.repo;
  const defaultBranch = context.payload.repository.default_branch;

  if (pr.user.type === 'Bot') return `skipped: ${pr.user.login} is a bot`;
  if (pr.base.ref !== defaultBranch) return `skipped: base ${pr.base.ref} is not ${defaultBranch}`;

  const linked = await linkedIssues(github, owner, repo, pr.number);
  if (linked.length) return `linked: #${linked.join(', #')}`;
  // GitHub lists a closing line in closingIssuesReferences a moment after the edit that wrote it.
  const body = await currentBody(github, owner, repo, pr.number);
  const written = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/i.exec(body);
  if (written) return `linked: #${written[1]} (in the body, not yet indexed)`;

  const author = pr.user.login;
  let number = await earlierBotIssue(github, owner, repo, pr.number);
  const reused = Boolean(number);
  if (!reused) {
    await ensureLabel(github, owner, repo);
    const issueBody = `${marker(pr.number)}by @${author}, which named no issue.\n\n${body}`;
    const { data: issue } = await github.rest.issues.create({
      owner, repo, title: pr.title, body: issueBody.slice(0, MAX_BODY), labels: [LABEL],
    });
    number = issue.number;
    try {
      await github.rest.issues.addAssignees({ owner, repo, issue_number: number, assignees: [author] });
    } catch (e) {
      core.warning(`could not assign #${number} to ${author}: ${e.message}`);
    }
  }
  const latest = await currentBody(github, owner, repo, pr.number);
  await github.rest.pulls.update({
    owner, repo, pull_number: pr.number, body: `${latest}\n\nCloses #${number}`.trim(),
  });
  return `${reused ? 'reused' : 'created'}: #${number}`;
}

module.exports = { linkPrIssue, LABEL };
