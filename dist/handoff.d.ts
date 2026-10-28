export type ToolResult = {
    content: {
        type: 'text';
        text: string;
    }[];
    isError?: true;
};
/** Wraps an API result for MCP; flags it as an error when it carries an `error` key. */
export declare function toolResult(result: unknown): ToolResult;
/** Finds a board column by name (spaces collapsed, case-insensitive). Exactly one match or an error. */
export declare function resolveListByName(lists: {
    id: number;
    title: string;
}[], name: string): {
    id: number;
} | {
    error: string;
};
/** Boolean tool argument: some clients send "true"/"1" as strings. */
export declare function isTrue(value: unknown): boolean;
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
/**
 * ProTask shows comments with v-html: text sent through the API must be escaped (same as the `message` of a move)
 * and line breaks turned into <br>.
 */
export declare function escapeCommentHtml(text: string): string;
/** Schema of `notify_user_ids`, shared by both transports. */
export declare const NOTIFY_USER_IDS_SCHEMA: {
    readonly type: "array";
    readonly items: {
        readonly type: "integer";
    };
    readonly maxItems: 20;
    readonly description: "User ids to notify (max 20), only people the user named";
};
export declare const DESCRIPTIONS: Record<string, string>;
export declare const SERVER_INSTRUCTIONS: string;
