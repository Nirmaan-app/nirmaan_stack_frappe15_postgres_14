const test = require('node:test');
const assert = require('node:assert/strict');
const { linkPrIssue } = require('./link-pr-issue.js');

function fakeGitHub({ linked = [], labelExists = true, assignFails = false, bodies = ['Adds the vendor filter.'], openIssues = [] } = {}) {
  const calls = [];
  let reads = 0;
  const record = (name, result) => async (args) => {
    calls.push({ name, args });
    return typeof result === 'function' ? result(args) : result;
  };
  const github = {
    graphql: record('graphql', {
      repository: { pullRequest: { closingIssuesReferences: { nodes: linked.map((number) => ({ number })) } } },
    }),
    paginate: async (fn, args) => (await fn(args)).data,
    rest: {
      issues: {
        listForRepo: record('listForRepo', { data: openIssues }),
        getLabel: record('getLabel', () => {
          if (!labelExists) throw Object.assign(new Error('Not Found'), { status: 404 });
          return {};
        }),
        createLabel: record('createLabel', {}),
        create: record('create', { data: { number: 77 } }),
        addAssignees: record('addAssignees', () => {
          if (assignFails) throw new Error('not assignable');
          return {};
        }),
      },
      pulls: {
        get: record('get', () => ({ data: { body: bodies[Math.min(reads++, bodies.length - 1)] } })),
        update: record('update', {}),
      },
    },
  };
  const writes = () => calls.filter((c) => !['graphql', 'get', 'listForRepo', 'getLabel'].includes(c.name)).map((c) => c.name);
  return { github, calls, writes, find: (name) => calls.find((c) => c.name === name) };
}

function context({ login = 'madhubalan17js', type = 'User', base = 'develop', body = 'Adds the vendor filter.' } = {}) {
  return {
    repo: { owner: 'Nirmaan-app', repo: 'nirmaan_stack_frappe15_postgres_14' },
    payload: {
      repository: { default_branch: 'develop' },
      pull_request: { number: 12, title: 'Vendor filter', body, user: { login, type }, base: { ref: base } },
    },
  };
}

const warnings = [];
const core = { warning: (m) => warnings.push(m) };

test('a PR with no issue gets a new issue, assigned to its author, and the PR names it', async () => {
  const gh = fakeGitHub({ labelExists: false });
  assert.equal(await linkPrIssue({ github: gh.github, context: context(), core }), 'created: #77');
  const create = gh.find('create').args;
  assert.equal(create.title, 'Vendor filter');
  assert.deepEqual(create.labels, ['auto-tracked']);
  assert.match(create.body, /^Opened by the bot for PR #12 by @madhubalan17js/);
  assert.match(create.body, /Adds the vendor filter\.$/);
  assert.deepEqual(gh.find('addAssignees').args.assignees, ['madhubalan17js']);
  assert.equal(gh.find('update').args.body, 'Adds the vendor filter.\n\nCloses #77');
  assert.ok(gh.writes().includes('createLabel'), 'the missing label is created');
});

test("an author's edit made while the bot runs is kept, not overwritten with the old text", async () => {
  const gh = fakeGitHub({ bodies: ['first text', 'first text, with a screenshot'] });
  await linkPrIssue({ github: gh.github, context: context({ body: 'first text' }), core });
  assert.equal(gh.find('update').args.body, 'first text, with a screenshot\n\nCloses #77');
});

test('a second run for the same PR reuses the issue the bot already opened', async () => {
  const earlier = { number: 77, body: 'Opened by the bot for PR #12 by @madhubalan17js, which named no issue.' };
  const other = { number: 70, body: 'Opened by the bot for PR #120 by @x, which named no issue.' };
  const gh = fakeGitHub({ openIssues: [other, earlier] });
  assert.equal(await linkPrIssue({ github: gh.github, context: context(), core }), 'reused: #77');
  assert.deepEqual(gh.writes(), ['update']);
  assert.equal(gh.find('update').args.body, 'Adds the vendor filter.\n\nCloses #77');
});

test('a PR GitHub already links to an issue is left alone', async () => {
  const gh = fakeGitHub({ linked: [40] });
  assert.equal(await linkPrIssue({ github: gh.github, context: context(), core }), 'linked: #40');
  assert.deepEqual(gh.writes(), []);
});

test('a closing line GitHub has not indexed yet does not open a second issue', async () => {
  const gh = fakeGitHub({ bodies: ['x\n\nCloses #77'] });
  assert.equal(await linkPrIssue({ github: gh.github, context: context(), core }), 'linked: #77 (in the body, not yet indexed)');
  assert.deepEqual(gh.writes(), []);
});

test('any closing keyword GitHub accepts counts, such as "Fixes: #12"', async () => {
  const gh = fakeGitHub({ bodies: ['Sorts the list.\nFixes: #12'] });
  assert.equal(await linkPrIssue({ github: gh.github, context: context(), core }), 'linked: #12 (in the body, not yet indexed)');
  assert.deepEqual(gh.writes(), []);
});

test('a release PR into a branch other than the default is skipped', async () => {
  const gh = fakeGitHub();
  assert.equal(await linkPrIssue({ github: gh.github, context: context({ base: 'main' }), core }),
    'skipped: base main is not develop');
  assert.deepEqual(gh.calls, []);
});

test('a bot PR is skipped', async () => {
  const gh = fakeGitHub();
  const out = await linkPrIssue({ github: gh.github, context: context({ login: 'dependabot[bot]', type: 'Bot' }), core });
  assert.equal(out, 'skipped: dependabot[bot] is a bot');
  assert.deepEqual(gh.calls, []);
});

test('an author who cannot be assigned still gets the issue linked, with a warning', async () => {
  const gh = fakeGitHub({ assignFails: true });
  assert.equal(await linkPrIssue({ github: gh.github, context: context(), core }), 'created: #77');
  assert.ok(gh.writes().includes('update'));
  assert.match(warnings.at(-1), /could not assign #77 to madhubalan17js/);
});
