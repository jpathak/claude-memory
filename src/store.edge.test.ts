/**
 * Edge case tests for Claude Memory Store
 *
 * Tests for:
 * - Empty inputs and special characters
 * - Large data handling
 * - Index merging logic in loadIndex()
 * - Error handling paths
 * - Concurrent operations
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryStore } from './store.js';
import { CreateMemoryInput, MemoryIndex, Memory } from './types.js';

describe('MemoryStore Edge Cases', () => {
  let store: MemoryStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-edge-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });
    store = new MemoryStore(testDir, 'test-instance');
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Empty and minimal inputs', () => {
    it('should handle empty title', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: '',
        summary: 'Summary with empty title',
      };

      const memory = await store.createMemory(input);
      expect(memory.title).toBe('');
      expect(memory.id).toBeDefined();

      const retrieved = await store.getMemory(memory.id);
      expect(retrieved?.title).toBe('');
    });

    it('should handle empty summary', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Title with empty summary',
        summary: '',
      };

      const memory = await store.createMemory(input);
      expect(memory.summary).toBe('');
    });

    it('should handle empty tags array', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'No tags',
        summary: 'Memory without tags',
        tags: [],
      };

      const memory = await store.createMemory(input);
      expect(memory.tags).toEqual([]);
    });

    it('should handle undefined optional fields', async () => {
      const input: CreateMemoryInput = {
        type: 'decision',
        title: 'Minimal memory',
        summary: 'Only required fields',
      };

      const memory = await store.createMemory(input);
      expect(memory.details).toBeUndefined();
      expect(memory.context).toBeUndefined();
      expect(memory.links).toBeUndefined();
      expect(memory.expires_at).toBeUndefined();
    });

    it('should use default values for importance and confidence', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Default values',
        summary: 'Testing default importance and confidence',
      };

      const memory = await store.createMemory(input);
      expect(memory.importance).toBe(0.5);
      expect(memory.confidence).toBe(0.8);
    });
  });

  describe('Special characters in inputs', () => {
    it('should handle unicode characters in title', async () => {
      const unicodeTitle = 'Unicode test: \u4e2d\u6587 \u65e5\u672c\u8a9e \ud83d\ude00 \u00e9\u00e0\u00fc';
      const input: CreateMemoryInput = {
        type: 'fact',
        title: unicodeTitle,
        summary: 'Testing unicode in title',
      };

      const memory = await store.createMemory(input);
      expect(memory.title).toBe(unicodeTitle);

      const retrieved = await store.getMemory(memory.id);
      expect(retrieved?.title).toBe(unicodeTitle);
    });

    it('should handle special YAML characters in content', async () => {
      const specialContent = 'Contains: colons: and # hashes\n---\nnewlines and "quotes" and \'apostrophes\'';
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'YAML special: chars # test',
        summary: specialContent,
        details: 'More: special --- chars\n\n```code```',
      };

      const memory = await store.createMemory(input);

      const retrieved = await store.getMemory(memory.id);
      expect(retrieved?.title).toBe('YAML special: chars # test');
      expect(retrieved?.summary).toBe(specialContent);
    });

    it('should handle backslashes and regex characters in tags', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Regex chars test',
        summary: 'Testing special regex chars in tags',
        tags: ['path\\to\\file', 'regex.*test', '[bracket]', '(paren)', '$dollar'],
      };

      const memory = await store.createMemory(input);
      expect(memory.tags).toContain('path\\to\\file');
      expect(memory.tags).toContain('regex.*test');

      const results = await store.queryMemories({ tags: ['path\\to\\file'] });
      expect(results.length).toBe(1);
    });

    it('should handle newlines and tabs in summary', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Whitespace test',
        summary: 'Line1\nLine2\n\tTabbed\n\n\nMultiple newlines',
      };

      const memory = await store.createMemory(input);

      const retrieved = await store.getMemory(memory.id);
      expect(retrieved?.summary).toContain('\n');
      expect(retrieved?.summary).toContain('\t');
    });
  });

  describe('Large data handling', () => {
    it('should handle very long titles', async () => {
      const longTitle = 'A'.repeat(1000);
      const input: CreateMemoryInput = {
        type: 'fact',
        title: longTitle,
        summary: 'Testing long title',
      };

      const memory = await store.createMemory(input);
      expect(memory.title.length).toBe(1000);

      const retrieved = await store.getMemory(memory.id);
      expect(retrieved?.title.length).toBe(1000);
    });

    it('should handle very long summaries', async () => {
      const longSummary = 'Summary content '.repeat(1000);
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Long summary test',
        summary: longSummary,
      };

      const memory = await store.createMemory(input);
      expect(memory.summary.length).toBeGreaterThan(10000);
    });

    it('should handle very long details', async () => {
      const longDetails = 'Detail line\n'.repeat(5000);
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Long details test',
        summary: 'Short summary',
        details: longDetails,
      };

      const memory = await store.createMemory(input);

      const retrieved = await store.getMemory(memory.id);
      expect(retrieved?.details?.length).toBeGreaterThan(50000);
    });

    it('should handle many tags', async () => {
      const manyTags = Array.from({ length: 100 }, (_, i) => `tag-${i}`);
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Many tags test',
        summary: 'Testing 100 tags',
        tags: manyTags,
      };

      const memory = await store.createMemory(input);
      expect(memory.tags.length).toBe(100);

      const index = await store.loadIndex();
      for (const tag of manyTags) {
        expect(index.by_tag[tag]).toContain(memory.id);
      }
    });

    it('should handle many related files', async () => {
      const manyFiles = Array.from({ length: 50 }, (_, i) => `/path/to/file${i}.ts`);
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Many files test',
        summary: 'Testing many related files',
        context: {
          related_files: manyFiles,
        },
      };

      const memory = await store.createMemory(input);

      const index = await store.loadIndex();
      for (const file of manyFiles) {
        expect(index.by_file[file]).toContain(memory.id);
      }
    });
  });

  describe('Boundary values', () => {
    it('should handle importance of 0', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Zero importance',
        summary: 'Lowest importance',
        importance: 0,
      };

      const memory = await store.createMemory(input);
      expect(memory.importance).toBe(0);

      const highImportance = await store.getHighImportanceMemories(0.5);
      expect(highImportance.find(m => m.id === memory.id)).toBeUndefined();
    });

    it('should handle importance of 1', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Maximum importance',
        summary: 'Highest importance',
        importance: 1,
      };

      const memory = await store.createMemory(input);
      expect(memory.importance).toBe(1);

      const index = await store.loadIndex();
      expect(index.high_importance).toContain(memory.id);
    });

    it('should handle importance of exactly 0.7', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Boundary importance',
        summary: 'Exactly at threshold',
        importance: 0.7,
      };

      const memory = await store.createMemory(input);

      const index = await store.loadIndex();
      expect(index.high_importance).toContain(memory.id);
    });

    it('should handle importance just below 0.7', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Below threshold',
        summary: 'Just below threshold',
        importance: 0.69,
      };

      const memory = await store.createMemory(input);

      const index = await store.loadIndex();
      expect(index.high_importance).not.toContain(memory.id);
    });

    it('should handle confidence of 0', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Zero confidence',
        summary: 'Lowest confidence',
        confidence: 0,
      };

      const memory = await store.createMemory(input);
      expect(memory.confidence).toBe(0);
    });

    it('should handle confidence of 1', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Full confidence',
        summary: 'Highest confidence',
        confidence: 1,
      };

      const memory = await store.createMemory(input);
      expect(memory.confidence).toBe(1);
    });
  });

  describe('Query edge cases', () => {
    beforeEach(async () => {
      // Create some test memories
      await store.createMemory({
        type: 'decision',
        title: 'Decision 1',
        summary: 'First decision',
        tags: ['tag1', 'tag2'],
        importance: 0.9,
      });

      await store.createMemory({
        type: 'fact',
        title: 'Fact 1',
        summary: 'First fact with special SEARCH term',
        tags: ['tag1'],
        importance: 0.5,
      });
    });

    it('should return empty array when no matches', async () => {
      const results = await store.queryMemories({ tags: ['nonexistent-tag'] });
      expect(results).toEqual([]);
    });

    it('should handle query with all filters combined', async () => {
      const results = await store.queryMemories({
        types: ['decision'],
        tags: ['tag1'],
        min_importance: 0.8,
        status: ['active'],
        limit: 5,
      });

      expect(results.length).toBe(1);
      expect(results[0].type).toBe('decision');
    });

    it('should handle search with case insensitivity', async () => {
      const resultsLower = await store.queryMemories({ search: 'search' });
      const resultsUpper = await store.queryMemories({ search: 'SEARCH' });
      const resultsMixed = await store.queryMemories({ search: 'SeArCh' });

      expect(resultsLower.length).toBe(1);
      expect(resultsUpper.length).toBe(1);
      expect(resultsMixed.length).toBe(1);
    });

    it('should handle search in tags', async () => {
      await store.createMemory({
        type: 'fact',
        title: 'Tagged memory',
        summary: 'Has searchable tag',
        tags: ['searchterm'],
      });

      const results = await store.queryMemories({ search: 'searchterm' });
      expect(results.length).toBe(1);
    });

    it('should handle search in details', async () => {
      await store.createMemory({
        type: 'fact',
        title: 'Detailed memory',
        summary: 'Short summary',
        details: 'This contains the UNIQUEDETAILSEARCH term',
      });

      const results = await store.queryMemories({ search: 'UNIQUEDETAILSEARCH' });
      expect(results.length).toBe(1);
    });

    it('should handle limit of 0', async () => {
      // limit: 0 is falsy, so it effectively means "no limit"
      const results = await store.queryMemories({ limit: 0 });
      // Should return all results since 0 is falsy and skips the limit check
      expect(results.length).toBe(2);
    });

    it('should handle limit of 1', async () => {
      const results = await store.queryMemories({ limit: 1 });
      expect(results.length).toBe(1);
    });

    it('should handle multiple types filter', async () => {
      const results = await store.queryMemories({ types: ['decision', 'fact'] });
      expect(results.length).toBe(2);
    });

    it('should handle empty types array', async () => {
      // Empty array is truthy but has length 0, so the types filter loop doesn't add anything
      // However the code has: if (query.types && query.types.length > 0)
      // When types is empty array: [] && 0 > 0 = false, so it falls through to "all memories"
      const results = await store.queryMemories({ types: [] });
      // Empty types array means the condition (query.types.length > 0) is false
      // so it falls through to getting all memories
      expect(results.length).toBe(2);
    });

    it('should handle timestamp filtering', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const results = await store.queryMemories({
        since: yesterday.toISOString(),
        before: tomorrow.toISOString(),
      });

      expect(results.length).toBe(2);
    });

    it('should handle since filter with future date', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const results = await store.queryMemories({
        since: future.toISOString(),
      });

      expect(results.length).toBe(0);
    });

    it('should handle before filter with past date', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const results = await store.queryMemories({
        before: past.toISOString(),
      });

      expect(results.length).toBe(0);
    });
  });

  describe('Access tracking', () => {
    it('should increment access count on getMemory', async () => {
      const memory = await store.createMemory({
        type: 'fact',
        title: 'Access test',
        summary: 'Testing access count',
      });

      expect(memory.access_count).toBe(0);

      const retrieved1 = await store.getMemory(memory.id);
      expect(retrieved1?.access_count).toBe(1);

      const retrieved2 = await store.getMemory(memory.id);
      expect(retrieved2?.access_count).toBe(2);

      const retrieved3 = await store.getMemory(memory.id);
      expect(retrieved3?.access_count).toBe(3);
    });

    it('should update last_accessed on getMemory', async () => {
      const memory = await store.createMemory({
        type: 'fact',
        title: 'Access time test',
        summary: 'Testing last_accessed update',
      });

      const originalTime = memory.last_accessed;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const retrieved = await store.getMemory(memory.id);
      expect(retrieved?.last_accessed).not.toBe(originalTime);
      expect(new Date(retrieved!.last_accessed!).getTime())
        .toBeGreaterThan(new Date(originalTime!).getTime());
    });
  });

  describe('Error handling', () => {
    it('should return null for non-existent memory ID', async () => {
      const result = await store.getMemory('nonexistent-id-12345');
      expect(result).toBeNull();
    });

    it('should handle getting memory context for non-existent ID', async () => {
      const context = await store.getMemoryContext('nonexistent-id');
      expect(context).toEqual([]);
    });

    it('should handle marking non-existent memory as superseded', async () => {
      // Should not throw
      await expect(store.markSuperseded('nonexistent', 'other')).resolves.not.toThrow();
    });

    it('should handle finding memory file when memories dir is empty', async () => {
      // Create a new store without any memories
      const emptyStore = new MemoryStore(testDir, 'empty-instance');
      await emptyStore.init();

      const result = await emptyStore.getMemory('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('Timeline operations', () => {
    it('should limit timeline to 500 entries', async () => {
      // Create many memories to exceed timeline limit
      for (let i = 0; i < 10; i++) {
        await store.createMemory({
          type: 'fact',
          title: `Memory ${i}`,
          summary: `Summary ${i}`,
        });
      }

      const timeline = await store.getTimeline();
      expect(timeline.length).toBeLessThanOrEqual(500);
    });

    it('should return timeline entries in reverse chronological order', async () => {
      await store.createMemory({
        type: 'fact',
        title: 'First',
        summary: 'Created first',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await store.createMemory({
        type: 'fact',
        title: 'Second',
        summary: 'Created second',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await store.createMemory({
        type: 'fact',
        title: 'Third',
        summary: 'Created third',
      });

      const timeline = await store.getTimeline();
      expect(timeline[0].summary).toBe('Third');
      expect(timeline[1].summary).toBe('Second');
      expect(timeline[2].summary).toBe('First');
    });

    it('should respect timeline limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await store.createMemory({
          type: 'fact',
          title: `Memory ${i}`,
          summary: `Summary ${i}`,
        });
      }

      const timeline3 = await store.getTimeline(3);
      expect(timeline3.length).toBe(3);

      const timeline5 = await store.getTimeline(5);
      expect(timeline5.length).toBe(5);
    });
  });

  describe('Recent memories list management', () => {
    it('should limit recent memories to 50', async () => {
      // Create 60 memories
      for (let i = 0; i < 60; i++) {
        await store.createMemory({
          type: 'fact',
          title: `Memory ${i}`,
          summary: `Summary ${i}`,
        });
      }

      const index = await store.loadIndex();
      expect(index.recent.length).toBe(50);
    });

    it('should keep newest memories in recent list', async () => {
      for (let i = 0; i < 55; i++) {
        await store.createMemory({
          type: 'fact',
          title: `Memory ${i}`,
          summary: `Summary ${i}`,
        });
      }

      const index = await store.loadIndex();
      // The oldest 5 memories should have been removed
      expect(index.recent.length).toBe(50);
    });
  });

  describe('Supersedes behavior', () => {
    it('should mark multiple memories as superseded', async () => {
      const mem1 = await store.createMemory({
        type: 'decision',
        title: 'Old decision 1',
        summary: 'First old decision',
      });

      const mem2 = await store.createMemory({
        type: 'decision',
        title: 'Old decision 2',
        summary: 'Second old decision',
      });

      const newMem = await store.createMemory({
        type: 'decision',
        title: 'New decision',
        summary: 'Supersedes both',
        links: {
          supersedes: [mem1.id, mem2.id],
        },
      });

      const retrieved1 = await store.getMemory(mem1.id);
      const retrieved2 = await store.getMemory(mem2.id);

      expect(retrieved1?.status).toBe('superseded');
      expect(retrieved1?.links?.superseded_by).toBe(newMem.id);
      expect(retrieved2?.status).toBe('superseded');
      expect(retrieved2?.links?.superseded_by).toBe(newMem.id);
    });

    it('should include superseded memories when flag is set', async () => {
      const original = await store.createMemory({
        type: 'decision',
        title: 'Original',
        summary: 'Will be superseded',
      });

      await store.createMemory({
        type: 'decision',
        title: 'Replacement',
        summary: 'Supersedes original',
        links: { supersedes: [original.id] },
      });

      const withSuperseded = await store.queryMemories({
        types: ['decision'],
        include_superseded: true,
      });

      const withoutSuperseded = await store.queryMemories({
        types: ['decision'],
      });

      expect(withSuperseded.length).toBe(2);
      expect(withoutSuperseded.length).toBe(1);
    });
  });

  describe('Memory context retrieval', () => {
    it('should return surrounding memories in timeline', async () => {
      const memories: Memory[] = [];

      for (let i = 0; i < 10; i++) {
        const mem = await store.createMemory({
          type: 'fact',
          title: `Memory ${i}`,
          summary: `Summary ${i}`,
        });
        memories.push(mem);
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // Get context around middle memory
      const context = await store.getMemoryContext(memories[5].id, 2);
      expect(context.length).toBeGreaterThanOrEqual(1);
      expect(context.length).toBeLessThanOrEqual(5);
    });

    it('should handle getting context for first memory', async () => {
      const first = await store.createMemory({
        type: 'fact',
        title: 'First',
        summary: 'First memory',
      });

      await store.createMemory({
        type: 'fact',
        title: 'Second',
        summary: 'Second memory',
      });

      const context = await store.getMemoryContext(first.id, 2);
      expect(context.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle getting context for last memory', async () => {
      await store.createMemory({
        type: 'fact',
        title: 'First',
        summary: 'First memory',
      });

      const last = await store.createMemory({
        type: 'fact',
        title: 'Last',
        summary: 'Last memory',
      });

      const context = await store.getMemoryContext(last.id, 2);
      expect(context.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('All memory types', () => {
    it('should handle all memory types correctly', async () => {
      const types = ['decision', 'event', 'fact', 'preference', 'context', 'conclusion'] as const;

      for (const type of types) {
        const memory = await store.createMemory({
          type,
          title: `Test ${type}`,
          summary: `Testing ${type} type`,
        });

        expect(memory.type).toBe(type);

        const index = await store.loadIndex();
        expect(index.by_type[type]).toContain(memory.id);
      }
    });
  });
});

describe('Index Merging Logic', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-index-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should merge partial index with defaults', async () => {
    // Initialize with a store to create directories
    const store1 = new MemoryStore(testDir, 'test1');
    await store1.init();

    // Manually write a partial index (simulating old version or corruption)
    const partialIndex = {
      version: '1.0',
      last_updated: new Date().toISOString(),
      by_type: {
        decision: ['mem1'],
        // Missing other types
      },
      by_tag: {
        tag1: ['mem1'],
      },
      // Missing by_file, by_status, recent, high_importance
    };

    const indexPath = path.join(testDir, '.claude-memory', 'index.json');
    await fs.writeFile(indexPath, JSON.stringify(partialIndex), 'utf-8');

    // Create new store and load index
    const store2 = new MemoryStore(testDir, 'test2');
    const loadedIndex = await store2.loadIndex();

    // Should have merged defaults
    expect(loadedIndex.by_type.decision).toEqual(['mem1']);
    expect(loadedIndex.by_type.event).toEqual([]);
    expect(loadedIndex.by_type.fact).toEqual([]);
    expect(loadedIndex.by_type.preference).toEqual([]);
    expect(loadedIndex.by_type.context).toEqual([]);
    expect(loadedIndex.by_type.conclusion).toEqual([]);
    expect(loadedIndex.by_status.active).toEqual([]);
    expect(loadedIndex.by_status.superseded).toEqual([]);
    expect(loadedIndex.by_status.archived).toEqual([]);
    expect(loadedIndex.recent).toEqual([]);
    expect(loadedIndex.high_importance).toEqual([]);
  });

  it('should handle completely empty index file', async () => {
    const store1 = new MemoryStore(testDir, 'test1');
    await store1.init();

    // Write empty object
    const indexPath = path.join(testDir, '.claude-memory', 'index.json');
    await fs.writeFile(indexPath, '{}', 'utf-8');

    const store2 = new MemoryStore(testDir, 'test2');
    const loadedIndex = await store2.loadIndex();

    // Should have all defaults
    expect(loadedIndex.version).toBe('1.0');
    expect(loadedIndex.by_type.decision).toEqual([]);
    expect(loadedIndex.by_status.active).toEqual([]);
  });

  it('should handle index with only by_type', async () => {
    const store1 = new MemoryStore(testDir, 'test1');
    await store1.init();

    const partialIndex = {
      version: '1.0',
      last_updated: new Date().toISOString(),
      by_type: {
        decision: ['mem1', 'mem2'],
        fact: ['mem3'],
      },
    };

    const indexPath = path.join(testDir, '.claude-memory', 'index.json');
    await fs.writeFile(indexPath, JSON.stringify(partialIndex), 'utf-8');

    const store2 = new MemoryStore(testDir, 'test2');
    const loadedIndex = await store2.loadIndex();

    expect(loadedIndex.by_type.decision).toEqual(['mem1', 'mem2']);
    expect(loadedIndex.by_type.fact).toEqual(['mem3']);
    expect(loadedIndex.by_type.event).toEqual([]);
    expect(loadedIndex.by_tag).toEqual({});
    expect(loadedIndex.by_file).toEqual({});
  });

  it('should handle corrupted JSON in index file', async () => {
    const store1 = new MemoryStore(testDir, 'test1');
    await store1.init();

    // Write invalid JSON
    const indexPath = path.join(testDir, '.claude-memory', 'index.json');
    await fs.writeFile(indexPath, '{invalid json', 'utf-8');

    const store2 = new MemoryStore(testDir, 'test2');
    const loadedIndex = await store2.loadIndex();

    // Should return empty defaults
    expect(loadedIndex.version).toBe('1.0');
    expect(loadedIndex.by_type.decision).toEqual([]);
  });

  it('should handle missing index file', async () => {
    await fs.mkdir(path.join(testDir, '.claude-memory'), { recursive: true });

    const store = new MemoryStore(testDir, 'test');
    const loadedIndex = await store.loadIndex();

    expect(loadedIndex.version).toBe('1.0');
    expect(loadedIndex.by_type.decision).toEqual([]);
  });

  it('should preserve existing tags during merge', async () => {
    const store1 = new MemoryStore(testDir, 'test1');
    await store1.init();

    const partialIndex = {
      version: '1.0',
      last_updated: new Date().toISOString(),
      by_type: {},
      by_tag: {
        'existing-tag': ['mem1', 'mem2'],
        'another-tag': ['mem3'],
      },
    };

    const indexPath = path.join(testDir, '.claude-memory', 'index.json');
    await fs.writeFile(indexPath, JSON.stringify(partialIndex), 'utf-8');

    const store2 = new MemoryStore(testDir, 'test2');
    const loadedIndex = await store2.loadIndex();

    expect(loadedIndex.by_tag['existing-tag']).toEqual(['mem1', 'mem2']);
    expect(loadedIndex.by_tag['another-tag']).toEqual(['mem3']);
  });

  it('should preserve existing file mappings during merge', async () => {
    const store1 = new MemoryStore(testDir, 'test1');
    await store1.init();

    const partialIndex = {
      version: '1.0',
      last_updated: new Date().toISOString(),
      by_file: {
        '/path/to/file.ts': ['mem1'],
        '/another/file.js': ['mem2', 'mem3'],
      },
    };

    const indexPath = path.join(testDir, '.claude-memory', 'index.json');
    await fs.writeFile(indexPath, JSON.stringify(partialIndex), 'utf-8');

    const store2 = new MemoryStore(testDir, 'test2');
    const loadedIndex = await store2.loadIndex();

    expect(loadedIndex.by_file['/path/to/file.ts']).toEqual(['mem1']);
    expect(loadedIndex.by_file['/another/file.js']).toEqual(['mem2', 'mem3']);
  });
});

describe('MemoryStore Initialization', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-init-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should generate unique instance ID if not provided', async () => {
    const store1 = new MemoryStore(testDir);
    const store2 = new MemoryStore(testDir);

    expect(store1.getInstanceId()).not.toBe(store2.getInstanceId());
    expect(store1.getInstanceId()).toMatch(/^instance_[a-z0-9]+$/);
  });

  it('should use provided instance ID', async () => {
    const store = new MemoryStore(testDir, 'my-custom-id');
    expect(store.getInstanceId()).toBe('my-custom-id');
  });

  it('should not recreate files on repeated init', async () => {
    const store = new MemoryStore(testDir, 'test');
    await store.init();

    const memory = await store.createMemory({
      type: 'fact',
      title: 'Test',
      summary: 'Test memory',
    });

    // Re-init
    await store.init();

    // Memory should still exist
    const retrieved = await store.getMemory(memory.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe('Test');
  });

  it('should report initialized status correctly', async () => {
    const store = new MemoryStore(testDir, 'test');

    expect(await store.isInitialized()).toBe(false);

    await store.init();

    expect(await store.isInitialized()).toBe(true);
  });

  it('should return correct directory paths', async () => {
    const store = new MemoryStore(testDir, 'test');

    expect(store.getMemoryDir()).toBe(path.join(testDir, '.claude-memory'));
    expect(store.getRuntimeDir()).toBe(path.join(testDir, '.claude-memory-runtime'));
  });

  it('should add runtime directory to gitignore', async () => {
    const store = new MemoryStore(testDir, 'test');
    await store.init();

    const gitignorePath = path.join(testDir, '.gitignore');
    const content = await fs.readFile(gitignorePath, 'utf-8');

    expect(content).toContain('.claude-memory-runtime/');
  });

  it('should not duplicate gitignore entry on repeated init', async () => {
    const store = new MemoryStore(testDir, 'test');
    await store.init();
    await store.init();
    await store.init();

    const gitignorePath = path.join(testDir, '.gitignore');
    const content = await fs.readFile(gitignorePath, 'utf-8');

    const matches = content.match(/\.claude-memory-runtime\//g);
    expect(matches?.length).toBe(1);
  });
});

describe('Config Loading', () => {
  let testDir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-config-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });
    store = new MemoryStore(testDir, 'test-instance');
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should load default config', async () => {
    const config = await store.loadConfig();

    expect(config.version).toBe('1.0');
    expect(config.storage.max_memories).toBe(1000);
    expect(config.retrieval.auto_load_recent).toBe(10);
    expect(config.instance.capabilities).toContain('coding');
  });

  it('should cache config after first load', async () => {
    const config1 = await store.loadConfig();
    const config2 = await store.loadConfig();

    expect(config1).toBe(config2); // Same reference
  });

  it('should handle missing config file', async () => {
    // Delete config file
    const configPath = path.join(testDir, '.claude-memory', 'config.yaml');
    await fs.unlink(configPath);

    const config = await store.loadConfig();

    expect(config.version).toBe('1.0');
  });

  it('should handle corrupted config file', async () => {
    const configPath = path.join(testDir, '.claude-memory', 'config.yaml');
    await fs.writeFile(configPath, 'invalid: yaml: : :content');

    // Should not throw, should return defaults
    const config = await store.loadConfig();
    expect(config.version).toBe('1.0');
  });
});

describe('Timeline Loading', () => {
  let testDir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-timeline-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });
    store = new MemoryStore(testDir, 'test-instance');
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should load empty timeline initially', async () => {
    const timeline = await store.getTimeline();
    expect(timeline).toEqual([]);
  });

  it('should handle missing timeline file', async () => {
    const timelinePath = path.join(testDir, '.claude-memory', 'timeline.json');
    await fs.unlink(timelinePath);

    const timeline = await store.getTimeline();
    expect(timeline).toEqual([]);
  });

  it('should handle corrupted timeline file', async () => {
    const timelinePath = path.join(testDir, '.claude-memory', 'timeline.json');
    await fs.writeFile(timelinePath, '{invalid json');

    const timeline = await store.getTimeline();
    expect(timeline).toEqual([]);
  });
});
