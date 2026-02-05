import fs from "fs-extra";
import path from "path";
import { ipcRenderer } from "electron";
import ThemePicker from "./ThemePicker";

// https://getflywheel.github.io/local-addon-api/modules/_local_renderer_.html
import * as LocalRenderer from "@getflywheel/local/renderer";

const packageJSON = fs.readJsonSync(path.join(__dirname, "../package.json"));
const addonID = packageJSON.slug;

export default function (context) {
	const { React, hooks } = context;

	// Include global style sheet
	const stylesheetPath = path.resolve(__dirname, "../style.css");

	hooks.addContent("stylesheets", () => {
		return (
			<link
				rel="stylesheet"
				key="external-theme-addon-styleesheet"
				href={stylesheetPath}
			/>
		);
	});

	hooks.addContent("SiteInfoOverview_TableList:Before", (site) => {
		const handlePickTheme = () => {
			// Send message to main process to handle theme selection
			ipcRenderer.send("external-theme-pick-theme", site.id);
		};

		const handleSyncTheme = async () => {
			try {
				// Use ipcRenderer.invoke for cleaner async IPC
				await ipcRenderer.invoke("external-theme-sync-theme", site.id);
				alert(`Theme symbolic link created successfully!`);
			} catch (error) {
				alert(`Sync failed: ${error.message}`);
			}
		};

		const handleOpenVSCode = async () => {
			try {
				// Use ipcRenderer.invoke to open VS Code
				await ipcRenderer.invoke("external-theme-open-vscode", site.id);
			} catch (error) {
				alert(`Failed to open VS Code: ${error.message}`);
			}
		};

		const handleOpenTheme = async () => {
			try {
				// Use ipcRenderer.invoke to open VS Code
				await ipcRenderer.invoke("external-theme-open-theme", site.id);
			} catch (error) {
				alert(`Failed to open theme folder: ${error.message}`);
			}
		};

		// Get the saved theme path from site data
		const savedTheme = site.externalThemeAddon?.selectedTheme;

		return (
			<ThemePicker
				onSync={handleSyncTheme}
				onPick={handlePickTheme}
				onOpenVSCode={handleOpenVSCode}
				onOpenFolder={handleOpenTheme}
				themePath={savedTheme}
			/>
		);
	});
}
