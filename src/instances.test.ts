/**
 * Tests for Claude Memory InstanceManager
 *
 * Tests for:
 * - Instance registration and lifecycle
 * - Heartbeat management
 * - Status updates
 * - Activity logging
 * - Message passing between instances
 * - Session recovery
 * - Capability-based instance lookup
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { InstanceManager } from './instances.js';
import { Instance, InboxMessage } from './types.js';

describe('InstanceManager', () => {
  let testDir: string;
  let instanceManager: InstanceManager;

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-instances-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });

    // Create required directories
    const runtimeDir = path.join(testDir, '.claude-memory-runtime');
    await fs.mkdir(path.join(runtimeDir, 'instances'), { recursive: true });
    await fs.mkdir(path.join(runtimeDir, 'inbox'), { recursive: true });

    instanceManager = new InstanceManager(testDir, 'test-instance', ['coding', 'testing'], 'jest');
  });

  afterEach(async () => {
    instanceManager.stopHeartbeat();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Constructor', () => {
    it('should generate unique instance ID if not provided', () => {
      const manager1 = new InstanceManager(testDir);
      const manager2 = new InstanceManager(testDir);

      expect(manager1.getInstanceId()).not.toBe(manager2.getInstanceId());
      expect(manager1.getInstanceId()).toMatch(/^instance_[a-z0-9]+$/);
    });

    it('should use provided instance ID', () => {
      const manager = new InstanceManager(testDir, 'custom-id');
      expect(manager.getInstanceId()).toBe('custom-id');
    });

    it('should return correct runtime directory path', () => {
      expect(instanceManager.getRuntimeDir()).toBe(path.join(testDir, '.claude-memory-runtime'));
    });

    it('should return machine hostname', () => {
      expect(instanceManager.getMachine()).toBe(os.hostname());
    });
  });

  describe('register', () => {
    it('should register instance with correct structure', async () => {
      const instance = await instanceManager.register();

      expect(instance.instance_id).toBe('test-instance');
      expect(instance.machine).toBe(os.hostname());
      expect(instance.capabilities).toEqual(['coding', 'testing']);
      expect(instance.current_status).toBe('active');
      expect(instance.first_seen).toBeDefined();
      expect(instance.last_activity).toBeDefined();
      expect(instance.session_info?.tool).toBe('jest');
    });

    it('should persist registration to filesystem', async () => {
      await instanceManager.register();

      const activityPath = path.join(testDir, '.claude-memory-runtime', 'instances', 'activity.yaml');
      const content = await fs.readFile(activityPath, 'utf-8');

      expect(content).toContain('test-instance');
    });

    it('should add registration to recent activity', async () => {
      await instanceManager.register();

      const activity = await instanceManager.getRecentActivity(10);
      expect(activity.length).toBeGreaterThan(0);
      expect(activity[0].action).toBe('registered');
      expect(activity[0].instance_id).toBe('test-instance');
    });

    it('should include capabilities in registration activity', async () => {
      await instanceManager.register();

      const activity = await instanceManager.getRecentActivity(1);
      expect(activity[0].details).toContain('coding');
      expect(activity[0].details).toContain('testing');
    });
  });

  describe('updateStatus', () => {
    beforeEach(async () => {
      await instanceManager.register();
    });

    it('should update instance status', async () => {
      await instanceManager.updateStatus('idle');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(instance?.current_status).toBe('idle');
    });

    it('should update working_on field', async () => {
      await instanceManager.updateStatus('active', 'Working on feature X');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(instance?.working_on).toBe('Working on feature X');
    });

    it('should update last_activity timestamp', async () => {
      const beforeUpdate = new Date().toISOString();
      await new Promise(resolve => setTimeout(resolve, 10));

      await instanceManager.updateStatus('active');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(new Date(instance!.last_activity).getTime())
        .toBeGreaterThan(new Date(beforeUpdate).getTime());
    });

    it('should register if instance not found', async () => {
      // Create new manager that hasn't registered
      const newManager = new InstanceManager(testDir, 'new-instance', ['coding'], 'cli');
      await newManager.updateStatus('active');

      const instances = await newManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'new-instance');

      expect(instance).toBeDefined();
    });
  });

  describe('heartbeat', () => {
    beforeEach(async () => {
      await instanceManager.register();
    });

    it('should update last_activity on heartbeat', async () => {
      const instances1 = await instanceManager.getActiveInstances();
      const before = instances1.find(i => i.instance_id === 'test-instance')?.last_activity;

      await new Promise(resolve => setTimeout(resolve, 10));
      await instanceManager.heartbeat();

      const instances2 = await instanceManager.getActiveInstances();
      const after = instances2.find(i => i.instance_id === 'test-instance')?.last_activity;

      expect(new Date(after!).getTime()).toBeGreaterThan(new Date(before!).getTime());
    });

    it('should do nothing if instance not registered', async () => {
      const newManager = new InstanceManager(testDir, 'unregistered', ['coding'], 'cli');

      // Should not throw
      await expect(newManager.heartbeat()).resolves.not.toThrow();
    });
  });

  describe('startHeartbeat and stopHeartbeat', () => {
    it('should start periodic heartbeats', async () => {
      await instanceManager.register();

      // Use very short interval for testing
      instanceManager.startHeartbeat(50);

      const before = (await instanceManager.getActiveInstances())
        .find(i => i.instance_id === 'test-instance')?.last_activity;

      await new Promise(resolve => setTimeout(resolve, 100));

      const after = (await instanceManager.getActiveInstances())
        .find(i => i.instance_id === 'test-instance')?.last_activity;

      instanceManager.stopHeartbeat();

      expect(new Date(after!).getTime()).toBeGreaterThan(new Date(before!).getTime());
    });

    it('should stop heartbeat when called', async () => {
      await instanceManager.register();

      instanceManager.startHeartbeat(50);
      instanceManager.stopHeartbeat();

      const before = (await instanceManager.getActiveInstances())
        .find(i => i.instance_id === 'test-instance')?.last_activity;

      await new Promise(resolve => setTimeout(resolve, 100));

      const after = (await instanceManager.getActiveInstances())
        .find(i => i.instance_id === 'test-instance')?.last_activity;

      // Should be same (no updates after stop)
      expect(before).toBe(after);
    });

    it('should handle multiple start calls', async () => {
      await instanceManager.register();

      // Multiple starts should not throw
      instanceManager.startHeartbeat(100);
      instanceManager.startHeartbeat(100);
      instanceManager.startHeartbeat(100);
      instanceManager.stopHeartbeat();
    });

    it('should handle stop without start', () => {
      // Should not throw
      instanceManager.stopHeartbeat();
    });
  });

  describe('goOffline', () => {
    beforeEach(async () => {
      await instanceManager.register();
    });

    it('should set status to offline', async () => {
      await instanceManager.goOffline();

      const instances = await instanceManager.getActiveInstances();
      // Should not appear in active instances (stale threshold)
      // But we can check activity log
      const activity = await instanceManager.getRecentActivity(1);
      expect(activity[0].action).toBe('went_offline');
    });

    it('should stop heartbeat', async () => {
      instanceManager.startHeartbeat(50);
      await instanceManager.goOffline();

      // Heartbeat should be stopped
      const before = (await instanceManager.getActiveInstances())
        .find(i => i.instance_id === 'test-instance')?.last_activity;

      await new Promise(resolve => setTimeout(resolve, 100));

      const after = (await instanceManager.getActiveInstances())
        .find(i => i.instance_id === 'test-instance')?.last_activity;

      expect(before).toBe(after);
    });

    it('should log activity', async () => {
      await instanceManager.goOffline();

      const activity = await instanceManager.getRecentActivity(5);
      const offlineActivity = activity.find(a => a.action === 'went_offline');

      expect(offlineActivity).toBeDefined();
    });
  });

  describe('touchFile', () => {
    beforeEach(async () => {
      await instanceManager.register();
    });

    it('should add file to touched files list', async () => {
      await instanceManager.touchFile('/path/to/file.ts');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(instance?.files_touched).toContain('/path/to/file.ts');
    });

    it('should not duplicate files', async () => {
      await instanceManager.touchFile('/path/to/file.ts');
      await instanceManager.touchFile('/path/to/file.ts');
      await instanceManager.touchFile('/path/to/file.ts');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      const fileCount = instance?.files_touched?.filter(f => f === '/path/to/file.ts').length;
      expect(fileCount).toBe(1);
    });

    it('should limit to 20 files', async () => {
      for (let i = 0; i < 25; i++) {
        await instanceManager.touchFile(`/path/to/file${i}.ts`);
      }

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(instance?.files_touched?.length).toBe(20);
    });

    it('should keep most recent files', async () => {
      for (let i = 0; i < 25; i++) {
        await instanceManager.touchFile(`/path/to/file${i}.ts`);
      }

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      // Should have files 5-24 (the most recent 20)
      expect(instance?.files_touched).toContain('/path/to/file24.ts');
      expect(instance?.files_touched).not.toContain('/path/to/file0.ts');
    });
  });

  describe('waitForTask', () => {
    beforeEach(async () => {
      await instanceManager.register();
    });

    it('should add task to waiting list', async () => {
      await instanceManager.waitForTask('task_12345');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(instance?.waiting_for?.some(w => w.task_id === 'task_12345')).toBe(true);
    });

    it('should set status to waiting', async () => {
      await instanceManager.waitForTask('task_12345');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(instance?.current_status).toBe('waiting');
    });

    it('should track multiple waits', async () => {
      await instanceManager.waitForTask('task_1');
      await instanceManager.waitForTask('task_2');
      await instanceManager.waitForTask('task_3');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(instance?.waiting_for?.length).toBe(3);
    });
  });

  describe('clearWait', () => {
    beforeEach(async () => {
      await instanceManager.register();
    });

    it('should remove task from waiting list', async () => {
      await instanceManager.waitForTask('task_1');
      await instanceManager.waitForTask('task_2');
      await instanceManager.clearWait('task_1');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(instance?.waiting_for?.some(w => w.task_id === 'task_1')).toBe(false);
      expect(instance?.waiting_for?.some(w => w.task_id === 'task_2')).toBe(true);
    });

    it('should set status to active when no more waits', async () => {
      await instanceManager.waitForTask('task_1');
      await instanceManager.clearWait('task_1');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(instance?.current_status).toBe('active');
    });

    it('should keep waiting status if other waits exist', async () => {
      await instanceManager.waitForTask('task_1');
      await instanceManager.waitForTask('task_2');
      await instanceManager.clearWait('task_1');

      const instances = await instanceManager.getActiveInstances();
      const instance = instances.find(i => i.instance_id === 'test-instance');

      expect(instance?.current_status).toBe('waiting');
    });
  });

  describe('getActiveInstances', () => {
    it('should return recently active instances', async () => {
      await instanceManager.register();

      const instances = await instanceManager.getActiveInstances();
      expect(instances.length).toBe(1);
      expect(instances[0].instance_id).toBe('test-instance');
    });

    it('should exclude stale instances', async () => {
      await instanceManager.register();

      // Manually modify the registry to make instance stale
      const activityPath = path.join(testDir, '.claude-memory-runtime', 'instances', 'activity.yaml');
      const content = await fs.readFile(activityPath, 'utf-8');

      // Set last_activity to 10 minutes ago - handle both quoted and unquoted YAML
      const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const modified = content.replace(/last_activity: .+$/m, `last_activity: "${staleTime}"`);
      await fs.writeFile(activityPath, modified, 'utf-8');

      const instances = await instanceManager.getActiveInstances();
      expect(instances.length).toBe(0);
    });

    it('should return multiple active instances', async () => {
      await instanceManager.register();

      const manager2 = new InstanceManager(testDir, 'instance-2', ['coding'], 'cli');
      await manager2.register();

      const manager3 = new InstanceManager(testDir, 'instance-3', ['testing'], 'browser');
      await manager3.register();

      const instances = await instanceManager.getActiveInstances();
      expect(instances.length).toBe(3);
    });
  });

  describe('getInstancesWithCapabilities', () => {
    beforeEach(async () => {
      await instanceManager.register();

      const manager2 = new InstanceManager(testDir, 'browser-instance', ['browser_testing', 'visual_testing'], 'browser');
      await manager2.register();

      const manager3 = new InstanceManager(testDir, 'deployment-instance', ['deployment', 'git'], 'cli');
      await manager3.register();
    });

    it('should find instances with single capability', async () => {
      const instances = await instanceManager.getInstancesWithCapabilities(['coding']);
      expect(instances.length).toBe(1);
      expect(instances[0].instance_id).toBe('test-instance');
    });

    it('should find instances with multiple capabilities', async () => {
      const instances = await instanceManager.getInstancesWithCapabilities(['browser_testing', 'visual_testing']);
      expect(instances.length).toBe(1);
      expect(instances[0].instance_id).toBe('browser-instance');
    });

    it('should return empty if no match', async () => {
      const instances = await instanceManager.getInstancesWithCapabilities(['nonexistent']);
      expect(instances.length).toBe(0);
    });

    it('should require all capabilities', async () => {
      const instances = await instanceManager.getInstancesWithCapabilities(['browser_testing', 'deployment']);
      expect(instances.length).toBe(0);
    });
  });

  describe('logActivity', () => {
    beforeEach(async () => {
      await instanceManager.register();
    });

    it('should log activity with action', async () => {
      await instanceManager.logActivity('test_action');

      const activity = await instanceManager.getRecentActivity(1);
      expect(activity[0].action).toBe('test_action');
    });

    it('should log activity with details', async () => {
      await instanceManager.logActivity('test_action', 'Additional details here');

      const activity = await instanceManager.getRecentActivity(1);
      expect(activity[0].details).toBe('Additional details here');
    });

    it('should limit to 100 entries', async () => {
      for (let i = 0; i < 110; i++) {
        await instanceManager.logActivity(`action_${i}`);
      }

      const activity = await instanceManager.getRecentActivity(200);
      expect(activity.length).toBeLessThanOrEqual(100);
    });

    it('should keep most recent activities', async () => {
      for (let i = 0; i < 110; i++) {
        await instanceManager.logActivity(`action_${i}`);
      }

      const activity = await instanceManager.getRecentActivity(1);
      // Most recent should be action_109
      expect(activity[0].action).toBe('action_109');
    });
  });

  describe('getRecentActivity', () => {
    beforeEach(async () => {
      await instanceManager.register();
      await instanceManager.logActivity('action_1');
      await instanceManager.logActivity('action_2');
      await instanceManager.logActivity('action_3');
    });

    it('should return limited entries', async () => {
      const activity = await instanceManager.getRecentActivity(2);
      expect(activity.length).toBe(2);
    });

    it('should return entries in reverse chronological order', async () => {
      const activity = await instanceManager.getRecentActivity(10);
      // Most recent should be first
      expect(activity[0].action).toBe('action_3');
    });

    it('should use default limit of 20', async () => {
      for (let i = 0; i < 30; i++) {
        await instanceManager.logActivity(`action_${i}`);
      }

      const activity = await instanceManager.getRecentActivity();
      expect(activity.length).toBe(20);
    });
  });

  describe('sendMessage', () => {
    it('should create message with correct structure', async () => {
      const message = await instanceManager.sendMessage(
        'target-instance',
        'info',
        'Hello, target!',
        'Test Subject'
      );

      expect(message.id).toMatch(/^msg_[a-z0-9-]+$/);
      expect(message.from).toBe('test-instance');
      expect(message.to).toBe('target-instance');
      expect(message.type).toBe('info');
      expect(message.message).toBe('Hello, target!');
      expect(message.subject).toBe('Test Subject');
      expect(message.read).toBe(false);
    });

    it('should persist message to filesystem', async () => {
      const message = await instanceManager.sendMessage(
        'target-instance',
        'info',
        'Persisted message'
      );

      const messagePath = path.join(
        testDir,
        '.claude-memory-runtime',
        'inbox',
        `${message.id}_to_target-instance.yaml`
      );

      const exists = await fs.access(messagePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should include optional related fields', async () => {
      const message = await instanceManager.sendMessage(
        'target',
        'response',
        'Response message',
        'Subject',
        'task_123',
        'mem_456'
      );

      expect(message.related_task).toBe('task_123');
      expect(message.related_memory).toBe('mem_456');
    });

    it('should handle all message types', async () => {
      const types = ['info', 'warning', 'request', 'response'] as const;

      for (const type of types) {
        const message = await instanceManager.sendMessage(
          'target',
          type,
          `Message of type ${type}`
        );

        expect(message.type).toBe(type);
      }
    });
  });

  describe('getUnreadMessages', () => {
    it('should return messages for this instance', async () => {
      // Create message from another instance to this one
      const otherManager = new InstanceManager(testDir, 'sender', ['coding'], 'cli');
      await otherManager.sendMessage('test-instance', 'info', 'Hello!');

      const messages = await instanceManager.getUnreadMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].message).toBe('Hello!');
    });

    it('should not return messages for other instances', async () => {
      const otherManager = new InstanceManager(testDir, 'sender', ['coding'], 'cli');
      await otherManager.sendMessage('other-recipient', 'info', 'Not for test-instance');

      const messages = await instanceManager.getUnreadMessages();
      expect(messages.length).toBe(0);
    });

    it('should not return read messages', async () => {
      const otherManager = new InstanceManager(testDir, 'sender', ['coding'], 'cli');
      const message = await otherManager.sendMessage('test-instance', 'info', 'Read this');

      await instanceManager.markMessageRead(message.id);

      const messages = await instanceManager.getUnreadMessages();
      expect(messages.length).toBe(0);
    });

    it('should return multiple messages sorted by timestamp', async () => {
      const otherManager = new InstanceManager(testDir, 'sender', ['coding'], 'cli');

      await otherManager.sendMessage('test-instance', 'info', 'First');
      await new Promise(resolve => setTimeout(resolve, 10));
      await otherManager.sendMessage('test-instance', 'info', 'Second');
      await new Promise(resolve => setTimeout(resolve, 10));
      await otherManager.sendMessage('test-instance', 'info', 'Third');

      const messages = await instanceManager.getUnreadMessages();
      expect(messages.length).toBe(3);
      // Most recent first
      expect(messages[0].message).toBe('Third');
      expect(messages[2].message).toBe('First');
    });
  });

  describe('markMessageRead', () => {
    it('should mark message as read', async () => {
      const otherManager = new InstanceManager(testDir, 'sender', ['coding'], 'cli');
      const message = await otherManager.sendMessage('test-instance', 'info', 'Mark me read');

      await instanceManager.markMessageRead(message.id);

      const messages = await instanceManager.getUnreadMessages();
      expect(messages.length).toBe(0);
    });

    it('should set read_at timestamp', async () => {
      const otherManager = new InstanceManager(testDir, 'sender', ['coding'], 'cli');
      const message = await otherManager.sendMessage('test-instance', 'info', 'Mark me read');

      const beforeMark = new Date().toISOString();
      await instanceManager.markMessageRead(message.id);

      // Read the raw file to check read_at
      const files = await fs.readdir(path.join(testDir, '.claude-memory-runtime', 'inbox'));
      const file = files.find(f => f.startsWith(message.id));
      const content = await fs.readFile(
        path.join(testDir, '.claude-memory-runtime', 'inbox', file!),
        'utf-8'
      );

      expect(content).toContain('read: true');
      expect(content).toContain('read_at:');
    });

    it('should do nothing for non-existent message', async () => {
      // Should not throw
      await expect(instanceManager.markMessageRead('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('cleanupOldMessages', () => {
    it('should remove old read messages', async () => {
      const otherManager = new InstanceManager(testDir, 'sender', ['coding'], 'cli');
      const message = await otherManager.sendMessage('test-instance', 'info', 'Old message');

      await instanceManager.markMessageRead(message.id);

      // Manually modify timestamp to be old - handle both quoted and unquoted YAML
      const files = await fs.readdir(path.join(testDir, '.claude-memory-runtime', 'inbox'));
      const file = files.find(f => f.startsWith(message.id));
      const filePath = path.join(testDir, '.claude-memory-runtime', 'inbox', file!);
      let content = await fs.readFile(filePath, 'utf-8');

      const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      content = content.replace(/timestamp: .+$/m, `timestamp: "${oldTime}"`);
      await fs.writeFile(filePath, content, 'utf-8');

      const cleaned = await instanceManager.cleanupOldMessages(7);
      expect(cleaned).toBe(1);
    });

    it('should not remove unread messages', async () => {
      const otherManager = new InstanceManager(testDir, 'sender', ['coding'], 'cli');
      const message = await otherManager.sendMessage('test-instance', 'info', 'Unread message');

      // Manually modify timestamp to be old - handle both quoted and unquoted YAML
      const files = await fs.readdir(path.join(testDir, '.claude-memory-runtime', 'inbox'));
      const file = files.find(f => f.startsWith(message.id));
      const filePath = path.join(testDir, '.claude-memory-runtime', 'inbox', file!);
      let content = await fs.readFile(filePath, 'utf-8');

      const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      content = content.replace(/timestamp: .+$/m, `timestamp: "${oldTime}"`);
      await fs.writeFile(filePath, content, 'utf-8');

      const cleaned = await instanceManager.cleanupOldMessages(7);
      expect(cleaned).toBe(0);
    });

    it('should not remove recent read messages', async () => {
      const otherManager = new InstanceManager(testDir, 'sender', ['coding'], 'cli');
      const message = await otherManager.sendMessage('test-instance', 'info', 'Recent message');

      await instanceManager.markMessageRead(message.id);

      const cleaned = await instanceManager.cleanupOldMessages(7);
      expect(cleaned).toBe(0);
    });

    it('should return count of cleaned messages', async () => {
      const otherManager = new InstanceManager(testDir, 'sender', ['coding'], 'cli');

      for (let i = 0; i < 5; i++) {
        const message = await otherManager.sendMessage('test-instance', 'info', `Old message ${i}`);
        await instanceManager.markMessageRead(message.id);

        // Make old - handle both quoted and unquoted YAML formats
        const files = await fs.readdir(path.join(testDir, '.claude-memory-runtime', 'inbox'));
        const file = files.find(f => f.startsWith(message.id));
        const filePath = path.join(testDir, '.claude-memory-runtime', 'inbox', file!);
        let content = await fs.readFile(filePath, 'utf-8');

        const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
        // Replace timestamp in YAML (handles both quoted and unquoted)
        content = content.replace(/timestamp: .+$/m, `timestamp: "${oldTime}"`);
        await fs.writeFile(filePath, content, 'utf-8');
      }

      const cleaned = await instanceManager.cleanupOldMessages(7);
      expect(cleaned).toBe(5);
    });
  });

  describe('recoverSession', () => {
    it('should recover pending waits from previous session', async () => {
      // Register and wait for a task
      await instanceManager.register();
      await instanceManager.waitForTask('task_1');
      await instanceManager.waitForTask('task_2');
      await instanceManager.goOffline();

      // Create new manager and recover
      const newManager = new InstanceManager(testDir, 'new-instance', ['coding'], 'cli');
      await newManager.register();

      const recovered = await newManager.recoverSession('test-instance');

      expect(recovered?.pendingWaits).toContain('task_1');
      expect(recovered?.pendingWaits).toContain('task_2');
    });

    it('should recover unread messages from previous session', async () => {
      await instanceManager.register();

      // Send message to the old instance
      const sender = new InstanceManager(testDir, 'sender', ['coding'], 'cli');
      await sender.sendMessage('test-instance', 'info', 'Message for old session');

      // Create new manager and recover
      const newManager = new InstanceManager(testDir, 'new-instance', ['coding'], 'cli');
      await newManager.register();

      const recovered = await newManager.recoverSession('test-instance');

      expect(recovered?.unreadMessages.length).toBe(1);
      expect(recovered?.unreadMessages[0].message).toBe('Message for old session');
    });

    it('should return null for non-existent instance', async () => {
      const recovered = await instanceManager.recoverSession('nonexistent-instance');
      expect(recovered).toBeNull();
    });

    it('should re-register with recovered instance ID', async () => {
      await instanceManager.register();
      await instanceManager.goOffline();

      const newManager = new InstanceManager(testDir, 'new-instance', ['coding'], 'cli');
      await newManager.recoverSession('test-instance');

      // The new manager should now have the old instance ID
      expect(newManager.getInstanceId()).toBe('test-instance');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty registry file', async () => {
      const activityPath = path.join(testDir, '.claude-memory-runtime', 'instances', 'activity.yaml');
      await fs.writeFile(activityPath, '', 'utf-8');

      // Should not throw, should create default registry
      await expect(instanceManager.register()).resolves.not.toThrow();
    });

    it('should handle corrupted registry file', async () => {
      const activityPath = path.join(testDir, '.claude-memory-runtime', 'instances', 'activity.yaml');
      await fs.writeFile(activityPath, '{invalid: yaml: : :content', 'utf-8');

      // Should not throw, should create default registry
      const instances = await instanceManager.getActiveInstances();
      expect(instances.length).toBe(0);
    });

    it('should handle missing inbox directory', async () => {
      await fs.rm(path.join(testDir, '.claude-memory-runtime', 'inbox'), { recursive: true });

      // Should not throw
      const messages = await instanceManager.getUnreadMessages();
      expect(messages).toEqual([]);
    });

    it('should handle special characters in instance ID', async () => {
      const specialManager = new InstanceManager(
        testDir,
        'instance_with-special.chars',
        ['coding'],
        'cli'
      );

      await specialManager.register();

      const instances = await specialManager.getActiveInstances();
      expect(instances.some(i => i.instance_id === 'instance_with-special.chars')).toBe(true);
    });

    it('should handle unicode in activity details', async () => {
      await instanceManager.register();
      await instanceManager.logActivity('unicode_test', 'Details with emoji \ud83d\ude80 and \u4e2d\u6587');

      const activity = await instanceManager.getRecentActivity(1);
      expect(activity[0].details).toContain('\ud83d\ude80');
    });
  });
});
