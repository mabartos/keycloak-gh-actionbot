import core from "@actions/core";
import { context } from "@actions/github";
import { Octokit } from "octokit";

async function run() {
  const githubToken = core.getInput("github_token");
  const debug = core.getInput("debug") === "true";

  if (debug) {
    console.log(`Event name: ${context.eventName}`);
    console.log("Event payload:", context.payload);
  }

  const octokit = new Octokit({ auth: githubToken });

  if (context.eventName === "issue_comment") {
    const body = context.payload.comment.body;
    const authorAssociation = context.payload.comment.author_association;
    const { issue } = context.payload;

    const { owner, repo } = context.repo;

    if (body.trim() !== "/rerun") {
      // unrecognized command
      core.setOutput("triggered", "false");
      return;
    }

    if (!issue.pull_request) {
      // not a pull request
      core.setOutput("triggered", "false");
      return;
    }

    if (issue.state !== "open") {
      // not open
      core.setOutput("triggered", "false");
      return;
    }

    console.log(`evaluating action for PR#${issue.number}`);

    if (
      authorAssociation !== "COLLABORATOR" &&
      authorAssociation !== "OWNER" &&
      authorAssociation !== "MEMBER" &&
      authorAssociation !== "CONTRIBUTOR"
    ) {
      console.log(`skipped due to authorAssociation: ${authorAssociation}`);
      core.setOutput("triggered", "false");
      return;
    }

    const pull_request = unwrapResult(
      await octokit.rest.pulls.get({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        pull_number: issue.number,
      })
    );

    if (debug) {
      console.log("Pull request:", pull_request);
    }

    const check_runs = unwrapResult(
      await octokit.rest.checks.listForRef({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        ref: pull_request.head.sha,
      })
    ).check_runs;

    for (const check of check_runs) {
      if (check.conclusion === "failure") {
        if (debug) {
          console.log("Check:", check);
        }

        const job = unwrapResult(
          await octokit.rest.actions.getJobForWorkflowRun({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            job_id: check.id,
          })
        );

        if (debug) {
          console.log("Job:", job);
        }

        unwrapResult(
          await octokit.rest.actions.reRunWorkflowFailedJobs({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            run_id: job.run_id,
          })
        );
      }
    }

    core.setOutput("triggered", "true");

    unwrapResult(
      await octokit.rest.reactions.createForIssueComment({
        owner: owner,
        repo: repo,
        comment_id: context.payload.comment.id,
        content: "+1",
      })
    );
  }
}

run().catch((err) => {
  console.error(err);
  core.setFailed("Unexpected error");
});

function unwrapResult(response) {
  if (response.status === 200) {
    return response.data;
  }
  if (response.status === 201) {
    return undefined;
  }
  console.error("response failed:", response);
  core.setFailed("Request to GitHub API failed");
}
