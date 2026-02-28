# Pylon Gateway Integration

Add Pylon (customer service platform) as a second gateway integration alongside GitHub. When a support ticket is assigned to the current user, automatically spawn an agent that researches the customer and prepares a draft response + action plan. Provide a skill to send the response via email.

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

### Webhooks (two systems)

1. **Trigger-based webhooks** (in-app): Create a Trigger with "Send webhook" action. Configurable "When"/"If" conditions. Custom payload with template variables. Set up via Pylon UI.

2. **API webhook destinations** (developer): Register a destination URL in API settings, select event types. Includes `Pylon-Webhook-Signature` (HMAC-SHA256) and `Pylon-Webhook-Timestamp` headers for verification. Retries up to 5 attempts with exponential backoff. Destinations go inactive after 7 days without successful delivery.

### Key Findings

- **Replying to tickets is fully supported** via `POST /issues/{id}/reply` with `body_html`, supports `email_info` (to/cc/bcc) for email delivery
- **Customer research is feasible** via `/contacts/{id}`, `/accounts/{id}`, and `/issues/search` (filter by requester to see history)
- **Assignment filtering works** via `/issues/search` with `assignee_id` filter + `/me` to get current user ID
- **Webhook delivery to our gateway is feasible** — Pylon supports custom webhook destinations with signature verification

## Phases

- [ ] Extend gateway types and server to support `pylon` channel type
- [ ] Add Pylon webhook listener and event routing (parallel to GitHub pattern)
- [ ] Build Pylon entity layer (service, store, types) for tickets
- [ ] Create Pylon API client for agent-side operations
- [ ] Implement `pylon-triage` agent skill (research customer, draft response + action plan)
- [ ] Implement `pylon-reply` skill (send response via API)
- [ ] Add configuration UI for Pylon API key and username
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
  apiKey: z.string(),        // Pylon bearer token
  username: z.string(),      // User's Pylon username/email
  userId: z.string(),        // Resolved via /me on setup
  webhookSecret: z.string(), // For signature verification
}).optional(),
```

**`core/types/gateway-events.ts`** — Change `ChannelSchema.type` from `z.literal("github")` to `z.enum(["github", "pylon"])`.

**Gateway server** (mort-server) — Accept `type: "pylon"` when creating channels. The server already treats payloads as opaque (`payload: z.record()`), so Pylon webhook bodies will pass through unchanged. Add Pylon signature verification (`Pylon-Webhook-Signature` header, HMAC-SHA256 of `timestamp.payload` with channel secret).

## Phase 2: Pylon Webhook Listener & Event Routing

Mirror the GitHub pattern: raw gateway events → typed Pylon events.

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

### Pylon Webhook Setup

The user configures a webhook destination in their Pylon admin settings (API Settings → Webhooks) pointing at the gateway `webhookUrl`. They select relevant event types (at minimum: issue created, issue updated/assigned). We store the webhook secret in `pylonConfig.webhookSecret` for the gateway server to verify signatures.

This is manual setup (unlike GitHub where we auto-create via `gh` CLI) because Pylon's webhook creation is done through their UI, not a public API endpoint. We guide the user through it in the configuration flow.

## Phase 3: Pylon Entity Layer

Create a new entity for Pylon tickets, following the PR entity pattern.

### New Files

**`src/entities/pylon-tickets/types.ts`** — Zod schemas for PylonTicket metadata:
```ts
PylonTicketMetadataSchema = z.object({
  id: z.string(),              // Pylon issue ID
  number: z.number(),          // Pylon issue number
  title: z.string(),
  state: z.string(),           // new, waiting_on_you, waiting_on_customer, etc.
  assigneeId: z.string().nullable(),
  requesterId: z.string().nullable(),
  requesterEmail: z.string().nullable(),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  priority: z.enum(["urgent", "high", "medium", "low"]).nullable(),
  link: z.string().url(),      // Direct Pylon URL
  channelId: z.string(),       // Gateway channel
  createdAt: z.number(),
  updatedAt: z.number(),
})
```

**`src/entities/pylon-tickets/store.ts`** — Zustand store following entity store pattern.

**`src/entities/pylon-tickets/service.ts`** — PylonTicketService with CRUD, hydration, and auto-triage triggering.

**`src/entities/pylon-tickets/gateway-handler.ts`** — Handle incoming Pylon events:
- `issue.created` / `issue.assigned` → Check if assigned to current user → spawn triage agent
- `issue.updated` → Refresh cached ticket state
- `issue.closed` → Clean up / mark inactive

**`src/entities/pylon-tickets/listeners.ts`** — Subscribe to `PYLON_WEBHOOK_EVENT`, call gateway handler.

## Phase 4: Pylon API Client (Agent-Side)

A lightweight HTTP client for agent processes to call Pylon APIs. Lives in `agents/` since it's used by agent skills.

### New File: `agents/src/lib/pylon-client.ts`

```ts
class PylonClient {
  constructor(private apiKey: string) {}

  // Identity
  async getMe(): Promise<PylonUser>

  // Issues
  async getIssue(id: string): Promise<PylonIssue>
  async searchIssues(filter: PylonFilter): Promise<PylonIssue[]>
  async replyToIssue(id: string, body: ReplyBody): Promise<void>
  async updateIssue(id: string, updates: IssueUpdates): Promise<void>

