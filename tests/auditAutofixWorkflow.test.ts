import { describe, it, expect, beforeEach } from 'bun:test';
import JSZip from 'jszip';
import { useWorkspaceStore } from '../src/store/workspaceStore';
import {
  setForceInMemory,
  inMemoryStore,
  replaceWorkspaceStorage,
} from '../src/lib/storage';
import { auditTarget } from '../src/lib/projectAudit';
import { runAutofixLoop } from '../src/lib/auditAutofix';
import { buildProjectZip } from '../src/lib/projectZipExport';
import type { CodeBlockData } from '../src/types/model';

describe('Multi-Target Audit -> Consent Gate -> Iterative Autofix & Re-audit Loop', () => {
  beforeEach(async () => {
    setForceInMemory(true);
    inMemoryStore.clear();
    await replaceWorkspaceStorage({
      projects: [],
      groups: [],
      blocks: [],
      tethers: [],
    });
    useWorkspaceStore.setState({
      projects: [],
      groups: [],
      blocks: [],
      tethers: [],
      activeProjectId: null,
      activeGroupId: null,
      selectedBlockId: null,
      connectingSourceBlockId: null,
      searchQuery: '',
      isInitialized: false,
      focusedBlockId: null,
      viewMode: 'canvas',
      isEditorOpen: false,
      openBlockIds: [],
      activeEditorBlockId: null,
      sandboxes: [],
      activeSandboxBlockIds: [],
      auditModalRequest: null,
    });
  });

  it('audits across single block, folder subtree, and complete project/.zip scopes with cross-file import checks', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Multi Scope Audit');
    const grp = await store.createGroup(proj.id, 'Main');

    const pkg = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'package.json',
      sourcePath: 'package.json',
      data: {
        path: 'package.json',
        language: 'json',
        currentContent: '{\n  "version": "1.0.0",\n  "dependencies": { "lucide-react": "^0.5.0" },\n}',
        revisions: [],
      },
    });

    const util = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'math.ts',
      sourcePath: 'src/utils/math.ts',
      data: {
        path: 'src/utils/math.ts',
        language: 'typescript',
        currentContent: 'export function add(a: number, b: number) { return a + b; }\n',
        revisions: [],
      },
    });

    const entry = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'main.ts',
      sourcePath: 'src/main.ts',
      data: {
        path: 'src/main.ts',
        language: 'typescript',
        currentContent:
          "import { add } from './math';\nimport chalk from 'chalk';\nconst count;\nconsole.log(add(1, 2));\n",
        revisions: [],
      },
    });

    const pyTool = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'build.py',
      sourcePath: 'scripts/build.py',
      data: {
        path: 'scripts/build.py',
        language: 'python',
        currentContent: 'def run()\n\treturn 42\n',
        revisions: [],
      },
    });

    // Tether pkg -> util & entry -> util so live seed exists
    await useWorkspaceStore.getState().createTether(entry.id, util.id);
    // Keep pkg and pyTool untethered on canvas (both included under includeUntethered: true)

    const state = useWorkspaceStore.getState();
    const liveProj = state.projects.find((p) => p.id === proj.id)!;

    // 1. Single block audit on clean util block
    const blockReport = auditTarget({
      targetType: 'block',
      project: liveProj,
      blocks: state.blocks,
      blockId: util.id,
    });
    expect(blockReport.filesAudited).toBe(1);
    expect(blockReport.passed).toBe(true);

    // 2. Folder audit on 'scripts' catches Python issues only
    const scriptsReport = auditTarget({
      targetType: 'folder',
      project: liveProj,
      blocks: state.blocks,
      folderPath: 'scripts',
    });
    expect(scriptsReport.filesAudited).toBe(1);
    expect(scriptsReport.passed).toBe(false);
    expect(scriptsReport.findings.some((f) => f.ruleId === 'py-missing-colon')).toBe(true);
    expect(scriptsReport.findings.some((f) => f.ruleId === 'py-mixed-indent')).toBe(true);
    expect(scriptsReport.knowledgeGaps.some((g) => g.language === 'python')).toBe(true);

    // 3. Complete project / .zip audit catches all errors across JSON, TS imports/const, and Python
    const projectReport = auditTarget({
      targetType: 'project',
      project: liveProj,
      blocks: state.blocks,
    });
    expect(projectReport.filesAudited).toBe(4);
    expect(projectReport.passed).toBe(false);
    expect(projectReport.findings.some((f) => f.ruleId === 'json-parse-error')).toBe(true);
    expect(projectReport.findings.some((f) => f.ruleId === 'missing-relative-import')).toBe(true);
    expect(projectReport.findings.some((f) => f.ruleId === 'const-no-init')).toBe(true);

    // Explicitly verify pkg block id exists
    expect(pkg.id).toBeTruthy();
    expect(pyTool.id).toBeTruthy();
  });

  it('enforces the user consent gate (never mutates files without confirmedByUser: true) and runs iterative autofix + re-audit until clean', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Consent & Loop App');
    const grp = await store.createGroup(proj.id, 'Main');

    const pkg = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'package.json',
      sourcePath: 'package.json',
      data: {
        path: 'package.json',
        language: 'json',
        currentContent: '{\n  "version": "1.0.0",\n}',
        revisions: [],
      },
    });

    const helper = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'helper.ts',
      sourcePath: 'src/lib/helper.ts',
      data: {
        path: 'src/lib/helper.ts',
        language: 'typescript',
        currentContent: 'export const ok = true;\n',
        revisions: [],
      },
    });

    const app = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'app.ts',
      sourcePath: 'src/app.ts',
      data: {
        path: 'src/app.ts',
        language: 'typescript',
        currentContent: "import { ok } from './helper';\nconst total;\nconsole.log(ok, total);\n",
        revisions: [],
      },
    });

    const py = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'check.py',
      sourcePath: 'check.py',
      data: {
        path: 'check.py',
        language: 'python',
        currentContent: 'def verify()\n\treturn True\n',
        revisions: [],
      },
    });

    await useWorkspaceStore.getState().createTether(app.id, helper.id);

    // 1. User declines autofix -> code stays untouched
    const declined = await runAutofixLoop({
      confirmedByUser: false,
      targetType: 'project',
      projectId: proj.id,
      getProject: () => useWorkspaceStore.getState().projects.find((p) => p.id === proj.id),
      getBlocks: () => useWorkspaceStore.getState().blocks,
      updateBlockContent: (bId, content) =>
        useWorkspaceStore.getState().applyAuditedBlockContent(bId, content),
    });

    expect(declined.status).toBe('declined');
    expect(declined.modifiedBlockIds).toEqual([]);
    const pkgBefore = useWorkspaceStore.getState().blocks.find((b) => b.id === pkg.id)!;
    expect((pkgBefore.data as CodeBlockData).currentContent).toBe('{\n  "version": "1.0.0",\n}');

    // 2. User explicitly consents -> iterative fix + re-audit clears all errors and repairs zip
    const result = await runAutofixLoop({
      confirmedByUser: true,
      targetType: 'project',
      projectId: proj.id,
      getProject: () => useWorkspaceStore.getState().projects.find((p) => p.id === proj.id),
      getBlocks: () => useWorkspaceStore.getState().blocks,
      updateBlockContent: (bId, content) =>
        useWorkspaceStore.getState().applyAuditedBlockContent(bId, content),
    });

    expect(result.status).toBe('clean');
    expect(result.report.passed).toBe(true);
    expect(result.report.testable).toBe(true);
    expect(result.report.errorCount).toBe(0);
    expect(result.modifiedBlockIds).toContain(pkg.id);
    expect(result.modifiedBlockIds).toContain(app.id);
    expect(result.modifiedBlockIds).toContain(py.id);

    // Verify package.json is valid JSON AND has name
    const pkgAfter = useWorkspaceStore.getState().blocks.find((b) => b.id === pkg.id)!;
    const parsedPkg = JSON.parse((pkgAfter.data as CodeBlockData).currentContent) as {
      name?: string;
      version?: string;
    };
    expect(parsedPkg.name).toBe('consent-loop-app');
    expect(parsedPkg.version).toBe('1.0.0');

    // Verify app.ts fixed both broken relative import AND const-no-init
    const appAfter = useWorkspaceStore.getState().blocks.find((b) => b.id === app.id)!;
    const appContent = (appAfter.data as CodeBlockData).currentContent;
    expect(appContent).toContain('./app/helper');
    expect(appContent).toContain('let total;');

    // Verify Python fixed both missing colon and tab indent
    const pyAfter = useWorkspaceStore.getState().blocks.find((b) => b.id === py.id)!;
    expect((pyAfter.data as CodeBlockData).currentContent).toBe('def verify():\n    return True\n');

    // Verify exported .zip contains the fixed files cleanly
    const liveProj = useWorkspaceStore.getState().projects.find((p) => p.id === proj.id)!;
    const { zip } = buildProjectZip(liveProj, useWorkspaceStore.getState().blocks, {
      includeUntethered: true,
    });
    const loadedZip = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
    expect(await loadedZip.file('check.py')?.async('string')).toBe(
      'def verify():\n    return True\n'
    );
  });

  it('recognizes knowledge gaps on unfamiliar languages, queries web resolver, applies minimal fix, and re-audits clean', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Rust Shader App');
    const grp = await store.createGroup(proj.id, 'Main');

    const rustBlock = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'lib.rs',
      sourcePath: 'src/lib.rs',
      data: {
        path: 'src/lib.rs',
        language: 'rust',
        currentContent: 'const API_KEY: &str = "sk-test-secret-1234567890";\npub fn add(a: i32, b: i32) -> i32 { a + b }\n',
        revisions: [],
      },
    });

    // Trigger an unresolved syntax error + knowledge gap by breaking Cargo/Rust or adding a syntax issue handled via webResolveFn
    await useWorkspaceStore
      .getState()
      .applyAuditedBlockContent(
        rustBlock.id,
        '<<<<<<< HEAD\npub fn add(a: i32, b: i32) -> i32 { a + b }\n=======\npub fn add(a: i32, b: i32) -> i32 { a + b + 1 }\n>>>>>>> feature\n'
      );

    let webCalledWithGap = false;
    const result = await runAutofixLoop({
      confirmedByUser: true,
      targetType: 'block',
      projectId: proj.id,
      blockId: rustBlock.id,
      getProject: () => useWorkspaceStore.getState().projects.find((p) => p.id === proj.id),
      getBlocks: () => useWorkspaceStore.getState().blocks,
      updateBlockContent: (bId, content) =>
        useWorkspaceStore.getState().applyAuditedBlockContent(bId, content),
      webResolveFn: async ({ knowledgeGaps }) => {
        webCalledWithGap = knowledgeGaps.some((g) => g.language === 'rust');
        return {
          available: true,
          changed: true,
          knowledgeSummary: 'Rust public function syntax verified via doc.rust-lang.org.',
          explanation: 'Kept updated feature branch implementation and removed conflict markers.',
          patchedContent: 'pub fn add(a: i32, b: i32) -> i32 {\n    a + b + 1\n}\n',
          sources: [
            {
              title: 'The Rust Programming Language - Functions',
              uri: 'https://doc.rust-lang.org/book/ch03-03-how-functions-work.html',
            },
          ],
        };
      },
    });

    expect(webCalledWithGap).toBe(true);
    expect(result.status).toBe('clean');
    expect(result.webSources.length).toBe(1);
    expect(result.webSources[0].uri).toContain('doc.rust-lang.org');
    expect(result.steps.some((s) => s.phase === 'web-search')).toBe(true);
    expect(result.steps.some((s) => s.phase === 're-audit')).toBe(true);
  });

  it('halts cleanly when stopped mid-loop by user request', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Stop Test');
    const grp = await store.createGroup(proj.id, 'Main');

    const bad = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'broken.js',
      sourcePath: 'broken.js',
      data: {
        path: 'broken.js',
        language: 'javascript',
        currentContent: 'const x;\n',
        revisions: [],
      },
    });

    const stopped = await runAutofixLoop({
      confirmedByUser: true,
      targetType: 'block',
      projectId: proj.id,
      blockId: bad.id,
      shouldStop: () => true,
      getProject: () => useWorkspaceStore.getState().projects.find((p) => p.id === proj.id),
      getBlocks: () => useWorkspaceStore.getState().blocks,
      updateBlockContent: (bId, content) =>
        useWorkspaceStore.getState().applyAuditedBlockContent(bId, content),
    });

    expect(stopped.status).toBe('stopped');
    expect(stopped.modifiedBlockIds).toEqual([]);
  });

  it('detects and fixes logical/runtime issues (NaN equality, duplicate JSON keys, unreachable code, invalid regex) and audits selected block portions', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Logic & Selection App');
    const grp = await store.createGroup(proj.id, 'Main');

    const logicJs = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'calc.js',
      sourcePath: 'src/calc.js',
      data: {
        path: 'src/calc.js',
        language: 'javascript',
        currentContent:
          'function checkScore(x) {\n  if (x === NaN) return 0;\n  return x * 2;\n}\n',
        revisions: [],
      },
    });

    const dupJson = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'settings.json',
      sourcePath: 'config/settings.json',
      data: {
        path: 'config/settings.json',
        language: 'json',
        currentContent: '{\n  "port": 3000,\n  "port": 4000\n}\n',
        revisions: [],
      },
    });

    const liveProj = useWorkspaceStore.getState().projects.find((p) => p.id === proj.id)!;
    const selectionReport = auditTarget({
      targetType: 'selection',
      project: liveProj,
      blocks: useWorkspaceStore.getState().blocks,
      selectedBlockIds: [logicJs.id, dupJson.id],
    });

    expect(selectionReport.filesAudited).toBe(2);
    expect(selectionReport.passed).toBe(false);
    expect(selectionReport.findings.some((f) => f.ruleId === 'nan-equality')).toBe(true);
    expect(selectionReport.findings.some((f) => f.ruleId === 'json-duplicate-key')).toBe(true);

    const loopResult = await runAutofixLoop({
      confirmedByUser: true,
      targetType: 'selection',
      projectId: proj.id,
      selectedBlockIds: [logicJs.id, dupJson.id],
      getProject: () => useWorkspaceStore.getState().projects.find((p) => p.id === proj.id),
      getBlocks: () => useWorkspaceStore.getState().blocks,
      updateBlockContent: (bId, content) =>
        useWorkspaceStore.getState().applyAuditedBlockContent(bId, content),
    });

    expect(loopResult.status).toBe('clean');
    expect(loopResult.report.testable).toBe(true);
    expect(loopResult.report.verification?.compiledCleanly).toBe(true);
    expect(loopResult.report.verification?.runtimeVerified).toBe(true);

    const fixedJs = useWorkspaceStore.getState().blocks.find((b) => b.id === logicJs.id)!;
    expect((fixedJs.data as CodeBlockData).currentContent).toContain('Number.isNaN(x)');

    const fixedJson = useWorkspaceStore.getState().blocks.find((b) => b.id === dupJson.id)!;
    expect((fixedJson.data as CodeBlockData).currentContent.match(/"port"/g)?.length).toBe(1);
  });

  it('continues the autofix loop until compiler verification AND Gemini deep semantic audit confirm zero errors', async () => {
    const store = useWorkspaceStore.getState();
    const proj = await store.createProject('Deep Verify & Gemini Loop');
    const grp = await store.createGroup(proj.id, 'Main');

    const svc = await store.createBlock({
      projectId: proj.id,
      groupId: grp.id,
      kind: 'code',
      title: 'service.ts',
      sourcePath: 'src/service.ts',
      data: {
        path: 'src/service.ts',
        language: 'typescript',
        currentContent: 'export function doubleValue(n: number): number {\n  return n + 1;\n}\n',
        revisions: [],
      },
    });

    let geminiCalls = 0;
    const result = await runAutofixLoop({
      confirmedByUser: true,
      targetType: 'block',
      projectId: proj.id,
      blockId: svc.id,
      getProject: () => useWorkspaceStore.getState().projects.find((p) => p.id === proj.id),
      getBlocks: () => useWorkspaceStore.getState().blocks,
      updateBlockContent: (bId, content) =>
        useWorkspaceStore.getState().applyAuditedBlockContent(bId, content),
      deepVerifyFn: async () => ({
        available: true,
        diagnostics: [],
        verification: {
          compiledCleanly: true,
          typeCheckedCleanly: true,
          runtimeVerified: true,
          geminiAudited: false,
          checksRun: ['TypeScript Compiler AST + Type Check', 'Isolated VM Execution'],
          summary: 'Verified clean.',
        },
      }),
      geminiAuditFn: async ({ files }) => {
        geminiCalls++;
        const code = files[0]?.content || '';
        if (code.includes('return n + 1;')) {
          return {
            available: true,
            connected: true,
            testable: false,
            summary: 'Logic mismatch: doubleValue returns n + 1 instead of n * 2.',
            findings: [
              {
                id: 'gem-1',
                severity: 'error',
                category: 'logic',
                ruleId: 'gemini-semantic-audit',
                file: 'src/service.ts',
                blockId: svc.id,
                line: 2,
                column: 3,
                message: 'Function doubleValue computes n + 1 instead of n * 2.',
                fixable: true,
              },
            ],
          };
        }
        return {
          available: true,
          connected: true,
          testable: true,
          summary: 'All types and logic confirmed sound.',
          findings: [],
        };
      },
      webResolveFn: async () => ({
        available: true,
        changed: true,
        explanation: 'Fixed doubleValue logic to return n * 2.',
        patchedContent: 'export function doubleValue(n: number): number {\n  return n * 2;\n}\n',
      }),
    });

    expect(geminiCalls).toBe(2);
    expect(result.status).toBe('clean');
    expect(result.iterations).toBe(2);
    expect(result.verification?.geminiAudited).toBe(true);
    expect(result.verification?.runtimeVerified).toBe(true);
    expect(result.steps.some((s) => s.phase === 'verify')).toBe(true);
    expect(result.steps.some((s) => s.phase === 'gemini-audit')).toBe(true);

    const updated = useWorkspaceStore.getState().blocks.find((b) => b.id === svc.id)!;
    expect((updated.data as CodeBlockData).currentContent).toContain('return n * 2;');
  });
});
