---
author: Ryan Condron (TabHR Integration)
description: Enterprise-grade QuickBooks Online API skill for TabHR OpenClaw agents. Supports structured read-only and read/write accounting operations with enforced safety, retry logic, idempotency protection, audit output, and token refresh contract.
env:
- QUICKBOOKS_CLIENT_ID
- QUICKBOOKS_CLIENT_SECRET
- QUICKBOOKS_REALM_ID
- QUICKBOOKS_ACCESS_TOKEN
- QUICKBOOKS_REFRESH_TOKEN
- QUICKBOOKS_TOKEN_EXPIRY
- QUICKBOOKS_BASE_URL
- QUICKBOOKS_ACCESS_MODE
- QUICKBOOKS_MINOR_VERSION
name: quickbooks
requires:
- shell
- http (curl)
version: 2.1.0
---

# QuickBooks Online API Skill (TabHR + OpenClaw)

This skill allows OpenClaw agents running inside TabHR-managed containers to interact safely with a connected QuickBooks Online company.

------------------------------------------------------------------------

# Critical Architecture Rules

## 1. OAuth Is Managed by TabHR

-   This skill MUST NOT initiate OAuth flows.
-   Tokens and realmId are injected by TabHR after user connection.
-   If refresh fails permanently → instruct user to reconnect in TabHR.

------------------------------------------------------------------------

## 2. Token Handling (Structured Refresh Contract)

### BEFORE ANY API CALL:

1.  Compare current Unix timestamp with `QUICKBOOKS_TOKEN_EXPIRY`.
2.  If expired or missing → refresh immediately.

### Refresh Command

``` bash
curl -X POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer   -H "Content-Type: application/x-www-form-urlencoded"   -d "grant_type=refresh_token"   -d "refresh_token=$QUICKBOOKS_REFRESH_TOKEN"   -d "client_id=$QUICKBOOKS_CLIENT_ID"   -d "client_secret=$QUICKBOOKS_CLIENT_SECRET"
```

The container MUST NOT modify environment variables directly. Instead, it must output a JSON object with refresh_success, new_access_token, new_refresh_token, expires_in. If refresh fails (invalid_grant), return: "QuickBooks connection has expired or been revoked. Please reconnect QuickBooks in the TabHR dashboard." and stop execution.

------------------------------------------------------------------------

## 3. Company Context Safety Check (Mandatory)

Before first operation: GET companyinfo endpoint. If this fails, stop execution. The skill must NEVER accept a realmId override from user input.

------------------------------------------------------------------------

## 4. Environment Lock Enforcement

If QUICKBOOKS_BASE_URL contains "sandbox" then environment = sandbox; otherwise production. The environment MUST NOT change during runtime. Log environment at start.

------------------------------------------------------------------------

## 5. Access Mode Enforcement

Read QUICKBOOKS_ACCESS_MODE. If mode = "read": allow GET, /query, /reports, /companyinfo, /preferences, CDC. Reject POST, PUT, DELETE, void, batch write. Return message to activate read/write container if needed.

------------------------------------------------------------------------

## 6. Global API Rules

All requests: Authorization Bearer token, Accept application/json, Content-Type application/json. Append ?minorversion=$QUICKBOOKS_MINOR_VERSION. Base URL: $QUICKBOOKS_BASE_URL/$QUICKBOOKS_REALM_ID/

------------------------------------------------------------------------

## 7. Retry Policy

401: refresh once, retry once. 429: exponential backoff (1s, 2s, 4s, 8s, 16s, max 5). 500/503: retry up to 3 times. 400: validation error. 403: permission error. 404: validate entity ID. No infinite loops.

------------------------------------------------------------------------

## 8. Idempotency Protection (MANDATORY for Writes)

All writes: deterministic idempotency key in PrivateNote or custom field. Before create, query for existing entity with same key; if found return existing. Required for Invoice, Payment, SalesReceipt, Bill, BillPayment, JournalEntry, Customer, Vendor, Item, and any create/update/void/delete.

------------------------------------------------------------------------

## 9. High-Level Agent-Safe Operations

Read: get_company_info, list_customers, list_invoices, get_profit_and_loss, get_balance_sheet, list_overdue_invoices, get_ar_aging, run_query. Write (readwrite only): create_invoice, record_payment, create_customer, sparse_update, void_transaction.

------------------------------------------------------------------------

## 10. Structured Audit Output (MANDATORY)

Every write must return JSON with operation, entity_type, entity_id, status, timestamp, summary, retry_count, idempotency_key, environment.

------------------------------------------------------------------------

## 11. Logging

Log: operation type, entity ID, HTTP status, retry count, duration, environment. Never log: access tokens, refresh tokens, client secret.

------------------------------------------------------------------------

## 12. Pagination and Data Guardrails

Paginate if results exceed 1000 rows (MAXRESULTS + STARTPOSITION). Timestamps UTC ISO-8601.

------------------------------------------------------------------------

## 13. Failure Conditions Requiring User Action

invalid_grant on refresh, repeated 401 after refresh, insufficient scope (403), revoked authorization. Return: "QuickBooks authorization requires reconnection in the TabHR dashboard."

------------------------------------------------------------------------

End of Skill Definition. Version 2.1.0 -- Enterprise Hardened + Idempotent
