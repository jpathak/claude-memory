/**
 * Claude Memory System
 *
 * A distributed memory and coordination system for Claude instances.
 */

export * from './types.js';
export { MemoryStore } from './store.js';
export { TaskManager } from './tasks.js';
export { InstanceManager } from './instances.js';

import { MemoryStore } from './store.js';
import { TaskManager } from './tasks.js';
import { InstanceManager } from './instances.js';
import {
  CreateMemoryInput,
  CreateTaskInput,
  Memory,
  Task,
  Instance,
  MemoryQuery,
  TaskResult,
  InboxMessage,
} from './types.js';

/**
 * Main Claude Memory API
 *
 * Provides a unified interface for memory storage, task delegation,
 * and instance coordination.
 */
export class ClaudeMemory {
  private store: MemoryStore;
  private tasks: TaskManager;
  private instances: InstanceManager;
  private initialized: boolean = false;

  constructor(
    baseDir: string = process.cwd(),
    options: {
      instanceId?: string;
      capabilities?: string[];
      tool?: string;
    } = {}
  ) {
    const instanceId = options.instanceId;
    this.store = new MemoryStore(baseDir, instanceId);
    this.tasks = new TaskManager(baseDir, this.store.getInstanceId());
    this.instances = new InstanceManager(
      baseDir,
      this.store.getInstanceId(),
      options.capabilities || ['coding'],
      options.tool || 'claude-code-cli'
    );
  }

  /**
   * Initialize the memory system
   */
  async init(): Promise<void> {
    await this.store.init();
    await this.instances.register();
    this.instances.startHeartbeat();
    this.initialized = true;
  }

  /**
   * Check if the memory system is initialized in this directory
   */
  async isInitialized(): Promise<boolean> {
    return this.store.isInitialized();
  }

  /**
   * Get the instance ID
   */
  getInstanceId(): string {
    return this.store.getInstanceId();
  }

  /**
   * Get the memory directory path
   */
  getMemoryDir(): string {
    return this.store.getMemoryDir();
  }

  // ============ Memory Operations ============

  /**
   * Store a new memory
   */
  async remember(input: CreateMemoryInput): Promise<Memory> {
    const memory = await this.store.createMemory(input);
    await this.instances.logActivity('stored_memory', `${input.type}: ${input.title}`);
    return memory;
  }

  /**
   * Recall a specific memory by ID
   */
  async recall(id: string): Promise<Memory | null> {
    return this.store.getMemory(id);
  }

  /**
   * Search memories
   */
  async search(query: MemoryQuery): Promise<Memory[]> {
    return this.store.queryMemories(query);
  }

  /**
   * Get recent memories
   */
  async getRecent(limit: number = 10): Promise<Memory[]> {
    return this.store.getRecentMemories(limit);
  }

  /**
   * Get high importance memories
   */
  async getImportant(minImportance: number = 0.7): Promise<Memory[]> {
    return this.store.getHighImportanceMemories(minImportance);
  }

  /**
   * Get memories related to specific files
   */
  async getForFiles(files: string[]): Promise<Memory[]> {
    return this.store.getMemoriesForFiles(files);
  }

  /**
   * Get timeline of memories
   */
  async getTimeline(limit?: number): Promise<Array<{ timestamp: string; memory_id?: string; type: string; summary: string; supersedes?: string[] }>> {
    return this.store.getTimeline(limit);
  }

  /**
   * Get context around a memory (for conflict resolution)
   */
  async getContext(memoryId: string, range: number = 5): Promise<Memory[]> {
    return this.store.getMemoryContext(memoryId, range);
  }

  // ============ Task Operations ============

  /**
   * Delegate a task to another instance
   */
  async delegate(input: CreateTaskInput): Promise<Task> {
    const task = await this.tasks.createTask(input);
    await this.instances.waitForTask(task.id);
    await this.instances.logActivity('delegated_task', input.title);
    return task;
  }

