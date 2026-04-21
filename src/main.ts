// https://getflywheel.github.io/local-addon-api/modules/_local_main_.html
import * as Local from '@getflywheel/local';
import * as LocalMain from '@getflywheel/local/main';
import * as path from 'path';
import * as fs from 'fs-extra';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import logger from './logger';

const execAsync = promisify(exec);

const { getServiceContainer } = LocalMain;

const serviceContainer = getServiceContainer();

const log = logger.child({
  thread: 'main',
  class: 'main.ts',
});

export default function (context: LocalMain.AddonMainContext): void {
  // The context object allows us to interact with various parts of Electron's main thread.
  const { electron } = context;
  const { ipcMain, dialog } = electron;

  const { siteData } = LocalMain.getServiceContainer().cradle;

  LocalMain.HooksMain.addAction('siteStarted', (site) => {
    log.info('Syncing site theme on start.');
    syncTheme(site.id);
  });

  async function enableThemeWithWPCLI(siteId, themeName) {
    const { wpCli, errorHandler } = serviceContainer.cradle;

    try {
      const site = siteData.getSite(siteId);

      // Snapshot the currently-active theme's `nav_menu_locations` (and
      // `sidebars_widgets`) BEFORE activating. theme_mods are keyed per-
      // stylesheet, so when we switch from e.g. `prime-roofing` to
      // `theme-prime-roofing`, WP's own carry-over in `switch_theme()` can
      // silently miss them if the activation runs twice or if anything in
      // the new theme's setup hooks clears them. We re-apply after activation.
      wpCli.run(site, [
        'eval',
        `$s = get_stylesheet(); $m = get_option("theme_mods_{$s}"); if (!is_array($m)) { $m = array(); } update_option('_external_theme_addon_prev_stylesheet', $s); update_option('_external_theme_addon_prev_mods', $m); WP_CLI::log("[external-theme] snapshot from {$s}: nav_menu_locations=" . (empty($m['nav_menu_locations']) ? 'EMPTY' : wp_json_encode($m['nav_menu_locations'])));`,
      ]);

      wpCli.run(site, ['theme', 'activate', themeName]);

      // Re-apply nav_menu_locations (and sidebars_widgets) from the snapshot
      // onto the newly-active stylesheet. No-op if nothing was captured or
      // if we happened to "switch" to the same stylesheet.
      wpCli.run(site, [
        'eval',
        `$prev = get_option('_external_theme_addon_prev_stylesheet'); $prev_mods = get_option('_external_theme_addon_prev_mods'); $curr = get_stylesheet(); if (empty($prev) || !is_array($prev_mods) || $prev === $curr) { WP_CLI::log("[external-theme] nothing to copy (prev={$prev} curr={$curr})"); } else { $curr_mods = get_option("theme_mods_{$curr}"); if (!is_array($curr_mods)) { $curr_mods = array(); } $copied = array(); foreach (array('nav_menu_locations', 'sidebars_widgets') as $k) { if (!empty($prev_mods[$k])) { $curr_mods[$k] = $prev_mods[$k]; $copied[] = $k; } } update_option("theme_mods_{$curr}", $curr_mods); WP_CLI::log("[external-theme] copied " . implode(',', $copied) . " from {$prev} to {$curr}"); } delete_option('_external_theme_addon_prev_stylesheet'); delete_option('_external_theme_addon_prev_mods');`,
      ]);
    } catch (e) {
      // Report the error to the user, the Local log, and Sentry.
      errorHandler.handleError({
        error: e,
        message: 'error encountered during finalizeNewSite step',
        dialogTitle: 'Uh-oh! Local ran into an error.',
        dialogMessage: e.toString(),
      });
    }
  }

  async function openTheme(siteId) {
    try {
      log.info(`Opening theme folder for site ${siteId}.`);

      // Get site data to find the selected theme
      const site = siteData.getSite(siteId);
      const selectedTheme = (site as any)?.externalThemeAddon?.selectedTheme;

      if (!selectedTheme) {
        log.error(`No theme selected for site ${siteId}.`);
        return {
          success: false,
          error: 'No theme selected for this site.',
        };
      }

      // Check if the theme directory exists
      if (!(await fs.pathExists(selectedTheme))) {
        log.error(`Selected theme directory does not exist: ${selectedTheme}`);
        return {
          success: false,
          error: `Selected theme directory does not exist: ${selectedTheme}`,
        };
      }

      // Open in native file explorer based on platform
      let command: string;

      if (process.platform === 'win32') {
        // Windows - use explorer
        command = `explorer "${selectedTheme}"`;
      } else if (process.platform === 'darwin') {
        // macOS - use open
        command = `open "${selectedTheme}"`;
      } else {
        // Linux - use xdg-open
        command = `xdg-open "${selectedTheme}"`;
      }

      exec(command);
      log.error(`Opened theme folder: ${selectedTheme}`);

      return { success: true };
    } catch (error) {
      log.error(`Error opening theme folder for site ${siteId}:`, error);
      return { success: false, error: error.message };
    }
  }

  async function syncTheme(siteId) {
    try {
      // Get site data to find the selected theme and site path
      const site = siteData.getSite(siteId);
      const selectedTheme = (site as any)?.externalThemeAddon?.selectedTheme;

      if (!selectedTheme) {
        log.error(`No theme selected for site ${siteId}.`);
        return {
          success: false,
          error: 'No theme selected for this site.',
        };
      }

      if (!site?.path) {
        log.error(`Site path not found for site ${siteId}.`);
        return { success: false, error: 'Site path not found.' };
      }

      // Construct the WordPress themes directory path
      const wpThemesDir = path.join(
        site.path,
        'app',
        'public',
        'wp-content',
        'themes',
      );
      const themeName = path.basename(selectedTheme);
      const symlinkPath = path.join(wpThemesDir, themeName);

      // Check if the source theme directory exists
      if (!(await fs.pathExists(selectedTheme))) {
        log.error(`Selected theme directory does not exist: ${selectedTheme}`);
        return {
          success: false,
          error: `Selected theme directory does not exist: ${selectedTheme}`,
        };
      }

      // Check if WordPress themes directory exists
      if (!(await fs.pathExists(wpThemesDir))) {
        log.error(`WordPress themes directory does not exist: ${wpThemesDir}`);
        return {
          success: false,
          error: `WordPress themes directory does not exist: ${wpThemesDir}`,
        };
      }

      // Remove existing symlink or directory if it exists
      if (await fs.pathExists(symlinkPath)) {
        await fs.unlink(symlinkPath);
        log.info(`Removed existing file: ${symlinkPath}`);
      }

      // Create directory symbolic link (required for proper deployment behavior)
      await fs.symlink(selectedTheme, symlinkPath, 'dir');
      log.info(
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
        log.warn(`Could not auto-activate theme: ${error.message}`);
        // Don't throw - symlink creation succeeded, theme activation is optional
      }

      log.info(`Theme synced successfully for site ${siteId}.`);
      return { success: true };
    } catch (error) {
      log.error(`Error syncing theme for site ${siteId}:`, error);

      // Enhanced error message for Windows Developer Mode
      if (process.platform === 'win32' && (error as any)?.code === 'EPERM') {
        return {
          success: false,
          error: `Directory symlink creation failed.\n\nOn Windows, enable Developer Mode:\n1. Go to Settings → Update & Security → For developers\n2. Turn on "Developer Mode"\n3. Restart Local\n\nThis ensures your theme files won't be uploaded during deployment.`,
        };
      }

      return { success: false, error: error.message };
    }
  }

  // Handle theme picking
  ipcMain.on('external-theme-pick-theme', async (event, siteId) => {
    try {
      log.info(`Picking theme for site ${siteId}.`);

      // Open a file dialog to select a theme zip file
      const result = await dialog.showOpenDialog({
        title: 'Select Theme Folder',
        properties: ['openDirectory'],
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const themePath = result.filePaths[0];
        log.info(`Selected theme: ${themePath} for site ${siteId}.`);

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

        log.info(`Theme selection saved for site ${siteId}.`);
      }
    } catch (error) {
      log.error(`Error picking theme for site ${siteId}:`, error);
    }
  });

  // Handle theme syncing
  ipcMain.handle('external-theme-sync-theme', (event, siteId) =>
    syncTheme(siteId),
  );

  // Handle open theme directory
  ipcMain.handle('external-theme-open-theme', (event, siteId) =>
    openTheme(siteId),
  );

  // Handle opening theme folder in VS Code
  ipcMain.handle('external-theme-open-vscode', async (event, siteId) => {
    try {
      log.info(`Opening VS Code for site ${siteId}.`);

      // Get site data to find the selected theme
      const site = siteData.getSite(siteId);
      const selectedTheme = (site as any)?.externalThemeAddon?.selectedTheme;

      if (!selectedTheme) {
        log.error(`No theme selected for site ${siteId}.`);
        return {
          success: false,
          error: 'No theme selected for this site.',
        };
      }

      // Check if the theme directory exists
      if (!(await fs.pathExists(selectedTheme))) {
        log.error(`Selected theme directory does not exist: ${selectedTheme}`);
        return {
          success: false,
          error: `Selected theme directory does not exist: ${selectedTheme}`,
        };
      }

      // Try to open in VS Code
      try {
        await execAsync(`code "${selectedTheme}"`);
        log.info(`Opened ${selectedTheme} in VS Code.`);
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
            return { success: true };
          } catch (pathError) {
            continue;
          }
        }

        // If all paths fail, return error
        return {
          success: false,
          error:
            'VS Code not found. Please make sure VS Code is installed and accessible from the command line.',
        };
      }
    } catch (error) {
      log.error(`Error opening VS Code for site ${siteId}:`, error);
      return { success: false, error: error.message };
    }
  });
}
