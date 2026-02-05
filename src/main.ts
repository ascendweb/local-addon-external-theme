// https://getflywheel.github.io/local-addon-api/modules/_local_main_.html
import * as Local from "@getflywheel/local";
import * as LocalMain from "@getflywheel/local/main";
import * as path from "path";
import * as fs from "fs-extra";
import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export default function (context: LocalMain.AddonMainContext): void {
	// The context object allows us to interact with various parts of Electron's main thread.
	const { electron, hooks } = context;
	const { ipcMain, dialog } = electron;

	const { localLogger, siteData } = LocalMain.getServiceContainer().cradle;

	// Local uses Winston for logging which means we can create create child
	// loggers with additional metadata. For example, the below child logger
	// will log something like this within the Local log:
	//
	// {"thread":"main","addon":"external-theme","level":"info","message":"Picking theme for site 5efOKun5u.","timestamp":"2022-12-21T16:43:40.515Z"}
	const logger = localLogger.child({
		thread: "main",
		addon: "external-theme",
	});

	async function enableThemeWithWPCLI(siteId, themeName) {
		try {
			const site = siteData.getSite(siteId);
			const wpPath = path.join(site.path, "app", "public");

			return new Promise((resolve, reject) => {
				const wpCli = spawn(
					"wp",
					["theme", "activate", themeName, "--path=" + wpPath],
					{
						stdio: "pipe",
					},
				);

				wpCli.on("close", (code) => {
					if (code === 0) {
						logger.log(
							"info",
							`Theme ${themeName} activated via WP-CLI`,
						);
						resolve(true);
					} else {
						reject(new Error(`WP-CLI failed with code ${code}`));
					}
				});

				wpCli.on("error", (error) => {
					reject(error);
				});
			});
		} catch (error) {
			logger.log(
				"error",
				`WP-CLI theme activation failed: ${error.message}`,
			);
			throw error;
		}
	}

	async function openTheme(siteId) {
		try {
			logger.log("info", `Opening theme folder for site ${siteId}.`);

			// Get site data to find the selected theme
			const site = siteData.getSite(siteId);
			const selectedTheme = (site as any)?.externalThemeAddon
				?.selectedTheme;

			if (!selectedTheme) {
				logger.log("error", `No theme selected for site ${siteId}.`);
				throw new Error("No theme selected for this site.");
			}

			// Check if the theme directory exists
			if (!(await fs.pathExists(selectedTheme))) {
				logger.log(
					"error",
					`Selected theme directory does not exist: ${selectedTheme}`,
				);
				throw new Error(
					`Selected theme directory does not exist: ${selectedTheme}`,
				);
			}

			// Open in native file explorer based on platform
			let command: string;

			if (process.platform === "win32") {
				// Windows - use explorer
				command = `explorer "${selectedTheme}"`;
			} else if (process.platform === "darwin") {
				// macOS - use open
				command = `open "${selectedTheme}"`;
			} else {
				// Linux - use xdg-open
				command = `xdg-open "${selectedTheme}"`;
			}

			exec(command);
			logger.log("info", `Opened theme folder: ${selectedTheme}`);

			// Return nothing or just true - don't return an object
			return true;
		} catch (error) {
			logger.log(
				"error",
				`Error opening theme folder for site ${siteId}:`,
				error,
			);
			throw error;
		}
	}

	async function syncTheme(siteId) {
		try {
			logger.log("info", `Syncing theme for site ${siteId}.`);

			// Get site data to find the selected theme and site path
			const site = siteData.getSite(siteId);
			const selectedTheme = (site as any)?.externalThemeAddon
				?.selectedTheme;

			if (!selectedTheme) {
				logger.log("error", `No theme selected for site ${siteId}.`);
				throw new Error("No theme selected for this site.");
			}

			if (!site?.path) {
				logger.log("error", `Site path not found for site ${siteId}.`);
				throw new Error("Site path not found.");
			}

			// Construct the WordPress themes directory path
			const wpThemesDir = path.join(
				site.path,
				"app",
				"public",
				"wp-content",
				"themes",
			);
			const themeName = path.basename(selectedTheme);
			const symlinkPath = path.join(wpThemesDir, themeName);

			// Check if the source theme directory exists
			if (!(await fs.pathExists(selectedTheme))) {
				logger.log(
					"error",
					`Selected theme directory does not exist: ${selectedTheme}`,
				);
				throw new Error(
					`Selected theme directory does not exist: ${selectedTheme}`,
				);
			}

			// Check if WordPress themes directory exists
			if (!(await fs.pathExists(wpThemesDir))) {
				logger.log(
					"error",
					`WordPress themes directory does not exist: ${wpThemesDir}`,
				);
				throw new Error(
					`WordPress themes directory does not exist: ${wpThemesDir}`,
				);
			}

			// Remove existing symlink or directory if it exists
			if (await fs.pathExists(symlinkPath)) {
				await fs.unlink(symlinkPath);
				logger.log("info", `Removed existing file: ${symlinkPath}`);
			}

			// Create directory symbolic link (required for proper deployment behavior)
			await fs.symlink(selectedTheme, symlinkPath, "dir");
			logger.log(
				"info",
				`Created directory symlink from ${selectedTheme} to ${symlinkPath}`,
			);

			// Update site data to track sync status
			siteData.updateSite(siteId, {
				id: siteId,
				externalThemeAddon: {
					...(site as any).externalThemeAddon,
					syncedAt: new Date().toISOString(),
					symlinkPath: symlinkPath,
				},
			} as Partial<Local.SiteJSON>);

			try {
				await enableThemeWithWPCLI(siteId, themeName);
				// Or use: await enableTheme(siteId, themeName);
			} catch (error) {
				logger.log(
					"warn",
					`Could not auto-activate theme: ${error.message}`,
				);
				// Don't throw - symlink creation succeeded, theme activation is optional
			}

			logger.log("info", `Theme synced successfully for site ${siteId}.`);
			return { success: true };
		} catch (error) {
			logger.log(
				"error",
				`Error syncing theme for site ${siteId}:`,
				error,
			);

			// Enhanced error message for Windows Developer Mode
			if (
				process.platform === "win32" &&
				(error as any)?.code === "EPERM"
			) {
				throw new Error(
					`Directory symlink creation failed.\n\nOn Windows, enable Developer Mode:\n1. Go to Settings → Update & Security → For developers\n2. Turn on "Developer Mode"\n3. Restart Local\n\nThis ensures your theme files won't be uploaded during deployment.`,
				);
			}

			throw error;
		}
	}

	// Auto sync after site
	hooks.addAction("siteCloned", async (site) => {
		syncTheme(site.id);
	});

	// Handle theme picking
	ipcMain.on("external-theme-pick-theme", async (event, siteId) => {
		try {
			logger.log("info", `Picking theme for site ${siteId}.`);

			// Open a file dialog to select a theme zip file
			const result = await dialog.showOpenDialog({
				title: "Select Theme Folder",
				properties: ["openDirectory"],
			});

			if (!result.canceled && result.filePaths.length > 0) {
				const themePath = result.filePaths[0];
				logger.log(
					"info",
					`Selected theme: ${themePath} for site ${siteId}.`,
				);

				// Store the selected theme path in site data
				siteData.updateSite(siteId, {
					id: siteId,
					externalThemeAddon: {
						selectedTheme: themePath,
						lastUpdated: new Date().toISOString(),
					},
				} as Partial<Local.SiteJSON>);

				// TODO: Add logic here to install/apply the theme
				// This could include extracting the zip file to the WordPress themes directory

				logger.log("info", `Theme selection saved for site ${siteId}.`);
			}
		} catch (error) {
			logger.log(
				"error",
				`Error picking theme for site ${siteId}:`,
				error,
			);
		}
	});

	// Handle theme syncing
	ipcMain.handle("external-theme-sync-theme", (event, siteId) =>
		syncTheme(siteId),
	);

	// Handle open theme directory
	ipcMain.handle("external-theme-open-theme", (event, siteId) =>
		openTheme(siteId),
	);

	// Handle opening theme folder in VS Code
	ipcMain.handle("external-theme-open-vscode", async (event, siteId) => {
		try {
			logger.log("info", `Opening VS Code for site ${siteId}.`);

			// Get site data to find the selected theme
			const site = siteData.getSite(siteId);
			const selectedTheme = (site as any)?.externalThemeAddon
				?.selectedTheme;

			if (!selectedTheme) {
				logger.log("error", `No theme selected for site ${siteId}.`);
				throw new Error("No theme selected for this site.");
			}

			// Check if the theme directory exists
			if (!(await fs.pathExists(selectedTheme))) {
				logger.log(
					"error",
					`Selected theme directory does not exist: ${selectedTheme}`,
				);
				throw new Error(
					`Selected theme directory does not exist: ${selectedTheme}`,
				);
			}

			// Try to open in VS Code
			try {
				await execAsync(`code "${selectedTheme}"`);
				logger.log("info", `Opened ${selectedTheme} in VS Code.`);
				return { success: true };
			} catch (execError) {
				// Fallback: try with full path to code executable
				const codePaths = [
					'"%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe"',
					'"C:\\Program Files\\Microsoft VS Code\\Code.exe"',
					'"C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe"',
				];

				for (const codePath of codePaths) {
					try {
						await execAsync(`${codePath} "${selectedTheme}"`);
						logger.log(
							"info",
							`Opened ${selectedTheme} in VS Code using ${codePath}.`,
						);
						return { success: true };
					} catch (pathError) {
						continue;
					}
				}

				// If all paths fail, throw error
				throw new Error(
					"VS Code not found. Please make sure VS Code is installed and accessible from the command line.",
				);
			}
		} catch (error) {
			logger.log(
				"error",
				`Error opening VS Code for site ${siteId}:`,
				error,
			);
			throw error;
		}
	});
}