  /**
   * Get tasks available for this instance to claim
   */
  async getAvailableTasks(): Promise<Task[]> {
    const config = await this.store.loadConfig();
    return this.tasks.getClaimableTasks(config.instance.capabilities);
  }

  /**
   * Claim a pending task
   */
  async claimTask(taskId: string): Promise<Task | null> {
    const task = await this.tasks.claimTask(taskId);
    if (task) {
      await this.instances.logActivity('claimed_task', task.title);
    }
    return task;
  }

  /**
   * Start working on a claimed task
   */
  async startTask(taskId: string): Promise<Task | null> {
    const task = await this.tasks.startTask(taskId);
    if (task) {
      await this.instances.updateStatus('active', task.title);
    }
    return task;
  }

  /**
   * Update task progress
   */
  async updateTaskProgress(taskId: string, message: string): Promise<void> {
    await this.tasks.updateProgress(taskId, message);
  }

  /**
   * Complete a task with results
   */
  async completeTask(taskId: string, result: TaskResult): Promise<Task | null> {
    const task = await this.tasks.completeTask(taskId, result);
    if (task) {
      await this.instances.logActivity('completed_task', task.title);
    }
    return task;
  }

  /**
   * Fail a task with error
   */
  async failTask(taskId: string, error: { code: string; message: string; details?: string }): Promise<Task | null> {
    const task = await this.tasks.failTask(taskId, error);
    if (task) {
      await this.instances.logActivity('failed_task', `${task.title}: ${error.message}`);
    }
    return task;
  }

  /**
   * Check if any delegated tasks have completed
   */
  async checkDelegatedTasks(): Promise<Task[]> {
    return this.tasks.checkCompletedWaits();
  }

  /**
   * Acknowledge and process a completed task result
   */
  async acknowledgeTask(taskId: string): Promise<void> {
    await this.tasks.acknowledgeResult(taskId);
    await this.instances.clearWait(taskId);
  }

  /**
   * Get a specific task
   */
  async getTask(taskId: string): Promise<Task | null> {
    return this.tasks.getTask(taskId);
  }

  // ============ Instance Operations ============

  /**
   * Update this instance's status
   */
  async setStatus(status: 'active' | 'idle' | 'waiting' | 'offline', workingOn?: string): Promise<void> {
    await this.instances.updateStatus(status, workingOn);
  }

  /**
   * Get active instances
   */
  async getActiveInstances(): Promise<Instance[]> {
    return this.instances.getActiveInstances();
  }

  /**
   * Get instances with specific capabilities
   */
  async findInstances(capabilities: string[]): Promise<Instance[]> {
    return this.instances.getInstancesWithCapabilities(capabilities);
  }

  /**
   * Send a message to another instance
   */
  async sendMessage(
    to: string,
    type: 'info' | 'warning' | 'request' | 'response',
    message: string,
    subject?: string
  ): Promise<InboxMessage> {
    return this.instances.sendMessage(to, type, message, subject);
  }

  /**
   * Get unread messages
   */
  async getMessages(): Promise<InboxMessage[]> {
    return this.instances.getUnreadMessages();
  }

  /**
   * Mark a message as read
   */
  async markRead(messageId: string): Promise<void> {
    await this.instances.markMessageRead(messageId);
  }

  /**
   * Get recent activity log
   */
  async getActivity(limit: number = 20): Promise<Array<{ timestamp: string; instance_id: string; action: string; details?: string }>> {
    return this.instances.getRecentActivity(limit);
  }

  /**
   * Record a file touch
   */
  async touchFile(filePath: string): Promise<void> {
    await this.instances.touchFile(filePath);
  }

  // ============ Lifecycle ============

  /**
   * Gracefully shutdown
   */
  async shutdown(): Promise<void> {
    await this.instances.goOffline();
    this.initialized = false;
  }

  /**
   * Recover a previous session
   */
  async recoverSession(previousInstanceId: string): Promise<{
    pendingWaits: string[];
    unreadMessages: InboxMessage[];
  } | null> {
    return this.instances.recoverSession(previousInstanceId);
  }
}

// Default export for convenience
export default ClaudeMemory;
