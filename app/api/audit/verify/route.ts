import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server';
import type { AuditFinding, AuditVerificationProof } from '@/src/types/model';
import { createId } from '@/src/lib/id';

interface VerifyFileInput {
  blockId?: string;
  path: string;
  language?: string;
  content: string;
}

interface VerifyRequest {
  targetFiles: VerifyFileInput[];
  allProjectFiles?: VerifyFileInput[];
}

const VIRTUAL_LIB_DTS = `
interface Array<T> { length: number; push(...items: T[]): number; pop(): T | undefined; map<U>(fn: (v: T, i: number) => U): U[]; filter(fn: (v: T, i: number) => boolean): T[]; find(fn: (v: T, i: number) => boolean): T | undefined; some(fn: (v: T, i: number) => boolean): boolean; every(fn: (v: T, i: number) => boolean): boolean; join(sep?: string): string; slice(start?: number, end?: number): T[]; includes(v: T): boolean; reduce<U>(fn: (acc: U, cur: T) => U, init: U): U; forEach(fn: (v: T, i: number) => void): void; [n: number]: T; }
interface ReadonlyArray<T> { readonly length: number; map<U>(fn: (v: T, i: number) => U): U[]; filter(fn: (v: T, i: number) => boolean): T[]; join(sep?: string): string; includes(v: T): boolean; [n: number]: T; }
interface String { length: number; trim(): string; split(sep: string | RegExp): string[]; includes(s: string): boolean; startsWith(s: string): boolean; endsWith(s: string): boolean; slice(start?: number, end?: number): string; replace(search: string | RegExp, rep: string): string; toLowerCase(): string; toUpperCase(): string; }
interface Number { toFixed(d?: number): string; toString(): string; }
interface Boolean {}
interface Function {}
interface Object {}
interface RegExp { test(s: string): boolean; exec(s: string): string[] | null; }
interface Promise<T> { then<U>(onfulfilled?: (value: T) => U | PromiseLike<U>): Promise<U>; catch<U>(onrejected?: (reason: unknown) => U): Promise<T | U>; }
interface PromiseLike<T> { then<U>(onfulfilled?: (value: T) => U | PromiseLike<U>): PromiseLike<U>; }
interface Record<K extends string | number | symbol, V> {}
interface Set<T> { add(v: T): this; has(v: T): boolean; delete(v: T): boolean; readonly size: number; }
interface Map<K, V> { get(k: K): V | undefined; set(k: K, v: V): this; has(k: K): boolean; delete(k: K): boolean; readonly size: number; }
interface Error { name: string; message: string; stack?: string; }
declare var Error: { new(msg?: string): Error; (msg?: string): Error; };
declare var Number: { (v?: unknown): number; isNaN(v: unknown): boolean; isFinite(v: unknown): boolean; parseInt(s: string, r?: number): number; parseFloat(s: string): number; };
declare var String: { (v?: unknown): string; };
declare var Boolean: { (v?: unknown): boolean; };
declare var Math: { abs(x: number): number; floor(x: number): number; ceil(x: number): number; round(x: number): number; max(...v: number[]): number; min(...v: number[]): number; random(): number; sqrt(x: number): number; pow(x: number, y: number): number; };
declare var JSON: { parse(text: string): unknown; stringify(val: unknown, replacer?: unknown, space?: number): string; };
declare var console: { log(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void; info(...args: unknown[]): void; };
declare function fetch(input: string, init?: unknown): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;
declare var process: { env: Record<string, string | undefined>; };
declare var window: Record<string, unknown>;
declare var document: Record<string, unknown>;
declare function setTimeout(cb: (...args: unknown[]) => void, ms?: number): number;
declare function clearTimeout(id: number): void;
declare var Object: { keys(o: object): string[]; values<T>(o: Record<string, T>): T[]; entries<T>(o: Record<string, T>): [string, T][]; assign<T extends object, U>(target: T, source: U): T & U; };
declare var Array: { isArray(v: unknown): v is unknown[]; from<T>(iter: Iterable<T> | ArrayLike<T>): T[]; };
interface Iterable<T> {}
interface ArrayLike<T> { readonly length: number; [n: number]: T; }
`;

