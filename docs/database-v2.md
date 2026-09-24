# Copilot Bridge Server V2 — database contract

Contract version `2.0.0`. PostgreSQL 17 with Drizzle migrations is the system of record. The ER and domain relationships are in [architecture-v2.md](architecture-v2.md); billing invariants are in [billing-v2.md](billing-v2.md). The existing V1 tables remain intact.

| Domain | Tables | Invariant |
| --- | --- | --- |
| Identity and access | `users`, `devices`, `device_sessions`, `refresh_tokens`, `web_sessions` | Device belongs to user; `(user_id,device_id)` is unique; refresh/session tokens are hashes. |
| Entitlement | `plans`, `subscriptions`, `plan_model_access`, `user_model_access` | Plan sets max devices, monthly points, rollover policy and legacy quotas. |
| Provider | `providers`, `models`, `provider_credentials`, `provider_accounts`, `provider_account_credentials` | Managed and user-owned accounts are distinct; credentials are AES-256-GCM ciphertext, never API output. |
| Request and metering | `ai_requests`, `usage_events`, legacy `usage_records`, `model_sessions` | Request pins rate version; one final immutable V2 event per request; V1 history remains separate. |
| Rating | `rate_cards`, `rate_card_versions` | Card key is provider/model/policy; version number is unique per card; one active version; published numbers are immutable. |
| Wallet | `wallets`, `wallet_transactions`, `wallet_lots`, `wallet_lot_spends` | One wallet per user; transaction idempotency key unique; ledger and lot allocations are immutable; balance never negative. |
| Referral | `referral_codes`, `referrals`, `referral_rewards`, `referral_policy` | Code belongs to user; one referred-user claim; reward unique per referral/beneficiary. |
| Commerce and operations | `billing_orders`, `payment_events`, `audit_logs`, `releases`, `system_settings` | Payment event idempotency; Admin mutations audited; historical orders retained. |

`usage_events` stores request/user/device/provider/model IDs, raw input/output/cached/reasoning counters, image counts, tool calls, provider reported usage, actual provider cost/currency when known, pinned rate version, rated/charged points, billing state and timestamps. Database triggers reject event updates and deletes. It stores neither prompts nor tokens or keys. `wallet_transactions` is append only, with signed points, balance after, reference, idempotency key and timestamp. `wallet_lots` link each credit to one source transaction, record initial and remaining points plus optional expiry; their remaining balance can only decrease. `wallet_lot_spends` are append only and attribute debits/expiry to source lots.

## Migration sequence

1. `0000`: V1 baseline.
2. `0001_abandoned_shotgun.sql`: additive V2 domain tables, fields, immutable event/ledger and rate-card constraints.
3. `0002_heavy_makkari.sql`: request rate-version pin and unique final event per request.
4. `0003_motionless_quasimodo.sql`: wallet lots, allocations, checks and immutability guards. The full migration chain and eight PostgreSQL invariants passed on an isolated fresh database. Production migration and the hourly expiry job passed with point charging disabled; see [deployment-v2.md](deployment-v2.md).

No migration fabricates points, provider cost or revenue from legacy `usage_records`. V1 records remain the quota history. Production V2 wallets currently contain no ledger rows and no nonzero balances; before applying `0003` to another environment, check these counts and reconcile/backfill any preexisting V2 credits. Migration is forward only. Rollback switches API/Web images while leaving additive schema in place; dropping tables would destroy billing evidence.

## Integrity queries

```sql
select w.id, w.balance, coalesce(sum(t.points),0) as ledger_balance
from wallets w left join wallet_transactions t on t.wallet_id=w.id
group by w.id having w.balance <> coalesce(sum(t.points),0);
```

```sql
select w.id, w.balance, coalesce(sum(l.remaining_points),0) as lot_balance
from wallets w left join wallet_lots l on l.wallet_id=w.id
group by w.id having w.balance <> coalesce(sum(l.remaining_points),0);
```

Both queries should return zero rows after `0003` and lot-aware code are active. Backups use PostgreSQL custom-format dumps in a private host directory; an off-host encrypted copy remains a commercial release requirement.
