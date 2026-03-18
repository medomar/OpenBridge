import type { SkillPack } from '../../types/agent.js';

/**
 * Web Deployment skill pack — Vercel, Netlify, Cloudflare Pages
 *
 * Teaches the Master AI how to deploy static sites and framework apps
 * using available deploy CLIs (vercel, netlify, wrangler) via full-access
 * workers. Returns live URLs after successful deployments.
 */
export const webDeploySkillPack: SkillPack = {
  name: 'web-deploy',
  description:
    'Deploys static sites and framework apps to Vercel, Netlify, or Cloudflare Pages via CLI tools, and returns live URLs.',
  toolProfile: 'full-access',
  requiredTools: ['Bash(npx:*)', 'Bash(vercel:*)', 'Bash(netlify:*)', 'Bash(wrangler:*)'],
  tags: [
    'web-deploy',
    'deployment',
    'vercel',
    'netlify',
    'cloudflare',
    'wrangler',
    'hosting',
    'static-site',
  ],
  isUserDefined: false,
  systemPromptExtension: `## Web Deployment Mode

You are handling a web deployment request. Your goal is to deploy the project (or a specific directory) and return a live URL.

### Step 1 — Detect available deploy CLIs

Check which deployment platforms are available on the machine:

\`\`\`bash
# Vercel
npx vercel --version 2>/dev/null

# Netlify
npx netlify --version 2>/dev/null

# Cloudflare Pages (Wrangler)
npx wrangler --version 2>/dev/null
\`\`\`

If none are available, inform the user and suggest installing one:
- "Install Vercel CLI: \`npm i -g vercel\`"
- "Install Netlify CLI: \`npm i -g netlify-cli\`"
- "Install Wrangler: \`npm i -g wrangler\`"

### Step 2 — Determine the deploy target

- **Framework app** (Next.js, Vite, SvelteKit, etc.): Deploy from project root. The platform auto-detects the framework.
- **Static site**: Deploy the build output directory (e.g., \`dist/\`, \`build/\`, \`out/\`, \`public/\`).
- **Specific directory**: If the user specified a directory, use that.

If no build output exists yet, run the project's build command first:
\`\`\`bash
npm run build
# or: yarn build, pnpm build — check package.json scripts
\`\`\`

### Step 3 — Check authentication

Each platform requires an auth token via environment variable:

| Platform    | Env Variable              | How to get it                           |
|-------------|---------------------------|-----------------------------------------|
| Vercel      | \`VERCEL_TOKEN\`            | \`vercel login\` or vercel.com/tokens    |
| Netlify     | \`NETLIFY_AUTH_TOKEN\`      | \`netlify login\` or app.netlify.com     |
| Cloudflare  | \`CLOUDFLARE_API_TOKEN\`    | \`wrangler login\` or dash.cloudflare.com |

If the token is not set, try the interactive login flow first:
\`\`\`bash
npx vercel login
# or: npx netlify login
# or: npx wrangler login
\`\`\`

If login is not possible (non-interactive), inform the user which env var to set.

### Step 4 — Deploy

Use the first available platform. Prefer the user's explicitly requested platform if specified.

#### Vercel
\`\`\`bash
# Production deploy (auto-detects framework)
npx vercel --yes --prod

# Deploy specific directory as static site
npx vercel --yes --prod ./dist
\`\`\`

#### Netlify
\`\`\`bash
# Production deploy (auto-detects build settings)
npx netlify deploy --prod --dir=./dist

# Or let Netlify build and deploy
npx netlify deploy --prod --build
\`\`\`

#### Cloudflare Pages (Wrangler)
\`\`\`bash
# Deploy static assets to Cloudflare Pages
npx wrangler pages deploy ./dist --project-name=<project-name>

# If project name not set, use the directory/repo name
npx wrangler pages deploy ./dist --project-name=$(basename $(pwd))
\`\`\`

### Step 5 — Return the live URL

After a successful deployment, extract the live URL from the CLI output and report it to the user.

Format your response clearly:
\`\`\`
Deployment successful!
Live URL: <url>
Platform: <vercel|netlify|cloudflare>
\`\`\`

### Error Handling

- **Build failure**: Show the build error output and suggest fixes. Do not deploy without a successful build.
- **Auth failure**: Report which platform failed auth and how to fix it (env var or login command).
- **Deploy timeout**: Some deploys take time. If the CLI hangs, suggest the user check the platform dashboard.
- **Rate limits**: If hit, inform the user and suggest waiting or using a different platform.
- **Framework detection failure**: Explicitly pass the output directory instead of relying on auto-detection.`,
};
