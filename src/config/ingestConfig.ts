export const MAX_ZIPPED_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_FILE_COUNT = 5_000;
export const MAX_COMPRESSION_RATIO = 100; // Strictly under 100:1
export const MAX_NESTING_DEPTH = 20;
export const MAX_TEXT_FILE_BYTES = 512 * 1024; // 512 KB cap per text file stored for analysis
export const MAX_HUGE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB single-file inspection cap (skip huge files with reason)
export const INGEST_BATCH_SIZE = 25;
export const VERIFY_BATCH_SIZE = 25;

// Unix file type mode bits for symbolic links (S_IFLNK = 0120000 = 0xA000)
export const UNIX_FILE_TYPE_MASK = 0xf000;
export const UNIX_SYMLINK_MODE = 0xa000;

export type NestedArchivePolicy = 'skip' | 'reject';
export const DEFAULT_NESTED_ARCHIVE_POLICY: NestedArchivePolicy = 'skip';

export const IGNORED_DEPENDENCY_AND_VCS_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.pytest_cache',
  '.mypy_cache',
  'vendor',
  '.bundle',
  'Pods',
]);

export const BUILD_OUTPUT_DIRS = new Set<string>([
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  'target',
  'bin',
  'obj',
]);

export const NESTED_ARCHIVE_EXTENSIONS = new Set<string>([
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.tbz2',
  '.xz',
  '.txz',
  '.7z',
  '.rar',
  '.jar',
  '.war',
  '.ear',
  '.whl',
  '.egg',
  '.nupkg',
]);

export const BINARY_EXTENSIONS = new Set<string>([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.tiff',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.mov',
  '.avi',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.a',
  '.o',
  '.obj',
  '.class',
  '.pyc',
  '.pyo',
  '.wasm',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.bin',
  '.dat',
  '.ds_store',
  '.lockb',
]);

export const SECRET_SCAN_SOURCE_EXTENSIONS = new Set<string>([
  '.env',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.config',
  '.properties',
  '.xml',
  '.tf',
  '.tfvars',
  '.hcl',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.pyw',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.swift',
  '.cs',
  '.fs',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.lua',
  '.r',
  '.scala',
  '.gradle',
  '.dockerfile',
  '.pem',
  '.key',
]);

export const SECRET_SCAN_SPECIAL_FILENAMES = new Set<string>([
  '.env',
  'dockerfile',
  'makefile',
  'procfile',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.dockercfg',
  'credentials',
  'secrets',
]);

export const ENTROPY_MIN_TOKEN_LENGTH = 20;
export const ENTROPY_THRESHOLD_BITS = 4.3;
export const SECRET_SCAN_MAX_LINE_LENGTH = 4096;
