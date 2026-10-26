# Orbito — AI Workspace for Real Work

**A desktop workspace for projects, conversations, agents, tools, and persistent work context.**

Orbito brings AI-assisted work into one Windows desktop app. Organize work by project, continue conversations with context, connect tools through MCP, and use the JCode agent runtime from a focused workspace.

![Orbito desktop workspace](./public/home.png)

*Orbito workspace preview.*

**Repository:** [Virencq/Orbito](https://github.com/Virencq/Orbito) · **Issues and bug reports:** [GitHub Issues](https://github.com/Virencq/Orbito/issues)

> **Important:** Orbito is the desktop client, not a bundled AI model or agent runtime. You must install **JCode CLI** separately and configure a supported model/provider before agent features can work.

## What Orbito includes

- **Project-based work:** Keep conversations and workspace context organized around projects.
- **Agent conversations:** Work through the JCode CLI using the Agent Client Protocol (ACP).
- **Tools and integrations:** Connect MCP servers and use Skills where configured.
- **Persistent workspace context:** Keep relevant workspace files and conversation history available to your work.
- **Tasks and artifacts:** Use scheduled tasks and create or work with artifacts supported by the app.
- **Desktop workflow:** A compact interface with contextual sidebars and visible agent activity.
- **Browser and voice capabilities:** Use the integrations supported by your current Orbito/JCode configuration.

## Get started

### 1. Install the prerequisites

- Windows 10/11 x64
- [JCode CLI](https://github.com/cnjack/jcode)
- A model/provider configured for JCode

JCode source and releases: **[github.com/cnjack/jcode](https://github.com/cnjack/jcode)** · [JCode documentation](https://www.j-code.net/docs)

### 2. Install JCode on Windows

JCode's quick installer is a shell script, not a PowerShell script. Run it from a supported Bash environment such as **WSL2** or **Git Bash**:

```bash
curl -fsSL https://raw.githubusercontent.com/cnjack/jcode/main/script/install.sh | sh
```

Alternatively, follow the current [JCode installation instructions](https://github.com/cnjack/jcode#install) for the method supported by your environment. Do not paste the Bash installer command directly into PowerShell.

Open a new terminal and verify the installation:

```bash
jcode --version
jcode doctor
```

Then follow the [JCode setup guide](https://www.j-code.net/docs/get-started) to configure your model/provider and authentication. Keep API keys and credentials in JCode's local configuration; **never commit them to Orbito**.

### 3. Launch Orbito

Use a trusted Orbito Windows installer when one is available from the project's official release page. The repository currently has no published GitHub release, so there is no verified release download linked here yet.

If you are building from source, follow the development steps below.

## Development

Install Node.js LTS, Rust stable, and the [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/). Then run in PowerShell:

```powershell
git clone https://github.com/Virencq/Orbito.git
cd Orbito
npm ci
npm run tauri:dev
```

Create production Windows installer packages:

```powershell
npm run tauri:build
```

Installer output is written under `src-tauri/target/release/bundle/`. The build regenerates native Orbito icon assets before packaging.

### Validation

Run the checks relevant to your change before submitting a pull request:

```powershell
npm run build
npm test
npm run native:check
```

## Architecture

- **Desktop shell:** Tauri 2 (Rust)
- **UI:** React, TypeScript, and Vite
- **Agent runtime:** JCode CLI through the Agent Client Protocol (ACP)
- **Local data:** SQLite where appropriate

## Branding

The selected identity is **Orbit Dot (Option 10)**: an orange open orbital ring with a distinct satellite node, on a deep-charcoal background. The mark is used in the app icon, title bar, favicon, and activity indicator. During agent work, the activity indicator may animate while keeping the mark recognizable.

## Security

- Never commit API keys, tokens, authentication files, or private chat exports.
- Review MCP server configuration before enabling tools that can access local files or execute commands.
- Remove credentials and private data from logs before sharing them in an issue.

## Reporting issues

Report reproducible bugs through [GitHub Issues](https://github.com/Virencq/Orbito/issues). Include the OS, Orbito version or commit, relevant sanitized logs, and clear steps to reproduce.

## Contributing

Contributions, bug reports, and focused improvement proposals are welcome. Before opening a pull request, describe the problem being solved, keep changes scoped, and run the applicable validation commands above. Never include secrets, private workspace data, or unsanitized logs.

## Thanks

Orbito builds on the open-source work of the [JCode project](https://github.com/cnjack/jcode), [Tauri](https://tauri.app/), [React](https://react.dev/), and the wider open-source ecosystem. Thank you to their maintainers and contributors.

## License

See [LICENSE](LICENSE).
