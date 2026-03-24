# Pylon Gateway Integration

Add Pylon (customer service platform) as a second gateway integration alongside GitHub. When support tickets are assigned to the current user, automatically spawn agents that research customers and prepare draft responses as internal notes. All Pylon-specific logic lives in skills, not in core product code.

## API Research Summary

### Pylon API Capabilities (confirmed via docs)

**Base URL:** `https://api.usepylon.com`
**Auth:** Bearer token (admin-created API key)
**Rate limits:** 10-60 req/min depending on endpoint

| Endpoint | Method | Purpose |
|---|---|---|
| `/me` | GET | Get current authenticated user (for assignment matching) |
| `/issues` | GET | List issues in time range |
| `/issues` | POST | Create issue |
| `/issues/{id}` | GET | Get issue by ID |
| `/issues/{id}` | PATCH | Update issue (state, assignee, tags, etc.) |
| `/issues/search` | POST | Advanced filtered search (assignee, account, tags, time, etc.) |
| `/issues/{id}/reply` | POST | **Send customer-facing reply** (email, Slack, in-app) |
| `/issues/{id}/note` | POST | Create internal note |
| `/issues/{id}/messages` | GET | Get all messages on an issue |
| `/contacts/{id}` | GET | Get customer contact details |
| `/contacts/search` | POST | Search contacts |
| `/accounts/{id}` | GET | Get customer account details |
| `/accounts/search` | POST | Search accounts |
| `/issues/{id}/followers` | GET/POST | Manage issue followers |
| `/issues/{id}/external-issues` | POST | Link to external issues (GitHub, Linear, etc.) |

### Webhooks (two systems — we use Triggers)

1. **Trigger-based webhooks** (in-app) — **our approach**: Create a Trigger with "Send webhook" action. Configurable "When"/"If" conditions with custom payload via template variables (`{{ variableName }}`). Set up via Pylon UI. Available kickoff events include:
   - **"Assignee changed"** — fires when assignee on an issue changes (our primary trigger)
   - **"New issue created"** — fires on new issue creation
   - **"Issue updated"** — fires on any field change
   - **"Team assigned"**, **"Issue reaction added"**, **"Message is internal note"**
   - Kickoff conditions can be combined with OR logic
   - Payload is fully user-defined — we define a standard shape in the setup instructions

2. **API webhook destinations** (developer): Traditional event subscription model. Includes `Pylon-Webhook-Signature` (HMAC-SHA256), `Pylon-Webhook-Timestamp`, `Pylon-Webhook-Version` headers. Retries up to 5 attempts. **However, the event type list is not publicly documented** — only visible in Pylon app settings. Less suitable for our guided setup flow.

### Key Findings

- **Internal notes are supported** via `POST /issues/{id}/note` — we'll use this for draft responses instead of sending replies automatically
- **Customer research is feasible** via `/contacts/{id}`, `/accounts/{id}`, and `/issues/search` (filter by requester to see history)
- **Assignment filtering works** via `/issues/search` with `assignee_id` filter + `/me` to get current user ID
- **Webhook delivery to our gateway is feasible** — Pylon supports custom webhook destinations with signature verification

## Phases

- [ ] Extend gateway types and server to support `pylon` channel type
- [ ] Add Pylon webhook listener and event routing (parallel to GitHub pattern)
- [ ] Build `pylon-triage-all` skill (batch triage all assigned tickets)
- [ ] Build `pylon-triage-single` skill (deep-dive on one ticket: research customer, draft response)
- [ ] Add generic integration configuration UI for Pylon
- [ ] Write integration tests for Pylon event handling and API client

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Extend Gateway Types & Server

The existing gateway is hardcoded to `z.literal("github")`. We need to make it polymorphic.

### Changes

**`core/types/gateway-channel.ts`** — Change `type` from `z.literal("github")` to `z.enum(["github", "pylon"])`. Add optional Pylon-specific fields:
```ts
// Add to schema:
pylonConfig: z.object({
  userId: z.string(),        // Resolved via /me on setup
  webhookSecret: z.string(), // For signature verification
}).optional(),
```

The API key is stored in the system keychain via Tauri's Stronghold plugin, keyed by channel ID. It is NOT stored in the channel metadata on disk.

**`core/types/gateway-events.ts`** — Change `ChannelSchema.type` from `z.literal("github")` to `z.enum(["github", "pylon"])`.

