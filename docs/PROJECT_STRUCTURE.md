# PROJECT STRUCTURE

## Katman Yapısı (Node.js uyarlaması)
backend/
  src/
    ai/
      orchestrator/    # Chat orchestrator, agent router
      tools/           # Tool handler registry + implementations
      context/         # Auth context builder, session context
      audit/           # Audit logger
    school/
      connector/       # SchoolConnectorInterface + MockSchoolApiConnector
      mapper/          # Data normalization
    auth/              # JWT, permission, scope
    session/           # AI session management
  server.js            # Express entry point

frontend/              # Separate test platform (SPA)
  index.html

docs/                  # Architecture documents
  ORCHESTRATION.md
  TOOL_CONTRACTS.md
  BACKEND_ENDPOINTS.md
  DTO_SCHEMAS.md
  PROJECT_STRUCTURE.md

## OpenClaw Agent Workspace Files
~/.openclaw/agents/
  learner-agent/workspace/   (IDENTITY, SOUL, TOOLS, USER, AGENTS)
  teacher-agent/workspace/   (IDENTITY, SOUL, TOOLS, USER, AGENTS)
  parent-agent/workspace/    (IDENTITY, SOUL, TOOLS, USER, AGENTS)
  retrieval-agent/workspace/ (IDENTITY, SOUL, TOOLS, USER)
  assessment-agent/workspace/(IDENTITY, SOUL, TOOLS, USER)
  study-plan-agent/workspace/(IDENTITY, SOUL, TOOLS, USER)
  content-agent/workspace/   (IDENTITY, SOUL, TOOLS, USER)
  report-agent/workspace/    (IDENTITY, SOUL, TOOLS, USER)
  risk-agent/workspace/      (IDENTITY, SOUL, TOOLS, USER)
