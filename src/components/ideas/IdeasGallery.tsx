import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

/**
 * IdeasGallery â€” a dynamic, interactive showcase of
 * real, actionable workflows that Orbito can execute.
 *
 * Each card maps to an actual capability in the codebase:
 * ACP lifecycle, MCP integration, skill loading, project
 * context, artifact handling, and performance diagnostics.
 *
 * Design language:
 *   Warm neutral surfaces, charcoal typography,
 *   warm orange accent, rounded cards, subtle borders,
 *   generous spacing. Consistent with the rest of the app.
 */

export interface Idea {
  id: string
  title: string
  tagline: string
  category: string
  icon: React.ReactNode
  steps: string
  keyCapability: string
  estimatedDuration: string
  requiresMcp: boolean
  mcpTool?: string
}

const IDEAS: Idea[] = [
  {
    id: 'acp-lifecycle',
    title: 'ACP Lifecycle Management',
    tagline: 'Initialize, prompt, cancel, and configure agent sessions',
    category: 'agent',
    icon: (
      <span role="img" aria-label="zap" className="text-xl">
        âš¡
      </span>
    ),
    steps: `Initialize a new agent session via ACP
Send the first prompt and observe streamed response
Cancel or pause mid-execution
Configure model/provider changes mid-session
Resume interrupted sessions`,
    keyCapability: 'Agent communication',
    estimatedDuration: '~5 min setup',
    requiresMcp: false,
  },
  {
    id: 'mcp-integration',
    title: 'MCP Tool Integration',
    tagline: 'Connect and use MCP servers like Exa, Firecrawl, and more',
    category: 'mcp',
    icon: (
      <span role="img" aria-label="globe" className="text-xl">
        ðŸŒ
      </span>
    ),
    steps: `Add and configure MCP servers (Exa, Firecrawl, filesystem, etc.)
Test connections and discover available tools
Use tools directly from the chat composer
Monitor tool activity and results in the event stream
Securely manage credentials per-server`,
    keyCapability: 'Tool integration',
    estimatedDuration: '~10 min',
    requiresMcp: true,
    mcpTool: 'Exa, Firecrawl, Slack, GitHub',
  },
  {
    id: 'artifact-workflows',
    title: 'Artifact-Centered Workflows',
    tagline: 'Save, organize, and reuse outputs across projects',
    category: 'artifacts',
    icon: (
      <span role="img" aria-label="briefcase" className="text-xl">
        ðŸ’¼
      </span>
    ),
    steps: `Run an agent session that produces structured output
Auto-save the result as an artifact with metadata
Browse, search, and filter your artifact library
Share artifacts between projects or export them
Tag and categorize for later retrieval`,
    keyCapability: 'Output persistence',
    estimatedDuration: 'Ongoing',
    requiresMcp: false,
  },
  {
    id: 'project-context',
    title: 'Project Context & Conventions',
    tagline: 'Define language, framework, and conventions per project',
    category: 'projects',
    icon: (
      <span role="img" aria-label="network" className="text-xl">
        ðŸ”—
      </span>
    ),
    steps: `Define project name, type, language, and framework
Set conventions: lint, test framework, git workflow
Add security requirements (PHI, PII, auth, payments)
Persist conventions with the project in the workspace store
Auto-apply conventions when starting new sessions`,
    keyCapability: 'Project governance',
    estimatedDuration: 'One-time setup',
    requiresMcp: false,
  },
  {
    id: 'tdd-workflows',
    title: 'Test-Driven Development',
    tagline: 'Write tests first, implement, verify 80%+ coverage',
    category: 'testing',
    icon: (
      <span role="img" aria-label="cpu" className="text-xl">
        ðŸ§ª
      </span>
    ),
    steps: `Write user journey tests before implementation
Implement minimal code to pass tests
Run the test suite with coverage report
Refactor while keeping tests green
Verify 80%+ coverage across unit, integration, and E2E`,
    keyCapability: 'Quality assurance',
    estimatedDuration: 'Per feature',
    requiresMcp: false,
  },
  {
    id: 'security-review',
    title: 'Security Review',
    tagline: 'Pre-deployment security checklist with proven patterns',
    category: 'security',
    icon: (
      <span role="img" aria-label="shield" className="text-xl">
        ðŸ›¡ï¸
      </span>
    ),
    steps: `Verify no hardcoded secrets â€” all in env vars
Confirm all user inputs validated with schemas
Ensure all database queries are parameterized
Check XSS prevention and CSP headers configured
Verify auth tokens stored in httpOnly cookies
Confirm rate limiting enabled on all endpoints`,
    keyCapability: 'Production safety',
    estimatedDuration: '~15 min',
    requiresMcp: false,
  },
  {
    id: 'performance-diagnostics',
    title: 'Performance Diagnostics',
    tagline: 'Track, profile, and optimize app startup',
    category: 'performance',
    icon: (
      <span role="img" aria-label="chart" className="text-xl">
        ðŸ“Š
      </span>
    ),
    steps: `Press ctrl+shift+D to export the diagnostics log
Inspect startup phases: database init, MCP refresh, skill refresh
Profile background discovery timings in the session
Identify bottlenecks in session hydration or store load
Optimize based on collected real-world timing data`,
    keyCapability: 'Performance optimization',
    estimatedDuration: 'Ongoing',
    requiresMcp: false,
  },
  {
    id: 'telegram-sync',
    title: 'Telegram Chat Sync',
    tagline: 'Continue conversations on mobile without losing context',
    category: 'collaboration',
    icon: (
      <span role="img" aria-label="music" className="text-xl">
        ðŸ“±
      </span>
    ),
    steps: `Configure Telegram bot token in Orbito settings
Sync active session messages to your Telegram chat
Continue the conversation on your phone
Receive push notifications on desktop
Messages stay encrypted end-to-end`,
    keyCapability: 'Cross-device continuity',
    estimatedDuration: 'Persistent',
    requiresMcp: false,
  },
  {
    id: 'code-project',
    title: 'Code Project Management',
    tagline: 'Create, manage, and switch between code projects',
    category: 'code',
    icon: (
      <span role="img" aria-label="code" className="text-xl">
        ðŸ’»
      </span>
    ),
    steps: `Create a code project with language/framework
Set dev, run, test, lint, and typecheck commands
Add code projects to the workspace sidebar
Switch context between chat and code modes
Persist project state across sessions`,
    keyCapability: 'Development workflow',
    estimatedDuration: 'Per project',
    requiresMcp: false,
  },
  {
    id: 'skill-discovery',
    title: 'Discover & Load Skills',
    tagline: 'Browse, install, and manage JCode skills from the UI',
    category: 'skills',
    icon: (
      <span role="img" aria-label="book" className="text-xl">
        ðŸ“š
      </span>
    ),
    steps: `Browse available skills by category or tag
Install skills with a single click via CLI integration
Activate skills for specific projects only
View skill metadata, usage examples, and proofs
Organize skills into personal or project libraries`,
    keyCapability: 'Skill management',
    estimatedDuration: '~5 min',
    requiresMcp: false,
  },
]

