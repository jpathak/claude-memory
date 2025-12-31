#!/usr/bin/env node
/**
 * Claude Memory CLI
 *
 * Command-line interface for the Claude Memory System
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { ClaudeMemory } from './index.js';
import { MemoryType, CreateMemoryInput, CreateTaskInput } from './types.js';

const program = new Command();

program
  .name('claude-mem')
  .description('Claude Memory System - Persistent memory and coordination for Claude instances')
  .version('0.1.0');

// Initialize memory system
program
  .command('init')
  .description('Initialize Claude Memory in the current directory')
  .option('-c, --capabilities <caps>', 'Comma-separated capabilities', 'coding')
  .action(async (options) => {
    const memory = new ClaudeMemory(process.cwd(), {
      capabilities: options.capabilities.split(','),
    });

    if (await memory.isInitialized()) {
      console.log(chalk.yellow('Claude Memory already initialized in this directory'));
      return;
    }

    await memory.init();
    console.log(chalk.green('✓ Claude Memory initialized'));
    console.log(chalk.dim(`  Memory dir: ${memory.getMemoryDir()} (version controlled)`));
    console.log(chalk.dim(`  Runtime dir: ${memory.getRuntimeDir()} (git ignored)`));
    console.log(chalk.dim(`  Instance ID: ${memory.getInstanceId()}`));
    await memory.shutdown();
  });

// Store a memory
program
  .command('store')
  .description('Store a new memory')
  .requiredOption('-t, --type <type>', 'Memory type (decision|event|fact|preference|context|conclusion)')
  .requiredOption('--title <title>', 'Memory title')
  .requiredOption('-s, --summary <summary>', 'Memory summary')
  .option('-d, --details <details>', 'Detailed description')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-i, --importance <number>', 'Importance (0-1)', '0.5')
  .option('--files <files>', 'Comma-separated related files')
  .action(async (options) => {
    const memory = new ClaudeMemory();

    if (!await memory.isInitialized()) {
      console.log(chalk.red('Claude Memory not initialized. Run: claude-mem init'));
      return;
    }

    await memory.init();

    const input: CreateMemoryInput = {
      type: options.type as MemoryType,
      title: options.title,
      summary: options.summary,
      details: options.details,
      tags: options.tags?.split(',').map((t: string) => t.trim()) || [],
      importance: parseFloat(options.importance),
      context: options.files ? {
        related_files: options.files.split(',').map((f: string) => f.trim()),
      } : undefined,
    };

    const stored = await memory.remember(input);
    console.log(chalk.green(`✓ Memory stored: ${stored.id}`));
    console.log(chalk.dim(`  Type: ${stored.type}`));
    console.log(chalk.dim(`  Title: ${stored.title}`));

    await memory.shutdown();
  });

// Recall memories
program
  .command('recall [query]')
  .description('Recall memories by search query or list recent')
  .option('-t, --type <type>', 'Filter by type')
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .option('-n, --limit <number>', 'Maximum number of results', '10')
  .option('--important', 'Only show high importance memories')
  .action(async (query, options) => {
    const memory = new ClaudeMemory();

    if (!await memory.isInitialized()) {
      console.log(chalk.red('Claude Memory not initialized. Run: claude-mem init'));
      return;
    }

    await memory.init();

    const memories = await memory.search({
      search: query,
      types: options.type ? [options.type as MemoryType] : undefined,
      tags: options.tags?.split(',').map((t: string) => t.trim()),
      limit: parseInt(options.limit),
      min_importance: options.important ? 0.7 : undefined,
    });

    if (memories.length === 0) {
      console.log(chalk.yellow('No memories found'));
    } else {
      console.log(chalk.bold(`Found ${memories.length} memories:\n`));

      for (const mem of memories) {
        const typeColor = {
          decision: chalk.blue,
          event: chalk.green,
          fact: chalk.cyan,
          preference: chalk.magenta,
          context: chalk.yellow,
          conclusion: chalk.red,
        }[mem.type] || chalk.white;

        console.log(`${typeColor(`[${mem.type}]`)} ${chalk.bold(mem.title)}`);
        console.log(chalk.dim(`  ID: ${mem.id} | ${mem.timestamp.slice(0, 10)} | Importance: ${mem.importance}`));
        console.log(`  ${mem.summary}`);
        if (mem.tags.length > 0) {
          console.log(chalk.dim(`  Tags: ${mem.tags.join(', ')}`));
        }
        console.log();
      }
    }

    await memory.shutdown();
  });

// Show timeline
program
  .command('timeline')
  .description('Show memory timeline')
  .option('-n, --limit <number>', 'Number of entries', '20')
  .action(async (options) => {
    const memory = new ClaudeMemory();

    if (!await memory.isInitialized()) {
      console.log(chalk.red('Claude Memory not initialized. Run: claude-mem init'));
      return;
    }

    await memory.init();

    const entries = await memory.getTimeline(parseInt(options.limit));

    if (entries.length === 0) {
      console.log(chalk.yellow('No timeline entries'));
    } else {
      console.log(chalk.bold('Timeline:\n'));

      for (const entry of entries) {
        const date = entry.timestamp.slice(0, 10);
        const time = entry.timestamp.slice(11, 16);
        console.log(`${chalk.dim(date)} ${chalk.dim(time)} ${chalk.cyan(`[${entry.type}]`)} ${entry.summary}`);
        if (entry.supersedes && entry.supersedes.length > 0) {
          console.log(chalk.yellow(`  ↑ supersedes: ${entry.supersedes.join(', ')}`));
        }
      }
    }

    await memory.shutdown();
  });

// Delegate a task
program
  .command('delegate')
  .description('Delegate a task to another instance')
  .requiredOption('--title <title>', 'Task title')
  .requiredOption('-d, --description <desc>', 'Task description')
  .option('-i, --instructions <instructions>', 'Detailed instructions')
  .option('-c, --capabilities <caps>', 'Required capabilities (comma-separated)')
  .option('-p, --priority <priority>', 'Priority (low|normal|high|critical)', 'normal')
  .option('--timeout <minutes>', 'Timeout in minutes')
  .action(async (options) => {
    const memory = new ClaudeMemory();

    if (!await memory.isInitialized()) {
      console.log(chalk.red('Claude Memory not initialized. Run: claude-mem init'));
      return;
    }

    await memory.init();

    const input: CreateTaskInput = {
      title: options.title,
      description: options.description,
      instructions: options.instructions,
      priority: options.priority,
      target: options.capabilities ? {
        capabilities: options.capabilities.split(',').map((c: string) => c.trim()),
      } : undefined,
      timeout_minutes: options.timeout ? parseInt(options.timeout) : undefined,
    };

    const task = await memory.delegate(input);
    console.log(chalk.green(`✓ Task delegated: ${task.id}`));
    console.log(chalk.dim(`  Title: ${task.title}`));
    console.log(chalk.dim(`  Status: ${task.status}`));

    await memory.shutdown();
  });

// List tasks
program
  .command('tasks')
  .description('List tasks')
  .option('-a, --available', 'Show only tasks I can claim')
  .option('-m, --mine', 'Show tasks I created or claimed')
  .action(async (options) => {
    const memory = new ClaudeMemory();

    if (!await memory.isInitialized()) {
      console.log(chalk.red('Claude Memory not initialized. Run: claude-mem init'));
      return;
    }

    await memory.init();

    let tasks;
    let title;

    if (options.available) {
      tasks = await memory.getAvailableTasks();
      title = 'Available Tasks';
    } else {
      // Get pending tasks by default
      tasks = await memory.getAvailableTasks();
      title = 'Pending Tasks';
    }

    if (tasks.length === 0) {
      console.log(chalk.yellow(`No ${title.toLowerCase()}`));
    } else {
      console.log(chalk.bold(`${title}:\n`));

      for (const task of tasks) {
        const statusColor = {
          pending: chalk.yellow,
          claimed: chalk.blue,
          in_progress: chalk.cyan,
          completed: chalk.green,
          failed: chalk.red,
          cancelled: chalk.gray,
        }[task.status] || chalk.white;

        console.log(`${statusColor(`[${task.status}]`)} ${chalk.bold(task.title)}`);
        console.log(chalk.dim(`  ID: ${task.id}`));
        console.log(`  ${task.description.slice(0, 100)}${task.description.length > 100 ? '...' : ''}`);
        if (task.target.capabilities && task.target.capabilities.length > 0) {
          console.log(chalk.dim(`  Requires: ${task.target.capabilities.join(', ')}`));
        }
        console.log();
      }
    }

    await memory.shutdown();
  });

// Claim a task
program
  .command('claim <taskId>')
  .description('Claim a pending task')
  .action(async (taskId) => {
    const memory = new ClaudeMemory();

    if (!await memory.isInitialized()) {
      console.log(chalk.red('Claude Memory not initialized. Run: claude-mem init'));
      return;
    }

    await memory.init();

    try {
      const task = await memory.claimTask(taskId);
      if (task) {
        console.log(chalk.green(`✓ Claimed task: ${task.id}`));
        console.log(chalk.dim(`  Title: ${task.title}`));
      } else {
        console.log(chalk.red('Task not found'));
      }
    } catch (err) {
      console.log(chalk.red(`Error: ${(err as Error).message}`));
    }

    await memory.shutdown();
  });

// Complete a task
program
  .command('complete <taskId>')
  .description('Mark a task as complete')
  .option('-o, --output <json>', 'Output data as JSON')
  .action(async (taskId, options) => {
    const memory = new ClaudeMemory();

    if (!await memory.isInitialized()) {
      console.log(chalk.red('Claude Memory not initialized. Run: claude-mem init'));
      return;
    }

    await memory.init();

    try {
      const task = await memory.completeTask(taskId, {
        success: true,
        output: options.output ? {
          type: 'json',
          data: JSON.parse(options.output),
        } : undefined,
      });

      if (task) {
        console.log(chalk.green(`✓ Completed task: ${task.id}`));
      } else {
        console.log(chalk.red('Task not found'));
      }
    } catch (err) {
      console.log(chalk.red(`Error: ${(err as Error).message}`));
    }

    await memory.shutdown();
  });

// Show status
program
  .command('status')
  .description('Show memory system status')
  .action(async () => {
    const memory = new ClaudeMemory();

    if (!await memory.isInitialized()) {
      console.log(chalk.red('Claude Memory not initialized. Run: claude-mem init'));
      return;
    }

    await memory.init();

    console.log(chalk.bold('Claude Memory Status\n'));
    console.log(`Instance ID: ${chalk.cyan(memory.getInstanceId())}`);
    console.log(`Memory dir: ${chalk.dim(memory.getMemoryDir())} ${chalk.green('(VCS)')}`);
    console.log(`Runtime dir: ${chalk.dim(memory.getRuntimeDir())} ${chalk.yellow('(ignored)')}`);


    // Active instances
    const instances = await memory.getActiveInstances();
    console.log(`\n${chalk.bold('Active Instances:')} ${instances.length}`);
    for (const inst of instances) {
      const status = inst.current_status === 'active' ? chalk.green('●') : chalk.yellow('○');
      console.log(`  ${status} ${inst.instance_id} (${inst.machine}) - ${inst.working_on || 'idle'}`);
    }

    // Recent memories
    const recent = await memory.getRecent(5);
    console.log(`\n${chalk.bold('Recent Memories:')} ${recent.length}`);
    for (const mem of recent) {
      console.log(`  [${mem.type}] ${mem.title}`);
    }

    // Pending tasks
    const tasks = await memory.getAvailableTasks();
    console.log(`\n${chalk.bold('Available Tasks:')} ${tasks.length}`);
    for (const task of tasks.slice(0, 3)) {
      console.log(`  [${task.priority}] ${task.title}`);
    }

    // Unread messages
    const messages = await memory.getMessages();
    if (messages.length > 0) {
      console.log(`\n${chalk.bold('Unread Messages:')} ${chalk.yellow(messages.length.toString())}`);
      for (const msg of messages.slice(0, 3)) {
        console.log(`  From ${msg.from}: ${msg.message.slice(0, 50)}...`);
      }
    }

    // Recent activity
    const activity = await memory.getActivity(5);
    console.log(`\n${chalk.bold('Recent Activity:')}`);
    for (const act of activity) {
      const time = act.timestamp.slice(11, 16);
      console.log(`  ${chalk.dim(time)} ${act.instance_id}: ${act.action}`);
    }

    await memory.shutdown();
  });

// Show recent activity
program
  .command('activity')
  .description('Show recent activity log')
  .option('-n, --limit <number>', 'Number of entries', '20')
  .action(async (options) => {
    const memory = new ClaudeMemory();

    if (!await memory.isInitialized()) {
      console.log(chalk.red('Claude Memory not initialized. Run: claude-mem init'));
      return;
    }

    await memory.init();

    const activity = await memory.getActivity(parseInt(options.limit));

    if (activity.length === 0) {
      console.log(chalk.yellow('No activity recorded'));
    } else {
      console.log(chalk.bold('Recent Activity:\n'));

      for (const act of activity) {
        const date = act.timestamp.slice(0, 10);
        const time = act.timestamp.slice(11, 16);
        console.log(`${chalk.dim(date)} ${chalk.dim(time)} ${chalk.cyan(act.instance_id)}: ${act.action}`);
        if (act.details) {
          console.log(chalk.dim(`  ${act.details}`));
        }
      }
    }

    await memory.shutdown();
  });

// Parse and execute
program.parse();
