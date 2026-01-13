/**
 * Claude Memory System - Instance Registry
 *
 * Tracks active Claude instances and enables coordination.
 *
 * All instance data is stored in .claude-memory-runtime/ (git ignored)
 * because it's ephemeral instance-specific data.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import * as YAML from 'yaml';
import {
  Instance,
  InstanceRegistry,
  InstanceStatus,
  ActivityEntry,
  InboxMessage,
  RUNTIME_DIR,
  INSTANCES_SUBDIR,
  INBOX_SUBDIR,
  ACTIVITY_FILE,
} from './types.js';

export class InstanceManager {
  private runtimeDir: string;   // .claude-memory-runtime/ (git ignored)
  private instanceId: string;
  private machine: string;
  private capabilities: string[];
  private tool: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(
    baseDir: string = process.cwd(),
    instanceId?: string,
    capabilities: string[] = ['coding'],
    tool: string = 'claude-code-cli'
  ) {
    this.runtimeDir = path.join(baseDir, RUNTIME_DIR);
    this.instanceId = instanceId || `instance_${uuidv4().slice(0, 8)}`;
    this.machine = os.hostname();
    this.capabilities = capabilities;
    this.tool = tool;
  }

  /**
   * Get the runtime directory path
   */
  getRuntimeDir(): string {
    return this.runtimeDir;
  }

  /**
   * Get this instance's ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Get this machine's hostname
   */
  getMachine(): string {
    return this.machine;
  }

  /**
   * Register this instance in the registry
   */
  async register(): Promise<Instance> {
    const registry = await this.loadRegistry();
    const now = new Date().toISOString();

    const instance: Instance = {
      instance_id: this.instanceId,
      machine: this.machine,
      capabilities: this.capabilities,
      first_seen: now,
      last_activity: now,
      current_status: 'active',
      session_info: {
        session_id: `session_${uuidv4().slice(0, 8)}`,
        tool: this.tool,
        started: now,
      },
    };

    registry.instances[this.instanceId] = instance;

    // Add activity entry
    registry.recent_activity.unshift({
      timestamp: now,
      instance_id: this.instanceId,
      action: 'registered',
      details: `Instance registered with capabilities: ${this.capabilities.join(', ')}`,
    });

    // Keep last 100 activity entries
    if (registry.recent_activity.length > 100) {
      registry.recent_activity = registry.recent_activity.slice(0, 100);
    }

    await this.saveRegistry(registry);
    return instance;
  }

  /**
   * Update this instance's status
   */
  async updateStatus(status: InstanceStatus, workingOn?: string): Promise<void> {
    const registry = await this.loadRegistry();
    const instance = registry.instances[this.instanceId];

    if (!instance) {
      await this.register();
      return this.updateStatus(status, workingOn);
    }

    instance.current_status = status;
    instance.last_activity = new Date().toISOString();
    if (workingOn !== undefined) {
      instance.working_on = workingOn;
    }

    await this.saveRegistry(registry);
  }

  /**
   * Record a heartbeat
   */
  async heartbeat(): Promise<void> {
    const registry = await this.loadRegistry();
    const instance = registry.instances[this.instanceId];

    if (instance) {
      instance.last_activity = new Date().toISOString();
      await this.saveRegistry(registry);
    }
  }

  /**
   * Start automatic heartbeat
   */
  startHeartbeat(intervalMs: number = 60000): void {
    this.stopHeartbeat();  // Clear any existing interval

    this.heartbeatInterval = setInterval(() => {
      this.heartbeat().catch(console.error);
    }, intervalMs);

    // Don't keep the process alive just for heartbeat
    this.heartbeatInterval.unref();
  }

  /**
   * Stop automatic heartbeat
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Mark this instance as offline
   */
  async goOffline(): Promise<void> {
    this.stopHeartbeat();
    await this.updateStatus('offline');

    const registry = await this.loadRegistry();
    registry.recent_activity.unshift({
      timestamp: new Date().toISOString(),
      instance_id: this.instanceId,
      action: 'went_offline',
    });
    await this.saveRegistry(registry);
  }

  /**
   * Add a file to the touched files list
   */
  async touchFile(filePath: string): Promise<void> {
    const registry = await this.loadRegistry();
    const instance = registry.instances[this.instanceId];

    if (instance) {
      instance.files_touched = instance.files_touched || [];
      if (!instance.files_touched.includes(filePath)) {
        instance.files_touched.push(filePath);
        // Keep last 20 files
        if (instance.files_touched.length > 20) {
          instance.files_touched = instance.files_touched.slice(-20);
        }
      }
      instance.last_activity = new Date().toISOString();
      await this.saveRegistry(registry);
    }
  }

  /**
   * Mark that this instance is waiting for a task
   */
  async waitForTask(taskId: string): Promise<void> {
    const registry = await this.loadRegistry();
    const instance = registry.instances[this.instanceId];

    if (instance) {
      instance.waiting_for = instance.waiting_for || [];
      instance.waiting_for.push({
        task_id: taskId,
        since: new Date().toISOString(),
      });
      instance.current_status = 'waiting';
      await this.saveRegistry(registry);
    }
  }

  /**
   * Clear a waited task
   */
  async clearWait(taskId: string): Promise<void> {
    const registry = await this.loadRegistry();
    const instance = registry.instances[this.instanceId];

    if (instance && instance.waiting_for) {
      instance.waiting_for = instance.waiting_for.filter(w => w.task_id !== taskId);
      if (instance.waiting_for.length === 0) {
        instance.current_status = 'active';
      }
      await this.saveRegistry(registry);
    }
  }

  /**
   * Get all active instances
   */
  async getActiveInstances(): Promise<Instance[]> {
    const registry = await this.loadRegistry();
    const now = Date.now();
    const staleThreshold = registry.heartbeat.stale_after_seconds * 1000;

    return Object.values(registry.instances).filter(instance => {
      const lastActivity = new Date(instance.last_activity).getTime();
      return (now - lastActivity) < staleThreshold;
    });
  }

  /**
   * Get instances with specific capabilities
   */
  async getInstancesWithCapabilities(requiredCapabilities: string[]): Promise<Instance[]> {
    const active = await this.getActiveInstances();
    return active.filter(instance =>
      requiredCapabilities.every(cap => instance.capabilities.includes(cap))
    );
  }

  /**
   * Log an activity
   */
  async logActivity(action: string, details?: string): Promise<void> {
    const registry = await this.loadRegistry();

    registry.recent_activity.unshift({
      timestamp: new Date().toISOString(),
      instance_id: this.instanceId,
      action,
      details,
    });

    // Keep last 100 entries
    if (registry.recent_activity.length > 100) {
      registry.recent_activity = registry.recent_activity.slice(0, 100);
    }

    await this.saveRegistry(registry);
  }

  /**
   * Get recent activity
   */
  async getRecentActivity(limit: number = 20): Promise<ActivityEntry[]> {
    const registry = await this.loadRegistry();
    return registry.recent_activity.slice(0, limit);
  }

  /**
   * Send a message to another instance
   */
  async sendMessage(
    to: string,
    type: 'info' | 'warning' | 'request' | 'response',
    message: string,
    subject?: string,
    relatedTask?: string,
    relatedMemory?: string
  ): Promise<InboxMessage> {
    const inboxDir = path.join(this.runtimeDir, INBOX_SUBDIR);
    const id = `msg_${uuidv4().slice(0, 12)}`;
    const now = new Date().toISOString();

    const msg: InboxMessage = {
      id,
      from: this.instanceId,
      to,
      timestamp: now,
      type,
      subject,
      message,
      read: false,
      related_task: relatedTask,
      related_memory: relatedMemory,
    };

    const filename = `${id}_to_${to}.yaml`;
    await fs.writeFile(path.join(inboxDir, filename), YAML.stringify(msg), 'utf-8');

    return msg;
  }

  /**
   * Get unread messages for this instance
   */
  async getUnreadMessages(): Promise<InboxMessage[]> {
    const inboxDir = path.join(this.runtimeDir, INBOX_SUBDIR);
    const messages: InboxMessage[] = [];

    try {
      const files = await fs.readdir(inboxDir);

      for (const file of files) {
        if (!file.includes(`_to_${this.instanceId}`) || !file.endsWith('.yaml')) {
          continue;
        }

        const content = await fs.readFile(path.join(inboxDir, file), 'utf-8');
        const msg = YAML.parse(content) as InboxMessage;

        if (!msg.read) {
          messages.push(msg);
        }
      }
    } catch {
      // Directory might not exist
    }

    return messages.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /**
   * Mark a message as read
   */
  async markMessageRead(messageId: string): Promise<void> {
    const inboxDir = path.join(this.runtimeDir, INBOX_SUBDIR);

    try {
      const files = await fs.readdir(inboxDir);
      const file = files.find(f => f.startsWith(messageId));

      if (file) {
        const filePath = path.join(inboxDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const msg = YAML.parse(content) as InboxMessage;

        msg.read = true;
        msg.read_at = new Date().toISOString();

        await fs.writeFile(filePath, YAML.stringify(msg), 'utf-8');
      }
    } catch {
      // File might not exist
    }
  }

  /**
   * Clean up old messages
   */
  async cleanupOldMessages(maxAgeDays: number = 7): Promise<number> {
    const inboxDir = path.join(this.runtimeDir, INBOX_SUBDIR);
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    try {
      const files = await fs.readdir(inboxDir);

      for (const file of files) {
        if (!file.endsWith('.yaml')) continue;

        const filePath = path.join(inboxDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const msg = YAML.parse(content) as InboxMessage;

        if (new Date(msg.timestamp).getTime() < cutoff && msg.read) {
          await fs.unlink(filePath);
          cleaned++;
        }
      }
    } catch {
      // Directory might not exist
    }

    return cleaned;
  }

  /**
   * Recover previous session state
   */
  async recoverSession(previousInstanceId: string): Promise<{
    pendingWaits: string[];
    unreadMessages: InboxMessage[];
  } | null> {
    const registry = await this.loadRegistry();
    const previousInstance = registry.instances[previousInstanceId];

    if (!previousInstance) {
      return null;
    }

    // Get pending waits from previous session
    const pendingWaits = previousInstance.waiting_for?.map(w => w.task_id) || [];

    // Get unread messages for previous instance
    const inboxDir = path.join(this.runtimeDir, INBOX_SUBDIR);
    const unreadMessages: InboxMessage[] = [];

    try {
      const files = await fs.readdir(inboxDir);

      for (const file of files) {
        if (!file.includes(`_to_${previousInstanceId}`) || !file.endsWith('.yaml')) {
          continue;
        }

        const content = await fs.readFile(path.join(inboxDir, file), 'utf-8');
        const msg = YAML.parse(content) as InboxMessage;

        if (!msg.read) {
          unreadMessages.push(msg);
        }
      }
    } catch {
      // Directory might not exist
    }

    // Merge previous instance state into current
    this.instanceId = previousInstanceId;
    await this.register(); // Re-register with same ID

    return {
      pendingWaits,
      unreadMessages,
    };
  }

  // Private helper methods

  private async loadRegistry(): Promise<InstanceRegistry> {
    const registryPath = path.join(this.runtimeDir, INSTANCES_SUBDIR, ACTIVITY_FILE);

    try {
      const content = await fs.readFile(registryPath, 'utf-8');
      const parsed = YAML.parse(content) as InstanceRegistry | null;
      // Handle empty or invalid YAML (returns null)
      if (!parsed || typeof parsed !== 'object') {
        return this.createEmptyRegistry();
      }
      // Ensure required fields exist
      return {
        ...this.createEmptyRegistry(),
        ...parsed,
        instances: parsed.instances || {},
        recent_activity: parsed.recent_activity || [],
      };
    } catch {
      return this.createEmptyRegistry();
    }
  }

  private async saveRegistry(registry: InstanceRegistry): Promise<void> {
    const instancesDir = path.join(this.runtimeDir, INSTANCES_SUBDIR);
    await fs.mkdir(instancesDir, { recursive: true });

    const registryPath = path.join(instancesDir, ACTIVITY_FILE);
    await fs.writeFile(registryPath, YAML.stringify(registry), 'utf-8');
  }

  private createEmptyRegistry(): InstanceRegistry {
    return {
      instances: {},
      heartbeat: {
        interval_seconds: 60,
        stale_after_seconds: 300,
        offline_after_seconds: 900,
      },
      recent_activity: [],
    };
  }
}
