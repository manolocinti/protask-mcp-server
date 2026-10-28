export type ToolResult = {
    content: {
        type: 'text';
        text: string;
    }[];
    isError?: true;
};
/** Wraps an API result for MCP; flags it as an error when it carries an `error` key. */
export declare function toolResult(result: unknown): ToolResult;
/** Finds a board column by name (trimmed, case-insensitive). Exactly one match or an error. */
export declare function resolveListByName(lists: {
    id: number;
    title: string;
}[], name: string): {
    id: number;
} | {
    error: string;
};
/** A move that asked for a notification must come back with `notified_user_ids` (older ProTask omits it). */
export declare function checkMoveResponse(handoffRequested: boolean, response: unknown): unknown;
export type MoveData = {
    list_id: number;
    order?: number;
    message?: string;
    notify_user_ids?: number[];
};
export interface MoveClient {
    getTask(id: number): Promise<any>;
    listBoardLists(projectId: number): Promise<any>;
    moveTask(taskId: number, data: MoveData): Promise<any>;
}
export declare function runMoveTask(client: MoveClient, args: Record<string, unknown>): Promise<unknown>;
export declare const DESCRIPTIONS: Record<string, string>;
export declare const SERVER_INSTRUCTIONS: string;
