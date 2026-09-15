export interface StoredAudio {
    id: string;
    bytes: Uint8Array;
    mimeType: string;
    createdAt: string;
}
export declare class AudioStore {
    private readonly store;
    put(bytes: Uint8Array, mimeType: string): StoredAudio;
    get(id: string): StoredAudio | null;
    clear(): void;
}
//# sourceMappingURL=audio-store.d.ts.map