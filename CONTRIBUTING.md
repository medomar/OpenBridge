# Contributing to OpenBridge

Thank you for your interest in contributing to OpenBridge! This document provides
guidelines and information about contributing to this project.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/OpenBridge.git`
3. Add upstream remote: `git remote add upstream https://github.com/medomar/OpenBridge.git`
4. Create a feature branch: `git checkout -b feature/your-feature develop`

## Development Setup

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run test         # Run tests
npm run lint         # Run linter
npm run dev          # Start in development mode with hot reload
```

## Branch Strategy

| Branch        | Purpose                                       |
| ------------- | --------------------------------------------- |
| `main`        | Production releases only                      |
| `develop`     | Integration branch -- all features merge here |
| `feature/*`   | New features                                  |
| `fix/*`       | Bug fixes                                     |
| `docs/*`      | Documentation changes                         |
| `release/x.y` | Release candidates                            |

Always branch from `develop`, not `main`.

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/). Commits are
validated by commitlint via a Git hook.

Format: `<type>(<scope>): <description>`

**Types**: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

**Scopes**: core, whatsapp, claude, connector, provider, config, deps

Examples:

```
feat(whatsapp): add message queue for rate limiting
fix(core): handle provider timeout gracefully
docs(readme): add installation instructions
```

## Pull Request Process

1. Ensure your branch is up to date with `develop`
2. Run `npm run lint && npm run test && npm run build` locally
3. Fill out the PR template completely
4. Request review from at least one maintainer
5. Address review comments
6. Squash merge into `develop` after approval

## Code Style

- TypeScript strict mode enabled
- ESLint + Prettier enforced via pre-commit hooks
- Prefer explicit types over `any`
- Use interfaces for plugin contracts (connectors, providers)

## Adding a Connector

1. Create a new directory: `src/connectors/your-connector/`
2. Implement the `Connector` interface from `src/types/connector.ts`
3. Add tests in `tests/connectors/your-connector/`
4. Register in `src/connectors/index.ts`
5. Add documentation in `docs/connectors/`

## Adding an AI Provider

1. Create a new directory: `src/providers/your-provider/`
2. Implement the `AIProvider` interface from `src/types/provider.ts`
3. Add tests in `tests/providers/your-provider/`
4. Register in `src/providers/index.ts`
5. Add documentation in `docs/providers/`
