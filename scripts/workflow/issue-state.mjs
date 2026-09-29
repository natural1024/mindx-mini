/** Canonical CNB issue-state model shared by every state-writing script. */

export const ISSUE_STATE_LABELS = Object.freeze([
  "原型中",
  "待研发",
  "开发中",
  "待发布",
  "已发布",
]);

export class IssueStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "IssueStateError";
  }
}

export function isIssueStateLabel(label) {
  return ISSUE_STATE_LABELS.includes(label);
}

export function getIssueState(labels) {
  const states = [
    ...new Set(
      (Array.isArray(labels) ? labels : []).filter((label) =>
        isIssueStateLabel(label),
      ),
    ),
  ];

  if (states.length > 1) {
    throw new IssueStateError(
      `Issue 同时存在多个状态 label：${states.join(", ")}`,
    );
  }

  return states[0] || null;
}

export function canTransitionIssueState(fromState, toState) {
  const fromIndex = ISSUE_STATE_LABELS.indexOf(fromState);
  const toIndex = ISSUE_STATE_LABELS.indexOf(toState);
  return fromIndex >= 0 && toIndex === fromIndex + 1;
}

export function transitionIssueStateLabels(labels, toState) {
  if (!isIssueStateLabel(toState)) {
    throw new IssueStateError(`未知 Issue 状态：${toState}`);
  }

  const currentState = getIssueState(labels);
  if (!canTransitionIssueState(currentState, toState)) {
    return {
      allowed: false,
      changed: false,
      currentState,
      targetState: toState,
      labels: Array.isArray(labels) ? [...labels] : [],
    };
  }

  return {
    allowed: true,
    changed: true,
    currentState,
    targetState: toState,
    labels: [
      ...(Array.isArray(labels) ? labels : []).filter(
        (label) => !isIssueStateLabel(label),
      ),
      toState,
    ],
  };
}
