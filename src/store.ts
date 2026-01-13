/**
 * Claude Memory System - Storage Layer
 *
 * Handles reading/writing memories to the filesystem.
 *
 * Directory structure:
 * - .claude-memory/ (version controlled) - memories, completed tasks, archive
 * - .claude-memory-runtime/ (git ignored) - instances, inbox, pending/in-progress tasks
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as YAML from 'yaml';
import {
  Memory,
  MemoryType,
  MemoryIndex,
  Timeline,
  TimelineEntry,
  MemoryConfig,
  CreateMemoryInput,
  MemoryQuery,
  MemoryStatus,
  MEMORY_DIR,
  RUNTIME_DIR,
  MEMORIES_SUBDIR,
  COMPLETED_SUBDIR,
  ARCHIVE_SUBDIR,
  INDEX_FILE,
  TIMELINE_FILE,
  CONFIG_FILE,
} from './types.js';

export class MemoryStore {
  private baseDir: string;      // .claude-memory/ (version controlled)
  private runtimeDir: string;   // .claude-memory-runtime/ (git ignored)
  private instanceId: string;
  private index: MemoryIndex | null = null;
  private timeline: Timeline | null = null;
  private config: MemoryConfig | null = null;

  constructor(baseDir: string = process.cwd(), instanceId?: string) {
    this.baseDir = path.join(baseDir, MEMORY_DIR);
    this.runtimeDir = path.join(baseDir, RUNTIME_DIR);
    this.instanceId = instanceId || `instance_${uuidv4().slice(0, 8)}`;
  }

  /**
   * Get the runtime directory path (git ignored)
   */
  getRuntimeDir(): string {
    return this.runtimeDir;
  }

  /**
   * Get the memory directory path
   */
  getMemoryDir(): string {
    return this.baseDir;
  }

  /**
   * Get the instance ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Initialize the memory system in the current directory.
   *
   * Creates two directory structures:
   * - .claude-memory/ (version controlled) - memories, completed tasks, config
   * - .claude-memory-runtime/ (git ignored) - instances, inbox, pending tasks
   */
  async init(): Promise<void> {
    // Create version-controlled directories (.claude-memory/)
    await fs.mkdir(path.join(this.baseDir, MEMORIES_SUBDIR), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, COMPLETED_SUBDIR), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, ARCHIVE_SUBDIR), { recursive: true });

    // Create runtime directories (.claude-memory-runtime/) - git ignored
    await fs.mkdir(path.join(this.runtimeDir, 'instances'), { recursive: true });
    await fs.mkdir(path.join(this.runtimeDir, 'inbox'), { recursive: true });
    await fs.mkdir(path.join(this.runtimeDir, 'tasks', 'pending'), { recursive: true });
    await fs.mkdir(path.join(this.runtimeDir, 'tasks', 'in_progress'), { recursive: true });
    await fs.mkdir(path.join(this.runtimeDir, 'failed'), { recursive: true });
    await fs.mkdir(path.join(this.runtimeDir, 'artifacts'), { recursive: true });

    // Initialize index if it doesn't exist
    if (!await this.fileExists(path.join(this.baseDir, INDEX_FILE))) {
      await this.saveIndex(this.createEmptyIndex());
    }

    // Initialize timeline if it doesn't exist
    if (!await this.fileExists(path.join(this.baseDir, TIMELINE_FILE))) {
      await this.saveTimeline({ entries: [], last_updated: new Date().toISOString() });
    }

    // Initialize config if it doesn't exist
    if (!await this.fileExists(path.join(this.baseDir, CONFIG_FILE))) {
      await this.saveConfig(this.createDefaultConfig());
    }

    // Create README in version-controlled directory
    await this.createReadme();

    // Create .gitignore in parent directory if it doesn't exist
    await this.ensureGitignore();
  }

  /**
   * Ensure .claude-memory-runtime/ is in .gitignore
   */
  private async ensureGitignore(): Promise<void> {
    const parentDir = path.dirname(this.baseDir);
    const gitignorePath = path.join(parentDir, '.gitignore');
    const runtimeEntry = RUNTIME_DIR + '/';

    try {
      let content = '';
      if (await this.fileExists(gitignorePath)) {
        content = await fs.readFile(gitignorePath, 'utf-8');
        if (content.includes(runtimeEntry)) {
          return; // Already in .gitignore
        }
      }

      // Append runtime directory to .gitignore
      const newContent = content.trim() + '\n\n# Claude Memory runtime data (instance-specific)\n' + runtimeEntry + '\n';
      await fs.writeFile(gitignorePath, newContent, 'utf-8');
    } catch {
      // Ignore errors - .gitignore might not be writable
    }
  }

  /**
   * Check if the memory system is initialized
   */
  async isInitialized(): Promise<boolean> {
    return await this.fileExists(this.baseDir);
  }

  /**
   * Create a new memory
   */
  async createMemory(input: CreateMemoryInput): Promise<Memory> {
    const id = uuidv4().slice(0, 12);
    const timestamp = new Date().toISOString();
    const filename = this.generateFilename(timestamp, input.type, id);

    const memory: Memory = {
      id,
      type: input.type,
      status: 'active',
      timestamp,
      instance_id: this.instanceId,
      title: input.title,
      summary: input.summary,
      details: input.details,
      context: input.context,
      links: input.links,
      tags: input.tags || [],
      importance: Math.max(0, Math.min(1, input.importance ?? 0.5)),
      confidence: Math.max(0, Math.min(1, input.confidence ?? 0.8)),
      expires_at: input.expires_at,
      last_accessed: timestamp,
      access_count: 0,
    };

    // Save memory file
    const memoryPath = path.join(this.baseDir, MEMORIES_SUBDIR, filename);
    await fs.writeFile(memoryPath, YAML.stringify(memory), 'utf-8');

    // Update index
    await this.addToIndex(memory);

    // Update timeline
    await this.addToTimeline({
      timestamp,
      memory_id: id,
      type: input.type,
      summary: input.title,
      supersedes: input.links?.supersedes,
    });

    // Handle supersedes links
    if (input.links?.supersedes) {
      for (const supersededId of input.links.supersedes) {
        await this.markSuperseded(supersededId, id);
      }
    }

    return memory;
  }

  /**
   * Get a memory by ID
   */
  async getMemory(id: string): Promise<Memory | null> {
    const index = await this.loadIndex();
    const filename = await this.findMemoryFile(id);

    if (!filename) {
      return null;
    }

    const memoryPath = path.join(this.baseDir, MEMORIES_SUBDIR, filename);
    const content = await fs.readFile(memoryPath, 'utf-8');
    const memory = YAML.parse(content) as Memory;

    // Update access stats
    memory.last_accessed = new Date().toISOString();
    memory.access_count++;
    await fs.writeFile(memoryPath, YAML.stringify(memory), 'utf-8');

    return memory;
  }

  /**
   * Query memories
   */
  async queryMemories(query: MemoryQuery): Promise<Memory[]> {
    const index = await this.loadIndex();
    let candidateIds = new Set<string>();

    // Start with all memories or filter by type
    if (query.types && query.types.length > 0) {
      for (const type of query.types) {
        const ids = index.by_type[type] || [];
        ids.forEach(id => candidateIds.add(id));
      }
    } else {
      // All memories
      Object.values(index.by_type).flat().forEach(id => candidateIds.add(id));
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      const tagMatches = new Set<string>();
      for (const tag of query.tags) {
        const ids = index.by_tag[tag] || [];
        ids.forEach(id => tagMatches.add(id));
      }
      candidateIds = new Set([...candidateIds].filter(id => tagMatches.has(id)));
    }

    // Filter by files
    if (query.files && query.files.length > 0) {
      const fileMatches = new Set<string>();
      for (const file of query.files) {
        const ids = index.by_file[file] || [];
        ids.forEach(id => fileMatches.add(id));
      }
      candidateIds = new Set([...candidateIds].filter(id => fileMatches.has(id)));
    }

    // Filter by status
    if (query.status && query.status.length > 0) {
      const statusMatches = new Set<string>();
      for (const status of query.status) {
        const ids = index.by_status[status] || [];
        ids.forEach(id => statusMatches.add(id));
      }
      candidateIds = new Set([...candidateIds].filter(id => statusMatches.has(id)));
    } else if (!query.include_superseded) {
      // By default, exclude superseded memories
      const activeIds = new Set(index.by_status['active'] || []);
      candidateIds = new Set([...candidateIds].filter(id => activeIds.has(id)));
    }

    // Load and filter memories
    const memories: Memory[] = [];
    for (const id of candidateIds) {
      const memory = await this.getMemory(id);
      if (!memory) continue;

      // Filter by timestamp
      if (query.since && memory.timestamp < query.since) continue;
      if (query.before && memory.timestamp > query.before) continue;

      // Filter by importance
      if (query.min_importance && memory.importance < query.min_importance) continue;

      // Full-text search
      if (query.search) {
        const searchLower = query.search.toLowerCase();
        const matchesTitle = memory.title.toLowerCase().includes(searchLower);
        const matchesSummary = memory.summary.toLowerCase().includes(searchLower);
        const matchesDetails = memory.details?.toLowerCase().includes(searchLower);
        const matchesTags = memory.tags.some(t => t.toLowerCase().includes(searchLower));
        if (!matchesTitle && !matchesSummary && !matchesDetails && !matchesTags) continue;
      }

      memories.push(memory);
    }

    // Sort by timestamp (newest first)
    memories.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Apply limit
    if (query.limit) {
      return memories.slice(0, query.limit);
    }

    return memories;
  }

  /**
   * Get recent memories
   */
  async getRecentMemories(limit: number = 10): Promise<Memory[]> {
    return this.queryMemories({ limit, status: ['active'] });
  }

  /**
   * Get high importance memories
   */
  async getHighImportanceMemories(minImportance: number = 0.7): Promise<Memory[]> {
    return this.queryMemories({ min_importance: minImportance, status: ['active'] });
  }

  /**
   * Get memories related to specific files
   */
  async getMemoriesForFiles(files: string[]): Promise<Memory[]> {
    return this.queryMemories({ files, status: ['active'] });
  }

  /**
   * Mark a memory as superseded
   */
  async markSuperseded(memoryId: string, supersededBy: string): Promise<void> {
    const filename = await this.findMemoryFile(memoryId);
    if (!filename) return;

    const memoryPath = path.join(this.baseDir, MEMORIES_SUBDIR, filename);
    const content = await fs.readFile(memoryPath, 'utf-8');
    const memory = YAML.parse(content) as Memory;

    memory.status = 'superseded';
    memory.links = memory.links || {};
    memory.links.superseded_by = supersededBy;

    await fs.writeFile(memoryPath, YAML.stringify(memory), 'utf-8');

    // Update index - only move between status arrays, keep in by_type for include_superseded queries
    const index = await this.loadIndex();
    // Remove from all status arrays (including 'active')
    for (const status of Object.keys(index.by_status) as MemoryStatus[]) {
      index.by_status[status] = index.by_status[status].filter(id => id !== memoryId);
    }
    // Add to superseded status
    index.by_status['superseded'] = index.by_status['superseded'] || [];
    index.by_status['superseded'].push(memoryId);
    // Remove from recent and high_importance
    index.recent = index.recent.filter(id => id !== memoryId);
    index.high_importance = index.high_importance.filter(id => id !== memoryId);
    await this.saveIndex(index);
  }

  /**
   * Get the timeline
   */
  async getTimeline(limit?: number): Promise<TimelineEntry[]> {
    const timeline = await this.loadTimeline();
    const entries = timeline.entries.sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
    return limit ? entries.slice(0, limit) : entries;
  }

  /**
   * Get context around a specific memory (for conflict resolution)
   */
  async getMemoryContext(memoryId: string, range: number = 5): Promise<Memory[]> {
    const timeline = await this.loadTimeline();
    const memory = await this.getMemory(memoryId);

    if (!memory) return [];

    // Find nearby entries in timeline
    const memoryIndex = timeline.entries.findIndex(e => e.memory_id === memoryId);
    if (memoryIndex === -1) return [memory];

    const start = Math.max(0, memoryIndex - range);
    const end = Math.min(timeline.entries.length, memoryIndex + range + 1);
    const nearbyEntries = timeline.entries.slice(start, end);

    const memories: Memory[] = [];
    for (const entry of nearbyEntries) {
      if (entry.memory_id) {
        const m = await this.getMemory(entry.memory_id);
        if (m) memories.push(m);
      }
    }

    return memories;
  }

  /**
   * Load the index
   */
  async loadIndex(): Promise<MemoryIndex> {
    if (this.index) return this.index;

    const indexPath = path.join(this.baseDir, INDEX_FILE);
    const emptyIndex = this.createEmptyIndex();

    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      const loadedIndex = JSON.parse(content) as Partial<MemoryIndex>;

      // Merge loaded index with defaults to ensure all properties exist
      this.index = {
        ...emptyIndex,
        ...loadedIndex,
        by_type: {
          ...emptyIndex.by_type,
          ...(loadedIndex.by_type || {}),
        },
        by_tag: {
          ...emptyIndex.by_tag,
          ...(loadedIndex.by_tag || {}),
        },
        by_file: {
          ...emptyIndex.by_file,
          ...(loadedIndex.by_file || {}),
        },
        by_status: {
          ...emptyIndex.by_status,
          ...(loadedIndex.by_status || {}),
        },
      };
      return this.index;
    } catch {
      this.index = emptyIndex;
      return this.index;
    }
  }

  /**
   * Load the timeline
   */
  async loadTimeline(): Promise<Timeline> {
    if (this.timeline) return this.timeline;

    const timelinePath = path.join(this.baseDir, TIMELINE_FILE);
    try {
      const content = await fs.readFile(timelinePath, 'utf-8');
      this.timeline = JSON.parse(content) as Timeline;
      return this.timeline;
    } catch {
      this.timeline = { entries: [], last_updated: new Date().toISOString() };
      return this.timeline;
    }
  }

  /**
   * Load the config
   */
  async loadConfig(): Promise<MemoryConfig> {
    if (this.config) return this.config;

    const configPath = path.join(this.baseDir, CONFIG_FILE);
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      this.config = YAML.parse(content) as MemoryConfig;
      return this.config;
    } catch {
      this.config = this.createDefaultConfig();
      return this.config;
    }
  }

  // Private helper methods

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private generateFilename(timestamp: string, type: MemoryType, id: string): string {
    const dateStr = timestamp.replace(/[:.]/g, '-').slice(0, 19);
    return `${dateStr}_${type}_${id}.yaml`;
  }

  private async findMemoryFile(id: string): Promise<string | null> {
    // Validate ID format (should be 12 characters from UUID, may include hyphen)
    // UUID format is xxxxxxxx-xxxx-..., so slice(0,12) gives xxxxxxxx-xxx
    if (!/^[a-f0-9-]{8,12}$/i.test(id)) {
      return null;
    }

    const memoriesDir = path.join(this.baseDir, MEMORIES_SUBDIR);
    try {
      const files = await fs.readdir(memoriesDir);
      // Use more precise matching: ID should be at the end before .yaml
      const match = files.find(f => f.endsWith(`_${id}.yaml`) || f.endsWith(`-${id}.yaml`));
      return match || null;
    } catch {
      return null;
    }
  }

  private createEmptyIndex(): MemoryIndex {
    return {
      version: '1.0',
      last_updated: new Date().toISOString(),
      by_type: {
        decision: [],
        event: [],
        fact: [],
        preference: [],
        context: [],
        conclusion: [],
      },
      by_tag: {},
      by_file: {},
      by_status: {
        active: [],
        superseded: [],
        archived: [],
      },
      recent: [],
      high_importance: [],
    };
  }

  private createDefaultConfig(): MemoryConfig {
    return {
      version: '1.0',
      instance_id: this.instanceId,
      storage: {
        max_memories: 1000,
        max_tasks: 100,
        prune_after_days: 90,
        archive_instead_of_delete: true,
      },
      retrieval: {
        auto_load_recent: 10,
        auto_load_high_importance: true,
        max_context_memories: 20,
      },
      instance: {
        capabilities: ['coding', 'testing'],
        heartbeat_interval_seconds: 60,
      },
    };
  }

  private async saveIndex(index: MemoryIndex): Promise<void> {
    index.last_updated = new Date().toISOString();
    this.index = index;
    const indexPath = path.join(this.baseDir, INDEX_FILE);
    // Use atomic write: write to temp file, then rename
    const tempPath = `${indexPath}.tmp.${process.pid}`;
    await fs.writeFile(tempPath, JSON.stringify(index, null, 2), 'utf-8');
    await fs.rename(tempPath, indexPath);
  }

  private async saveTimeline(timeline: Timeline): Promise<void> {
    timeline.last_updated = new Date().toISOString();
    this.timeline = timeline;
    const timelinePath = path.join(this.baseDir, TIMELINE_FILE);
    // Use atomic write: write to temp file, then rename
    const tempPath = `${timelinePath}.tmp.${process.pid}`;
    await fs.writeFile(tempPath, JSON.stringify(timeline, null, 2), 'utf-8');
    await fs.rename(tempPath, timelinePath);
  }

  private async saveConfig(config: MemoryConfig): Promise<void> {
    this.config = config;
    const configPath = path.join(this.baseDir, CONFIG_FILE);
    await fs.writeFile(configPath, YAML.stringify(config), 'utf-8');
  }

  private async addToIndex(memory: Memory): Promise<void> {
    const index = await this.loadIndex();

    // Add to by_type (handle unknown types defensively)
    if (!index.by_type[memory.type]) {
      index.by_type[memory.type] = [];
    }
    index.by_type[memory.type].push(memory.id);

    // Add to by_tag
    for (const tag of memory.tags) {
      index.by_tag[tag] = index.by_tag[tag] || [];
      index.by_tag[tag].push(memory.id);
    }

    // Add to by_file
    if (memory.context?.related_files) {
      for (const file of memory.context.related_files) {
        index.by_file[file] = index.by_file[file] || [];
        index.by_file[file].push(memory.id);
      }
    }

    // Add to by_status (handle unknown statuses defensively)
    if (!index.by_status[memory.status]) {
      index.by_status[memory.status] = [];
    }
    index.by_status[memory.status].push(memory.id);

    // Add to recent (keep last 50)
    index.recent.unshift(memory.id);
    if (index.recent.length > 50) {
      index.recent = index.recent.slice(0, 50);
    }

    // Add to high_importance if applicable
    if (memory.importance >= 0.7) {
      index.high_importance.push(memory.id);
    }

    await this.saveIndex(index);
  }

  private async addToTimeline(entry: TimelineEntry): Promise<void> {
    const timeline = await this.loadTimeline();
    timeline.entries.push(entry);

    // Keep last 500 entries
    if (timeline.entries.length > 500) {
      timeline.entries = timeline.entries.slice(-500);
    }

    await this.saveTimeline(timeline);
  }

  private removeFromIndexArrays(index: MemoryIndex, memoryId: string): void {
    // Remove from all type arrays
    for (const type of Object.keys(index.by_type) as MemoryType[]) {
      index.by_type[type] = index.by_type[type].filter(id => id !== memoryId);
    }

    // Remove from all status arrays
    for (const status of Object.keys(index.by_status) as MemoryStatus[]) {
      index.by_status[status] = index.by_status[status].filter(id => id !== memoryId);
    }

    // Remove from recent
    index.recent = index.recent.filter(id => id !== memoryId);

    // Remove from high_importance
    index.high_importance = index.high_importance.filter(id => id !== memoryId);
  }

  private async createReadme(): Promise<void> {
    const readmePath = path.join(this.baseDir, 'README.md');
    if (await this.fileExists(readmePath)) return;

    const readme = `# Claude Memory System

This directory contains the **version-controlled** shared memory for Claude instances working on this project.

## Directory Structure

The memory system uses two directories:

### .claude-memory/ (this directory - VERSION CONTROLLED)
Contains project knowledge that should be shared across all developers and sessions:
\`\`\`
.claude-memory/
├── README.md           <- You are here
├── config.yaml         <- Project settings
├── index.json          <- Fast memory lookups
├── timeline.json       <- Chronological view of events
├── memories/           <- Persistent knowledge (decisions, facts, preferences)
├── completed/          <- Completed tasks with results
└── archive/            <- Archived memories
\`\`\`

### .claude-memory-runtime/ (GIT IGNORED)
Contains instance-specific runtime data:
\`\`\`
.claude-memory-runtime/
├── instances/          <- Active Claude instances registry
│   └── activity.yaml   <- Who's working, what they're doing
├── inbox/              <- Direct messages between instances
├── tasks/
│   ├── pending/        <- Unclaimed tasks
│   └── in_progress/    <- Tasks being worked on
├── failed/             <- Failed tasks
└── artifacts/          <- Temporary files from tasks
\`\`\`

## For New Claude Instances

Welcome! Here's how to participate:

### On Startup
1. Read this file and check \`index.json\` for important memories
2. Load high-importance memories from \`memories/\`
3. Check \`.claude-memory-runtime/instances/activity.yaml\` for active instances
4. Register yourself in the activity file
5. Check \`.claude-memory-runtime/tasks/pending/\` for claimable tasks

### Storing Memories
Create a memory when:
- A significant decision is made
- A bug root cause is found
- User expresses a preference
- An investigation reaches a conclusion
- A milestone is completed

Memory types: \`decision\`, \`event\`, \`fact\`, \`preference\`, \`context\`, \`conclusion\`

### Task Delegation
To delegate work:
1. Create a task in \`.claude-memory-runtime/tasks/pending/\`
2. Specify required capabilities or target instance
3. Check \`.claude-memory/completed/\` for results

To claim a task:
1. Check \`pending/\` for tasks matching your capabilities
2. Move to \`in_progress/\`, update claimed_by
3. Complete work, move to \`.claude-memory/completed/\` with results

### Capabilities
- \`coding\` - Write/modify code
- \`browser_testing\` - Browser access
- \`visual_testing\` - View screenshots
- \`git\` - Git operations
- \`deployment\` - Deploy to environments
- \`research\` - Web research

### Conflict Resolution
1. Check \`supersedes\` links in memories
2. Use timestamps - more recent wins
3. Read timeline for context
4. The most recent non-superseded memory wins

### Best Practices
1. **Always check memories on startup** - especially high-importance ones
2. Store preferences immediately when users express them
3. Link related memories together
4. Use appropriate importance scores (0.9 for critical, 0.3 for minor)
5. Commit memory changes along with code changes
`;

    await fs.writeFile(readmePath, readme, 'utf-8');
  }
}
