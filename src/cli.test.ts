/**
 * Integration tests for Claude Memory CLI and full memory flow
 *
 * These tests verify:
 * 1. CLI commands work correctly
 * 2. Memories are stored and retrievable
 * 3. High-importance memories are properly indexed for SessionStart hook
 * 4. The full "remember" flow works end-to-end
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { MemoryStore } from './store.js';
import { ClaudeMemory } from './index.js';
import { CreateMemoryInput, Memory } from './types.js';

describe('CLI Integration', () => {
  let testDir: string;
  const cliPath = path.join(process.cwd(), 'dist', 'cli.js');

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-cli-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const runCli = (args: string): string => {
    try {
      return execSync(`node ${cliPath} ${args}`, {
        cwd: testDir,
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch (err: any) {
      return err.stdout || err.message;
    }
  };

  describe('init command', () => {
    it('should initialize memory system', () => {
      const output = runCli('init');
      expect(output).toContain('Claude Memory initialized');
    });

    it('should create both directories', async () => {
      runCli('init');

      const memoryDir = path.join(testDir, '.claude-memory');
      const runtimeDir = path.join(testDir, '.claude-memory-runtime');

      expect(await fs.access(memoryDir).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(runtimeDir).then(() => true).catch(() => false)).toBe(true);
    });

    it('should create index.json', async () => {
      runCli('init');

      const indexPath = path.join(testDir, '.claude-memory', 'index.json');
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);

      expect(index.version).toBe('1.0');
      expect(index.by_type).toBeDefined();
      expect(index.high_importance).toEqual([]);
    });
  });

  describe('store command', () => {
    beforeEach(() => {
      runCli('init');
    });

    it('should store a memory', () => {
      const output = runCli('store -t preference --title "Git Email" -s "Use me@example.com for commits"');
      expect(output).toContain('Memory stored');
    });

    it('should store with high importance', async () => {
      runCli('store -t preference --title "Important Pref" -s "This is important" -i 0.9');

      const indexPath = path.join(testDir, '.claude-memory', 'index.json');
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);

      expect(index.high_importance.length).toBe(1);
    });

    it('should store with tags', async () => {
      runCli('store -t decision --title "DB Choice" -s "Use PostgreSQL" --tags "database,architecture"');

      const indexPath = path.join(testDir, '.claude-memory', 'index.json');
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);

      expect(index.by_tag['database']).toBeDefined();
      expect(index.by_tag['architecture']).toBeDefined();
    });
  });

  describe('recall command', () => {
    beforeEach(() => {
      runCli('init');
      runCli('store -t preference --title "Git Email" -s "Use test@example.com" -i 0.9');
      runCli('store -t decision --title "Framework" -s "Use React" --tags "frontend"');
    });

    it('should recall memories', () => {
      const output = runCli('recall');
      expect(output).toContain('Git Email');
      expect(output).toContain('Framework');
    });

    it('should filter by type', () => {
      const output = runCli('recall -t preference');
      expect(output).toContain('Git Email');
      expect(output).not.toContain('Framework');
    });

    it('should search by text', () => {
      const output = runCli('recall React');
      expect(output).toContain('Framework');
      expect(output).not.toContain('Git Email');
    });
  });

  describe('status command', () => {
    it('should show status after init', () => {
      runCli('init');
      const output = runCli('status');
      expect(output).toContain('Claude Memory Status');
      expect(output).toContain('Instance ID');
    });
  });
});

describe('Memory Flow Integration', () => {
  let testDir: string;
  let memory: ClaudeMemory;

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-flow-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });
    memory = new ClaudeMemory(testDir);
    await memory.init();
  });

  afterEach(async () => {
    await memory.shutdown();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('remember flow', () => {
    it('should store a preference memory', async () => {
      const stored = await memory.remember({
        type: 'preference',
        title: 'Git commit email',
        summary: 'User prefers commits with me@jpathak.com',
        importance: 0.9,
        tags: ['git', 'preferences'],
      });

      expect(stored.id).toBeDefined();
      expect(stored.type).toBe('preference');
      expect(stored.importance).toBe(0.9);
    });

    it('should make high-importance memories retrievable', async () => {
      await memory.remember({
        type: 'preference',
        title: 'Git Email',
        summary: 'Use me@jpathak.com',
        importance: 0.9,
      });

      const highImportance = await memory.getImportant();
      expect(highImportance.length).toBe(1);
      expect(highImportance[0].title).toBe('Git Email');
    });

    it('should persist memories to filesystem', async () => {
      const stored = await memory.remember({
        type: 'fact',
        title: 'API Rate Limit',
        summary: 'Rate limit is 100 requests per minute',
        importance: 0.7,
      });

      // Create new instance to verify persistence
      const memory2 = new ClaudeMemory(testDir);
      await memory2.init();

      const retrieved = await memory2.recall(stored.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBe('API Rate Limit');

      await memory2.shutdown();
    });

    it('should update index with memory IDs', async () => {
      await memory.remember({
        type: 'decision',
        title: 'Use TypeScript',
        summary: 'Project uses TypeScript for type safety',
        tags: ['typescript', 'tooling'],
        importance: 0.8,
      });

      const store = new MemoryStore(testDir);
      const index = await store.loadIndex();

      expect(index.by_type['decision'].length).toBe(1);
      expect(index.by_tag['typescript'].length).toBe(1);
      expect(index.high_importance.length).toBe(1);
    });
  });

  describe('SessionStart hook simulation', () => {
    it('should retrieve high-importance memories for hook', async () => {
      // Store some memories with varying importance
      await memory.remember({
        type: 'preference',
        title: 'Git Email',
        summary: 'Use me@jpathak.com for commits',
        importance: 0.9,
      });

      await memory.remember({
        type: 'fact',
        title: 'Minor Fact',
        summary: 'Some minor detail',
        importance: 0.3,
      });

      await memory.remember({
        type: 'decision',
        title: 'Critical Decision',
        summary: 'Use PostgreSQL for database',
        importance: 0.95,
      });

      // Simulate what the hook does - get high importance memories
      const highImportance = await memory.getImportant(0.7);

      expect(highImportance.length).toBe(2);
      expect(highImportance.some((m: Memory) => m.title === 'Git Email')).toBe(true);
      expect(highImportance.some((m: Memory) => m.title === 'Critical Decision')).toBe(true);
      expect(highImportance.some((m: Memory) => m.title === 'Minor Fact')).toBe(false);
    });

    it('should format memories for context injection', async () => {
      await memory.remember({
        type: 'preference',
        title: 'Git Email Preference',
        summary: 'User wants commits with me@jpathak.com',
        importance: 0.9,
      });

      const highImportance = await memory.getImportant();

      // Build context like the hook does
      let context = '=== CLAUDE MEMORY SYSTEM ===\n\n';
      for (const mem of highImportance) {
        context += `[${mem.type}] ${mem.title} (importance: ${mem.importance})\n`;
        context += `  Summary: ${mem.summary}\n\n`;
      }
      context += '=== END MEMORIES ===';

      expect(context).toContain('[preference] Git Email Preference');
      expect(context).toContain('me@jpathak.com');
    });
  });

  describe('index file structure', () => {
    it('should have correct structure for hook parsing', async () => {
      await memory.remember({
        type: 'preference',
        title: 'Test Pref',
        summary: 'Test summary',
        importance: 0.9,
      });

      const indexPath = path.join(testDir, '.claude-memory', 'index.json');
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);

      // Verify structure matches what load-memories.sh expects
      expect(index).toHaveProperty('high_importance');
      expect(Array.isArray(index.high_importance)).toBe(true);
      expect(index.high_importance.length).toBeGreaterThan(0);

      // Memory ID should be a string
      expect(typeof index.high_importance[0]).toBe('string');
    });
  });
});

describe('Memory YAML file format', () => {
  let testDir: string;
  let memory: ClaudeMemory;

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-yaml-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });
    memory = new ClaudeMemory(testDir);
    await memory.init();
  });

  afterEach(async () => {
    await memory.shutdown();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should create YAML file with correct format', async () => {
    const stored = await memory.remember({
      type: 'preference',
      title: 'Git Email',
      summary: 'Use me@jpathak.com',
      importance: 0.9,
    });

    const memoriesDir = path.join(testDir, '.claude-memory', 'memories');
    const files = await fs.readdir(memoriesDir);
    const memoryFile = files.find(f => f.includes(stored.id));

    expect(memoryFile).toBeDefined();

    const content = await fs.readFile(path.join(memoriesDir, memoryFile!), 'utf-8');

    // Verify YAML contains required fields for the hook
    expect(content).toContain('title:');
    expect(content).toContain('type:');
    expect(content).toContain('summary:');
    expect(content).toContain('importance:');
    expect(content).toContain('Git Email');
    expect(content).toContain('preference');
  });

  it('should be parseable by simple grep (hook compatibility)', async () => {
    const stored = await memory.remember({
      type: 'preference',
      title: 'Test Title Here',
      summary: 'Test summary content',
      importance: 0.85,
    });

    const memoriesDir = path.join(testDir, '.claude-memory', 'memories');
    const files = await fs.readdir(memoriesDir);
    const memoryFile = files.find(f => f.includes(stored.id));
    const content = await fs.readFile(path.join(memoriesDir, memoryFile!), 'utf-8');

    // Simulate what the bash hook does with grep
    const titleMatch = content.match(/^title: (.+)$/m);
    const typeMatch = content.match(/^type: (.+)$/m);
    const summaryMatch = content.match(/^summary: (.+)$/m);
    const importanceMatch = content.match(/^importance: (.+)$/m);

    expect(titleMatch).not.toBeNull();
    expect(typeMatch).not.toBeNull();
    expect(summaryMatch).not.toBeNull();
    expect(importanceMatch).not.toBeNull();

    expect(titleMatch![1]).toContain('Test Title Here');
    expect(typeMatch![1]).toContain('preference');
    expect(parseFloat(importanceMatch![1])).toBe(0.85);
  });
});
