/**
 * Tests for Claude Memory Store
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryStore } from './store.js';
import { CreateMemoryInput } from './types.js';

describe('MemoryStore', () => {
  let store: MemoryStore;
  let testDir: string;

  beforeEach(async () => {
    // Create unique directory for each test
    testDir = '/tmp/claude-memory-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });
    store = new MemoryStore(testDir, 'test-instance');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('should create directory structure', async () => {
      await store.init();

      const memoryDir = store.getMemoryDir();
      const exists = await fs.access(memoryDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Check subdirectories
      const memoriesDir = path.join(memoryDir, 'memories');
      const tasksDir = path.join(memoryDir, 'tasks');
      const indexFile = path.join(memoryDir, 'index.json');

      expect(await fs.access(memoriesDir).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(tasksDir).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(indexFile).then(() => true).catch(() => false)).toBe(true);
    });

    it('should create README', async () => {
      await store.init();
      const readmePath = path.join(store.getMemoryDir(), 'README.md');
      const content = await fs.readFile(readmePath, 'utf-8');
      expect(content).toContain('Claude Memory System');
    });
  });

  describe('createMemory', () => {
    beforeEach(async () => {
      await store.init();
    });

    it('should create a memory with correct structure', async () => {
      const input: CreateMemoryInput = {
        type: 'decision',
        title: 'Test Decision',
        summary: 'This is a test decision',
        tags: ['test', 'decision'],
        importance: 0.8,
      };

      const memory = await store.createMemory(input);

      expect(memory.id).toBeDefined();
      expect(memory.type).toBe('decision');
      expect(memory.title).toBe('Test Decision');
      expect(memory.summary).toBe('This is a test decision');
      expect(memory.tags).toEqual(['test', 'decision']);
      expect(memory.importance).toBe(0.8);
      expect(memory.status).toBe('active');
      expect(memory.instance_id).toBe('test-instance');
    });

    it('should persist memory to filesystem', async () => {
      const input: CreateMemoryInput = {
        type: 'fact',
        title: 'Persisted Fact',
        summary: 'This should be saved to disk',
      };

      const memory = await store.createMemory(input);
      const retrieved = await store.getMemory(memory.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(memory.id);
      expect(retrieved?.title).toBe('Persisted Fact');
    });

    it('should update index on create', async () => {
      const input: CreateMemoryInput = {
        type: 'preference',
        title: 'Indexed Memory',
        summary: 'Should appear in index',
        tags: ['indexed'],
      };

      await store.createMemory(input);
      const index = await store.loadIndex();

      expect(index.by_type['preference'].length).toBeGreaterThan(0);
      expect(index.by_tag['indexed'].length).toBeGreaterThan(0);
    });
  });

  describe('queryMemories', () => {
    beforeEach(async () => {
      await store.init();

      // Create test memories
      await store.createMemory({
        type: 'decision',
        title: 'Database Choice',
        summary: 'Chose PostgreSQL',
        tags: ['database', 'architecture'],
        importance: 0.9,
      });

      await store.createMemory({
        type: 'fact',
        title: 'API Limit',
        summary: 'Rate limit is 100/min',
        tags: ['api'],
        importance: 0.5,
      });

      await store.createMemory({
        type: 'preference',
        title: 'TypeScript Preference',
        summary: 'User prefers TypeScript',
        tags: ['typescript', 'preferences'],
        importance: 0.7,
      });
    });

    it('should filter by type', async () => {
      const decisions = await store.queryMemories({ types: ['decision'] });
      expect(decisions.length).toBe(1);
      expect(decisions[0].type).toBe('decision');
    });

    it('should filter by tags', async () => {
      const apiMemories = await store.queryMemories({ tags: ['api'] });
      expect(apiMemories.length).toBe(1);
      expect(apiMemories[0].title).toBe('API Limit');
    });

    it('should filter by importance', async () => {
      const important = await store.queryMemories({ min_importance: 0.8 });
      expect(important.length).toBe(1);
      expect(important[0].importance).toBeGreaterThanOrEqual(0.8);
    });

    it('should search by text', async () => {
      const results = await store.queryMemories({ search: 'PostgreSQL' });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Database Choice');
    });

    it('should respect limit', async () => {
      const limited = await store.queryMemories({ limit: 2 });
      expect(limited.length).toBe(2);
    });
  });

  describe('supersedes', () => {
    beforeEach(async () => {
      await store.init();
    });

    it('should mark old memory as superseded', async () => {
      const original = await store.createMemory({
        type: 'decision',
        title: 'Use MongoDB',
        summary: 'Initially chose MongoDB',
      });

      const updated = await store.createMemory({
        type: 'decision',
        title: 'Use PostgreSQL',
        summary: 'Changed to PostgreSQL',
        links: {
          supersedes: [original.id],
        },
      });

      const originalAfter = await store.getMemory(original.id);
      expect(originalAfter?.status).toBe('superseded');
      expect(originalAfter?.links?.superseded_by).toBe(updated.id);
    });

    it('should exclude superseded by default in queries', async () => {
      const original = await store.createMemory({
        type: 'decision',
        title: 'Old Decision',
        summary: 'This will be superseded',
      });

      await store.createMemory({
        type: 'decision',
        title: 'New Decision',
        summary: 'This supersedes the old one',
        links: { supersedes: [original.id] },
      });

      const active = await store.queryMemories({ types: ['decision'] });
      expect(active.length).toBe(1);
      expect(active[0].title).toBe('New Decision');
    });
  });

  describe('timeline', () => {
    beforeEach(async () => {
      await store.init();
    });

    it('should add entries to timeline', async () => {
      await store.createMemory({
        type: 'event',
        title: 'First Event',
        summary: 'Something happened',
      });

      await store.createMemory({
        type: 'event',
        title: 'Second Event',
        summary: 'Something else happened',
      });

      const timeline = await store.getTimeline();
      expect(timeline.length).toBe(2);
    });

    it('should return timeline in reverse chronological order', async () => {
      await store.createMemory({
        type: 'event',
        title: 'First',
        summary: 'First event',
      });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      await store.createMemory({
        type: 'event',
        title: 'Second',
        summary: 'Second event',
      });

      const timeline = await store.getTimeline();
      expect(timeline[0].summary).toBe('Second');
      expect(timeline[1].summary).toBe('First');
    });
  });
});