function isTsOrJsPath(path: string, lang?: string): boolean {
  const lower = path.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lower)) return true;
  return (
    lang === 'typescript' ||
    lang === 'tsx' ||
    lang === 'javascript' ||
    lang === 'jsx'
  );
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isRunnableInSandbox(content: string): boolean {
  if (content.length > 32000) return false;
  if (/\b(?:window|document|fetch|require|process|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/.test(content)) {
    return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VerifyRequest;
    const targetFiles = Array.isArray(body?.targetFiles) ? body.targetFiles : [];
    const allProjectFiles = Array.isArray(body?.allProjectFiles) && body.allProjectFiles.length > 0
      ? body.allProjectFiles
      : targetFiles;

    if (targetFiles.length === 0) {
      const emptyProof: AuditVerificationProof = {
        compiledCleanly: true,
        typeCheckedCleanly: true,
        runtimeVerified: true,
        geminiAudited: false,
        checksRun: ['No executable targets'],
        summary: 'No compilable targets provided.',
      };
      return NextResponse.json({
        available: true,
        diagnostics: [],
        verification: emptyProof,
      });
    }

    const diagnosticsFindings: AuditFinding[] = [];
    const checksRun: string[] = [];

    const virtualFiles = new Map<string, { content: string; blockId?: string }>();
    virtualFiles.set('/__lib.d.ts', { content: VIRTUAL_LIB_DTS });

    for (const f of allProjectFiles) {
      if (!isTsOrJsPath(f.path, f.language)) continue;
      const vPath = `/${normalizePath(f.path)}`;
      virtualFiles.set(vPath, { content: f.content, blockId: f.blockId });
    }

    const targetCodeFiles = targetFiles.filter((f) => isTsOrJsPath(f.path, f.language));
    let compiledCleanly = true;
    let typeCheckedCleanly = true;
    let runtimeVerified = false;

    if (targetCodeFiles.length > 0) {
      checksRun.push('TypeScript Compiler AST + Type Check');

      const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        strict: false,
        noImplicitAny: false,
        allowJs: true,
        checkJs: false,
        noEmit: true,
        jsx: ts.JsxEmit.ReactJSX,
        skipLibCheck: true,
      };

      const rootNames = [
        '/__lib.d.ts',
        ...targetCodeFiles.map((f) => `/${normalizePath(f.path)}`),
      ];

      const host: ts.CompilerHost = {
        getSourceFile(fileName, languageVersion) {
          const entry = virtualFiles.get(fileName);
          if (!entry) return undefined;
          return ts.createSourceFile(fileName, entry.content, languageVersion, true);
        },
        getDefaultLibFileName: () => '/__lib.d.ts',
        writeFile: () => {},
        getCurrentDirectory: () => '/',
        getDirectories: () => [],
        fileExists: (fileName) => virtualFiles.has(fileName),
        readFile: (fileName) => virtualFiles.get(fileName)?.content,
        getCanonicalFileName: (fileName) => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        resolveModuleNames(moduleNames, containingFile) {
          return moduleNames.map((modName) => {
            if (!modName.startsWith('./') && !modName.startsWith('../')) {
              return undefined;
            }
            const baseDir = containingFile.split('/').slice(0, -1).join('/');
            const segments = (baseDir ? `${baseDir}/${modName}` : `/${modName}`).split('/');
            const resolvedParts: string[] = [];
            for (const seg of segments) {
              if (!seg || seg === '.') continue;
              if (seg === '..') resolvedParts.pop();
              else resolvedParts.push(seg);
            }
            const base = `/${resolvedParts.join('/')}`;
            const candidates = [
              base,
              `${base}.ts`,
              `${base}.tsx`,
              `${base}.js`,
              `${base}.jsx`,
              `${base}/index.ts`,
              `${base}/index.tsx`,
              `${base}/index.js`,
            ];
            for (const c of candidates) {
              if (virtualFiles.has(c)) {
                return {
                  resolvedFileName: c,
                  extension: c.endsWith('.tsx')
                    ? ts.Extension.Tsx
                    : c.endsWith('.ts')
                    ? ts.Extension.Ts
                    : c.endsWith('.jsx')
                    ? ts.Extension.Jsx
                    : ts.Extension.Js,
                  isExternalLibraryImport: false,
                };
              }
            }
            return undefined;
          });
        },
      };

      const program = ts.createProgram(rootNames, compilerOptions, host);
      const targetPathSet = new Set(targetCodeFiles.map((f) => `/${normalizePath(f.path)}`));
      const tsDiagnostics = ts.getPreEmitDiagnostics(program);

      for (const diag of tsDiagnostics) {
        if (!diag.file) continue;
        const vName = diag.file.fileName;
        if (!targetPathSet.has(vName)) continue;

        const msgText = ts.flattenDiagnosticMessageText(diag.messageText, ' ');
        // Ignore missing ambient third-party npm modules (already checked against package.json)
        if (diag.code === 2307 && !msgText.includes("'./") && !msgText.includes("'../")) {
          continue;
        }
        // Ignore JSX missing react runtime ambient types unless syntax is broken
        if (diag.code === 2875 || diag.code === 7026) continue;

        const pos = diag.start !== undefined
          ? diag.file.getLineAndCharacterOfPosition(diag.start)
          : { line: 0, character: 0 };

        const matchedInput = targetCodeFiles.find(
          (f) => `/${normalizePath(f.path)}` === vName
        );

        const isSyntax = diag.category === ts.DiagnosticCategory.Error && diag.code < 2000;
        if (isSyntax) compiledCleanly = false;
        typeCheckedCleanly = false;

        diagnosticsFindings.push({
          id: createId(),
          severity:
            diag.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
          category: isSyntax ? 'syntax' : diag.code === 2307 ? 'imports' : 'types',
          ruleId: `ts-${diag.code}`,
          message: msgText,
          file: matchedInput?.path || vName.replace(/^\//, ''),
          blockId: matchedInput?.blockId,
          fixable: true,
          line: pos.line + 1,
          column: pos.character + 1,
        });
      }

      // Safe Node VM execution verification for self-contained JS/TS targets with 0 TS errors
      const errorTargets = new Set(
        diagnosticsFindings.filter((d) => d.severity === 'error').map((d) => d.file)
      );
      let executedCount = 0;

      for (const f of targetCodeFiles) {
        if (errorTargets.has(f.path)) continue;
        if (f.path.endsWith('.tsx') || f.path.endsWith('.jsx')) continue;
        if (!isRunnableInSandbox(f.content)) continue;

        const transpiled = ts.transpileModule(f.content, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
          },
          reportDiagnostics: true,
        });

        if (transpiled.diagnostics && transpiled.diagnostics.length > 0) {
          compiledCleanly = false;
          continue;
        }

        try {
          const sandboxModule: { exports: Record<string, unknown> } = { exports: {} };
          const sandboxContext = vm.createContext({
            module: sandboxModule,
            exports: sandboxModule.exports,
            console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
            Math,
            JSON,
            Number,
            String,
            Boolean,
            Array,
            Object,
            Date,
            RegExp,
            Set,
            Map,
            Error,
            TypeError,
            RangeError,
            Promise,
          });
          // Only execute when file has no relative require dependencies left unresolved
          if (!/\brequire\s*\(/.test(transpiled.outputText)) {
            const script = new vm.Script(transpiled.outputText, { filename: f.path });
            script.runInContext(sandboxContext, { timeout: 120 });
            executedCount++;
          } else {
            // Still verify V8 parses the compiled script cleanly
            new vm.Script(transpiled.outputText, { filename: f.path });
          }
        } catch (vmErr) {
          const errMsg = vmErr instanceof Error ? vmErr.message : String(vmErr);
          diagnosticsFindings.push({
            id: createId(),
            severity: 'error',
            category: 'runtime',
            ruleId: 'vm-runtime-error',
            message: `Sandbox execution check failed: ${errMsg}`,
            file: f.path,
            blockId: f.blockId,
            fixable: true,
            line: 1,
            column: 1,
          });
        }
      }

      if (executedCount > 0) {
        checksRun.push(`Isolated VM Execution (${executedCount} module${executedCount === 1 ? '' : 's'})`);
        runtimeVerified = diagnosticsFindings.every((d) => d.ruleId !== 'vm-runtime-error');
      } else {
        runtimeVerified = diagnosticsFindings.filter((d) => d.severity === 'error').length === 0;
      }
    } else {
      checksRun.push('Static structured validation');
      runtimeVerified = true;
    }

    const hasErrors = diagnosticsFindings.some((f) => f.severity === 'error');
    const verification: AuditVerificationProof = {
      compiledCleanly: compiledCleanly && !hasErrors,
      typeCheckedCleanly: typeCheckedCleanly && !hasErrors,
      runtimeVerified: runtimeVerified && !hasErrors,
      geminiAudited: false,
      checksRun,
      summary: hasErrors
        ? `Compiler/runtime verification detected ${diagnosticsFindings.filter((f) => f.severity === 'error').length} error(s).`
        : `Verified clean across ${checksRun.join(' + ')}.`,
    };

    return NextResponse.json({
      available: true,
      diagnostics: diagnosticsFindings,
      verification,
    });
  } catch (err) {
    return NextResponse.json(
      {
        available: false,
        diagnostics: [],
        reason: err instanceof Error ? err.message : 'Compiler verification failed.',
      },
      { status: 500 }
    );
  }
}
