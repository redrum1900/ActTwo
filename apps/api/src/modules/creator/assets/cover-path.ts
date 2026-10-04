import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function defaultCoverDirectory(): string { return path.resolve(fileURLToPath(new URL('../../../../../../data/covers', import.meta.url))); }
