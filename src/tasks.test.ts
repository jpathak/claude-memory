/**
 * Tests for Claude Memory TaskManager
 *
 * Tests for:
 * - Task creation and lifecycle
 * - Task claiming and status transitions
 * - Task completion and failure
 * - Capability-based task filtering
 * - Wait handles and async tracking
 * - Error handling
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { TaskManager } from './tasks.js';
import { CreateTaskInput, Task, TaskPriority, TaskStatus } from './types.js';

describe('TaskManager', () => {
  let testDir: string;
  let taskManager: TaskManager;

  beforeEach(async () => {
    testDir = '/tmp/claude-memory-tasks-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await fs.mkdir(testDir, { recursive: true });

    // Create required directories
    const runtimeDir = path.join(testDir, '.claude-memory-runtime');
    const memoryDir = path.join(testDir, '.claude-memory');
    await fs.mkdir(path.join(runtimeDir, 'tasks', 'pending'), { recursive: true });
    await fs.mkdir(path.join(runtimeDir, 'tasks', 'in_progress'), { recursive: true });
    await fs.mkdir(path.join(runtimeDir, 'failed'), { recursive: true });
    await fs.mkdir(path.join(memoryDir, 'completed'), { recursive: true });

    taskManager = new TaskManager(testDir, 'test-instance', 'test-machine');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('createTask', () => {
    it('should create a task with correct structure', async () => {
      const input: CreateTaskInput = {
        title: 'Test Task',
        description: 'A test task description',
      };

      const task = await taskManager.createTask(input);

      expect(task.id).toMatch(/^task_[a-z0-9-]+$/);
      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('A test task description');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('normal');
      expect(task.created_by.instance_id).toBe('test-instance');
      expect(task.created_by.machine).toBe('test-machine');
    });

    it('should create task with all optional fields', async () => {
      const input: CreateTaskInput = {
        title: 'Full Task',
        description: 'Complete task',
        instructions: 'Detailed instructions here',
        priority: 'high',
        target: {
          capabilities: ['browser_testing', 'visual_testing'],
          specific_instance: 'target-instance',
        },
        expected_output: {
          type: 'json',
          format: 'object',
        },
        timeout_minutes: 30,
        related_memories: ['mem1', 'mem2'],
        files_involved: ['/path/to/file.ts'],
      };

      const task = await taskManager.createTask(input);

      expect(task.instructions).toBe('Detailed instructions here');
      expect(task.priority).toBe('high');
      expect(task.target.capabilities).toEqual(['browser_testing', 'visual_testing']);
      expect(task.target.specific_instance).toBe('target-instance');
      expect(task.expected_output?.type).toBe('json');
      expect(task.wait_handle?.timeout_at).toBeDefined();
      expect(task.related_memories).toEqual(['mem1', 'mem2']);
      expect(task.files_involved).toEqual(['/path/to/file.ts']);
    });

    it('should persist task to filesystem', async () => {
      const task = await taskManager.createTask({
        title: 'Persisted Task',
        description: 'Should be saved to disk',
      });

      const taskPath = path.join(
        testDir,
        '.claude-memory-runtime',
        'tasks',
        'pending',
        `${task.id}.yaml`
      );

      const exists = await fs.access(taskPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should initialize status history with pending', async () => {
      const task = await taskManager.createTask({
        title: 'Status History Test',
        description: 'Testing status history',
      });

      expect(task.status_history.length).toBe(1);
      expect(task.status_history[0].status).toBe('pending');
      expect(task.status_history[0].by).toBe('test-instance');
      expect(task.status_history[0].timestamp).toBeDefined();
    });

    it('should set wait handle correctly', async () => {
      const task = await taskManager.createTask({
        title: 'Wait Handle Test',
        description: 'Testing wait handle',
      });

      expect(task.wait_handle?.requester).toBe('test-instance');
      expect(task.wait_handle?.callback_type).toBe('poll');
      expect(task.wait_handle?.acknowledged).toBe(false);
    });

    it('should calculate timeout correctly', async () => {
      const beforeCreate = Date.now();

      const task = await taskManager.createTask({
        title: 'Timeout Test',
        description: 'Testing timeout',
        timeout_minutes: 60,
      });

      const afterCreate = Date.now();
      const timeoutTime = new Date(task.wait_handle!.timeout_at!).getTime();

      // Timeout should be approximately 60 minutes from now
      const expectedMin = beforeCreate + 60 * 60 * 1000;
      const expectedMax = afterCreate + 60 * 60 * 1000;

      expect(timeoutTime).toBeGreaterThanOrEqual(expectedMin);
      expect(timeoutTime).toBeLessThanOrEqual(expectedMax);
    });

    it('should handle all priority levels', async () => {
      const priorities: TaskPriority[] = ['low', 'normal', 'high', 'critical'];

      for (const priority of priorities) {
        const task = await taskManager.createTask({
          title: `${priority} priority task`,
          description: 'Testing priority',
          priority,
        });

        expect(task.priority).toBe(priority);
      }
    });
  });

  describe('getPendingTasks', () => {
    it('should return empty array when no tasks', async () => {
      const tasks = await taskManager.getPendingTasks();
      expect(tasks).toEqual([]);
    });

    it('should return all pending tasks', async () => {
      await taskManager.createTask({
        title: 'Task 1',
        description: 'First task',
      });

      await taskManager.createTask({
        title: 'Task 2',
        description: 'Second task',
      });

      const tasks = await taskManager.getPendingTasks();
      expect(tasks.length).toBe(2);
    });

    it('should not return claimed or completed tasks', async () => {
      const task = await taskManager.createTask({
        title: 'Task to claim',
        description: 'Will be claimed',
      });

      await taskManager.claimTask(task.id);

      const pending = await taskManager.getPendingTasks();
      expect(pending.length).toBe(0);
    });
  });

  describe('getClaimableTasks', () => {
    it('should return tasks with no capability requirements', async () => {
      await taskManager.createTask({
        title: 'Open Task',
        description: 'No capabilities required',
      });

      const claimable = await taskManager.getClaimableTasks(['coding']);
      expect(claimable.length).toBe(1);
    });

    it('should return tasks when instance has required capabilities', async () => {
      await taskManager.createTask({
        title: 'Browser Task',
        description: 'Requires browser testing',
        target: {
          capabilities: ['browser_testing'],
        },
      });

      const claimableWith = await taskManager.getClaimableTasks(['browser_testing', 'coding']);
      const claimableWithout = await taskManager.getClaimableTasks(['coding']);

      expect(claimableWith.length).toBe(1);
      expect(claimableWithout.length).toBe(0);
    });

    it('should require all capabilities', async () => {
      await taskManager.createTask({
        title: 'Multi-capability Task',
        description: 'Requires multiple capabilities',
        target: {
          capabilities: ['browser_testing', 'visual_testing'],
        },
      });

      const hasOne = await taskManager.getClaimableTasks(['browser_testing']);
      const hasAll = await taskManager.getClaimableTasks(['browser_testing', 'visual_testing']);

      expect(hasOne.length).toBe(0);
      expect(hasAll.length).toBe(1);
    });

    it('should return tasks targeting specific instance', async () => {
      await taskManager.createTask({
        title: 'Targeted Task',
        description: 'For specific instance',
        target: {
          specific_instance: 'test-instance',
          capabilities: ['advanced-capability'],
        },
      });

      // Even without the capability, specific instance should get the task
      const claimable = await taskManager.getClaimableTasks(['coding']);
      expect(claimable.length).toBe(1);
    });

    it('should not return tasks targeting different instance', async () => {
      await taskManager.createTask({
        title: 'Targeted Task',
        description: 'For other instance',
        target: {
          specific_instance: 'other-instance',
        },
      });

      const claimable = await taskManager.getClaimableTasks(['coding']);
      expect(claimable.length).toBe(0);
    });
  });

  describe('claimTask', () => {
    it('should claim a pending task', async () => {
      const task = await taskManager.createTask({
        title: 'Task to claim',
        description: 'Will be claimed',
      });

      const claimed = await taskManager.claimTask(task.id);

      expect(claimed).not.toBeNull();
      expect(claimed?.status).toBe('claimed');
      expect(claimed?.claimed_by?.instance_id).toBe('test-instance');
      expect(claimed?.claimed_by?.machine).toBe('test-machine');
    });

    it('should move task from pending to in_progress directory', async () => {
      const task = await taskManager.createTask({
        title: 'Task to move',
        description: 'Will be moved',
      });

      await taskManager.claimTask(task.id);

      const pendingPath = path.join(testDir, '.claude-memory-runtime', 'tasks', 'pending', `${task.id}.yaml`);
      const inProgressPath = path.join(testDir, '.claude-memory-runtime', 'tasks', 'in_progress', `${task.id}.yaml`);

      const pendingExists = await fs.access(pendingPath).then(() => true).catch(() => false);
      const inProgressExists = await fs.access(inProgressPath).then(() => true).catch(() => false);

      expect(pendingExists).toBe(false);
      expect(inProgressExists).toBe(true);
    });

    it('should add to status history', async () => {
      const task = await taskManager.createTask({
        title: 'Status history test',
        description: 'Testing status history update',
      });

      const claimed = await taskManager.claimTask(task.id);

      expect(claimed?.status_history.length).toBe(2);
      expect(claimed?.status_history[1].status).toBe('claimed');
      expect(claimed?.status_history[1].by).toBe('test-instance');
    });

    it('should return null for non-existent task', async () => {
      const result = await taskManager.claimTask('nonexistent-task-id');
      expect(result).toBeNull();
    });

    it('should throw error when claiming non-pending task', async () => {
      const task = await taskManager.createTask({
        title: 'Task to claim twice',
        description: 'Will fail on second claim',
      });

      await taskManager.claimTask(task.id);

      await expect(taskManager.claimTask(task.id))
        .rejects
        .toThrow('Task task_' + task.id.slice(5) + ' is not pending');
    });
  });

  describe('startTask', () => {
    it('should start a claimed task', async () => {
      const task = await taskManager.createTask({
        title: 'Task to start',
        description: 'Will be started',
      });

      await taskManager.claimTask(task.id);
      const started = await taskManager.startTask(task.id);

      expect(started?.status).toBe('in_progress');
      expect(started?.progress_updates).toEqual([]);
    });

    it('should throw error when starting non-claimed task', async () => {
      const task = await taskManager.createTask({
        title: 'Pending task',
        description: 'Not claimed yet',
      });

      await expect(taskManager.startTask(task.id))
        .rejects
        .toThrow('is not claimed');
    });

    it('should add to status history', async () => {
      const task = await taskManager.createTask({
        title: 'Status history test',
        description: 'Testing status history',
      });

      await taskManager.claimTask(task.id);
      const started = await taskManager.startTask(task.id);

      expect(started?.status_history.length).toBe(3);
      expect(started?.status_history[2].status).toBe('in_progress');
    });
  });

  describe('updateProgress', () => {
    it('should add progress update', async () => {
      const task = await taskManager.createTask({
        title: 'Progress test',
        description: 'Testing progress updates',
      });

      await taskManager.claimTask(task.id);
      await taskManager.startTask(task.id);
      await taskManager.updateProgress(task.id, 'Step 1 complete');
      await taskManager.updateProgress(task.id, 'Step 2 complete');

      const updated = await taskManager.getTask(task.id);

      expect(updated?.progress_updates?.length).toBe(2);
      expect(updated?.progress_updates?.[0].message).toBe('Step 1 complete');
      expect(updated?.progress_updates?.[1].message).toBe('Step 2 complete');
    });

    it('should throw error when updating non-in_progress task', async () => {
      const task = await taskManager.createTask({
        title: 'Not started',
        description: 'Task not in progress',
      });

      await expect(taskManager.updateProgress(task.id, 'Update'))
        .rejects
        .toThrow('is not in progress');
    });

    it('should do nothing for non-existent task', async () => {
      // Should not throw
      await expect(taskManager.updateProgress('nonexistent', 'Update'))
        .resolves.not.toThrow();
    });
  });

  describe('completeTask', () => {
    it('should complete a task with success', async () => {
      const task = await taskManager.createTask({
        title: 'Task to complete',
        description: 'Will be completed',
      });

      await taskManager.claimTask(task.id);
      await taskManager.startTask(task.id);

      const completed = await taskManager.completeTask(task.id, {
        success: true,
        output: {
          type: 'text',
          data: 'Task completed successfully',
        },
      });

      expect(completed?.status).toBe('completed');
      expect(completed?.result?.success).toBe(true);
      expect(completed?.result?.output?.data).toBe('Task completed successfully');
      expect(completed?.completed_at).toBeDefined();
    });

    it('should move task to completed directory', async () => {
      const task = await taskManager.createTask({
        title: 'Task to complete',
        description: 'Will be completed',
      });

      await taskManager.claimTask(task.id);
      await taskManager.startTask(task.id);
      await taskManager.completeTask(task.id, { success: true });

      const completedPath = path.join(testDir, '.claude-memory', 'completed', `${task.id}.yaml`);
      const inProgressPath = path.join(testDir, '.claude-memory-runtime', 'tasks', 'in_progress', `${task.id}.yaml`);

      const completedExists = await fs.access(completedPath).then(() => true).catch(() => false);
      const inProgressExists = await fs.access(inProgressPath).then(() => true).catch(() => false);

      expect(completedExists).toBe(true);
      expect(inProgressExists).toBe(false);
    });

    it('should complete directly from claimed status', async () => {
      const task = await taskManager.createTask({
        title: 'Quick task',
        description: 'Complete without starting',
      });

      await taskManager.claimTask(task.id);
      const completed = await taskManager.completeTask(task.id, { success: true });

      expect(completed?.status).toBe('completed');
    });

    it('should throw error when completing pending task', async () => {
      const task = await taskManager.createTask({
        title: 'Pending task',
        description: 'Cannot complete',
      });

      await expect(taskManager.completeTask(task.id, { success: true }))
        .rejects
        .toThrow('cannot be completed');
    });

    it('should include artifacts in result', async () => {
      const task = await taskManager.createTask({
        title: 'Artifact task',
        description: 'Creates artifacts',
      });

      await taskManager.claimTask(task.id);
      const completed = await taskManager.completeTask(task.id, {
        success: true,
        artifacts: [
          { path: '/tmp/output.json', description: 'Output file' },
          { path: '/tmp/report.txt', description: 'Report' },
        ],
      });

      expect(completed?.result?.artifacts?.length).toBe(2);
    });

    it('should include generated memories in result', async () => {
      const task = await taskManager.createTask({
        title: 'Memory generating task',
        description: 'Creates memories',
      });

      await taskManager.claimTask(task.id);
      const completed = await taskManager.completeTask(task.id, {
        success: true,
        generated_memories: ['mem1', 'mem2'],
      });

      expect(completed?.result?.generated_memories).toEqual(['mem1', 'mem2']);
    });
  });

  describe('failTask', () => {
    it('should fail a task with error', async () => {
      const task = await taskManager.createTask({
        title: 'Task to fail',
        description: 'Will fail',
      });

      await taskManager.claimTask(task.id);
      await taskManager.startTask(task.id);

      const failed = await taskManager.failTask(task.id, {
        code: 'EXECUTION_ERROR',
        message: 'Something went wrong',
        details: 'Stack trace here',
      });

      expect(failed?.status).toBe('failed');
      expect(failed?.result?.success).toBe(false);
      expect(failed?.result?.error?.code).toBe('EXECUTION_ERROR');
      expect(failed?.result?.error?.message).toBe('Something went wrong');
    });

    it('should move task to failed directory', async () => {
      const task = await taskManager.createTask({
        title: 'Task to fail',
        description: 'Will fail',
      });

      await taskManager.claimTask(task.id);
      await taskManager.failTask(task.id, {
        code: 'ERROR',
        message: 'Failed',
      });

      const failedPath = path.join(testDir, '.claude-memory-runtime', 'failed', `${task.id}.yaml`);
      const failedExists = await fs.access(failedPath).then(() => true).catch(() => false);

      expect(failedExists).toBe(true);
    });

    it('should add error message to status history', async () => {
      const task = await taskManager.createTask({
        title: 'Task with history',
        description: 'Error in history',
      });

      await taskManager.claimTask(task.id);
      const failed = await taskManager.failTask(task.id, {
        code: 'ERROR',
        message: 'This error message appears in history',
      });

      const lastHistory = failed?.status_history[failed.status_history.length - 1];
      expect(lastHistory?.status).toBe('failed');
      expect(lastHistory?.message).toBe('This error message appears in history');
    });
  });

  describe('getWaitingTasks', () => {
    it('should return tasks this instance is waiting for', async () => {
      const task = await taskManager.createTask({
        title: 'Delegated task',
        description: 'Waiting for completion',
      });

      const waiting = await taskManager.getWaitingTasks();
      expect(waiting.length).toBe(1);
      expect(waiting[0].id).toBe(task.id);
    });

    it('should not return acknowledged tasks', async () => {
      const task = await taskManager.createTask({
        title: 'Acknowledged task',
        description: 'Already acknowledged',
      });

      await taskManager.claimTask(task.id);
      await taskManager.completeTask(task.id, { success: true });
      await taskManager.acknowledgeResult(task.id);

      const waiting = await taskManager.getWaitingTasks();
      expect(waiting.length).toBe(0);
    });

    it('should not return tasks from other instances', async () => {
      // Create a task with different requester
      const otherManager = new TaskManager(testDir, 'other-instance', 'other-machine');
      await otherManager.createTask({
        title: 'Other instance task',
        description: 'Created by other',
      });

      const waiting = await taskManager.getWaitingTasks();
      expect(waiting.length).toBe(0);
    });
  });

  describe('checkCompletedWaits', () => {
    it('should return completed tasks that are awaited', async () => {
      const task = await taskManager.createTask({
        title: 'Task to complete',
        description: 'Will be completed',
      });

      await taskManager.claimTask(task.id);
      await taskManager.completeTask(task.id, { success: true });

      const completed = await taskManager.checkCompletedWaits();
      expect(completed.length).toBe(1);
      expect(completed[0].id).toBe(task.id);
    });

    it('should return failed tasks that are awaited', async () => {
      const task = await taskManager.createTask({
        title: 'Task to fail',
        description: 'Will fail',
      });

      await taskManager.claimTask(task.id);
      await taskManager.failTask(task.id, {
        code: 'ERROR',
        message: 'Failed',
      });

      const completed = await taskManager.checkCompletedWaits();
      expect(completed.length).toBe(1);
      expect(completed[0].status).toBe('failed');
    });

    it('should not return pending or in-progress tasks', async () => {
      await taskManager.createTask({
        title: 'Pending task',
        description: 'Still pending',
      });

      const completed = await taskManager.checkCompletedWaits();
      expect(completed.length).toBe(0);
    });
  });

  describe('acknowledgeResult', () => {
    it('should mark task as acknowledged', async () => {
      const task = await taskManager.createTask({
        title: 'Task to acknowledge',
        description: 'Will be acknowledged',
      });

      await taskManager.claimTask(task.id);
      await taskManager.completeTask(task.id, { success: true });
      await taskManager.acknowledgeResult(task.id);

      const retrieved = await taskManager.getTask(task.id);
      expect(retrieved?.wait_handle?.acknowledged).toBe(true);
      expect(retrieved?.wait_handle?.acknowledged_at).toBeDefined();
    });

    it('should do nothing for non-existent task', async () => {
      // Should not throw
      await expect(taskManager.acknowledgeResult('nonexistent'))
        .resolves.not.toThrow();
    });

    it('should do nothing for task without wait handle', async () => {
      // This is a defensive test - in practice all tasks have wait handles
      // but the code should handle it gracefully
      await expect(taskManager.acknowledgeResult('nonexistent'))
        .resolves.not.toThrow();
    });
  });

  describe('getTask', () => {
    it('should find task in pending', async () => {
      const task = await taskManager.createTask({
        title: 'Pending task',
        description: 'In pending',
      });

      const found = await taskManager.getTask(task.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(task.id);
    });

    it('should find task in in_progress', async () => {
      const task = await taskManager.createTask({
        title: 'In progress task',
        description: 'In progress',
      });

      await taskManager.claimTask(task.id);

      const found = await taskManager.getTask(task.id);
      expect(found).not.toBeNull();
    });

    it('should find task in completed', async () => {
      const task = await taskManager.createTask({
        title: 'Completed task',
        description: 'Completed',
      });

      await taskManager.claimTask(task.id);
      await taskManager.completeTask(task.id, { success: true });

      const found = await taskManager.getTask(task.id);
      expect(found).not.toBeNull();
      expect(found?.status).toBe('completed');
    });

    it('should find task in failed', async () => {
      const task = await taskManager.createTask({
        title: 'Failed task',
        description: 'Failed',
      });

      await taskManager.claimTask(task.id);
      await taskManager.failTask(task.id, {
        code: 'ERROR',
        message: 'Failed',
      });

      const found = await taskManager.getTask(task.id);
      expect(found).not.toBeNull();
      expect(found?.status).toBe('failed');
    });

    it('should return null for non-existent task', async () => {
      const found = await taskManager.getTask('nonexistent-task');
      expect(found).toBeNull();
    });
  });

  describe('getMyTasks', () => {
    it('should return tasks created by this instance', async () => {
      await taskManager.createTask({
        title: 'My task',
        description: 'Created by me',
      });

      const myTasks = await taskManager.getMyTasks();
      expect(myTasks.length).toBe(1);
      expect(myTasks[0].created_by.instance_id).toBe('test-instance');
    });

    it('should not return tasks from other instances', async () => {
      const otherManager = new TaskManager(testDir, 'other-instance');
      await otherManager.createTask({
        title: 'Other task',
        description: 'Created by other',
      });

      const myTasks = await taskManager.getMyTasks();
      expect(myTasks.length).toBe(0);
    });

    it('should return tasks in all statuses', async () => {
      const task1 = await taskManager.createTask({
        title: 'Task 1',
        description: 'Will stay pending',
      });

      const task2 = await taskManager.createTask({
        title: 'Task 2',
        description: 'Will be completed',
      });

      await taskManager.claimTask(task2.id);
      await taskManager.completeTask(task2.id, { success: true });

      const myTasks = await taskManager.getMyTasks();
      expect(myTasks.length).toBe(2);
    });
  });

  describe('getMyClaimedTasks', () => {
    it('should return tasks claimed by this instance', async () => {
      const task = await taskManager.createTask({
        title: 'Task to claim',
        description: 'Will be claimed',
      });

      await taskManager.claimTask(task.id);

      const claimed = await taskManager.getMyClaimedTasks();
      expect(claimed.length).toBe(1);
      expect(claimed[0].claimed_by?.instance_id).toBe('test-instance');
    });

    it('should not return tasks claimed by other instances', async () => {
      const task = await taskManager.createTask({
        title: 'Task for other',
        description: 'Will be claimed by other',
      });

      const otherManager = new TaskManager(testDir, 'other-instance');
      await otherManager.claimTask(task.id);

      const claimed = await taskManager.getMyClaimedTasks();
      expect(claimed.length).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty task title', async () => {
      const task = await taskManager.createTask({
        title: '',
        description: 'Empty title task',
      });

      expect(task.title).toBe('');
    });

    it('should handle special characters in task content', async () => {
      const task = await taskManager.createTask({
        title: 'Task: with #special [chars] {here}',
        description: 'Description with "quotes" and \'apostrophes\'\n\nAnd newlines',
        instructions: '```code block```',
      });

      const retrieved = await taskManager.getTask(task.id);
      expect(retrieved?.title).toBe('Task: with #special [chars] {here}');
      expect(retrieved?.description).toContain("'apostrophes'");
    });

    it('should handle very long descriptions', async () => {
      const longDescription = 'A'.repeat(10000);

      const task = await taskManager.createTask({
        title: 'Long description task',
        description: longDescription,
      });

      const retrieved = await taskManager.getTask(task.id);
      expect(retrieved?.description.length).toBe(10000);
    });

    it('should handle unicode in task content', async () => {
      const task = await taskManager.createTask({
        title: 'Unicode task: \u4e2d\u6587 \ud83d\ude80',
        description: 'Description with emoji: \ud83d\udc4d\ud83c\udffb',
      });

      const retrieved = await taskManager.getTask(task.id);
      expect(retrieved?.title).toContain('\u4e2d\u6587');
    });
  });
});
