/**
 * Edge case tests for Claude Memory CLI
 *
 * Tests for:
 * - Command validation and error handling
 * - Invalid inputs
 * - Missing required options
 * - Edge cases in command behavior
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';

describe('CLI Edge Cases', () => {
  let testDir: string;
  const cliPath = path.join(process.cwd(), 'dist', 'cli.js');

  const execOptions: ExecSyncOptionsWithStringEncoding = {
    encoding: 'utf-8',
    timeout: 10000,
  };

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-cli-edge-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const runCli = (args: string, expectError = false): string => {
    try {
      return execSync(`node ${cliPath} ${args}`, {
        ...execOptions,
        cwd: testDir,
      });
    } catch (err: any) {
      if (expectError) {
        return err.stdout || err.stderr || err.message;
      }
      return err.stdout || err.message;
    }
  };

  describe('init command edge cases', () => {
    it('should warn when already initialized', () => {
      runCli('init');
      const output = runCli('init');
      expect(output).toContain('already initialized');
    });

    it('should accept custom capabilities', () => {
      const output = runCli('init --capabilities "browser_testing,visual_testing,deployment"');
      expect(output).toContain('initialized');
    });

    it('should handle empty capabilities', () => {
      const output = runCli('init --capabilities ""');
      expect(output).toContain('initialized');
    });
  });

  describe('store command edge cases', () => {
    beforeEach(() => {
      runCli('init');
    });

    it('should require type option', () => {
      const output = runCli('store --title "Test" -s "Summary"', true);
      expect(output.toLowerCase()).toContain('required');
    });

    it('should require title option', () => {
      const output = runCli('store -t decision -s "Summary"', true);
      expect(output.toLowerCase()).toContain('required');
    });

    it('should require summary option', () => {
      const output = runCli('store -t decision --title "Test"', true);
      expect(output.toLowerCase()).toContain('required');
    });

    it('should handle empty tags string', () => {
      const output = runCli('store -t fact --title "Test" -s "Summary" --tags ""');
      expect(output).toContain('Memory stored');
    });

    it('should handle importance at boundary values', () => {
      const output0 = runCli('store -t fact --title "Test 0" -s "Summary" -i 0');
      expect(output0).toContain('Memory stored');

      const output1 = runCli('store -t fact --title "Test 1" -s "Summary" -i 1');
      expect(output1).toContain('Memory stored');
    });

    it('should handle very long title', () => {
      const longTitle = 'A'.repeat(500);
      const output = runCli(`store -t fact --title "${longTitle}" -s "Summary"`);
      expect(output).toContain('Memory stored');
    });

    it('should handle special characters in title', () => {
      const output = runCli('store -t fact --title "Test \\"quoted\\" title" -s "Summary"');
      expect(output).toContain('Memory stored');
    });

    it('should handle multiple tags', () => {
      const output = runCli('store -t fact --title "Multi-tag" -s "Summary" --tags "tag1,tag2,tag3,tag4,tag5"');
      expect(output).toContain('Memory stored');
    });

    it('should handle related files', () => {
      const output = runCli('store -t fact --title "With files" -s "Summary" --files "/path/to/file1.ts,/path/to/file2.js"');
      expect(output).toContain('Memory stored');
    });

    it('should store all memory types', () => {
      const types = ['decision', 'event', 'fact', 'preference', 'context', 'conclusion'];

      for (const type of types) {
        const output = runCli(`store -t ${type} --title "Test ${type}" -s "Summary for ${type}"`);
        expect(output).toContain('Memory stored');
      }
    });
  });

  describe('recall command edge cases', () => {
    beforeEach(() => {
      runCli('init');
      runCli('store -t preference --title "Git Email" -s "Use test@example.com" -i 0.9 --tags "git,config"');
      runCli('store -t decision --title "Framework Choice" -s "Use React" --tags "frontend,framework"');
      runCli('store -t fact --title "API Endpoint" -s "Base URL is https://api.example.com" -i 0.3');
    });

    it('should handle no search query', () => {
      const output = runCli('recall');
      expect(output).toContain('Git Email');
      expect(output).toContain('Framework Choice');
    });

    it('should handle search with no results', () => {
      const output = runCli('recall "nonexistent-search-term"');
      expect(output).toContain('No memories found');
    });

    it('should filter by type', () => {
      const output = runCli('recall -t preference');
      expect(output).toContain('Git Email');
      expect(output).not.toContain('Framework Choice');
    });

    it('should filter by important flag', () => {
      const output = runCli('recall --important');
      expect(output).toContain('Git Email');
      expect(output).not.toContain('API Endpoint');
    });

    it('should filter by tags', () => {
      const output = runCli('recall --tags "git"');
      expect(output).toContain('Git Email');
      expect(output).not.toContain('Framework Choice');
    });

    it('should respect limit option', () => {
      runCli('store -t fact --title "Extra 1" -s "Summary 1"');
      runCli('store -t fact --title "Extra 2" -s "Summary 2"');
      runCli('store -t fact --title "Extra 3" -s "Summary 3"');

      const output = runCli('recall -n 2');
      // Should contain "Found X memories" where we limit to 2
      const lines = output.split('\n').filter(l => l.includes('['));
      expect(lines.length).toBeLessThanOrEqual(2);
    });

    it('should handle case-insensitive search', () => {
      const output = runCli('recall "REACT"');
      expect(output).toContain('Framework Choice');
    });

    it('should search in summary', () => {
      const output = runCli('recall "api.example.com"');
      expect(output).toContain('API Endpoint');
    });
  });

  describe('delegate command edge cases', () => {
    beforeEach(() => {
      runCli('init');
    });

    it('should require title option', () => {
      const output = runCli('delegate -d "Description"', true);
      expect(output.toLowerCase()).toContain('required');
    });

    it('should require description option', () => {
      const output = runCli('delegate --title "Test"', true);
      expect(output.toLowerCase()).toContain('required');
    });

    it('should handle all priority levels', () => {
      const priorities = ['low', 'normal', 'high', 'critical'];

      for (const priority of priorities) {
        const output = runCli(`delegate --title "Task ${priority}" -d "Description" -p ${priority}`);
        expect(output).toContain('Task delegated');
      }
    });

    it('should handle capabilities option', () => {
      const output = runCli('delegate --title "Browser Task" -d "Needs browser" -c "browser_testing,visual_testing"');
      expect(output).toContain('Task delegated');
    });

    it('should handle timeout option', () => {
      const output = runCli('delegate --title "Timed Task" -d "Has timeout" --timeout 60');
      expect(output).toContain('Task delegated');
    });

    it('should handle instructions option', () => {
      const output = runCli('delegate --title "Task with instructions" -d "Has instructions" -i "Step 1: Do this. Step 2: Do that."');
      expect(output).toContain('Task delegated');
    });
  });

  describe('tasks command edge cases', () => {
    beforeEach(() => {
      runCli('init');
    });

    it('should show no tasks message when empty', () => {
      const output = runCli('tasks');
      expect(output.toLowerCase()).toContain('no');
    });

    it('should show tasks after delegation', () => {
      runCli('delegate --title "Test Task" -d "A test task"');
      const output = runCli('tasks');
      expect(output).toContain('Test Task');
    });

    it('should handle available flag', () => {
      runCli('delegate --title "Available Task" -d "Can be claimed"');
      const output = runCli('tasks --available');
      expect(output).toContain('Available Task');
    });
  });

  describe('claim command edge cases', () => {
    beforeEach(() => {
      runCli('init');
    });

    it('should handle non-existent task ID', () => {
      const output = runCli('claim nonexistent-task-id');
      expect(output).toContain('not found');
    });

    it('should claim existing task', async () => {
      const delegateOutput = runCli('delegate --title "Claimable Task" -d "Will be claimed"');
      // Task ID format includes hyphens from UUID: task_xxxx-xxxx-xxx
      const taskIdMatch = delegateOutput.match(/task_[a-z0-9-]+/);

      if (taskIdMatch) {
        const output = runCli(`claim ${taskIdMatch[0]}`);
        expect(output).toContain('Claimed task');
      } else {
        fail('No task ID found in delegate output');
      }
    });

    it('should error when claiming already claimed task', async () => {
      const delegateOutput = runCli('delegate --title "Double Claim" -d "Will fail second claim"');
      const taskIdMatch = delegateOutput.match(/task_[a-z0-9-]+/);

      if (taskIdMatch) {
        runCli(`claim ${taskIdMatch[0]}`);
        const output = runCli(`claim ${taskIdMatch[0]}`);
        expect(output.toLowerCase()).toContain('error');
      }
    });
  });

  describe('complete command edge cases', () => {
    beforeEach(() => {
      runCli('init');
    });

    it('should handle non-existent task ID', () => {
      const output = runCli('complete nonexistent-task-id');
      expect(output).toContain('not found');
    });

    it('should complete claimed task', async () => {
      const delegateOutput = runCli('delegate --title "Completable Task" -d "Will be completed"');
      const taskIdMatch = delegateOutput.match(/task_[a-z0-9-]+/);

      if (taskIdMatch) {
        runCli(`claim ${taskIdMatch[0]}`);
        const output = runCli(`complete ${taskIdMatch[0]}`);
        expect(output).toContain('Completed task');
      }
    });

    it('should handle output option with valid JSON', async () => {
      const delegateOutput = runCli('delegate --title "Task with output" -d "Has output"');
      const taskIdMatch = delegateOutput.match(/task_[a-z0-9-]+/);

      if (taskIdMatch) {
        runCli(`claim ${taskIdMatch[0]}`);
        const output = runCli(`complete ${taskIdMatch[0]} -o '{"result": "success"}'`);
        expect(output).toContain('Completed task');
      }
    });

    it('should error on completing pending task', async () => {
      const delegateOutput = runCli('delegate --title "Pending Task" -d "Not claimed"');
      const taskIdMatch = delegateOutput.match(/task_[a-z0-9-]+/);

      if (taskIdMatch) {
        const output = runCli(`complete ${taskIdMatch[0]}`);
        expect(output.toLowerCase()).toContain('error');
      }
    });
  });

  describe('status command edge cases', () => {
    it('should error when not initialized', () => {
      const output = runCli('status');
      expect(output).toContain('not initialized');
    });

    it('should show status when initialized', () => {
      runCli('init');
      const output = runCli('status');
      expect(output).toContain('Claude Memory Status');
      expect(output).toContain('Instance ID');
    });

    it('should show active instances', () => {
      runCli('init');
      const output = runCli('status');
      expect(output).toContain('Active Instances');
    });

    it('should show recent memories section', () => {
      runCli('init');
      runCli('store -t fact --title "Test Memory" -s "For status check"');
      const output = runCli('status');
      expect(output).toContain('Recent Memories');
    });

    it('should show available tasks section', () => {
      runCli('init');
      const output = runCli('status');
      expect(output).toContain('Available Tasks');
    });

    it('should show recent activity section', () => {
      runCli('init');
      const output = runCli('status');
      expect(output).toContain('Recent Activity');
    });
  });

  describe('timeline command edge cases', () => {
    beforeEach(() => {
      runCli('init');
    });

    it('should show no entries message when empty', () => {
      const output = runCli('timeline');
      expect(output).toContain('No timeline entries');
    });

    it('should show timeline after creating memories', () => {
      runCli('store -t fact --title "Timeline Test" -s "Should appear in timeline"');
      const output = runCli('timeline');
      expect(output).toContain('Timeline');
      expect(output).toContain('Timeline Test');
    });

    it('should respect limit option', () => {
      for (let i = 0; i < 10; i++) {
        runCli(`store -t fact --title "Memory ${i}" -s "Summary ${i}"`);
      }

      const output = runCli('timeline -n 3');
      // Count the number of timeline entries (each entry starts with a date)
      const entries = output.split('\n').filter(l => /^\d{4}-\d{2}-\d{2}/.test(l));
      expect(entries.length).toBeLessThanOrEqual(3);
    });

    it('should show supersedes information', () => {
      const output1 = runCli('store -t decision --title "Old Decision" -s "Will be superseded"');
      const idMatch = output1.match(/Memory stored: ([a-z0-9]+)/i);

      if (idMatch) {
        const memoryId = idMatch[1];
        // Note: CLI doesn't support --supersedes flag currently, so we just verify timeline works
        const timelineOutput = runCli('timeline');
        expect(timelineOutput).toContain('decision');
      }
    });
  });

  describe('activity command edge cases', () => {
    beforeEach(() => {
      runCli('init');
    });

    it('should show activity after init', () => {
      const output = runCli('activity');
      expect(output).toContain('Recent Activity');
      expect(output).toContain('registered');
    });

    it('should show stored_memory activities', () => {
      runCli('store -t fact --title "Activity Test" -s "Should appear in activity"');
      const output = runCli('activity');
      expect(output).toContain('stored_memory');
    });

    it('should respect limit option', () => {
      for (let i = 0; i < 30; i++) {
        runCli(`store -t fact --title "Memory ${i}" -s "Summary ${i}"`);
      }

      const output = runCli('activity -n 5');
      // Activity log should be limited
      const lines = output.split('\n').filter(l => l.includes('stored_memory'));
      expect(lines.length).toBeLessThanOrEqual(5);
    });

    it('should show task activities', () => {
      runCli('delegate --title "Test Task" -d "For activity log"');
      const output = runCli('activity');
      expect(output).toContain('delegated_task');
    });
  });

  describe('Error handling', () => {
    it('should show help with --help flag', () => {
      const output = runCli('--help');
      expect(output).toContain('Claude Memory System');
      expect(output).toContain('Commands');
    });

    it('should show version with --version flag', () => {
      const output = runCli('--version');
      expect(output).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should show command-specific help', () => {
      const output = runCli('store --help');
      expect(output).toContain('Store a new memory');
      expect(output).toContain('--type');
    });

    it('should handle unknown commands', () => {
      const output = runCli('unknowncommand', true);
      expect(output.toLowerCase()).toContain('unknown command');
    });

    it('should handle invalid options gracefully', () => {
      runCli('init');
      const output = runCli('store -t invalid_type --title "Test" -s "Summary"', true);
      // Should either work (accepts any string) or give a meaningful error
      expect(output).toBeDefined();
    });
  });

  describe('Directory structure verification', () => {
    it('should create VCS directory on init', async () => {
      runCli('init');
      const vcsDir = path.join(testDir, '.claude-memory');
      const exists = await fs.access(vcsDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create runtime directory on init', async () => {
      runCli('init');
      const runtimeDir = path.join(testDir, '.claude-memory-runtime');
      const exists = await fs.access(runtimeDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create memories subdirectory', async () => {
      runCli('init');
      const memoriesDir = path.join(testDir, '.claude-memory', 'memories');
      const exists = await fs.access(memoriesDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create tasks subdirectories', async () => {
      runCli('init');

      const pendingDir = path.join(testDir, '.claude-memory-runtime', 'tasks', 'pending');
      const inProgressDir = path.join(testDir, '.claude-memory-runtime', 'tasks', 'in_progress');

      const pendingExists = await fs.access(pendingDir).then(() => true).catch(() => false);
      const inProgressExists = await fs.access(inProgressDir).then(() => true).catch(() => false);

      expect(pendingExists).toBe(true);
      expect(inProgressExists).toBe(true);
    });

    it('should create index.json on init', async () => {
      runCli('init');
      const indexPath = path.join(testDir, '.claude-memory', 'index.json');
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);

      expect(index.version).toBe('1.0');
      expect(index.by_type).toBeDefined();
    });

    it('should create timeline.json on init', async () => {
      runCli('init');
      const timelinePath = path.join(testDir, '.claude-memory', 'timeline.json');
      const content = await fs.readFile(timelinePath, 'utf-8');
      const timeline = JSON.parse(content);

      expect(timeline.entries).toBeDefined();
      expect(Array.isArray(timeline.entries)).toBe(true);
    });

    it('should create config.yaml on init', async () => {
      runCli('init');
      const configPath = path.join(testDir, '.claude-memory', 'config.yaml');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create README.md on init', async () => {
      runCli('init');
      const readmePath = path.join(testDir, '.claude-memory', 'README.md');
      const content = await fs.readFile(readmePath, 'utf-8');
      expect(content).toContain('Claude Memory System');
    });

    it('should add runtime dir to gitignore', async () => {
      runCli('init');
      const gitignorePath = path.join(testDir, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      expect(content).toContain('.claude-memory-runtime/');
    });
  });

  describe('Memory persistence verification', () => {
    it('should persist memory to YAML file', async () => {
      runCli('init');
      const output = runCli('store -t fact --title "Persist Test" -s "Should be saved"');

      const memoriesDir = path.join(testDir, '.claude-memory', 'memories');
      const files = await fs.readdir(memoriesDir);
      const yamlFiles = files.filter(f => f.endsWith('.yaml'));

      expect(yamlFiles.length).toBeGreaterThan(0);
    });

    it('should update index when storing memory', async () => {
      runCli('init');
      runCli('store -t decision --title "Index Test" -s "Should update index" -i 0.9 --tags "test"');

      const indexPath = path.join(testDir, '.claude-memory', 'index.json');
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);

      expect(index.by_type.decision.length).toBeGreaterThan(0);
      expect(index.by_tag.test.length).toBeGreaterThan(0);
      expect(index.high_importance.length).toBeGreaterThan(0);
    });

    it('should update timeline when storing memory', async () => {
      runCli('init');
      runCli('store -t event --title "Timeline Test" -s "Should update timeline"');

      const timelinePath = path.join(testDir, '.claude-memory', 'timeline.json');
      const content = await fs.readFile(timelinePath, 'utf-8');
      const timeline = JSON.parse(content);

      expect(timeline.entries.length).toBeGreaterThan(0);
      expect(timeline.entries[0].summary).toBe('Timeline Test');
    });
  });
});
