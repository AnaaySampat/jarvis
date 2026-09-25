import { describe, expect, it } from "vitest";
import {
  addPlaybook,
  describePlaybooks,
  getPromotedWorkflow,
  listPlaybooks,
  playbooksPromptHint,
  recordVerifiedWorkflowSuccess,
  recordWorkflowDrift,
  recordWorkflowFailure,
  registerWorkflowCandidate,
  removePlaybook,
  type WorkflowCandidate,
  type WorkflowSuccessReceipt,
} from "./playbooks";

let sequence = 0;
const unique = (label: string) => `${label}_${++sequence}_${Date.now()}`;
const PACKAGE = "com.example.notes";

function selector(resource: string) {
  return {
    packageName: PACKAGE,
    resourceId: `${PACKAGE}:id/${resource}`,
    role: resource.includes("input") ? ("field" as const) : ("button" as const),
  };
}

function candidate(name = unique("VerifiedNotes")): WorkflowCandidate {
  return {
    name,
    triggers: [unique("find_note")],
    app: {
      packageName: PACKAGE,
      minVersionCode: 10,
      maxVersionCode: 20,
      versionNamePattern: "^1\\.",
    },
    parameters: [{ name: "query", type: "text", required: true }],
    preconditions: [{ kind: "app_foreground", packageName: PACKAGE }],
    procedure: [
      {
        stepId: "open_search",
        action: "tap",
        selector: selector("search_button"),
        postconditions: [
          { kind: "element_present", selector: selector("search_input") },
        ],
      },
      {
        stepId: "enter_query",
        action: "set_text",
        selector: selector("search_input"),
        value: { parameter: "query" },
        postconditions: [
          {
            kind: "element_value",
            selector: selector("search_input"),
            value: { parameter: "query" },
          },
        ],
      },
    ],
    risk: "R1",
    idempotency: "verify_before_retry",
  };
}

function receipt(index: number): WorkflowSuccessReceipt {
  return {
    runId: `run_${index}_${sequence}`,
    proofDigest: `proof_digest_${index}_${sequence}_verified`,
    independentlyVerified: true,
    deterministic: true,
    verifier: "native_accessibility",
    executorId: "executor_android",
    verifierId: "verifier_native",
    packageName: PACKAGE,
    versionCode: 12,
    versionName: "1.4.0",
    checkedPostconditions: 2,
  };
}

function promote(workflowId: string): void {
  expect(recordVerifiedWorkflowSuccess(workflowId, receipt(1)).ok).toBe(true);
  expect(recordVerifiedWorkflowSuccess(workflowId, receipt(2)).ok).toBe(true);
  const third = recordVerifiedWorkflowSuccess(workflowId, receipt(3));
  expect(third.ok).toBe(true);
  expect(third.promoted).toBe(true);
}

