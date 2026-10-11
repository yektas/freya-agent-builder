# Diagnosis of the 13:25 generation

Run: `2026-10-11T13-25-38.262Z-552e4fd6-cf61-4325-b36f-6cccc636ec3b`.
Brief A, `gpt-6.1-sol`, medium reasoning. Recorded practice: **1/10**, one repetition. This is a historical practice result, not final three-repetition reliability.

## Confirmed account failure: eight cases

PUB-01 and PUB-04 through PUB-10 all successfully verify identity and fetch an account, then enter `account_error` and close `no_promise/service_error`. These cases never reach payment discussion. Their date, amount, hardship, paid, restructuring and promise-retry failures cannot yet diagnose those downstream behaviors.

The generated `prepare_account` reads:

```python
products = vars.get('account_products', vars.get('get_account_response.data.products', []))
```

It requires that value to be a list of length one. Neither key exists in the recorded runtime variable tables. The API body contains a valid products array, but the variables contain only flattened leaves such as `get_account_response.data.products.0.product_id`. The node mapping of `data.products` to `account_products` does not supply the whole array. The compiler's pre-action alias hook likewise copies leaves only.

This is a mismatch between generated consumer code and the platform/compiler representation. The earlier tool-name alias fix is present and working: `get_account_response.data.ok` is `true`, and product leaves are available. It does not provide the container this new generation expects.

For PUB-01, call `e58c36c0-c567-481c-ae2c-5035cac685cb`, zero-based message indices:

- 24: API result has `ok=true` and one valid credit-card product.
- 25: variable table has the product leaves and `calendar_state=ready`, but neither whole-array key.
- 29: `prepare_account` has set `account_state=error` and cleared product facts.
- 30: route enters `account_error`.
- 31: assistant incorrectly says it could not obtain account information.

The same absent-container guard failure is confirmed in all eight account-bearing calls. A read-only replay of that input guard is saved in `experiments/diagnosis/2026-10-11-products-array/captured-boundary-check.json`. It executes no recorded generated Python and makes no remote requests; it is a data-flow check, not a new benchmark score.

Export did not change the consequential account code or API pre-action. The exported mappings retain the same paths and variables, adding empty descriptions. Calendar and API failures are ruled out for this mechanism.

## Separate identity failure: PUB-03

Call `90dc2ba5-8d5c-48b3-9462-5307fa0e6319`:

- Message 14: date-of-birth result is `verified=false`, with two wrong answers left.
- Message 16: assistant proceeds to the phone question despite that negative result.
- Message 20: phone verification succeeds, but `all_verified=false`.
- Message 22: assistant asks how it can help instead of retrying date of birth.
- Messages 25–34: assistant invents a restriction that verification details cannot be changed and rejects corrected birth dates without calling verification again.
- Message 45: closes `no_promise/refused`, whereas the case expects `not_verified/failed`.

The account-lookup gate prevents disclosure, but the dialogue policy ignores negative verification results. Only two verification calls occur; the three-wrong-answer route never gets its required tool evidence. Fixing array representation cannot fix this case.

PUB-02, the third-party callback case, passes and bypasses account processing.

## Recommended next experiments

1. Make the compiler response contract usable by generated code for structured containers as well as leaves. Preserve containers as JSON text under their response paths, or provide an explicit equivalent contract. Verify the chosen representation survives the platform's variable storage. Cover successful arrays, empty arrays, nested data and clearing stale values on later failures offline.
2. Independently test result-driven identity next actions, for example generated post-hooks or separate question states, so a negative result requires retrying the same question and cannot advance silently.

Use `docs/experiment-template.md`, compare across tasks, and record regressions before promotion. Do not manually patch this recorded agent or interpret removing the account blocker as eight newly passing cases. No runtime changes, new generation, upload or practice run were made during this diagnosis.