  // Customer research
  async getContact(id: string): Promise<PylonContact>
  async getAccount(id: string): Promise<PylonAccount>
  async getIssueMessages(id: string): Promise<PylonMessage[]>
  async searchContactIssues(contactId: string): Promise<PylonIssue[]>
}
```

Types are Zod-validated at the boundary (API responses). Keep the client under 250 lines — split types into a separate `pylon-types.ts` if needed.

## Phase 5: `pylon-triage` Agent Skill

When a ticket is assigned to the user, this skill kicks off automatically. The agent:

1. **Fetches ticket details** — full issue body, messages, metadata
2. **Researches the customer** — contact info, account details, past ticket history (via `/issues/search` filtered by `requester_id`)
3. **Generates a brief plan file** at `plans/pylon-tickets/{ticket-number}.md` containing:
   - Customer context (name, account, history summary)
   - Ticket summary
   - Proposed RESPONSE (draft reply HTML)
   - Action plan (next steps, escalation needs, related issues)

### Skill File: `.claude/skills/pylon-triage/SKILL.md`

```markdown
---
description: Triage a Pylon support ticket — research customer, draft response and action plan
userInvocable: true
disableModelInvocation: false
---

# Pylon Ticket Triage

You are triaging a customer support ticket from Pylon.

## Steps

1. Read the ticket details provided in context
2. Use the Pylon API to research:
   - Customer contact details (GET /contacts/{id})
   - Customer account details (GET /accounts/{id})
   - Customer's ticket history (POST /issues/search filtered by requester_id)
   - Full message thread (GET /issues/{id}/messages)
3. Create a brief plan file at plans/pylon-tickets/{ticket-number}.md with:
   - **Customer Context**: name, company, past interactions summary
   - **Ticket Summary**: what they need, urgency assessment
   - **Draft Response**: professional, helpful reply in HTML
   - **Action Plan**: concrete next steps
4. Keep the plan concise — aim for under 100 lines
```

### Auto-Spawn Logic

In `src/entities/pylon-tickets/gateway-handler.ts`, when a ticket is assigned to the current user (matching `pylonConfig.userId`):
1. Create a thread for this ticket (reuse existing if ticket already tracked)
2. Spawn an agent with the `pylon-triage` skill injected
3. Pass ticket ID and channel config as context

## Phase 6: `pylon-reply` Skill

A user-invocable skill that sends the draft response from the triage plan.

### Skill File: `.claude/skills/pylon-reply/SKILL.md`

```markdown
---
description: Send a reply to a Pylon support ticket via email
userInvocable: true
disableModelInvocation: false
---

# Pylon Reply

Send a customer-facing reply to a Pylon support ticket.

## Steps

1. Read the triage plan at plans/pylon-tickets/{ticket-number}.md
2. Use the draft response from the plan (or user-provided edits)
3. Call POST /issues/{id}/reply with:
   - body_html: the response content
   - email_info: { to_emails: [requester email] }
4. Update the issue state to "waiting_on_customer" via PATCH /issues/{id}
5. Mark the triage plan phase as complete
```

This gives the user a review step — the triage agent drafts, the user reviews/edits the plan file, then invokes `/pylon-reply` to send.

## Phase 7: Configuration UI

Add a settings section for Pylon configuration.

### UX Flow

1. User navigates to Settings → Integrations → Pylon
2. Enters their Pylon API key and email/username
3. App calls `GET /me` to validate the key and resolve `userId`
4. App creates a gateway channel (type: `pylon`)
5. App displays the `webhookUrl` and instructions for the user to configure in Pylon's webhook settings (select event types, paste URL, copy secret for signature verification)
6. Once configured, activate the channel to start receiving events

### Changes

- Add Pylon section to settings/integrations UI
- Store API key securely in `pylonConfig` on the channel metadata
- Validate connectivity on save via `/me` endpoint

## Phase 8: Integration Tests

### Agent-side tests (`agents/src/lib/__tests__/pylon-client.test.ts`)
- Mock HTTP responses for all PylonClient methods
- Test Zod validation on API response boundaries
- Test error handling for rate limits and auth failures

### Entity-side tests
- Test gateway event routing for `pylon.*` events
- Test ticket assignment matching logic
- Test auto-triage spawn conditions

### Live API test (guarded by env var)
- `PYLON_API_KEY` guard, skip if not set
- Validate `/me` returns expected shape
- Validate `/issues/search` with a basic filter

## Open Questions

1. **API key storage**: The GitHub integration uses `gh` CLI auth (no key stored). For Pylon we need to store a bearer token. Should we use the system keychain (via Tauri's `stronghold` plugin) or is disk storage (`pylonConfig` in metadata.json) acceptable for MVP?

2. **Gateway server changes**: The gateway server (mort-server on Fly) needs to accept `type: "pylon"` and add Pylon signature verification. This is a server-side deploy — confirm we can make this change.

3. **Webhook event types**: Pylon's developer webhook system lets you select event types when creating a destination. We need to confirm which event types map to ticket assignment changes. The trigger-based system is more flexible but requires in-app setup by the user.

4. **Multi-channel**: Should a user be able to have multiple Pylon channels (e.g., different teams/workspaces)? The current architecture supports it but the UI would need to handle it.