describe("verified procedural learning", () => {
  it("requires a name and reference text", () => {
    expect(addPlaybook("", "do a thing", "").ok).toBe(false);
    expect(addPlaybook(unique("Empty"), "", "").ok).toBe(false);
  });

  it("stores raw prose only as a disabled redacted reference and never prompts it", () => {
    const name = unique("RawDraft");
    const added = addPlaybook(
      name,
      "open notes password=VERY_SECRET token=ALSO_SECRET and enter OTP 123456",
      "raw draft trigger",
    );
    expect(added.ok).toBe(true);
    const draft = listPlaybooks().find((item) => item.name === name)!;
    expect(draft).toMatchObject({
      schemaVersion: 2,
      status: "draft",
      enabled: false,
      app: null,
      procedure: [],
    });
    expect(draft.steps).toContain("[redacted]");
    expect(draft.steps).not.toContain("VERY_SECRET");
    expect(draft.steps).not.toContain("ALSO_SECRET");
    expect(draft.steps).not.toContain("123456");
    expect(playbooksPromptHint()).not.toContain(name);
    expect(playbooksPromptHint()).not.toContain("VERY_SECRET");
  });

  it("replaces a same-name draft without creating a duplicate", () => {
    const name = unique("ReplaceDraft");
    addPlaybook(name, "first reference", "");
    addPlaybook(name.toLowerCase(), "second reference", "second trigger");
    const matches = listPlaybooks().filter(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].steps).toBe("second reference");
    expect(matches[0].revision).toBe(2);
  });

  it("accepts typed stable selectors but rejects coordinates and captured text", () => {
    const safe = registerWorkflowCandidate(candidate());
    expect(safe.ok).toBe(true);
    expect(safe.workflow).toMatchObject({
      status: "candidate",
      enabled: false,
      risk: "R1",
      idempotency: "verify_before_retry",
    });

    const withCoordinates = candidate(unique("Coordinates")) as any;
    withCoordinates.procedure[0].x = 42;
    withCoordinates.procedure[0].y = 84;
    expect(registerWorkflowCandidate(withCoordinates).ok).toBe(false);

    const withLiteral = candidate(unique("Literal")) as any;
    withLiteral.procedure[1].value = "captured private message";
    expect(registerWorkflowCandidate(withLiteral).ok).toBe(false);
  });

  it("rejects external commits, credential selectors, R2/R3, and unsafe retries", () => {
    const external = candidate(unique("External"));
    external.procedure[0].selector = selector("send_button");
    expect(registerWorkflowCandidate(external).ok).toBe(false);

    const credential = candidate(unique("Credential"));
    credential.procedure[1].selector = selector("password_input");
    expect(registerWorkflowCandidate(credential).ok).toBe(false);

    const highRisk = candidate(unique("HighRisk")) as any;
    highRisk.risk = "R2";
    expect(registerWorkflowCandidate(highRisk).ok).toBe(false);

    const unsafeRetry = candidate(unique("UnsafeRetry"));
    unsafeRetry.idempotency = "repeatable";
    expect(registerWorkflowCandidate(unsafeRetry).ok).toBe(false);
  });

  it("promotes only after three unique independently verified successes", () => {
    const spec = candidate(unique("Promote"));
    const registered = registerWorkflowCandidate(spec);
    const workflowId = registered.workflow!.workflowId;
    expect(playbooksPromptHint()).not.toContain(workflowId);

    const first = receipt(1);
    expect(recordVerifiedWorkflowSuccess(workflowId, first).promoted).toBe(false);
    expect(recordVerifiedWorkflowSuccess(workflowId, first).ok).toBe(false);
    expect(recordVerifiedWorkflowSuccess(workflowId, receipt(2)).promoted).toBe(false);
    const third = recordVerifiedWorkflowSuccess(workflowId, receipt(3));
    expect(third.promoted).toBe(true);

    const hint = playbooksPromptHint();
    expect(hint).toContain(workflowId);
    expect(hint).toContain(PACKAGE);
    expect(hint).toContain("verified_runs=3");
    expect(hint).not.toContain("search_button");
    expect(hint).not.toContain("enter_query");
    expect(hint).not.toContain("procedure");
  });

  it("rejects model, non-independent, incomplete, and version-mismatched receipts", () => {
    const registered = registerWorkflowCandidate(candidate(unique("BadReceipt")));
    const workflowId = registered.workflow!.workflowId;

    const model = { ...receipt(1), verifier: "model" as const };
    expect(recordVerifiedWorkflowSuccess(workflowId, model).ok).toBe(false);
    const sameActor = { ...receipt(2), verifierId: "executor_android" };
    expect(recordVerifiedWorkflowSuccess(workflowId, sameActor).ok).toBe(false);
    const incomplete = { ...receipt(3), checkedPostconditions: 1 };
    expect(recordVerifiedWorkflowSuccess(workflowId, incomplete).ok).toBe(false);
    const wrongVersion = { ...receipt(4), versionCode: 99 };
    expect(recordVerifiedWorkflowSuccess(workflowId, wrongVersion).ok).toBe(false);
  });

  it("matches promoted workflows only inside package and app-version constraints", () => {
    const spec = candidate(unique("Versioned"));
    const registered = registerWorkflowCandidate(spec);
    const workflowId = registered.workflow!.workflowId;
    promote(workflowId);

    expect(
      getPromotedWorkflow(workflowId, {
        packageName: PACKAGE,
        versionCode: 12,
        versionName: "1.5.0",
      }),
    ).toMatchObject({ workflowId, enabled: true, status: "promoted" });
    expect(
      getPromotedWorkflow(workflowId, {
        packageName: PACKAGE,
        versionCode: 30,
        versionName: "1.5.0",
      }),
    ).toBeNull();
    expect(
      getPromotedWorkflow(workflowId, {
        packageName: "com.attacker.notes",
        versionCode: 12,
        versionName: "1.5.0",
      }),
    ).toBeNull();
  });

  it("auto-disables on failed postconditions and UI drift", () => {
    const failed = registerWorkflowCandidate(candidate(unique("FailedPostcondition")));
    promote(failed.workflow!.workflowId);
    const failure = recordWorkflowFailure(failed.workflow!.workflowId, {
      runId: unique("failure_run"),
      kind: "postcondition_failed",
      reason: "Expected field value was not observed",
    });
    expect(failure.workflow).toMatchObject({ status: "disabled", enabled: false });
    expect(playbooksPromptHint()).not.toContain(failed.workflow!.workflowId);

    const drifted = registerWorkflowCandidate(candidate(unique("Drift")));
    promote(drifted.workflow!.workflowId);
    const drift = recordWorkflowDrift(drifted.workflow!.workflowId, {
      runId: unique("drift_run"),
      reason: "selector_ambiguous",
      detail: "Two controls now share the stable selector",
    });
    expect(drift.workflow?.driftHistory).toHaveLength(1);
    expect(drift.workflow).toMatchObject({ status: "disabled", enabled: false });
    expect(playbooksPromptHint()).not.toContain(drifted.workflow!.workflowId);
  });

  it("resets promotion evidence when a typed workflow revision changes", () => {
    const name = unique("Revision");
    const initial = registerWorkflowCandidate(candidate(name));
    promote(initial.workflow!.workflowId);
    const revisedSpec = candidate(name);
    revisedSpec.procedure[0].postconditions = [
      { kind: "structure_changed", scope: "active_window" },
    ];
    const revised = registerWorkflowCandidate(revisedSpec);
    expect(revised.workflow).toMatchObject({
      workflowId: initial.workflow!.workflowId,
      revision: 2,
      status: "candidate",
      enabled: false,
    });
    expect(playbooksPromptHint()).not.toContain(initial.workflow!.workflowId);
  });

  it("keeps describe/remove compatibility while surfacing safe status", () => {
    const name = unique("DescribeRemove");
    addPlaybook(name, "reference only", "reference trigger");
    expect(describePlaybooks().summary).toContain(`${name} [draft]`);
    expect(removePlaybook(name).ok).toBe(true);
    expect(listPlaybooks().some((item) => item.name === name)).toBe(false);
    expect(removePlaybook(unique("missing")).ok).toBe(false);
  });
});

