# Plugin Agent Routing Design

Status: approved design; implementation not started.

## Problem

The DSH global `AGENTS.md` describes generic Manager–worker routing through `subagent`, `subagent_fork`, and `workflow`. The plugin already provides `agent_delegation_route`, an enable switch, saved five-role mappings, and `agent_orchestrate`, but its injected prompt only explains the plugin path for requests explicitly phrased as role-based multi-agent orchestration. This leaves room for the generic routing instructions to select another path when the plugin's routing is intended.

## Decision

Strengthen the plugin's injected system prompt to define the routing precedence for work handled through this plugin. Do not modify or install into `$DSH_HOME/AGENTS.md`; do not add a separately maintained AGENTS snippet.

## Routing behavior

- For a task where delegation is being considered, the root assesses the independent work scopes, explicit multi-agent request, and need for an independent check, then calls `agent_delegation_route` with that assessment.
- If the route is `root`, the root handles the task without invoking `agent_orchestrate`.
- If the route is `delegate` and the plugin's multi-agent mode is enabled, the root calls `agent_orchestrate`, passing the same assessment and using the saved role mappings. It does not substitute generic `subagent`, `subagent_fork`, or `workflow` for this plugin route.
- If plugin mode is disabled, the root does not bypass the switch through this plugin route. A user who explicitly names another delegation tool still takes precedence and may use that tool.
- Root-owned planning, ambiguous or high-risk decisions, and final verification remain with the root. A delegation decision does not authorize parallel writes; existing ownership, handoff, and failure rules remain in force.
- User requests for a simple task do not require a routing-tool call unless delegation is under consideration.

## Scope and compatibility

This is a prompt-guidance change in `index.js`. It does not alter tool schemas, delegation decision logic, model IDs, stored mappings, the global AGENTS file, DSH native Agent Teams, or other plugins. Existing settings and session snapshots are unaffected.

## Acceptance criteria

- The injected guidance clearly describes the root/delegate decision path and plugin-enabled gate.
- The same route assessment is passed to `agent_orchestrate`.
- Generic delegation tools are not used as a fallback for the plugin route when plugin mode is off.
- Explicit user selection of another tool remains authoritative.
- The root's decision-making and verification responsibilities remain explicit.
- No global or unrelated files are modified.

## Review notes

- The system-prompt wording should stay concise and avoid requiring a routing call for simple tasks.
- Existing changes in the shared worktree are outside this design and must be preserved.
