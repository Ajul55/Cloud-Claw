/**
 * File Manager Tools — Cloudstick API
 *
 * - upload_file (Tier 3)
 * - create_file (Tier 3)
 * - create_folder (Tier 3)
 * - rename_file (Tier 3)
 * - move_file (Tier 3)
 * - copy_file (Tier 3)
 * - change_file_permissions (Tier 3)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── Upload File (Tier 3) ───────────────────────────────────────────────────

const uploadFileTool: Tool = {
    name: 'upload_file',
    description:
        'Upload a file to the specified server path via the Cloudstick API. ' +
        'The file_content must be base64 encoded. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            destination_path: { type: 'string', description: 'Destination path on server' },
            file_content: { type: 'string', description: 'Base64-encoded file content' },
            file_name: { type: 'string', description: 'File name to create' },
        },
        required: ['server_id', 'destination_path', 'file_content', 'file_name'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will upload "${args.file_name}" to ${args.destination_path} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('upload_file', {
            server_id: String(args.server_id),
            destination_path: String(args.destination_path),
            file_name: String(args.file_name),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Upload "${args.file_name}" to ${args.destination_path}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.uploadFile(
                String(args.server_id), userId(),
                {
                    destination_path: String(args.destination_path),
                    file_content: String(args.file_content),
                    file_name: String(args.file_name),
                }
            );
            return { success: true, output: `File "${args.file_name}" uploaded to ${args.destination_path}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `File upload failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Create File (Tier 3) ───────────────────────────────────────────────────

const createFileTool: Tool = {
    name: 'create_file',
    description:
        'Create a new empty file at the given path via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            path: { type: 'string', description: 'Directory path for the new file' },
            file_name: { type: 'string', description: 'Name of the file to create' },
        },
        required: ['server_id', 'path', 'file_name'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create an empty file "${args.file_name}" at ${args.path} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_file', {
            server_id: String(args.server_id),
            path: String(args.path),
            file_name: String(args.file_name),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create file "${args.file_name}" at ${args.path}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createFile(
                String(args.server_id), userId(),
                { path: String(args.path), file_name: String(args.file_name) }
            );
            return { success: true, output: `File "${args.file_name}" created at ${args.path}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `File creation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Create Folder (Tier 3) ─────────────────────────────────────────────────

const createFolderTool: Tool = {
    name: 'create_folder',
    description:
        'Create a new folder at the given path via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            path: { type: 'string', description: 'Parent directory path' },
            folder_name: { type: 'string', description: 'Name of the folder to create' },
        },
        required: ['server_id', 'path', 'folder_name'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create folder "${args.folder_name}" at ${args.path} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_folder', {
            server_id: String(args.server_id),
            path: String(args.path),
            folder_name: String(args.folder_name),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create folder "${args.folder_name}" at ${args.path}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createFolder(
                String(args.server_id), userId(),
                { path: String(args.path), folder_name: String(args.folder_name) }
            );
            return { success: true, output: `Folder "${args.folder_name}" created at ${args.path}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Folder creation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Rename File (Tier 3) ────────────────────────────────────────────────────

const renameFileTool: Tool = {
    name: 'rename_file',
    description:
        'Rename a file or directory on a Cloudstick website. ' +
        'Provide the parent path, current name, and new name. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            path: { type: 'string', description: 'Parent directory path containing the file' },
            name: { type: 'string', description: 'Current file or directory name' },
            new_name: { type: 'string', description: 'New file or directory name' },
        },
        required: ['website', 'server_id', 'path', 'name', 'new_name'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `Rename "${args.name}" to "${args.new_name}" at ${args.path} on ${args.website}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('rename_file', {
            website: String(args.website),
            server_id: String(args.server_id),
            path: String(args.path),
            name: String(args.name),
            new_name: String(args.new_name),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Rename "${args.name}" to "${args.new_name}" at ${args.path}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.renameFile(
                String(args.website), String(args.server_id), userId(), {
                    path: String(args.path),
                    name: String(args.name),
                    new_name: String(args.new_name),
                }
            );
            return { success: true, output: `Renamed "${args.name}" to "${args.new_name}" at ${args.path}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Rename failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Move File (Tier 3) ─────────────────────────────────────────────────────

const moveFileTool: Tool = {
    name: 'move_file',
    description:
        'Move a file or directory to a new path on a Cloudstick website. ' +
        'Provide the current path, name, and the target directory. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            path: { type: 'string', description: 'Current parent directory path' },
            name: { type: 'string', description: 'Current file or directory name' },
            new_path: { type: 'string', description: 'Target directory path to move the file to' },
        },
        required: ['website', 'server_id', 'path', 'name', 'new_path'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `Move "${args.name}" from ${args.path} to ${args.new_path} on ${args.website}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('move_file', {
            website: String(args.website),
            server_id: String(args.server_id),
            path: String(args.path),
            name: String(args.name),
            new_path: String(args.new_path),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Move "${args.name}" from ${args.path} to ${args.new_path}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.moveFile(
                String(args.website), String(args.server_id), userId(), {
                    path: String(args.path),
                    name: String(args.name),
                    new_path: String(args.new_path),
                }
            );
            return { success: true, output: `Moved "${args.name}" to ${args.new_path}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Move failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Copy File (Tier 3) ───────────────────────────────────────────────────────

const copyFileTool: Tool = {
    name: 'copy_file',
    description:
        'Copy a file or directory on a Cloudstick website. ' +
        'Provide the parent path, file name, and optionally a new name for the copy. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            path: { type: 'string', description: 'Parent directory path containing the file' },
            name: { type: 'string', description: 'File or directory name to copy' },
            new_name: { type: 'string', description: 'Optional: name for the copy' },
        },
        required: ['website', 'server_id', 'path', 'name'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `Copy "${args.name}" at ${args.path} on ${args.website}${args.new_name ? ` as "${args.new_name}"` : ''}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('copy_file', {
            website: String(args.website),
            server_id: String(args.server_id),
            path: String(args.path),
            name: String(args.name),
            new_name: args.new_name !== undefined ? String(args.new_name) : '',
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Copy "${args.name}"${args.new_name ? ` as "${args.new_name}"` : ''}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.copyFile(
                String(args.website), String(args.server_id), userId(), {
                    path: String(args.path),
                    name: String(args.name),
                    new_name: args.new_name !== undefined ? String(args.new_name) : undefined,
                }
            );
            return { success: true, output: `Copied "${args.name}"${args.new_name ? ` as "${args.new_name}"` : ''}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Copy failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Change File Permissions (Tier 3) ─────────────────────────────────────────

const changeFilePermissionsTool: Tool = {
    name: 'change_file_permissions',
    description:
        'Change the permissions (chmod) of a file or directory on a Cloudstick website. ' +
        'Permissions are specified as an octal string (e.g. "644", "755", "600"). ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            path: { type: 'string', description: 'Parent directory path containing the file' },
            name: { type: 'string', description: 'File or directory name' },
            permissions: { type: 'string', description: 'Octal permissions string (e.g. "644", "755", "600")' },
        },
        required: ['website', 'server_id', 'path', 'name', 'permissions'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `Set permissions ${args.permissions} on "${args.name}" at ${args.path} on ${args.website}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('change_file_permissions', {
            website: String(args.website),
            server_id: String(args.server_id),
            path: String(args.path),
            name: String(args.name),
            permissions: String(args.permissions),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Set permissions ${args.permissions} on "${args.name}" at ${args.path}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.changeFilePermissions(
                String(args.website), String(args.server_id), userId(), {
                    path: String(args.path),
                    name: String(args.name),
                    permissions: String(args.permissions),
                }
            );
            return { success: true, output: `Set permissions ${args.permissions} on "${args.name}".\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Permission change failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

export {
    uploadFileTool,
    createFileTool,
    createFolderTool,
    renameFileTool,
    moveFileTool,
    copyFileTool,
    changeFilePermissionsTool,
};
