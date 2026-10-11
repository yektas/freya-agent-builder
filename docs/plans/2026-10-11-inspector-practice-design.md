# Inspector practice testing

The approved scope is uploaded agent → official practice test → recorded score in the inspector. Keep generation and upload independent so testing an existing agent never spends another builder model call.

Use a separate asynchronous `POST /api/runs/:id/practice` action rather than testing during upload or regenerating through the CLI. The browser chooses A, B, or all public cases, a supplied speaking style, and one or three repetitions. The server resolves the uploaded agent from a discovered completed generation, checks the workflow hash, verifies its workspace, and uses the unchanged kit runner behind the existing bridge. Credentials and filesystem paths are never browser inputs.

Reserve the run during setup and take the existing exclusive workspace lock before simulation. Refuse upload, archive, and deletion during testing. Bound execution to 25 minutes by default; retain the lock on a simulation timeout because stopping local polling does not cancel a remote simulation. Failures preserve registration and earlier successful results.

Write separate job, latest successful result, and attempt-history artifacts. The job records source and kit versions, case hash, choices, ids, timing, verdict, and failure. Polling displays progress and results after a refresh. Scores belong to the workflow hash and become null for a running/failed latest attempt or changed workflow. Three-repetition case rows use the aggregate verdict and failures across repetitions.

Validation uses injected transports and synthetic fixtures offline: success, refresh, repeated clicks, multi-repetition aggregation, workspace conflicts/mismatch, deadlines, redaction, changed workflows, missing credentials, unknown ids, and origin/choice restrictions. Run the full repository checks and production UI build. No live score is inferred from these tests.
