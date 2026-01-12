# Contributing to xAgent CLI

Thank you for your interest in contributing to xAgent CLI! This document provides guidelines and instructions for contributing.

## Ways to Contribute

- 🐛 Report bugs
- 💡 Suggest features
- 📝 Improve documentation
- 🔧 Submit pull requests
- 🧪 Test the application

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- TypeScript 5.3+

### Development Setup

1. **Fork the repository**

   Visit [xAgent CLI GitHub](https://github.com/xagent-ai/xagent-cli) and click "Fork".

2. **Clone your fork**

   ```bash
   git clone https://github.com/YOUR-USERNAME/xagent-cli.git
   cd xagent-cli
   ```

3. **Install dependencies**

   ```bash
   npm install
   ```

4. **Start development server**

   ```bash
   npm run dev
   ```

5. **Run tests**

   ```bash
   npm test
   ```

## Code Standards

### TypeScript Guidelines

- Enable strict mode
- Use ES Module syntax
- Export all public interfaces
- Use type annotations

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Class | PascalCase | `AgentManager` |
| Interface | PascalCase | `AgentConfig` |
| Enum | PascalCase + UPPER_SNAKE_CASE | `ExecutionMode.YOLO` |
| File | kebab-case | `cli.ts` |

### Code Style

```bash
# Format code
npm run format

# Run linter
npm run lint

# Type check
npm run typecheck
```

## Submitting Changes

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Changes

- Follow code standards
- Add unit tests
- Update documentation

### 3. Commit Changes

```bash
git add .
git commit -m "feat: add new feature description"
```

**Commit Message Format:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `refactor`: Code refactoring
- `test`: Tests
- `chore`: Maintenance

### 4. Push and PR

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub.

## Pull Request Guidelines

1. **Clear Title**: Descriptive and concise
2. **Detailed Description**: Explain what and why
3. **Screenshots**: For UI changes
4. **Tests**: Include passing tests
5. **Checklist**:
   - [ ] Code follows style guidelines
   - [ ] Tests pass
   - [ ] Documentation updated
   - [ ] No linting errors

## Reporting Bugs

Use GitHub Issues with:

- Clear title
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details

## Feature Requests

Use GitHub Issues with:

- Clear description
- Use case
- Potential solution
- Alternatives considered

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Keep the community healthy

## Questions?

- Check existing [Documentation](./docs/)
- Search [GitHub Issues](https://github.com/xagent-ai/xagent-cli/issues)
- Start a [Discussion](https://github.com/xagent-ai/xagent-cli/discussions)

---

**Thank you for contributing to xAgent CLI!**
