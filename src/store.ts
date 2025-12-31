/**
 * Claude Memory System - Storage Layer
 *
 * Handles reading/writing memories to the filesystem
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
} from './types.js';

const MEMORY_DIR = '.claude-memory';
const MEMORIES_SUBDIR = 'memories';
const INDEX_FILE = 'index.json';
const TIMELINE_FILE = 'timeline.json';
const CONFIG_FILE = 'config.yaml';

export class MemoryStore {
  private baseDir: string;
  private instanceId: string;
  private index: MemoryIndex | null = null;
  private timeline: Timeline | null = null;
  private config: MemoryConfig | null = null;

  constructor(baseDir: string = process.cwd(), instanceId?: string) {
    this.baseDir = path.join(baseDir, MEMORY_DIR);
    this.instanceId = instanceId || `instance_${uuidv4().slice(0, 8)}`;
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
   * Initialize the memory system in the current directory
   */
  async init(): Promise<void> {
    // Create directory structure
    await fs.mkdir(path.join(this.baseDir, MEMORIES_SUBDIR), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'tasks', 'pending'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'tasks', 'in_progress'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'tasks', 'completed'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'tasks', 'failed'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'instances'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'inbox'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'artifacts'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'archive'), { recursive: true });

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

    // Create README
    await this.createReadme();
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
      importance: input.importance ?? 0.5,
      confidence: input.confidence ?? 0.8,
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

    // Update index
    const index = await this.loadIndex();
    this.removeFromIndexArrays(index, memoryId);
    index.by_status['superseded'] = index.by_status['superseded'] || [];
    index.by_status['superseded'].push(memoryId);
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
    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      this.index = JSON.parse(content) as MemoryIndex;
      return this.index;
    } catch {
      this.index = this.createEmptyIndex();
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
    const memoriesDir = path.join(this.baseDir, MEMORIES_SUBDIR);
    try {
      const files = await fs.readdir(memoriesDir);
      const match = files.find(f => f.includes(id) && f.endsWith('.yaml'));
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
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  private async saveTimeline(timeline: Timeline): Promise<void> {
    timeline.last_updated = new Date().toISOString();
    this.timeline = timeline;
    const timelinePath = path.join(this.baseDir, TIMELINE_FILE);
    await fs.writeFile(timelinePath, JSON.stringify(timeline, null, 2), 'utf-8');
  }

  private async saveConfig(config: MemoryConfig): Promise<void> {
    this.config = config;
    const configPath = path.join(this.baseDir, CONFIG_FILE);
    await fs.writeFile(configPath, YAML.stringify(config), 'utf-8');
  }

  private async addToIndex(memory: Memory): Promise<void> {
    const index = await this.loadIndex();

    // Add to by_type
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

    // Add to by_status
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

This directory contains a shared memory and coordination system for Claude instances working on this project.

## For New Claude Instances

Welcome! You're now part of a distributed team of Claude instances. Here's how to participate:

### On Startup
1. Read this file (you're doing that now)
2. Check \`instances/activity.yaml\` to see who else is working
3. Register yourself by updating \`instances/activity.yaml\`
4. Check \`tasks/pending/\` for any tasks you can help with
5. Load relevant memories from \`memories/\` based on your task

### Storing Memories
When you learn something important, create a memory using the memory system. Store a memory when:
- A significant decision is made
- A bug root cause is found
- User expresses a preference
- An investigation reaches a conclusion
- A milestone is completed

Memory types: \`decision\`, \`event\`, \`fact\`, \`preference\`, \`context\`, \`conclusion\`

### Task Delegation
To request another instance do something:
1. Create a task file in \`tasks/pending/\`
2. Specify required capabilities or target instance
3. Poll \`tasks/completed/\` or check your inbox for results

To claim a task:
1. Check \`tasks/pending/\` for tasks matching your capabilities
2. Move the file to \`tasks/in_progress/\`
3. Update status and claimed_by fields
4. Complete the work
5. Move to \`tasks/completed/\` with results

### Directory Structure
\`\`\`
.claude-memory/
├── README.md           <- You are here
├── config.yaml         <- System settings
├── memories/           <- Persistent knowledge
├── tasks/              <- Task delegation queue
│   ├── pending/        <- Unclaimed tasks
│   ├── in_progress/    <- Being worked on
│   ├── completed/      <- Done (with results)
│   └── failed/         <- Failed tasks
├── instances/          <- Who's active
├── inbox/              <- Direct messages
├── artifacts/          <- Files from tasks
├── archive/            <- Old/pruned memories
├── index.json          <- Fast lookup
└── timeline.json       <- Chronological view
\`\`\`

### Capabilities
Common capabilities to register:
- \`coding\` - Can write/modify code
- \`browser_testing\` - Has browser access
- \`visual_testing\` - Can view screenshots
- \`git\` - Can perform git operations
- \`deployment\` - Can deploy to environments
- \`research\` - Can do web research

### Conflict Resolution
When you find conflicting information:
1. Check the \`supersedes\` links in memories
2. Use timestamps to determine recency
3. Read surrounding memories for context (via timeline)
4. The most recent non-superseded memory wins

### Best Practices
1. Update your activity status regularly
2. Complete or hand off tasks before going offline
3. Write clear, descriptive memories
4. Link related memories together
5. Use appropriate importance/confidence scores
`;

    await fs.writeFile(readmePath, readme, 'utf-8');
  }
}
