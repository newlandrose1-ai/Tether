import { beforeEach, describe, expect, it } from 'bun:test';
import JSZip from 'jszip';
import { usePipelineStore } from '../src/store/pipelineStore';

describe('Zip Upgrader Pipeline Stage State Machine', () => {
  beforeEach(() => {
    usePipelineStore.getState().resetPipeline();
  });

  it('starts at upload stage with downstream stages locked until ingest succeeds', () => {
    const state = usePipelineStore.getState();
    expect(state.currentStage).toBe('upload');
    expect(state.highestUnlockedStage).toBe('upload');

    state.goToStage('analyse');
    expect(usePipelineStore.getState().currentStage).toBe('upload');
  });

  it('populates shared state, flags redactBeforeAi files, and unlocks analyse on valid zip', async () => {
    const zip = new JSZip();
    const fakeStripe = ['sk_live_', '51NxTestKey00000000000000000'].join('');
    zip.file('package.json', '{"name":"sample-app","version":"1.0.0"}');
    zip.file('.env', `STRIPE_KEY=${fakeStripe}\n`);
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    await usePipelineStore.getState().ingestArrayBuffer('sample.zip', buf);

    const state = usePipelineStore.getState();
    expect(state.ingestStatus).toBe('ready');
    expect(state.ingestError).toBeNull();
    expect(state.ingest?.flaggedPaths).toEqual(['.env']);
    expect(state.ingest?.textFiles['.env']?.redactBeforeAi).toBe(true);
    expect(state.highestUnlockedStage).toBe('analyse');

    state.advanceFromUpload();
    expect(usePipelineStore.getState().currentStage).toBe('analyse');
  });

  it('enters fail-closed error state and keeps downstream stages locked on invalid zip', async () => {
    const zip = new JSZip();
    zip.file('../escape.txt', 'bad');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    await usePipelineStore.getState().ingestArrayBuffer('bad.zip', buf);

    const state = usePipelineStore.getState();
    expect(state.ingestStatus).toBe('error');
    expect(state.ingestError?.code).toBe('UNSAFE_PATH');
    expect(state.ingest).toBeNull();
    expect(state.highestUnlockedStage).toBe('upload');
  });
});
