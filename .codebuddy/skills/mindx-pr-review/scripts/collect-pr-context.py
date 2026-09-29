#!/usr/bin/env python3
"""Deterministic context collection and failure notification for MindX PR review."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import posixpath
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Sequence
from urllib.parse import unquote_to_bytes, urlsplit


DEFAULT_CONTEXT_FILE = Path("/mindx-pr-review/context.json")
DEFAULT_CHANGED_PATHS_FILE = Path("/mindx-pr-review/changed-paths.txt")
DEFAULT_DIFF_FILE = Path("/mindx-pr-review/review.diff")
DEFAULT_FAILURE_BODY_FILE = Path("/tmp/mindx-pr-review-failure.md")
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
ISSUE_PATTERN = re.compile(r"#(\d{3,})")
INVALID_PERCENT_PATTERN = re.compile(r"%(?![0-9A-Fa-f]{2})")


class ContextError(RuntimeError):
    """A deterministic input could not be collected or validated."""


def require_env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise ContextError(f"missing environment variable: {name}")
    return value


def run_command(
    command: Sequence[str],
    *,
    timeout: int = 60,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        list(command),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if check and completed.returncode != 0:
        message = completed.stderr or completed.stdout or "no output"
        raise ContextError(
            f"command failed ({' '.join(command[:3])}): {message[:500]}"
        )
    return completed


def unwrap(value: Any) -> Any:
    if isinstance(value, dict) and "data" in value:
        return value["data"]
    return value


def run_cnb_json(args: Sequence[str], *, timeout: int = 60) -> Any:
    completed = run_command(["cnb", *args, "--verbose"], timeout=timeout)
    try:
        return unwrap(json.loads(completed.stdout))
    except Exception as error:
        raise ContextError(
            f"CNB JSON parse failed for {' '.join(args[:2])}: {error}"
        ) from error


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)


def validate_repo_path(path: str, *, source: str) -> str:
    if not path:
        raise ContextError(f"empty repository path from {source}")
    if any(character in path for character in ("\x00", "\n", "\r", "\\")):
        raise ContextError(f"illegal repository path from {source}: {path!r}")
    pure_path = PurePosixPath(path)
    parts = path.split("/")
    if (
        pure_path.is_absolute()
        or path.endswith("/")
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise ContextError(f"illegal repository path from {source}: {path!r}")
    return path


def strict_url_decode(raw_path: str, *, source: str) -> str:
    if INVALID_PERCENT_PATTERN.search(raw_path):
        raise ContextError(f"malformed URL escape in {source}: {raw_path!r}")
    try:
        decoded = unquote_to_bytes(raw_path).decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ContextError(f"non-UTF-8 repository path in {source}") from error
    return validate_repo_path(decoded, source=source)


def path_from_contents_url(value: str) -> str:
    parsed = urlsplit(value)
    marker = "/-/git/contents/"
    if not parsed.scheme or not parsed.netloc or parsed.path.count(marker) != 1:
        raise ContextError(f"invalid contents_url: {value!r}")
    raw_path = parsed.path.split(marker, 1)[1]
    return strict_url_decode(raw_path, source="contents_url")


def path_from_blob_url(value: str) -> str:
    parsed = urlsplit(value)
    marker = "/-/blob/"
    if not parsed.scheme or not parsed.netloc or parsed.path.count(marker) != 1:
        raise ContextError(f"invalid blob_url: {value!r}")
    remainder = parsed.path.split(marker, 1)[1]
    if "/" not in remainder:
        raise ContextError(f"blob_url has no repository path: {value!r}")
    revision, raw_path = remainder.split("/", 1)
    if not SHA_PATTERN.fullmatch(revision.lower()):
        raise ContextError(f"blob_url has invalid SHA: {value!r}")
    return strict_url_decode(raw_path, source="blob_url")


def full_path_from_file_record(record: dict[str, Any]) -> str:
    candidates: list[tuple[str, str]] = []
    contents_url = record.get("contents_url")
    if contents_url:
        if not isinstance(contents_url, str):
            raise ContextError("contents_url is not a string")
        candidates.append(("contents_url", path_from_contents_url(contents_url)))
    blob_url = record.get("blob_url")
    if blob_url:
        if not isinstance(blob_url, str):
            raise ContextError("blob_url is not a string")
        candidates.append(("blob_url", path_from_blob_url(blob_url)))
    if not candidates:
        raise ContextError("pull file has neither contents_url nor blob_url")

    resolved_paths = {path for _, path in candidates}
    if len(resolved_paths) != 1:
        details = ", ".join(f"{source}={path!r}" for source, path in candidates)
        raise ContextError(f"ambiguous pull file paths: {details}")
    full_path = next(iter(resolved_paths))

    filename = record.get("filename")
    if filename is not None:
        if not isinstance(filename, str) or filename != posixpath.basename(full_path):
            raise ContextError(
                f"filename is not the basename of resolved path: {filename!r} vs {full_path!r}"
            )
    return full_path


def sanitize_file_records(value: Any) -> tuple[list[dict[str, Any]], list[str]]:
    if not isinstance(value, list):
        raise ContextError("pull files response is not a list")
    sanitized: list[dict[str, Any]] = []
    paths: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            raise ContextError("pull files contains a non-object entry")
        full_path = full_path_from_file_record(item)
        clean = dict(item)
        clean.pop("patch", None)
        clean.pop("diff", None)
        clean["full_path"] = full_path
        sanitized.append(clean)
        paths.append(full_path)
    if len(set(paths)) != len(paths):
        raise ContextError(f"ambiguous duplicate pull file paths: {paths!r}")
    return sanitized, paths


def git_commit_exists(revision: str) -> bool:
    return (
        run_command(
            ["git", "cat-file", "-e", f"{revision}^{{commit}}"], check=False
        ).returncode
        == 0
    )


def fetch_missing_commits(
    target_sha: str,
    head_sha: str,
    source_ref: str,
    source_remote: str,
) -> None:
    if not git_commit_exists(target_sha):
        run_command(
            ["git", "fetch", "--no-tags", "--depth=200", "origin", "refs/heads/main"],
            timeout=180,
        )
    if not git_commit_exists(target_sha):
        raise ContextError(f"target commit is unavailable after fetch: {target_sha}")

    if not git_commit_exists(head_sha):
        run_command(
            ["git", "fetch", "--no-tags", "--depth=200", source_remote, source_ref],
            timeout=180,
        )
    if not git_commit_exists(head_sha):
        raise ContextError(f"head commit is unavailable after fetch: {head_sha}")


def resolve_merge_base(
    target_sha: str,
    head_sha: str,
    source_ref: str,
    source_remote: str,
) -> str:
    result = run_command(
        ["git", "merge-base", target_sha, head_sha], check=False
    )
    merge_base = result.stdout.strip() if result.returncode == 0 else ""
    if not SHA_PATTERN.fullmatch(merge_base):
        run_command(
            ["git", "fetch", "--no-tags", "--depth=1000", "origin", "refs/heads/main"],
            timeout=180,
        )
        run_command(
            ["git", "fetch", "--no-tags", "--depth=1000", source_remote, source_ref],
            timeout=180,
        )
        merge_base = run_command(
            ["git", "merge-base", target_sha, head_sha]
        ).stdout.strip()
    if not SHA_PATTERN.fullmatch(merge_base):
        raise ContextError(f"invalid merge base: {merge_base!r}")
    return merge_base


def parse_git_name_status(raw: str) -> tuple[list[dict[str, str]], list[str]]:
    fields = raw.split("\0")
    if fields and fields[-1] == "":
        fields.pop()
    changes: list[dict[str, str]] = []
    changed_paths: list[str] = []
    index = 0
    while index < len(fields):
        status = fields[index]
        index += 1
        if not re.fullmatch(r"[A-Z][0-9]*", status):
            raise ContextError(f"invalid git name-status entry: {status!r}")
        kind = status[0]
        if kind in {"R", "C"}:
            if index + 1 >= len(fields):
                raise ContextError(f"truncated git {kind} name-status entry")
            old_path = validate_repo_path(fields[index], source="git old path")
            new_path = validate_repo_path(fields[index + 1], source="git new path")
            index += 2
            changes.append(
                {"status": status, "old_path": old_path, "path": new_path}
            )
            changed_paths.append(new_path)
        else:
            if index >= len(fields):
                raise ContextError(f"truncated git {kind} name-status entry")
            path = validate_repo_path(fields[index], source="git path")
            index += 1
            changes.append({"status": status, "path": path})
            changed_paths.append(path)
    if len(set(changed_paths)) != len(changed_paths):
        raise ContextError(f"ambiguous duplicate Git changed paths: {changed_paths!r}")
    return changes, changed_paths


def collect_git_context(
    target_sha: str,
    head_sha: str,
    source_branch: str,
    source_slug: str,
    repo: str,
) -> tuple[str, str, list[dict[str, str]], list[str]]:
    source_ref = f"refs/heads/{source_branch}"
    if run_command(["git", "check-ref-format", source_ref], check=False).returncode != 0:
        raise ContextError(f"invalid source branch: {source_branch!r}")
    source_remote = (
        "origin"
        if source_slug == repo
        else f"https://cnb.woa.com/{source_slug}.git"
    )
    fetch_missing_commits(target_sha, head_sha, source_ref, source_remote)
    merge_base = resolve_merge_base(
        target_sha, head_sha, source_ref, source_remote
    )
    revision_range = f"{merge_base}...{head_sha}"
    diff = run_command(
        ["git", "diff", "--no-ext-diff", "--find-renames", revision_range],
        timeout=180,
    ).stdout
    name_status = run_command(
        [
            "git",
            "diff",
            "--no-ext-diff",
            "--find-renames",
            "--name-status",
            "-z",
            revision_range,
        ],
        timeout=180,
    ).stdout
    changes, changed_paths = parse_git_name_status(name_status)
    return merge_base, diff, changes, changed_paths


def collect_issue_follow_up_commits(
    issue_numbers: list[str], target_sha: str, head_sha: str
) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    for issue_number in issue_numbers:
        token = f"#{issue_number}"
        commits_by_sha: dict[str, dict[str, Any]] = {}
        for reachable_from, revision in (("target", target_sha), ("head", head_sha)):
            output = run_command(
                [
                    "git",
                    "log",
                    "--max-count=20",
                    "--fixed-strings",
                    f"--grep={token}",
                    "--format=%H%x1f%s%x1f%aI%x1f%b%x1e",
                    revision,
                ]
            ).stdout
            for raw_record in output.split("\x1e"):
                raw_record = raw_record.strip("\n")
                if not raw_record:
                    continue
                fields = raw_record.split("\x1f")
                if len(fields) != 4:
                    raise ContextError("ambiguous git log record for follow-up evidence")
                sha, subject, authored_at, body = fields
                if not SHA_PATTERN.fullmatch(sha):
                    raise ContextError(f"invalid follow-up commit SHA: {sha!r}")
                if not re.search(
                    rf"(?<!\d){re.escape(token)}(?!\d)", f"{subject}\n{body}"
                ):
                    continue
                record = commits_by_sha.setdefault(
                    sha,
                    {
                        "sha": sha,
                        "subject": subject,
                        "authored_at": authored_at,
                        "reachable_from": [],
                    },
                )
                record["reachable_from"].append(reachable_from)
        evidence.append(
            {"issue_number": issue_number, "commits": list(commits_by_sha.values())}
        )
    return evidence


def fetch_issue(repo: str, issue_number: str) -> dict[str, Any]:
    detail = run_cnb_json(
        ["issues", "get-issue", "--repo", repo, "--number", issue_number],
        timeout=45,
    )
    comments = run_cnb_json(
        [
            "issues",
            "list-issue-comments",
            "--repo",
            repo,
            "--number",
            issue_number,
            "--page-size",
            "100",
        ],
        timeout=45,
    )
    if not isinstance(detail, dict) or not isinstance(comments, list):
        raise ContextError(f"invalid issue context for #{issue_number}")
    return {"number": issue_number, "detail": detail, "comments": comments}


def fetch_review_comments(
    repo: str, number: str, review: dict[str, Any]
) -> dict[str, Any]:
    review_id = str(review.get("id") or "")
    if not review_id.isdigit():
        raise ContextError(f"invalid review id: {review_id!r}")
    comments = run_cnb_json(
        [
            "pulls",
            "list-pull-review-comments",
            "--repo",
            repo,
            "--number",
            number,
            "--review-id",
            review_id,
            "--page-size",
            "100",
        ],
        timeout=45,
    )
    if not isinstance(comments, list):
        raise ContextError(f"invalid review comments for review {review_id}")
    return {"review_id": review_id, "comments": comments}


def collect(args: argparse.Namespace) -> None:
    repo = require_env("MINDX_REVIEW_REPO_SLUG")
    number = require_env("MINDX_REVIEW_PR_IID")
    head_sha = require_env("MINDX_REVIEW_PR_HEAD_SHA")
    target_sha = require_env("MINDX_REVIEW_PR_TARGET_SHA")
    source_branch = require_env("MINDX_REVIEW_SOURCE_BRANCH")
    source_slug = require_env("MINDX_REVIEW_SOURCE_SLUG")
    if not number.isdigit() or number.startswith("0"):
        raise ContextError(f"invalid PR IID: {number!r}")
    if not SHA_PATTERN.fullmatch(head_sha) or not SHA_PATTERN.fullmatch(target_sha):
        raise ContextError("head and target must be lowercase 40-character SHAs")
    current_repo = os.environ.get("CNB_REPO_SLUG")
    if current_repo and current_repo != repo:
        raise ContextError(f"repository mismatch: {current_repo!r} vs {repo!r}")

    for artifact in (args.context_file, args.changed_paths_file, args.diff_file):
        artifact.unlink(missing_ok=True)

    merge_base, diff, git_changes, changed_paths = collect_git_context(
        target_sha, head_sha, source_branch, source_slug, repo
    )

    initial_tasks = {
        "pull": ["pulls", "get-pull", "--repo", repo, "--number", number],
        "files": ["pulls", "list-pull-files", "--repo", repo, "--number", number],
        "commits": [
            "pulls",
            "list-pull-commits",
            "--repo",
            repo,
            "--number",
            number,
            "--page-size",
            "100",
        ],
        "comments": [
            "pulls",
            "list-pull-comments",
            "--repo",
            repo,
            "--number",
            number,
            "--page-size",
            "100",
        ],
        "reviews": [
            "pulls",
            "list-pull-reviews",
            "--repo",
            repo,
            "--number",
            number,
            "--page-size",
            "100",
        ],
    }
    collected: dict[str, Any] = {}
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=len(initial_tasks)
    ) as executor:
        futures = {
            executor.submit(run_cnb_json, command): name
            for name, command in initial_tasks.items()
        }
        for future in concurrent.futures.as_completed(futures):
            collected[futures[future]] = future.result()

    pull = collected.get("pull")
    if not isinstance(pull, dict):
        raise ContextError("pull detail is missing")
    head = pull.get("head") if isinstance(pull.get("head"), dict) else {}
    base = pull.get("base") if isinstance(pull.get("base"), dict) else {}
    if pull.get("state") != "open":
        raise ContextError(f"pull is not open: {pull.get('state')}")
    if head.get("sha") != head_sha:
        raise ContextError(f"head drifted: {head.get('sha')!r} vs {head_sha!r}")
    if base.get("sha") != target_sha:
        raise ContextError(
            f"target drifted: {base.get('sha')!r} vs {target_sha!r}"
        )
    if base.get("ref") not in {"main", "refs/heads/main"}:
        raise ContextError(f"unexpected target ref: {base.get('ref')!r}")

    files, api_paths = sanitize_file_records(collected.get("files"))
    if set(api_paths) != set(changed_paths):
        raise ContextError(
            f"Git/API changed path mismatch: git={sorted(changed_paths)!r} "
            f"api={sorted(api_paths)!r}"
        )

    commits = collected.get("commits")
    comments = collected.get("comments")
    reviews = collected.get("reviews")
    if not isinstance(commits, list):
        raise ContextError("pull commits response is not a list")
    if not isinstance(comments, list):
        raise ContextError("pull comments response is not a list")
    if not isinstance(reviews, list) or any(
        not isinstance(review, dict) for review in reviews
    ):
        raise ContextError("pull reviews response is not a list of objects")

    issue_text = "\n".join(
        [
            str(pull.get("title") or ""),
            str(pull.get("body") or ""),
            source_branch,
            str(head.get("ref") or ""),
        ]
    )
    issue_numbers: list[str] = []
    seen: set[str] = set()
    for match in ISSUE_PATTERN.finditer(issue_text):
        issue_number = match.group(1)
        if issue_number != number and issue_number not in seen:
            seen.add(issue_number)
            issue_numbers.append(issue_number)

    issue_follow_up_commits = collect_issue_follow_up_commits(
        issue_numbers, target_sha, head_sha
    )

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=min(6, max(1, len(issue_numbers)))
    ) as executor:
        issues = (
            list(executor.map(lambda item: fetch_issue(repo, item), issue_numbers))
            if issue_numbers
            else []
        )
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=min(8, max(1, len(reviews)))
    ) as executor:
        review_comments = (
            list(
                executor.map(
                    lambda item: fetch_review_comments(repo, number, item), reviews
                )
            )
            if reviews
            else []
        )

    context = {
        "repo": repo,
        "number": number,
        "expected_head_sha": head_sha,
        "target_sha": target_sha,
        "merge_base": merge_base,
        "source_branch": source_branch,
        "source_slug": source_slug,
        "pull": pull,
        "files": files,
        "git_changes": git_changes,
        "changed_paths": changed_paths,
        "commits": commits,
        "comments": comments,
        "reviews": reviews,
        "review_comments": review_comments,
        "issue_numbers": issue_numbers,
        "issues": issues,
        "issue_follow_up_commits": issue_follow_up_commits,
        "diff_file": str(args.diff_file),
        "changed_paths_file": str(args.changed_paths_file),
    }
    atomic_write(args.diff_file, diff)
    atomic_write(
        args.changed_paths_file,
        "".join(f"{path}\n" for path in changed_paths),
    )
    atomic_write(
        args.context_file,
        json.dumps(context, ensure_ascii=False, indent=2) + "\n",
    )


def notify_failure(args: argparse.Namespace) -> None:
    repo = require_env("MINDX_REVIEW_REPO_SLUG")
    number = require_env("MINDX_REVIEW_PR_IID")
    head_sha = require_env("MINDX_REVIEW_PR_HEAD_SHA")
    build_id = require_env("CNB_BUILD_ID")
    build_url = require_env("CNB_BUILD_WEB_URL")
    if not number.isdigit() or not SHA_PATTERN.fullmatch(head_sha):
        raise ContextError("invalid PR IID or head SHA for failure notification")

    pull = run_cnb_json(
        ["pulls", "get-pull", "--repo", repo, "--number", number]
    )
    if not isinstance(pull, dict):
        raise ContextError("pull detail is missing during failure notification")
    head = pull.get("head") if isinstance(pull.get("head"), dict) else {}
    base = pull.get("base") if isinstance(pull.get("base"), dict) else {}
    if (
        pull.get("state") != "open"
        or base.get("ref") not in {"main", "refs/heads/main"}
        or head.get("sha") != head_sha
    ):
        print("Skip failure comment: PR closed, target changed, or head drifted")
        return

    marker = (
        "<!-- mindx-pr-review-failure: "
        f"head_sha={head_sha}, build_id={build_id} -->"
    )
    comments = run_cnb_json(
        [
            "pulls",
            "list-pull-comments",
            "--repo",
            repo,
            "--number",
            number,
            "--page-size",
            "100",
        ]
    )
    if not isinstance(comments, list) or any(
        not isinstance(comment, dict) for comment in comments
    ):
        raise ContextError("pull comments response is not a list of objects")
    if any(marker in str(comment.get("body") or "") for comment in comments):
        print("Skip duplicate MindX NPC review failure comment for this build/head")
        return

    body = (
        "🤖 MindX NPC PR review 未能发布\n\n"
        "本次评审未通过上下文收集、模型执行或发布验收，不能视为已完成代码评审。\n"
        f"head: {head_sha}\n"
        f"build: {build_url}\n\n"
        f"{marker}\n"
    )
    atomic_write(args.body_file, body)
    run_command(
        [
            "cnb",
            "pulls",
            "post-pull-comment",
            "--repo",
            repo,
            "--number",
            number,
            "--body-file",
            str(args.body_file),
            "--verbose",
        ]
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    collect_parser = subparsers.add_parser("collect")
    collect_parser.add_argument("--context-file", type=Path, default=DEFAULT_CONTEXT_FILE)
    collect_parser.add_argument(
        "--changed-paths-file", type=Path, default=DEFAULT_CHANGED_PATHS_FILE
    )
    collect_parser.add_argument("--diff-file", type=Path, default=DEFAULT_DIFF_FILE)
    collect_parser.set_defaults(handler=collect)

    notify_parser = subparsers.add_parser("notify-failure")
    notify_parser.add_argument(
        "--body-file", type=Path, default=DEFAULT_FAILURE_BODY_FILE
    )
    notify_parser.set_defaults(handler=notify_failure)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        args.handler(args)
    except (ContextError, OSError, subprocess.TimeoutExpired) as error:
        print(f"mindx-pr-review {args.command} failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