describe("removePlaybook only deletes what it names", () => {
  // `.includes(query)` deleted EVERY playbook whose name contained the query while
  // reporting the singular "Forgot the playbook." — "forget the meeting playbook"
  // wiped both "morning meeting setup" and "team meeting notes", and a promoted
  // workflow's verified receipts are not recoverable.
  it("refuses an ambiguous substring instead of deleting both", () => {
    const a = unique("morning meeting setup");
    const b = unique("team meeting notes");
    addPlaybook(a, "open app; tap send", "standup");
    addPlaybook(b, "open app; tap save", "notes");

    const res = removePlaybook("meeting");
    expect(res.ok).toBe(false);
    expect(res.summary).toContain(a);
    expect(res.summary).toContain(b);

    const names = listPlaybooks().map((p) => p.name);
    expect(names).toContain(a);
    expect(names).toContain(b);

    // The exact name still works, and takes only that one.
    expect(removePlaybook(a).ok).toBe(true);
    const after = listPlaybooks().map((p) => p.name);
    expect(after).not.toContain(a);
    expect(after).toContain(b);
    removePlaybook(b);
  });

  it("still accepts an unambiguous substring", () => {
    const only = unique("grocery run");
    addPlaybook(only, "open app; tap add", "shopping");
    expect(removePlaybook("grocery").ok).toBe(true);
    expect(listPlaybooks().map((p) => p.name)).not.toContain(only);
  });
});
