<!-- system-recap:start -->

<details>
<summary>System recap: <b>extends existing primitives</b> (medium risk)</summary>

**Mode:** recap · **Base:** `main` @ `f9a4b1508` · **Head:** `91e9dfda6`

**Classification:** extends. Shared error-prompt helper + button composed into
agent-blind website/email surfaces; no `primitives.yaml` map change.

### Primitives touched

| Primitive         | Group    | Impact  |
| ----------------- | -------- | ------- |
| `app-ui`          | surfaces | extends |
| `package-runtime` | runtime  | extends |

### Change flow

Agent-blind HTML errors get a redacted copy-paste prompt for the user's agent.

```mermaid
sequenceDiagram
	participant user as human
	participant appUi as app-ui
	participant packageRuntime as package-runtime
	participant agent as user-agent
	user->>appUi: Hits website or connect error
	appUi->>user: Shows Copy prompt for your agent
	user->>packageRuntime: Or visits a package-app HTML failure
	packageRuntime->>user: Same prompt block in static HTML
	user->>agent: Pastes prompt into Claude ChatGPT Grok or Cursor
	agent->>appUi: Fixes via search execute runGet guides
```

</details>

<!-- system-recap:end -->
