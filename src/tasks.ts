/**
 * Claude Memory System - Task Delegation
 *
 * Handles task creation, claiming, completion, and async waiting.
 *
 * Task directories are split:
 * - .claude-memory/completed/ (version controlled) - completed tasks with results
 * - .claude-memory-runtime/tasks/pending/ (git ignored) - pending tasks
 * - .claude-memory-runtime/tasks/in_progress/ (git ignored) - in-progress tasks
 * - .claude-memory-runtime/failed/ (git ignored) - failed tasks
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as YAML from 'yaml';
import {
  Task,
  TaskStatus,
  CreateTaskInput,
  TaskResult,
  StatusHistoryEntry,
  MEMORY_DIR,
  RUNTIME_DIR,
  COMPLETED_SUBDIR,
  TASKS_SUBDIR,
  PENDING_SUBDIR,
  IN_PROGRESS_SUBDIR,
  FAILED_SUBDIR,
} from './types.js';

export class TaskManager {
  private memoryDir: string;    // .claude-memory/ (VCS)
  private runtimeDir: string;   // .claude-memory-runtime/ (git ignored)
  private instanceId: string;
  private machine: string;

  constructor(baseDir: string = process.cwd(), instanceId: string, machine?: string) {
    this.memoryDir = path.join(baseDir, MEMORY_DIR);
    this.runtimeDir = path.join(baseDir, RUNTIME_DIR);
    this.instanceId = instanceId;
    this.machine = machine || 'unknown';
  }

  /**
   * Get the directory path for a task status
   */
  private getStatusDir(status: 'pending' | 'in_progress' | 'completed' | 'failed'): string {
    switch (status) {
      case 'pending':
        return path.join(this.runtimeDir, TASKS_SUBDIR, PENDING_SUBDIR);
      case 'in_progress':
        return path.join(this.runtimeDir, TASKS_SUBDIR, IN_PROGRESS_SUBDIR);
      case 'completed':
        return path.join(this.memoryDir, COMPLETED_SUBDIR);
      case 'failed':
        return path.join(this.runtimeDir, FAILED_SUBDIR);
    }
  }

  /**
   * Create a new task for delegation
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    const id = `task_${uuidv4().slice(0, 12)}`;
    const now = new Date().toISOString();

    const task: Task = {
      id,
      created_at: now,
      created_by: {
        instance_id: this.instanceId,
        machine: this.machine,
      },
      type: 'request',
      priority: input.priority || 'normal',
      title: input.title,
      description: input.description,
      instructions: input.instructions,
      expected_output: input.expected_output,
      target: input.target || { capabilities: [] },
      status: 'pending',
      status_history: [
        {
          status: 'pending',
          timestamp: now,
          by: this.instanceId,
        },
      ],
      wait_handle: {
        requester: this.instanceId,
        callback_type: 'poll',
        timeout_at: input.timeout_minutes
          ? new Date(Date.now() + input.timeout_minutes * 60 * 1000).toISOString()
          : undefined,
        acknowledged: false,
      },
      related_memories: input.related_memories,
      files_involved: input.files_involved,
    };

    await this.saveTask(task, 'pending');
    return task;
  }

  /**
   * Get all pending tasks
   */
  async getPendingTasks(): Promise<Task[]> {
    return this.getTasksInStatus('pending');
  }

  /**
   * Get pending tasks that match this instance's capabilities
   */
  async getClaimableTasks(capabilities: string[]): Promise<Task[]> {
    const pending = await this.getPendingTasks();

    return pending.filter(task => {
      // If no specific target, anyone can claim
      if (!task.target.capabilities || task.target.capabilities.length === 0) {
        return true;
      }

      // If targeting specific instance, check if it's us
      if (task.target.specific_instance) {
        return task.target.specific_instance === this.instanceId;
      }

      // Check if we have required capabilities
      return task.target.capabilities.every(cap => capabilities.includes(cap));
    });
  }

  /**
   * Claim a pending task
   */
  async claimTask(taskId: string): Promise<Task | null> {
    const task = await this.findTask(taskId);
    if (!task) return null;

    if (task.status !== 'pending') {
      throw new Error(`Task ${taskId} is not pending (status: ${task.status})`);
    }

    const now = new Date().toISOString();

    task.status = 'claimed';
    task.status_history.push({
      status: 'claimed',
      timestamp: now,
      by: this.instanceId,
    });
    task.claimed_by = {
      instance_id: this.instanceId,
      machine: this.machine,
      claimed_at: now,
    };

    // Move from pending to in_progress
    await this.deleteTask(taskId, 'pending');
    await this.saveTask(task, 'in_progress');

    return task;
  }

  /**
   * Start working on a claimed task
   */
  async startTask(taskId: string): Promise<Task | null> {
    const task = await this.findTask(taskId);
    if (!task) return null;

    if (task.status !== 'claimed') {
      throw new Error(`Task ${taskId} is not claimed (status: ${task.status})`);
    }

    const now = new Date().toISOString();

    task.status = 'in_progress';
    task.status_history.push({
      status: 'in_progress',
      timestamp: now,
      by: this.instanceId,
    });
    task.progress_updates = [];

    await this.saveTask(task, 'in_progress');
    return task;
  }

  /**
   * Update task progress
   */
  async updateProgress(taskId: string, message: string): Promise<void> {
    const task = await this.findTask(taskId);
    if (!task) return;

    if (task.status !== 'in_progress') {
      throw new Error(`Task ${taskId} is not in progress`);
    }

    task.progress_updates = task.progress_updates || [];
    task.progress_updates.push({
      timestamp: new Date().toISOString(),
      message,
    });

    await this.saveTask(task, 'in_progress');
  }

  /**
   * Complete a task with results
   */
  async completeTask(taskId: string, result: TaskResult): Promise<Task | null> {
    const task = await this.findTask(taskId);
    if (!task) return null;

    if (task.status !== 'in_progress' && task.status !== 'claimed') {
      throw new Error(`Task ${taskId} cannot be completed (status: ${task.status})`);
    }

    const now = new Date().toISOString();

    task.status = 'completed';
    task.status_history.push({
      status: 'completed',
      timestamp: now,
      by: this.instanceId,
    });
    task.completed_at = now;
    task.result = result;

    // Move to completed
    await this.deleteTask(taskId, 'in_progress');
    await this.saveTask(task, 'completed');

    return task;
  }

  /**
   * Fail a task with error
   */
  async failTask(taskId: string, error: { code: string; message: string; details?: string }): Promise<Task | null> {
    const task = await this.findTask(taskId);
    if (!task) return null;

    const now = new Date().toISOString();

    task.status = 'failed';
    task.status_history.push({
      status: 'failed',
      timestamp: now,
      by: this.instanceId,
      message: error.message,
    });
    task.completed_at = now;
    task.result = {
      success: false,
      error,
    };

    // Move to failed
    const currentStatus = task.status_history[task.status_history.length - 2]?.status;
    if (currentStatus === 'in_progress' || currentStatus === 'claimed') {
      await this.deleteTask(taskId, 'in_progress');
    }
    await this.saveTask(task, 'failed');

    return task;
  }

  /**
   * Get tasks this instance is waiting for
   */
  async getWaitingTasks(): Promise<Task[]> {
    const allTasks: Task[] = [];

    for (const status of ['pending', 'in_progress', 'completed', 'failed'] as const) {
      const tasks = await this.getTasksInStatus(status);
      allTasks.push(...tasks);
    }

    return allTasks.filter(task =>
      task.wait_handle?.requester === this.instanceId &&
      !task.wait_handle.acknowledged
    );
  }

  /**
   * Check if any waited tasks have completed
   */
  async checkCompletedWaits(): Promise<Task[]> {
    const waiting = await this.getWaitingTasks();
    return waiting.filter(task =>
      task.status === 'completed' || task.status === 'failed'
    );
  }

  /**
   * Acknowledge a completed task result
   */
  async acknowledgeResult(taskId: string): Promise<void> {
    const task = await this.findTask(taskId);
    if (!task) return;

    if (!task.wait_handle) return;

    task.wait_handle.acknowledged = true;
    task.wait_handle.acknowledged_at = new Date().toISOString();

    await this.saveTask(task, task.status as 'completed' | 'failed');
  }

  /**
   * Get a specific task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    return this.findTask(taskId);
  }

  /**
   * Get tasks created by this instance
   */
  async getMyTasks(): Promise<Task[]> {
    const allTasks: Task[] = [];

    for (const status of ['pending', 'in_progress', 'completed', 'failed'] as const) {
      const tasks = await this.getTasksInStatus(status);
      allTasks.push(...tasks);
    }

    return allTasks.filter(task =>
      task.created_by.instance_id === this.instanceId
    );
  }

  /**
   * Get tasks claimed by this instance
   */
  async getMyClaimedTasks(): Promise<Task[]> {
    const inProgress = await this.getTasksInStatus('in_progress');
    return inProgress.filter(task =>
      task.claimed_by?.instance_id === this.instanceId
    );
  }

  // Private helper methods

  private async getTasksInStatus(status: 'pending' | 'in_progress' | 'completed' | 'failed'): Promise<Task[]> {
    const statusDir = this.getStatusDir(status);
    try {
      const files = await fs.readdir(statusDir);
      const tasks: Task[] = [];

      for (const file of files) {
        if (!file.endsWith('.yaml')) continue;
        const content = await fs.readFile(path.join(statusDir, file), 'utf-8');
        tasks.push(YAML.parse(content) as Task);
      }

      return tasks;
    } catch {
      return [];
    }
  }

  private async findTask(taskId: string): Promise<Task | null> {
    for (const status of ['pending', 'in_progress', 'completed', 'failed'] as const) {
      const statusDir = this.getStatusDir(status);
      const taskPath = path.join(statusDir, `${taskId}.yaml`);

      try {
        const content = await fs.readFile(taskPath, 'utf-8');
        return YAML.parse(content) as Task;
      } catch {
        // Not in this directory, continue
      }
    }

    return null;
  }

  private async saveTask(task: Task, status: 'pending' | 'in_progress' | 'completed' | 'failed'): Promise<void> {
    const statusDir = this.getStatusDir(status);
    await fs.mkdir(statusDir, { recursive: true });
    const taskPath = path.join(statusDir, `${task.id}.yaml`);
    await fs.writeFile(taskPath, YAML.stringify(task), 'utf-8');
  }

  private async deleteTask(taskId: string, status: 'pending' | 'in_progress' | 'completed' | 'failed'): Promise<void> {
    const statusDir = this.getStatusDir(status);
    const taskPath = path.join(statusDir, `${taskId}.yaml`);
    try {
      await fs.unlink(taskPath);
    } catch {
      // File might not exist
    }
  }
}
