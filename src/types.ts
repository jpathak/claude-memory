/**
 * Claude Memory System - Type Definitions
 */

// Memory types that can be stored
export type MemoryType =
  | 'decision'    // A choice made between alternatives
  | 'event'       // Something significant that happened
  | 'fact'        // Discovered truth about codebase/domain
  | 'preference'  // User or project preference
  | 'context'     // Background information
  | 'conclusion'; // Result of investigation/analysis

// Status of a memory entry
export type MemoryStatus = 'active' | 'superseded' | 'archived';

// Links between memories
export interface MemoryLinks {
  supersedes?: string[];      // Memories this replaces/updates
  superseded_by?: string;     // Memory that replaced this one
  derived_from?: string[];    // Memories that led to this conclusion
  related_to?: string[];      // Loosely related memories
}

// Context about when/why memory was created
export interface MemoryContext {
  conversation_id?: string;
  triggered_by?: string;
  related_files?: string[];
  working_directory?: string;
}

// A single memory entry
export interface Memory {
  id: string;
  type: MemoryType;
  status: MemoryStatus;
  timestamp: string;          // ISO 8601
  instance_id: string;        // Which Claude instance created this

  // Core content
  title: string;
  summary: string;
  details?: string;

  // Contextual linking
  context?: MemoryContext;
  links?: MemoryLinks;

  // Metadata for retrieval
  tags: string[];
  importance: number;         // 0-1 scale
  confidence: number;         // 0-1 scale

  // Lifecycle
  expires_at?: string;        // Optional TTL
  last_accessed?: string;
  access_count: number;
}

// Task status for delegation
export type TaskStatus =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

// Task priority levels
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

// Status history entry
export interface StatusHistoryEntry {
  status: TaskStatus;
  timestamp: string;
  by: string;               // Instance ID
  message?: string;
}

// Task result when completed
export interface TaskResult {
  success: boolean;
  output?: {
    type: string;
    data: unknown;
  };
  error?: {
    code: string;
    message: string;
    details?: string;
  };
  artifacts?: Array<{
    path: string;
    description: string;
  }>;
  generated_memories?: string[];  // Memory IDs created from this task
}

// Wait handle for async task tracking
export interface WaitHandle {
  requester: string;          // Instance ID
  callback_type: 'poll' | 'inbox_notify';
  timeout_at?: string;
  acknowledged: boolean;
  acknowledged_at?: string;
}

// A delegated task
export interface Task {
  id: string;
  created_at: string;
  created_by: {
    instance_id: string;
    machine?: string;
    session_id?: string;
  };

  // Task definition
  type: 'request' | 'response' | 'notification';
  priority: TaskPriority;
  title: string;
  description: string;
  instructions?: string;

  // Expected output
  expected_output?: {
    type: string;
    format: string;
  };

  // Targeting
  target: {
    capabilities?: string[];    // Required capabilities
    specific_instance?: string; // Or specific instance ID
  };

  // State machine
  status: TaskStatus;
  status_history: StatusHistoryEntry[];

  // Claim info (when claimed)
  claimed_by?: {
    instance_id: string;
    machine?: string;
    claimed_at: string;
  };

  // Progress tracking
  progress_updates?: Array<{
    timestamp: string;
    message: string;
  }>;

  // Completion
  completed_at?: string;
  result?: TaskResult;

  // Wait handle for requester
  wait_handle?: WaitHandle;

  // Context
  related_memories?: string[];
  related_tasks?: string[];
  files_involved?: string[];
}

// Instance status
export type InstanceStatus = 'active' | 'idle' | 'waiting' | 'offline';

// An active Claude instance
export interface Instance {
  instance_id: string;
  machine?: string;
  capabilities: string[];
  first_seen: string;
  last_activity: string;
  current_status: InstanceStatus;
  working_on?: string;
  waiting_for?: Array<{
    task_id: string;
    since: string;
  }>;
  files_touched?: string[];
  session_info?: {
    session_id: string;
    tool: string;             // claude-code-cli, chrome-extension, etc.
    started: string;
  };
}

// Activity log entry
export interface ActivityEntry {
  timestamp: string;
  instance_id: string;
  action: string;
  details?: string;
}

// Instance registry
export interface InstanceRegistry {
  instances: Record<string, Instance>;
  heartbeat: {
    interval_seconds: number;
    stale_after_seconds: number;
    offline_after_seconds: number;
  };
  recent_activity: ActivityEntry[];
}

// Direct message between instances
export interface InboxMessage {
  id: string;
  from: string;
  to: string;
  timestamp: string;
  type: 'info' | 'warning' | 'request' | 'response';
  subject?: string;
  message: string;
  read: boolean;
  read_at?: string;
  related_task?: string;
  related_memory?: string;
}

// Index for fast lookups
export interface MemoryIndex {
  version: string;
  last_updated: string;

  by_type: Record<MemoryType, string[]>;
  by_tag: Record<string, string[]>;
  by_file: Record<string, string[]>;
  by_status: Record<MemoryStatus, string[]>;

  recent: string[];           // Last N memory IDs
  high_importance: string[];  // Importance > 0.7
}

// Timeline entry for chronological view
export interface TimelineEntry {
  timestamp: string;
  memory_id?: string;
  task_id?: string;
  type: MemoryType | 'task_created' | 'task_completed';
  summary: string;
  supersedes?: string[];
}

// Timeline structure
export interface Timeline {
  entries: TimelineEntry[];
  last_updated: string;
}

// System configuration
export interface MemoryConfig {
  version: string;
  instance_id: string;

  // Storage settings
  storage: {
    max_memories: number;
    max_tasks: number;
    prune_after_days: number;
    archive_instead_of_delete: boolean;
  };

  // Retrieval settings
  retrieval: {
    auto_load_recent: number;     // Load N recent memories on startup
    auto_load_high_importance: boolean;
    max_context_memories: number;
  };

  // Instance settings
  instance: {
    capabilities: string[];
    heartbeat_interval_seconds: number;
  };
}

// Input for creating a new memory
export interface CreateMemoryInput {
  type: MemoryType;
  title: string;
  summary: string;
  details?: string;
  tags?: string[];
  importance?: number;
  confidence?: number;
  context?: MemoryContext;
  links?: MemoryLinks;
  expires_at?: string;
}

// Input for creating a new task
export interface CreateTaskInput {
  title: string;
  description: string;
  instructions?: string;
  priority?: TaskPriority;
  target?: {
    capabilities?: string[];
    specific_instance?: string;
  };
  expected_output?: {
    type: string;
    format: string;
  };
  timeout_minutes?: number;
  related_memories?: string[];
  files_involved?: string[];
}

// Query options for searching memories
export interface MemoryQuery {
  types?: MemoryType[];
  tags?: string[];
  files?: string[];
  search?: string;            // Full-text search
  since?: string;             // Timestamp
  before?: string;            // Timestamp
  min_importance?: number;
  status?: MemoryStatus[];
  limit?: number;
  include_superseded?: boolean;
}
