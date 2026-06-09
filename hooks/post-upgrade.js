#!/usr/bin/env node
import { ensureRuntimeDirs } from '../src/lib/config.js';

ensureRuntimeDirs();
console.log('[post-upgrade] zylos-line upgrade complete');
