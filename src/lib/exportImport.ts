import type {
  Project,
  TetherGroup,
  Block,
  Tether,
  TextBlockData,
  CodeBlockData,
  FileBlockData,
} from '../types/model';

export const CURRENT_SCHEMA_VERSION = 1;

export interface TetherWorkspaceExport {
  schemaVersion: number;
  exportedAt: number;
  appName: 'Tether';
  projects: Project[];
  groups: TetherGroup[];
  blocks: Block[];
  tethers: Tether[];
}

export function validateWorkspaceExport(
  raw: unknown
): { valid: true; data: TetherWorkspaceExport } | { valid: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'File does not contain a valid JSON object.' };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.schemaVersion !== 'number') {
    return { valid: false, error: "Missing or invalid 'schemaVersion' field." };
  }

  if (obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      valid: false,
      error: `Unsupported schema version ${obj.schemaVersion}. Maximum supported version is ${CURRENT_SCHEMA_VERSION}.`,
    };
  }

  if (!Array.isArray(obj.projects)) {
    return { valid: false, error: "Missing or invalid 'projects' list in workspace file." };
  }

  if (!Array.isArray(obj.groups)) {
    return { valid: false, error: "Missing or invalid 'groups' list in workspace file." };
  }

  if (!Array.isArray(obj.blocks)) {
    return { valid: false, error: "Missing or invalid 'blocks' list in workspace file." };
  }

  if (!Array.isArray(obj.tethers)) {
    return { valid: false, error: "Missing or invalid 'tethers' list in workspace file." };
  }

  // Validate that items have essential fields
  for (const p of obj.projects as Partial<Project>[]) {
    if (!p.id || typeof p.name !== 'string') {
      return { valid: false, error: 'One or more projects are malformed (missing id or name).' };
    }
  }

  for (const g of obj.groups as Partial<TetherGroup>[]) {
    if (!g.id || !g.projectId || typeof g.name !== 'string') {
      return { valid: false, error: 'One or more tether groups are malformed.' };
    }
  }

  for (const b of obj.blocks as Partial<Block>[]) {
    if (!b.id || !b.projectId || !b.groupId || !b.kind || typeof b.title !== 'string') {
      return { valid: false, error: 'One or more blocks are malformed.' };
    }
  }

  for (const t of obj.tethers as Partial<Tether>[]) {
    if (!t.id || !t.sourceBlockId || !t.targetBlockId) {
      return { valid: false, error: 'One or more tethers are malformed.' };
    }
  }

  return {
    valid: true,
    data: {
      schemaVersion: obj.schemaVersion,
      exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
      appName: 'Tether',
      projects: obj.projects as Project[],
      groups: obj.groups as TetherGroup[],
      blocks: obj.blocks as Block[],
      tethers: obj.tethers as Tether[],
    },
  };
}

export function exportWorkspaceToJson(state: {
  projects: Project[];
  groups: TetherGroup[];
  blocks: Block[];
  tethers: Tether[];
}): void {
  const exportData: TetherWorkspaceExport = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    appName: 'Tether',
    projects: state.projects,
    groups: state.groups,
    blocks: state.blocks,
    tethers: state.tethers,
  };

  const jsonString = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const dateStr = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tether-workspace-${dateStr}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportSingleBlock(
  block: Block
): { success: true } | { success: false; reason: string } {
  let content = '';
  let filename = block.title;

  if (block.kind === 'text') {
    content = (block.data as TextBlockData)?.content ?? '';
    if (!filename.toLowerCase().endsWith('.txt')) {
      filename += '.txt';
    }
  } else if (block.kind === 'code') {
    const codeData = block.data as CodeBlockData;
    content = codeData?.currentContent ?? '';
    filename = codeData?.path || block.title;
  } else if (block.kind === 'file') {
    const fileData = block.data as FileBlockData;
    if (fileData.binary) {
      return { success: false, reason: 'Binary file blocks cannot be exported as text.' };
    }
    content = fileData.content ?? '';
    filename = fileData.path ? fileData.path.split('/').pop() || block.title : block.title;
  } else {
    return { success: false, reason: 'This block kind does not support single-block export.' };
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { success: true };
}
