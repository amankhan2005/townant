// Lets Metro resolve the shared workspace package (../../packages/shared).
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../packages/shared')];
module.exports = config;
