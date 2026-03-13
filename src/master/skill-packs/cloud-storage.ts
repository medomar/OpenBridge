import type { SkillPack } from '../../types/agent.js';

/**
 * Cloud Storage skill pack — Google Drive, Dropbox, OneDrive, S3
 *
 * Teaches the Master AI how to upload files to cloud storage using
 * available MCP servers (google-drive, dropbox, onedrive) or CLI tools
 * (rclone, gdrive, aws s3, dropbox-cli) via full-access workers.
 * Returns shareable links after successful uploads.
 */
export const cloudStorageSkillPack: SkillPack = {
  name: 'cloud-storage',
  description:
    'Uploads files to cloud storage (Google Drive, Dropbox, OneDrive, S3) via MCP servers or CLI tools, and returns shareable links.',
  toolProfile: 'full-access',
  requiredTools: ['Bash(rclone:*)', 'Bash(aws:*)', 'Bash(gdrive:*)'],
  tags: ['cloud-storage', 'file-sharing', 'google-drive', 'dropbox', 'onedrive', 's3', 'upload'],
  isUserDefined: false,
  systemPromptExtension: `## Cloud Storage Mode

You are handling a cloud storage request. Your goal is to upload the specified file(s) and return a shareable link.

### Step 1 — Determine available upload mechanism

Check for cloud storage MCP servers first, then fall back to CLI tools:

#### A. MCP Server Check (preferred)
Look at the "Available MCP Servers" section of your system prompt for any of these:
- \`google-drive\` — Google Drive MCP server
- \`dropbox\` — Dropbox MCP server
- \`onedrive\` — OneDrive MCP server

If an MCP server is available for the target platform, use it via a worker with \`--mcp-config\` pointing to that server.

#### B. CLI Tool Check (fallback)
If no MCP server is available, check for CLI tools:
\`\`\`bash
# Google Drive
which gdrive 2>/dev/null && gdrive version

# Rclone (multi-cloud: Drive, Dropbox, OneDrive, S3, etc.)
which rclone 2>/dev/null && rclone version

# AWS S3
which aws 2>/dev/null && aws --version

# Dropbox CLI
which dropbox-cli 2>/dev/null
\`\`\`

Use the first available tool that matches the user's target platform.

### Step 2 — Locate the file to upload

- If the user specified a path, resolve it relative to the workspace.
- If the file was just generated, look in \`.openbridge/generated/\` for the most recent matching file.
- Confirm the file exists before attempting upload.

### Step 3 — Upload the file

#### Using rclone (recommended multi-cloud CLI)
\`\`\`bash
# Upload to Google Drive (requires configured remote named 'gdrive')
rclone copy "<local-path>" gdrive:OpenBridge/ --drive-shared-with-me

# Upload to Dropbox (requires configured remote named 'dropbox')
rclone copy "<local-path>" dropbox:/

# Upload to S3 (requires configured remote or AWS credentials)
rclone copy "<local-path>" s3:my-bucket/openbridge/

# Get a shareable link after upload
rclone link gdrive:OpenBridge/<filename>
\`\`\`

#### Using gdrive CLI
\`\`\`bash
gdrive files upload --parent <folder-id> "<local-path>"
gdrive files share <file-id> --role reader --type anyone
\`\`\`

#### Using AWS CLI (S3)
\`\`\`bash
aws s3 cp "<local-path>" s3://<bucket>/<key>
aws s3 presign s3://<bucket>/<key> --expires-in 86400
\`\`\`

### Step 4 — Return the shareable link

After a successful upload, emit the share link on a dedicated line:

\`\`\`
[SHARE:gdrive:<shareable-url>]
\`\`\`
or
\`\`\`
[SHARE:dropbox:<shareable-url>]
\`\`\`
or
\`\`\`
[SHARE:s3:<presigned-url>]
\`\`\`

Then confirm to the user: "File uploaded successfully. Share link: <url>"

### Error Handling

- If no cloud storage tools are configured, inform the user which tools are missing and how to set them up (e.g., "Install rclone and run \`rclone config\` to add a Google Drive remote").
- If authentication fails, report the specific error and suggest the user check their credentials (env vars, rclone config, MCP server auth).
- Never upload files containing secrets or credentials without explicit user confirmation.`,
};
