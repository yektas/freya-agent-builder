# Evaluation and submission alignment

The user authorized addressing all gaps found against the official hackathon page.
The implementation keeps direct generation as the baseline. It makes no paid run.

## Decisions

- Add `freya --final`: use the supplied brief and explicit API file, compile, validate,
  register, export, and stop. Public practice is optional through the existing practice
  mode. A final run never loads public case answers or runs mismatched public cases.
- Keep one repetition as a development default. Add CLI `--repetitions 3` for strict
  public practice. Check brief and API contents before any remote action. A+B agents
  can run A, B, or all; A-only agents can run A. Unknown/edited inputs are refused.
- Retain the workspace lock after uncertain practice timeouts. Record its path and
  require reconciliation before another operation. Release after confirmed completion
  or before a simulation starts. Preserve the specific error even on deadline expiry.
- Prepare two selected final exports and trace summaries locally. Verify source files
  against the chosen commit and validate recorded export hashes and registration IDs.
  Refuse dirty-source runs, changed exports, existing destinations, and credentials.
  After artifacts are committed, finalize the form against that commit. A subsequent
  artifact-only commit is valid when all builder source files still match the run.
- Add an offline comparison report: matching input/case/style/repetition groups, strict
  all-three results, ledger amounts for passing cases per repetition, total build time
  when available, model costs, errors, and missing evidence. No hidden score is inferred.
- Add synthetic clean/raw input fixtures, calendar examples, and changed-schema tests.
  Input preservation is testable offline. Behavioral extraction, completion, date math,
  refusals, honesty, and fresh-build consistency still need a separately authorized
  model/platform evaluation. Synthetic checks never count as benchmark results.

## Alternatives considered

A single UI submission flow would add new write routes and combine actions that should
remain separate. A shell-only checklist would leave input and artifact checks unenforced.
The chosen CLI helpers enforce those checks without expanding inspector permissions.

## Validation

Use injected generators and bridges to test final export, repetitions, and uncertain
simulation cleanup. Use a local synthetic Git repository to test submission provenance
and artifact tampering. Test the inspector's mismatch refusal before remote calls.
Run the full offline check suite. Do not change generated agents manually or promote
new strategy behavior from these infrastructure checks.
