# v1.0.3 Release Notes

## Scope

This is an A-only patch release containing only these user-facing fixes:

- Fixed the Edit PI flow so master data, the related PO, and the warehouse list for the PI's saved country are loaded before the complete form is shown. Warehouse options are written before the saved `target_warehouse` value is restored.
- Preserved and surfaced an existing saved warehouse when it is missing from the returned country warehouse options, while recording the data anomaly.
- Fixed PI deposit status rendering so `need_deposit = false` displays “无需定金”, “No deposit required”, or “Tidak perlu uang muka” instead of a payment status.

## A-only verification

- Existing PI opened with `Bekasi Warehouse` selected on the first render without changing country.
- With the warehouse API delayed by 1.5 seconds, only Loading was displayed until the warehouse data returned; the empty edit form was not exposed.
- Saving and reopening the PI retained the correct warehouse.
- No-deposit, unpaid-deposit, and paid-deposit states were verified in Chinese, English, and Indonesian.
- Console Error count was 0 in both normal and delayed-interface browser checks.
- `node --check` and `git diff --check` passed; temporary PI diagnostic logs and B-feature signatures were absent.

## Excluded work

The following B work-in-progress changes are not included in this release:

- `pageRenderSeq` and `isPageRenderCurrent`;
- `loadPO` / `loadPI` stale-render guards;
- asynchronous list refresh changes in `saveEditPI`;
- `toast.piSavedButRefreshFailed`;
- all other uncommitted or untracked files from the main working directory.

## Rollback point

- Version: `v1.0.2`
- Commit: `3b4fb8e24170f681c0ca6909438d95e2280fc4b4`

The `v1.0.2` tag must remain unchanged. The `v1.0.3` tag will be created only after production deployment and production browser verification succeed.
