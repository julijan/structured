export type LooseObject = Record<string, any>;
export type KeysOfUnion<T> = T extends T ? keyof T : never;