**Gateway server** (anvil-server) — Accept `type: "pylon"` when creating channels. The server already treats payloads as opaque (`payload: z.record()`), so Pylon webhook bodies will pass through unchanged. Add Pylon signature verification (`Pylon-Webhook-Signature` header, HMAC-SHA256 of `timestamp.payload` with channel secret).

## Phase 2: Pylon Webhook Listener & Event Routing

Mirror the GitHub pattern: raw gateway events → typed Pylon events. No Pylon entity layer — events are routed directly to skill invocations.

### Changes

**`src/entities/gateway-channels/listeners.ts`** — Add routing for `pylon.*` events alongside existing `github.*` routing:
```ts
if (event.type.startsWith("pylon.")) {
  eventBus.emit(PYLON_WEBHOOK_EVENT_KEY, {
    channelId: event.channelId,
    pylonEventType: event.type.replace("pylon.", ""),
    payload: event.payload,
  });
}
```

**`core/types/events.ts`** — Add `PYLON_WEBHOOK_EVENT` event name and payload type:
```ts
PYLON_WEBHOOK_EVENT: {
  channelId: string;
  pylonEventType: string;  // e.g. "issue.created", "issue.assigned"
  payload: Record<string, unknown>;
};
```

**`src/entities/gateway-channels/pylon-event-handler.ts`** — Lightweight handler that listens for `PYLON_WEBHOOK_EVENT` and, when a ticket is assigned to the current user (matching `pylonConfig.userId`), spawns an agent thread with the `pylon-triage-single` skill. No entity store, no cached ticket state — the skill fetches what it needs directly from the Pylon API.

### Pylon Webhook Setup (Trigger-Based)

The user creates a **Trigger** in Pylon (Settings → Triggers) with our guided instructions:

1. **When**: "Assignee changed" OR "New issue created"
2. **If** (optional filter): assignee matches the user
3. **Action**: "Send webhook" to the gateway `webhookUrl`
4. **Payload**: We provide a standard JSON template for the user to paste:
```json
{
  "event": "assignee_changed",
  "issue_id": "{{ issue.id }}",
  "issue_number": "{{ issue.number }}",
  "title": "{{ issue.title }}",
  "assignee_id": "{{ issue.assignee.id }}",
  "assignee_email": "{{ issue.assignee.email }}",
  "requester_id": "{{ issue.requester.id }}",
  "account_id": "{{ issue.account.id }}",
  "state": "{{ issue.state }}",
  "link": "{{ issue.link }}"
}
```
5. The user adds a custom `Authorization` header with a shared secret for verification

