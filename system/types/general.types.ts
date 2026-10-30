export type LooseObject = Record<string, any>;
export type KeysOfUnion<T> = T extends T ? keyof T : never;
export type BooleanKeys<T> = {
	[K in keyof T]: T[K] extends boolean ? K : never;
}[keyof T];