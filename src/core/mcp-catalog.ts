import type { MCPCatalogEntry } from '../types/config.js';

/**
 * Built-in catalog of known MCP servers users can browse and install.
 * Each entry describes a well-known MCP server package with its configuration requirements.
 */
export const MCP_CATALOG: MCPCatalogEntry[] = [
  {
    name: 'Filesystem',
    description:
      'Read and write files on the local filesystem. Gives AI workers access to read, write, and list files within allowed directories.',
    category: 'code',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    envVars: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    name: 'GitHub',
    description:
      'Interact with GitHub repositories — read files, create issues, open pull requests, search code, and manage workflows.',
    category: 'code',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envVars: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        description: 'GitHub personal access token with repo and workflow scopes',
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    name: 'Slack',
    description:
      'Read and send Slack messages, list channels, search conversations, and post updates to your Slack workspace.',
    category: 'communication',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envVars: [
      {
        key: 'SLACK_BOT_TOKEN',
        description: 'Slack bot token (xoxb-...) with channels:read and chat:write scopes',
        required: true,
      },
      {
        key: 'SLACK_TEAM_ID',
        description: 'Slack workspace team ID (found in workspace settings)',
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
  {
    name: 'Gmail',
    description:
      'Read, search, and send Gmail messages. Lets AI workers process email threads and draft replies on your behalf.',
    category: 'communication',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gmail'],
    envVars: [
      {
        key: 'GMAIL_OAUTH_CREDENTIALS',
        description: 'Path to OAuth 2.0 credentials JSON file from Google Cloud Console',
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gmail',
  },
  {
    name: 'Canva',
    description:
      'Create and edit Canva designs programmatically. Generate presentations, social media graphics, and documents via the Canva API.',
    category: 'design',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-canva'],
    envVars: [
      {
        key: 'CANVA_API_TOKEN',
        description: 'Canva API token from your Canva developer account',
        required: true,
      },
    ],
    docsUrl: 'https://www.canva.com/developers/',
  },
  {
    name: 'Brave Search',
    description:
      'Search the web using Brave Search. Provides real-time web search results without tracking.',
    category: 'productivity',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envVars: [
      {
        key: 'BRAVE_API_KEY',
        description: 'Brave Search API key from the Brave developer portal',
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    name: 'Puppeteer',
    description:
      'Control a headless Chromium browser — navigate pages, take screenshots, extract content, and interact with web UIs.',
    category: 'code',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    envVars: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
  {
    name: 'PostgreSQL',
    description:
      'Query and manage PostgreSQL databases. Run SQL queries, inspect schemas, and retrieve data for analysis tasks.',
    category: 'data',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    envVars: [
      {
        key: 'POSTGRES_CONNECTION_STRING',
        description: 'PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/dbname)',
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    name: 'SQLite',
    description:
      'Read and write SQLite database files. Useful for local data storage, prototypes, and embedded databases.',
    category: 'data',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    envVars: [
      {
        key: 'SQLITE_DB_PATH',
        description: 'Absolute path to the SQLite database file',
        required: false,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    name: 'Sentry',
    description:
      'Access Sentry error tracking — retrieve issues, stack traces, releases, and performance data for debugging tasks.',
    category: 'code',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sentry'],
    envVars: [
      {
        key: 'SENTRY_AUTH_TOKEN',
        description: 'Sentry authentication token with project:read scope',
        required: true,
      },
      {
        key: 'SENTRY_ORG',
        description: 'Sentry organization slug',
        required: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sentry',
  },
  {
    name: 'GitLab',
    description:
      'Interact with GitLab repositories — read files, manage merge requests, issues, and CI/CD pipelines.',
    category: 'code',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    envVars: [
      {
        key: 'GITLAB_PERSONAL_ACCESS_TOKEN',
        description: 'GitLab personal access token with api scope',
        required: true,
      },
      {
        key: 'GITLAB_API_URL',
        description: 'GitLab API base URL (defaults to https://gitlab.com/api/v4)',
        required: false,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
  },
  {
    name: 'Notion',
    description:
      'Read and write Notion pages and databases. Useful for knowledge management, task tracking, and documentation workflows.',
    category: 'productivity',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-notion'],
    envVars: [
      {
        key: 'NOTION_API_TOKEN',
        description: 'Notion integration token from your Notion workspace settings',
        required: true,
      },
    ],
    docsUrl: 'https://developers.notion.com/',
  },
];