Since the trigger-based system doesn't use Pylon's HMAC signature verification (that's the API destination system), we authenticate via a shared secret in the `Authorization` header that the gateway server validates. Store this in `pylonConfig.webhookSecret`.

This is manual setup (unlike GitHub where we auto-create via `gh` CLI) because Pylon's Trigger creation is done through their UI. We provide step-by-step instructions with screenshots/descriptions in the configuration flow.

## Phase 3: `pylon-triage-all` Skill

A user-invocable skill that batch-triages all tickets currently assigned to the user. Good for morning stand-up or catching up after being away.

### Skill Structure: `.claude/skills/pylon-triage-all/`

**`SKILL.md`**:
```markdown
---
name: Pylon Triage All
description: Triage all Pylon support tickets assigned to you
user-invocable: true
argument-hint: "[optional: filter like 'urgent only' or 'last 24h']"
---

# Pylon Triage All

Fetch and summarize all open tickets assigned to you in Pylon.

## Steps

1. Read the Pylon API key from the system keychain (channel config)
2. Call GET /me to confirm identity
3. Call POST /issues/search with assignee_id filter, state: open
4. For each ticket, produce a brief summary:
   - Ticket number + title + priority + state
   - Requester name/company
   - Last message preview
   - How long it's been waiting
5. Output a prioritized list with recommendations on which to tackle first
6. For any ticket that needs immediate attention, suggest running /pylon-triage-single {ticket-id}
```

**`pylon-client.ts`** — Lightweight Pylon API client used by both skills. Lives in the skill folder since Pylon logic stays out of core. Shared between skills via relative import or extracted to a shared skill lib.

```ts
class PylonClient {
  constructor(private apiKey: string) {}

  async getMe(): Promise<PylonUser>
  async getIssue(id: string): Promise<PylonIssue>
  async searchIssues(filter: PylonFilter): Promise<PylonIssue[]>
  async getContact(id: string): Promise<PylonContact>
  async getAccount(id: string): Promise<PylonAccount>
  async getIssueMessages(id: string): Promise<PylonMessage[]>
}
```

**`pylon-types.ts`** — Zod schemas for Pylon API responses, validated at the boundary.

### Shared Skill Code

Since both `pylon-triage-all` and `pylon-triage-single` need the API client and types, we have two options:
- **Option A**: Place `pylon-client.ts` and `pylon-types.ts` in `.claude/skills/pylon-shared/` and import from both skills
- **Option B**: Duplicate the client in each skill folder (simpler, but drift risk)

Recommend Option A — a shared utility folder that both skills reference.

## Phase 4: `pylon-triage-single` Skill

Deep-dive triage on a single ticket. Auto-invoked when a ticket is assigned (via webhook), or manually via `/pylon-triage-single {ticket-id}`.

### Skill Structure: `.claude/skills/pylon-triage-single/`

**`SKILL.md`**:
```markdown
---
name: Pylon Triage Single
description: Deep-triage a single Pylon ticket — research customer, draft response as internal note
user-invocable: true
argument-hint: "<ticket-id or ticket-number>"
---

# Pylon Triage Single

Deep-dive triage on a single customer support ticket.

## Steps

1. Read the Pylon API key from the system keychain (channel config)
2. Fetch full ticket details: GET /issues/{id}
3. Fetch the complete message thread: GET /issues/{id}/messages
4. Research the customer:
   - GET /contacts/{requester_id} — contact info
   - GET /accounts/{account_id} — company details
   - POST /issues/search filtered by requester_id — past ticket history
5. Analyze the ticket and produce:
   - **Customer Context**: name, company, past interactions summary
   - **Ticket Summary**: what they need, urgency assessment
   - **Draft Response**: professional, helpful reply in HTML
   - **Action Plan**: concrete next steps, escalation needs
6. Post the draft response as an **internal note** on the ticket via POST /issues/{id}/note
   - This lets the user review and edit before sending to the customer
7. Output a summary to the thread so the user can review
```

### Auto-Spawn Logic

In `src/entities/gateway-channels/pylon-event-handler.ts`, when a ticket is assigned to the current user (matching `pylonConfig.userId`):
1. Create a thread for this ticket (reuse existing if ticket already tracked)
2. Spawn an agent with the `pylon-triage-single` skill
3. Pass ticket ID and channel ID as context

The agent posts its draft as an internal note on the Pylon ticket. The user reviews the note in Pylon's UI and can edit/send from there — no agentic reply.

## Phase 5: Generic Integration Configuration UI

A minimal, generic settings section that works for Pylon (and future integrations).

### UX Flow

1. User navigates to Settings → Integrations
2. Sees a list of available integrations (GitHub already present, add Pylon)
3. For Pylon:
   - Enters API key → stored in Stronghold (system keychain)
   - App calls `GET /me` to validate the key and resolve `userId`
   - App creates a gateway channel (type: `pylon`, single channel only)
   - App displays the `webhookUrl` and step-by-step instructions for configuring the webhook in Pylon's admin UI
   - User confirms webhook is configured → activate channel
4. Show connection status (connected/disconnected) and a way to disconnect

### Design Principles

- Keep the UI generic — a card per integration with name, status, configure/disconnect actions
- Pylon-specific setup instructions render as markdown within the generic card
- API key management through Stronghold, never exposed in metadata files
- No Pylon-specific React components if avoidable — use the same integration card pattern as GitHub

## Phase 6: Integration Tests

### Pylon client tests (`.claude/skills/pylon-shared/__tests__/pylon-client.test.ts`)
- Mock HTTP responses for all PylonClient methods
- Test Zod validation on API response boundaries
- Test error handling for rate limits and auth failures

### Event routing tests
- Test gateway event routing for `pylon.*` events in listeners
- Test pylon-event-handler assignment matching logic
- Test auto-triage spawn conditions

### Live API test (guarded by env var)
- `PYLON_API_KEY` guard, skip if not set
- Validate `/me` returns expected shape
- Validate `/issues/search` with a basic filter

## Resolved Questions

1. **API key storage**: Using Tauri's Stronghold plugin (system keychain). API key never written to disk in plaintext.
2. **Gateway server changes**: Confirmed — we'll add `type: "pylon"` support and Pylon signature verification to anvil-server.
3. **Webhook event types**: Resolved. Using Pylon's **Trigger-based webhooks** (not API destinations). The "Assignee changed" kickoff event targets assignment changes directly. The API destination event type list is not publicly documented, making triggers the better choice since we control the payload shape and can provide exact setup instructions to users.
4. **Multi-channel**: Single Pylon channel for now. UI enforces one active Pylon integration.