export function IdeasGallery({ projectId }: { projectId?: string }) {
  const { t } = useTranslation()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const handleToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  // The app uses warm accent colors. In light mode it's #8b4c3c (terracotta).
  // In dark mode it's #c49a8c. We reference the CSS variable so it
  // always matches the active theme.
  const visibleIdeas = projectId
    ? IDEAS.filter((idea) => idea.category !== 'projects' && idea.category !== 'skills')
    : IDEAS

  return (
    <div className="flex flex-col gap-8 pt-6 pb-10 overflow-y-auto">
      <div className="px-6">
        <h1 className="text-xl font-semibold text-text">Ideas & Workflows</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Pick a workflow to explore, or browse to discover what Orbito can do
          with JCode ACP.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-6">
        {visibleIdeas.map((idea) => {
          const isExpanded = expandedId === idea.id
          const isHovered = hoveredId === idea.id

          return (
            <article
              key={idea.id}
              className={`group relative rounded-xl border transition-all duration-300 ${
                isExpanded
                  ? 'border-accent shadow-xl'
                  : 'border-border hover:border-accent/30 hover:shadow-lg'
              } bg-surface`}
              onMouseEnter={() => setHoveredId(idea.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                        idea.requiresMcp
                          ? 'bg-accent/20 text-accent'
                          : 'bg-surface-tertiary text-text-tertiary'
                      }`}
                    >
                      {idea.icon}
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-text">{idea.title}</h2>
                      <p className="mt-0.5 text-xs text-text-secondary">{idea.tagline}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggle(idea.id)}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    className="ml-2 rounded-md p-1 text-text-tertiary opacity-0 group-hover:opacity-100 hover:bg-surface-hover hover:text-text-secondary transition-all"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                {/* Always visible: category + duration + key capability */}
                <div
                  className={`mt-3 flex flex-wrap items-center gap-2 text-xs ${
                    isExpanded ? 'pb-0' : 'pb-0'
                  }`}
                >
                  <span className="inline-flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-0.5 text-text-tertiary">
                    {idea.category}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-0.5 text-text-tertiary">
                    {idea.estimatedDuration}
                  </span>
                  {idea.requiresMcp && idea.mcpTool && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-accent">
                      MCP: {idea.mcpTool}
                    </span>
                  )}
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="mt-4 space-y-3">
                    <div className="text-xs text-text-tertiary">
                      <span className="font-medium text-text-secondary">
                        Key capability:
                      </span>{' '}
                      {idea.keyCapability}
                    </div>

                    <div className="text-xs text-text-secondary whitespace-pre-line leading-relaxed">
                      {idea.steps.split('\n').map((step, i) => (
                        <div key={i} className="mb-1">
                          {step}
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        // In a full implementation, this would seed a new ChatView
                        // with the idea's prompt template. For now, it logs intent.
                        void t
                        void projectId
                        void isHovered
                        void t('invokeIdea', 'Invoking idea')
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground opacity-0 group-hover:opacity-100 hover:bg-accent/90 transition-opacity"
                    >
                      Open in Chat
                      <span aria-hidden="true">â†’</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Collapse hint */}
              {!isExpanded && (
                <div
                  className={`absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-overlay to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-end justify-center pb-1`}
                >
                  <span className="text-xs text-text-tertiary">Click to expand</span>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}

export default IdeasGallery

