# External Themes Add-on

A Local by Flywheel add-on that allows you to link external theme folders to your WordPress sites using symbolic links. Perfect for theme developers who want to work on themes outside of the WordPress installation while keeping them synchronized.

## Features

- **🔗 Symbolic Link Integration**: Creates symbolic links between external theme folders and WordPress themes directory
- **📁 Theme Selection**: Easy folder picker to select your external theme directory
- **🔄 One-Click Sync**: Instantly sync your external theme to any WordPress site
- **💻 Developer Tools**: 
  - Open theme folder in VS Code
  - Open theme folder in native file explorer
  - Auto-activation with WP-CLI (optional)
- **🌐 Cross-Platform**: Works on Windows, macOS, and Linux
- **⚡ Live Development**: Changes to external theme files are immediately reflected in WordPress
- **🚀 Deployment Safe**: Symbolic links prevent theme files from being uploaded during deployment

## How It Works

1. **Select Theme**: Choose an external theme folder from anywhere on your computer
2. **Sync to Site**: Create a symbolic link in your WordPress site's themes directory
3. **Develop**: Edit theme files in your preferred location and see changes instantly
4. **Deploy**: Symbolic links ensure theme files stay local and don't get uploaded

## Use Cases

- **Theme Development**: Work on themes in a centralized location outside of WordPress
- **Version Control**: Keep themes in Git repositories separate from WordPress sites
- **Multi-Site Development**: Use the same theme across multiple Local sites
- **Backup Safety**: Theme files stay in your preferred backup location



## Installation

### Add Add-on to Local

1. Clone repo directly into the add-ons folder (paths described above)
2. `npm install` (install dependencies)
2. `npm run watch`
3. Open Local and enable add-on

## Development

### External Libraries

- @getflywheel/local provides type definitions for Local's Add-on API.
	- Node Module: https://www.npmjs.com/package/@getflywheel/local-components
	- GitHub Repo: https://github.com/getflywheel/local-components

- @getflywheel/local-components provides reusable React components to use in your Local add-on.
	- Node Module: https://www.npmjs.com/package/@getflywheel/local
	- GitHub Repo: https://github.com/getflywheel/local-addon-api
	- Style Guide: https://getflywheel.github.io/local-components

### Folder Structure

All files in `/src` will be transpiled to `/lib` using [TypeScript](https://www.typescriptlang.org/). Anything in `/lib` will be overwritten.

### Development Workflow

If you are looking for help getting started, you can consult [the documentation for the add-on generator](https://github.com/getflywheel/create-local-addon#next-steps).

You can consult the [Local add-on API](https://getflywheel.github.io/local-addon-api), which provides a wide range of values and functions for developing your add-on.

## License

MIT
